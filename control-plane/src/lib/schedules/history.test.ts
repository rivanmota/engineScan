import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeScanHistory, HistoryFinding, HistoryScan } from "./history";
import { CHECK_FAILED_EVIDENCE_PREFIX } from "@/lib/checks/types";

const CSP: HistoryFinding = {
  checkId: "security-headers",
  severity: "medium",
  title: "Missing Content-Security-Policy header",
  evidence: "no CSP",
};
const XFO: HistoryFinding = {
  checkId: "security-headers",
  severity: "low",
  title: "Missing X-Frame-Options header",
  evidence: "no XFO",
};
const ENV: HistoryFinding = {
  checkId: "exposed-paths",
  severity: "high",
  title: "Potentially exposed path: /.env",
  evidence: "GET /.env returned HTTP 200.",
};
const HEADERS_OK: HistoryFinding = {
  checkId: "security-headers",
  severity: "info",
  title: "Security headers look good",
  evidence: "all present",
};
const failed = (checkId: string): HistoryFinding => ({
  checkId,
  severity: "info",
  title: `${checkId} check failed`,
  evidence: `${CHECK_FAILED_EVIDENCE_PREFIX} timed out`,
});

let seq = 0;
function scan(day: number, findings: HistoryFinding[], status: HistoryScan["status"] = "completed"): HistoryScan {
  return { id: `scan-${++seq}`, status, createdAt: new Date(Date.UTC(2026, 0, 1 + day)), findings };
}
const titles = (refs: { title: string }[]) => refs.map((r) => r.title).sort();

test("the first completed scan is a baseline with no changes", () => {
  const { runs, issues } = analyzeScanHistory([scan(0, [CSP, ENV])]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].baseline, true);
  assert.deepEqual(runs[0].newIssues, []);
  assert.deepEqual(runs[0].openIssueCounts, { high: 1, medium: 1, low: 0 });
  assert.deepEqual(issues.map((i) => [i.title, i.status]), [
    [ENV.title, "open"],
    [CSP.title, "open"],
  ]);
});

test("tracks new, fixed and regressed issues across runs", () => {
  const s1 = scan(0, [CSP, ENV]);
  const s2 = scan(1, [CSP, XFO]); // ENV fixed, XFO new
  const s3 = scan(2, [CSP, XFO, ENV]); // ENV back: regression
  const s4 = scan(3, [HEADERS_OK]); // everything fixed
  // Input order shouldn't matter.
  const { runs, issues } = analyzeScanHistory([s3, s1, s4, s2]);

  assert.deepEqual(runs.map((r) => r.scanId), [s4.id, s3.id, s2.id, s1.id], "newest first");
  const [r4, r3, r2] = runs;

  assert.deepEqual(titles(r2.newIssues), [XFO.title]);
  assert.deepEqual(titles(r2.fixedIssues), [ENV.title]);
  assert.deepEqual(r2.regressedIssues, []);

  assert.deepEqual(r3.newIssues, []);
  assert.deepEqual(titles(r3.regressedIssues), [ENV.title]);
  assert.deepEqual(r3.fixedIssues, []);

  assert.deepEqual(titles(r4.fixedIssues), [CSP.title, ENV.title, XFO.title].sort());
  assert.deepEqual(r4.openIssueCounts, { high: 0, medium: 0, low: 0 });

  const env = issues.find((i) => i.title === ENV.title)!;
  assert.equal(env.status, "fixed");
  assert.equal(env.regressionCount, 1);
  assert.deepEqual(env.firstSeenAt, s1.createdAt);
  assert.deepEqual(env.lastSeenAt, s3.createdAt);
  assert.deepEqual(env.fixedAt, s4.createdAt);
});

test("info findings are not tracked as issues", () => {
  const { runs, issues } = analyzeScanHistory([scan(0, [CSP]), scan(1, [HEADERS_OK])]);
  assert.deepEqual(runs[0].newIssues, []);
  assert.deepEqual(titles(runs[0].fixedIssues), [CSP.title]);
  assert.deepEqual(issues.map((i) => i.title), [CSP.title]);
});

test("an issue whose check failed to run is not reported as fixed", () => {
  const s1 = scan(0, [CSP, ENV]);
  // Target flaked: headers check timed out, exposed-paths ran fine and ENV is gone.
  const s2 = scan(1, [failed("security-headers")]);
  const { runs, issues } = analyzeScanHistory([s1, s2]);

  assert.deepEqual(titles(runs[0].fixedIssues), [ENV.title]);
  assert.deepEqual(runs[0].inconclusiveChecks, ["security-headers"]);

  const csp = issues.find((i) => i.title === CSP.title)!;
  assert.equal(csp.status, "open");
  assert.equal(csp.unverified, true);
  assert.deepEqual(csp.lastSeenAt, s1.createdAt);

  // Next run the check works again and the issue is still there: confirmed,
  // and not counted as new or regressed.
  const s3 = scan(2, [CSP]);
  const after = analyzeScanHistory([s1, s2, s3]);
  assert.deepEqual(after.runs[0].newIssues, []);
  assert.deepEqual(after.runs[0].regressedIssues, []);
  assert.equal(after.issues.find((i) => i.title === CSP.title)!.unverified, false);
});

test("failed and in-progress scans are listed but don't change issue status", () => {
  const s1 = scan(0, [CSP]);
  const s2 = scan(1, [], "failed");
  const s3 = scan(2, [], "running");
  const s4 = scan(3, [CSP]);
  const { runs, issues } = analyzeScanHistory([s1, s2, s3, s4]);

  assert.deepEqual(runs.map((r) => r.status), ["completed", "running", "failed", "completed"]);
  assert.equal(runs[1].openIssueCounts, null);
  assert.equal(runs[2].openIssueCounts, null);
  assert.deepEqual(runs[0].newIssues, []);
  assert.deepEqual(runs[0].fixedIssues, []);
  assert.equal(issues[0].status, "open");
});

test("a failed first scan doesn't stop the next completed scan being the baseline", () => {
  const { runs } = analyzeScanHistory([scan(0, [], "failed"), scan(1, [CSP])]);
  assert.equal(runs[0].baseline, true);
  assert.deepEqual(runs[0].newIssues, []);
});

test("severity changes keep the same issue and report the latest severity", () => {
  const cookie = (severity: "medium" | "low"): HistoryFinding => ({
    checkId: "cookie-flags",
    severity,
    title: 'Cookie "sid" is missing security flags',
    evidence: severity === "medium" ? "Missing: Secure, SameSite." : "Missing: SameSite.",
  });
  const { runs, issues } = analyzeScanHistory([scan(0, [cookie("medium")]), scan(1, [cookie("low")])]);
  assert.deepEqual(runs[0].newIssues, []);
  assert.deepEqual(runs[0].fixedIssues, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "low");
});

test("issues are ordered open first, then by severity", () => {
  const { issues } = analyzeScanHistory([scan(0, [XFO, ENV, CSP]), scan(1, [XFO, CSP])]);
  assert.deepEqual(
    issues.map((i) => `${i.status}:${i.severity}`),
    ["open:medium", "open:low", "fixed:high"]
  );
});
