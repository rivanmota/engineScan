import { checkSecurityHeaders } from "./checks/securityHeaders";
import { checkTlsConfig } from "./checks/tlsConfig";
import { checkExposedPaths } from "./checks/exposedPaths";
import { checkCookieFlags } from "./checks/cookieFlags";
import { Check, CheckContext, FindingInput, CHECK_FAILED_EVIDENCE_PREFIX } from "./checks/types";

// Orchestrates every check module against a target URL. Each check runs
// independently with its own timeout; a check that throws or times out
// fails soft into a single `info` finding instead of aborting the whole
// scan, so one slow/broken probe never loses the other results.

const CHECKS: Array<{ id: string; run: Check }> = [
  { id: "security-headers", run: checkSecurityHeaders },
  { id: "tls-config", run: checkTlsConfig },
  { id: "exposed-paths", run: checkExposedPaths },
  { id: "cookie-flags", run: checkCookieFlags },
];

const CHECK_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} check timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export async function runScan(targetUrl: string): Promise<FindingInput[]> {
  const ctx: CheckContext = { targetUrl };

  const settled = await Promise.allSettled(
    CHECKS.map((check) => withTimeout(check.run(ctx), CHECK_TIMEOUT_MS, check.id))
  );

  const findings: FindingInput[] = [];
  settled.forEach((result, i) => {
    const { id: checkId } = CHECKS[i];
    if (result.status === "fulfilled") {
      findings.push(...result.value);
    } else {
      findings.push({
        checkId,
        severity: "info",
        title: `${checkId} check failed`,
        evidence: `${CHECK_FAILED_EVIDENCE_PREFIX} ${String(result.reason)}`,
      });
    }
  });

  return findings;
}
