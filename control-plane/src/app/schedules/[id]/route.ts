import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { scheduleFromDoc } from "@/lib/converters";
import { nextRunAfter, sameCadence } from "@/lib/schedules/cadence";
import { SCHEDULES_COLLECTION } from "@/lib/schedules/runner";
import {
  cadenceSchema,
  firstRunAfterExpiryError,
  startAtSchema,
  timeZoneSchema,
} from "@/lib/schedules/validation";
import { buildScheduleDetailView, getScheduleForOrg } from "@/lib/schedules/store";

type Params = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const { id } = await params;

    const schedule = await getScheduleForOrg(id, organizationId);
    if (!schedule) return notFound();

    return NextResponse.json(await buildScheduleDetailView(schedule));
  } catch (e) {
    return errorResponse(e);
  }
}

// The target URL is deliberately not editable: a different target needs its
// own schedule and its own authorization. The authorization is renewed via
// POST /schedules/:id/authorization.
const updateScheduleSchema = z
  .object({
    enabled: z.boolean().optional(),
    cadence: cadenceSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    // (Re)start the schedule from this moment: no runs before it.
    startAt: startAtSchema.optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Provide at least one of: enabled, cadence, timeZone, startAt",
  });

// Pause/resume, change when the schedule runs, or postpone it to a start date.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const { id } = await params;

    const parsed = updateScheduleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const db = getDb();
    const ref = db.collection(SCHEDULES_COLLECTION).doc(id);
    const outcome = await db.runTransaction(async (tx): Promise<"ok" | "not-found" | { error: string }> => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.organizationId !== organizationId) return "not-found";

      const current = scheduleFromDoc(snap);
      const now = new Date();
      const enabled = body.enabled ?? current.enabled;
      const cadence = body.cadence ?? current.cadence;
      const timeZone = body.timeZone ?? current.timeZone;

      const timingChanged = !sameCadence(cadence, current.cadence) || timeZone !== current.timeZone;
      const startPending = current.cadenceAnchorAt.getTime() > now.getTime();
      let anchor = current.cadenceAnchorAt;
      if (body.startAt) {
        anchor = body.startAt;
      } else if (timingChanged && !startPending) {
        // A new cadence counts its "every N" from the last run, so e.g.
        // switching to "every 6 hours" two hours after a run goes again in
        // four. (A schedule that hasn't reached its start date keeps it.)
        anchor = current.lastRunAt ?? now;
      }

      const recompute = body.startAt !== undefined || timingChanged || !current.enabled;
      let nextRunAt: Date | null;
      if (!enabled) nextRunAt = null; // paused
      else if (recompute) nextRunAt = nextRunAfter({ cadence, timeZone, anchor }, now);
      else nextRunAt = current.nextRunAt; // no-op: don't shift the schedule

      if (body.startAt) {
        const firstRun = nextRunAt ?? nextRunAfter({ cadence, timeZone, anchor }, now);
        const expiryProblem = firstRunAfterExpiryError(firstRun, current.authorizationExpiresAt);
        if (expiryProblem) return { error: expiryProblem };
      }

      tx.update(ref, { enabled, cadence, timeZone, cadenceAnchorAt: anchor, nextRunAt, updatedAt: now });
      return "ok";
    });
    if (outcome === "not-found") return notFound();
    if (typeof outcome === "object") return NextResponse.json({ error: outcome.error }, { status: 400 });

    const schedule = (await getScheduleForOrg(id, organizationId))!;
    return NextResponse.json(await buildScheduleDetailView(schedule));
  } catch (e) {
    return errorResponse(e);
  }
}

// Stops monitoring. Scans the schedule already ran are kept and stay visible
// in the scan history.
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const { id } = await params;

    const schedule = await getScheduleForOrg(id, organizationId);
    if (!schedule) return notFound();

    await getDb().collection(SCHEDULES_COLLECTION).doc(id).delete();
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
