import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { isSafeScanTarget } from "@/lib/scanScope";
import { firstRunFrom, nextRunAfter } from "@/lib/schedules/cadence";
import { SCHEDULES_COLLECTION } from "@/lib/schedules/runner";
import {
  attestationSchema,
  cadenceSchema,
  firstRunAfterExpiryError,
  startAtSchema,
  timeZoneSchema,
} from "@/lib/schedules/validation";
import {
  buildScheduleDetailView,
  buildScheduleView,
  findScheduleByTarget,
  getScheduleForOrg,
  listSchedulesForOrg,
} from "@/lib/schedules/store";

const createScheduleSchema = z.object({
  targetUrl: z.string().url(),
  cadence: cadenceSchema,
  // Wall-clock times in the cadence are in this IANA timezone.
  timeZone: timeZoneSchema.default("UTC"),
  // Optional: don't run before this moment. Without it, the first run is
  // the cadence's next slot after now.
  startAt: startAtSchema.optional(),
  // Same attestation as a one-off scan (see docs/SAFETY_AND_SCOPE.md), plus
  // when it expires. It covers every scan this schedule runs until then.
  ...attestationSchema,
});

// Creates a schedule. Nothing is scanned at creation time: the first scan
// happens at the schedule's first run (use POST /schedules/:id/run to scan
// right away). That first completed scan is the baseline later runs are
// compared against.
export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);

    const parsed = createScheduleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    await isSafeScanTarget(body.targetUrl);

    const existing = await findScheduleByTarget(organizationId, body.targetUrl);
    if (existing) {
      return NextResponse.json(
        { error: "A schedule for this target URL already exists.", scheduleId: existing.id },
        { status: 409 }
      );
    }

    const now = new Date();
    const anchor = body.startAt ?? now;
    const firstRun = body.startAt
      ? firstRunFrom(body.cadence, body.timeZone, body.startAt)
      : nextRunAfter({ cadence: body.cadence, timeZone: body.timeZone, anchor }, now);
    const expiryProblem = firstRunAfterExpiryError(firstRun, body.authorizationExpiresAt);
    if (expiryProblem) {
      return NextResponse.json({ error: expiryProblem }, { status: 400 });
    }

    const ref = getDb().collection(SCHEDULES_COLLECTION).doc();
    await ref.set({
      organizationId,
      targetUrl: body.targetUrl,
      cadence: body.cadence,
      timeZone: body.timeZone,
      cadenceAnchorAt: anchor,
      authorizedByName: body.authorizedByName,
      authorizedByEmail: body.authorizedByEmail,
      authorizedAt: now,
      authorizationExpiresAt: body.authorizationExpiresAt,
      enabled: true,
      nextRunAt: firstRun,
      lastRunAt: null,
      lastScanId: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    const schedule = (await getScheduleForOrg(ref.id, organizationId))!;
    return NextResponse.json(await buildScheduleDetailView(schedule), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const schedules = await listSchedulesForOrg(organizationId);
    return NextResponse.json(await Promise.all(schedules.map(buildScheduleView)));
  } catch (e) {
    return errorResponse(e);
  }
}
