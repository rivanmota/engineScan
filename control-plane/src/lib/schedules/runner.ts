import { DocumentReference } from "firebase-admin/firestore";
import { getDb } from "@/lib/firestore";
import { scheduleFromDoc } from "@/lib/converters";
import { executeScan, ScanWithFindings } from "@/lib/executeScan";
import { ScopeViolation } from "@/lib/scanScope";
import { ScanSchedule, ScheduleRunStatus } from "@/types/firestore";
import { nextRunAfter } from "./cadence";
import { AUTHORIZATION_EXPIRED_ERROR_PREFIX, isAuthorizationExpired } from "./authorization";

// Executes scan schedules. Two entry points:
//   - runDueSchedules(): called periodically (in-process ticker, see
//     src/instrumentation.ts, and/or an external cron hitting
//     POST /internal/schedules/run-due) to run every schedule whose
//     nextRunAt has passed.
//   - runSchedule(): runs one schedule immediately ("Run now"). Doesn't
//     move nextRunAt.
//
// Every run is skipped (nothing is sent to the target) if the schedule's
// authorization has expired or the target has become out of scope.
//
// Safe to run from several processes at once: a due schedule is claimed in a
// Firestore transaction that also advances its nextRunAt, so exactly one
// caller wins each run and the others see it as no longer due.

export const SCHEDULES_COLLECTION = "scanSchedules";

// How many due schedules one tick picks up, and how many scans it runs in
// parallel. Anything left over is picked up by the next tick.
const DEFAULT_TICK_LIMIT = 10;
const TICK_CONCURRENCY = 3;

export interface ScheduleRunResult {
  scheduleId: string;
  status: ScheduleRunStatus;
  scanId: string | null;
  error: string | null;
  scan: ScanWithFindings | null;
}

export interface TickResult {
  due: number;
  ran: number;
  results: Array<Omit<ScheduleRunResult, "scan">>;
}

export async function runSchedule(schedule: ScanSchedule): Promise<ScheduleRunResult> {
  const result = await attemptRun(schedule);
  await recordRunOutcome(schedule.id, result);
  return result;
}

async function attemptRun(schedule: ScanSchedule): Promise<ScheduleRunResult> {
  if (isAuthorizationExpired(schedule.authorizationExpiresAt, new Date())) {
    // Nothing is sent to the target without a current attestation.
    return {
      scheduleId: schedule.id,
      status: "skipped",
      scanId: null,
      error: `${AUTHORIZATION_EXPIRED_ERROR_PREFIX} on ${schedule.authorizationExpiresAt.toISOString()}. Renew it to resume scanning.`,
      scan: null,
    };
  }

  try {
    const scan = await executeScan({
      organizationId: schedule.organizationId,
      targetUrl: schedule.targetUrl,
      authorizedByName: schedule.authorizedByName,
      authorizedByEmail: schedule.authorizedByEmail,
      authorizedAt: schedule.authorizedAt,
      scheduleId: schedule.id,
    });
    return {
      scheduleId: schedule.id,
      status: scan.status === "completed" ? "completed" : "failed",
      scanId: scan.id,
      error: null,
      scan,
    };
  } catch (e) {
    if (e instanceof ScopeViolation) {
      // The target stopped being a safe scan target (e.g. its DNS now points
      // at a private address). Nothing was sent to it; record why.
      return { scheduleId: schedule.id, status: "skipped", scanId: null, error: e.message, scan: null };
    }
    console.error(`Scheduled scan ${schedule.id} failed`, e);
    return {
      scheduleId: schedule.id,
      status: "failed",
      scanId: null,
      error: "Unexpected error while running the scan.",
      scan: null,
    };
  }
}

async function recordRunOutcome(scheduleId: string, result: ScheduleRunResult): Promise<void> {
  const now = new Date();
  const update: Record<string, unknown> = {
    lastRunAt: now,
    lastRunStatus: result.status,
    lastError: result.error,
    updatedAt: now,
  };
  // A skipped run created no scan; keep pointing at the last real one.
  if (result.scanId) update.lastScanId = result.scanId;

  try {
    await getDb().collection(SCHEDULES_COLLECTION).doc(scheduleId).update(update);
  } catch (e) {
    // The schedule was deleted while its scan was running. The scan itself is
    // kept (it's an ordinary scan now); there's just nothing left to update.
    if (isNotFound(e)) return;
    throw e;
  }
}

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === 5; // gRPC NOT_FOUND
}

/**
 * Atomically claims one due run of a schedule. Returns the schedule if this
 * caller won the claim, or null if it's no longer due (paused, deleted, or
 * already claimed by another tick/process).
 */
async function claimDueRun(ref: DocumentReference, now: Date): Promise<ScanSchedule | null> {
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const schedule = scheduleFromDoc(snap);
    if (!schedule.enabled || !schedule.nextRunAt || schedule.nextRunAt.getTime() > now.getTime()) {
      return null;
    }

    tx.update(ref, {
      // Strictly after `now`: if the scheduler was down and several slots
      // were missed, this run covers them and the next one is in the future.
      nextRunAt: nextRunAfter(
        { cadence: schedule.cadence, timeZone: schedule.timeZone, anchor: schedule.cadenceAnchorAt },
        now
      ),
      updatedAt: now,
    });
    return schedule;
  });
}

export async function runDueSchedules(options: { now?: Date; limit?: number } = {}): Promise<TickResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_TICK_LIMIT;

  // Paused schedules have nextRunAt = null, which never matches `<=`, so this
  // single-field range query needs no composite index.
  const dueSnap = await getDb()
    .collection(SCHEDULES_COLLECTION)
    .where("nextRunAt", "<=", now)
    .orderBy("nextRunAt")
    .limit(limit)
    .get();

  const queue = [...dueSnap.docs];
  const results: TickResult["results"] = [];

  async function worker() {
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      try {
        const claimed = await claimDueRun(doc.ref, now);
        if (!claimed) continue;
        const { scheduleId, status, scanId, error } = await runSchedule(claimed);
        results.push({ scheduleId, status, scanId, error });
      } catch (e) {
        // One broken schedule must not stop the rest of the tick.
        console.error(`Failed to run schedule ${doc.id}`, e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(TICK_CONCURRENCY, queue.length) }, worker));

  return { due: dueSnap.size, ran: results.length, results };
}
