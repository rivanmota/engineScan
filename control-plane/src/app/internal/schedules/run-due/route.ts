import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { errorResponse } from "@/lib/httpErrors";
import { runDueSchedules } from "@/lib/schedules/runner";

// Trigger for an external cron (Cloud Scheduler, Vercel Cron, plain crontab,
// ...) in deployments where the in-process ticker isn't suitable, e.g.
// serverless or when you'd rather not have every instance tick. Runs every
// schedule that is due, across all organizations.
//
// Not an org-facing endpoint: it authenticates with the SCHEDULER_SECRET env
// var (`Authorization: Bearer <secret>`) instead of an X-Api-Key, and is
// disabled entirely when that variable isn't set.

function isAuthorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(req: NextRequest) {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Scheduler trigger is disabled (SCHEDULER_SECRET is not set)." }, { status: 404 });
  }
  if (!isAuthorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runDueSchedules());
  } catch (e) {
    return errorResponse(e);
  }
}
