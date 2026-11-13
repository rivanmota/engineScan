import { CheckContext, FindingInput } from "./types";
import { safeFetch } from "./safeFetch";

const CHECK_ID = "exposed-paths";

// Passive GETs only — this never attempts to read file contents or exploit
// anything, it just flags paths that respond with HTTP 200 and therefore
// shouldn't be publicly reachable at all.
const SENSITIVE_PATHS = [
  ".env",
  ".git/config",
  ".git/HEAD",
  "wp-config.php.bak",
  "config.php.bak",
  "backup.zip",
  "backup.sql",
  "admin",
  ".DS_Store",
];

export async function checkExposedPaths(ctx: CheckContext): Promise<FindingInput[]> {
  const base = ctx.targetUrl.endsWith("/") ? ctx.targetUrl : `${ctx.targetUrl}/`;

  const results = await Promise.allSettled(
    SENSITIVE_PATHS.map(async (path) => {
      const url = new URL(path, base).toString();
      const res = await safeFetch(url, { timeoutMs: 3000 });
      return { path, url, status: res.status };
    })
  );

  const findings: FindingInput[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.status === 200) {
      findings.push({
        checkId: CHECK_ID,
        severity: "high",
        title: `Potentially exposed path: /${result.value.path}`,
        evidence: `GET ${result.value.url} returned HTTP 200.`,
      });
    }
    // Rejected probes (network errors, timeouts) and non-200 statuses are
    // expected for the vast majority of targets and aren't reported.
  }

  if (findings.length === 0) {
    findings.push({
      checkId: CHECK_ID,
      severity: "info",
      title: "No commonly exposed paths found",
      evidence: `Checked ${SENSITIVE_PATHS.length} common sensitive path(s); none returned HTTP 200.`,
    });
  }

  return findings;
}
