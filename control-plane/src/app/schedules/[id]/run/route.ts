import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiKey } from "@/lib/auth";
import { errorResponse } from "@/lib/httpErrors";
import { runSchedule } from "@/lib/schedules/runner";
import { getScheduleForOrg } from "@/lib/schedules/store";

// "Run now": scans the schedule's target immediately, outside its cadence.
// Works while paused too. Doesn't change when the next automatic run is due.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const { id } = await params;

    const schedule = await getScheduleForOrg(id, organizationId);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    const result = await runSchedule(schedule);
    if (result.status === "skipped") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (!result.scan) {
      return NextResponse.json({ error: result.error ?? "Internal server error" }, { status: 500 });
    }
    return NextResponse.json(result.scan, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
