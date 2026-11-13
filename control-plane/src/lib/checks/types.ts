import { Finding } from "@/types/firestore";

// Shared contract for every check module (src/lib/checks/*.ts).

export interface CheckContext {
  targetUrl: string;
}

export type FindingInput = Omit<Finding, "id" | "scanId" | "createdAt">;

export type Check = (ctx: CheckContext) => Promise<FindingInput[]>;

// Every "this check could not run" finding (timeouts, network errors, ...)
// must start its evidence with this prefix. Scheduled-scan history relies on
// it to tell "the issue is gone" apart from "we couldn't look this time", so
// a flaky or unreachable target never shows up as findings being fixed.
export const CHECK_FAILED_EVIDENCE_PREFIX = "Could not complete this check:";
