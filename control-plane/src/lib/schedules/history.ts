import { Finding, FindingSeverity, ScanStatus } from "@/types/firestore";
import { CHECK_FAILED_EVIDENCE_PREFIX } from "@/lib/checks/types";

// Turns a schedule's run history (a series of scans of the same target) into
// "what changed": which issues are new, which were fixed, which came back.
// Pure function over plain data so it can be unit tested without Firestore;
// nothing here is persisted — it's recomputed from the scans on every read.
//
// Identity: a finding is "the same issue" across scans when its checkId and
// title match. Titles are stable per issue (e.g. `Missing Content-Security-
// Policy header`, `Cookie "sid" is missing security flags`), while evidence
// often isn't (e.g. "expires in N days"), so evidence is deliberately not part
// of the key.
//
// Only real issues (severity low/medium/high) are tracked. `info` findings are
// status notes ("Security headers look good") rather than problems.
//
// A check that failed to run (timeout, target unreachable) is "inconclusive"
// for that scan: issues from that check are neither confirmed nor marked
// fixed, so an outage never looks like a fix.

// How many of a schedule's most recent scans the detail view analyses. Lives
// here (not in store.ts) so client components can import it too.
export const DETAIL_HISTORY_LIMIT = 30;

export type IssueSeverity = Exclude<FindingSeverity, "info">;

export interface HistoryFinding {
  checkId: string;
  severity: FindingSeverity;
  title: string;
  evidence: string;
}

export interface HistoryScan {
  id: string;
  status: ScanStatus;
  createdAt: Date;
  findings: HistoryFinding[];
}

export interface IssueRef {
  key: string;
  checkId: string;
  title: string;
  severity: IssueSeverity;
}

export interface RunSummary {
  scanId: string;
  status: ScanStatus;
  createdAt: Date;
  // Only meaningful for completed scans; null otherwise.
  openIssueCounts: Record<IssueSeverity, number> | null;
  // True for the first completed scan in the analysed window: there is nothing
  // earlier to compare against, so it reports no new/fixed/regressed issues.
  baseline: boolean;
  newIssues: IssueRef[]; // never seen before in this history
  regressedIssues: IssueRef[]; // had been fixed, and came back
  fixedIssues: IssueRef[]; // were open, now gone (and the check ran fine)
  inconclusiveChecks: string[]; // checks that failed to run in this scan
}

export type IssueStatus = "open" | "fixed";

export interface TrackedIssue extends IssueRef {
  status: IssueStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  fixedAt: Date | null;
  // How many times this issue came back after having been fixed.
  regressionCount: number;
  // Open, but its check couldn't run in the most recent completed scan, so
  // the "open" status is carried over rather than freshly confirmed.
  unverified: boolean;
}

export interface HistoryAnalysis {
  runs: RunSummary[]; // newest first
  issues: TrackedIssue[]; // open first, then by severity, then title
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 };

export function issueKey(f: Pick<HistoryFinding, "checkId" | "title">): string {
  return `${f.checkId}::${f.title}`;
}

export function isCheckFailureFinding(f: HistoryFinding): boolean {
  return f.severity === "info" && f.evidence.startsWith(CHECK_FAILED_EVIDENCE_PREFIX);
}

function isIssue(f: HistoryFinding): f is HistoryFinding & { severity: IssueSeverity } {
  return f.severity !== "info";
}

function toRef(issue: IssueRef): IssueRef {
  return { key: issue.key, checkId: issue.checkId, title: issue.title, severity: issue.severity };
}

export function analyzeScanHistory(scans: HistoryScan[]): HistoryAnalysis {
  const chronological = [...scans].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const issues = new Map<string, TrackedIssue>();
  const runs: RunSummary[] = [];
  let sawCompletedScan = false;

  for (const scan of chronological) {
    if (scan.status !== "completed") {
      // Pending/running/failed scans carry no usable signal; list them, but
      // don't let them move any issue's status.
      runs.push({
        scanId: scan.id,
        status: scan.status,
        createdAt: scan.createdAt,
        openIssueCounts: null,
        baseline: false,
        newIssues: [],
        regressedIssues: [],
        fixedIssues: [],
        inconclusiveChecks: [],
      });
      continue;
    }

    const baseline = !sawCompletedScan;
    sawCompletedScan = true;

    const inconclusiveChecks = new Set(scan.findings.filter(isCheckFailureFinding).map((f) => f.checkId));

    const present = new Map<string, HistoryFinding & { severity: IssueSeverity }>();
    for (const f of scan.findings) {
      if (isIssue(f)) present.set(issueKey(f), f);
    }

    const newIssues: IssueRef[] = [];
    const regressedIssues: IssueRef[] = [];
    const fixedIssues: IssueRef[] = [];

    for (const [key, f] of present) {
      const existing = issues.get(key);
      if (!existing) {
        const issue: TrackedIssue = {
          key,
          checkId: f.checkId,
          title: f.title,
          severity: f.severity,
          status: "open",
          firstSeenAt: scan.createdAt,
          lastSeenAt: scan.createdAt,
          fixedAt: null,
          regressionCount: 0,
          unverified: false,
        };
        issues.set(key, issue);
        if (!baseline) newIssues.push(toRef(issue));
        continue;
      }

      existing.lastSeenAt = scan.createdAt;
      existing.severity = f.severity;
      existing.unverified = false;
      if (existing.status === "fixed") {
        existing.status = "open";
        existing.fixedAt = null;
        existing.regressionCount += 1;
        regressedIssues.push(toRef(existing));
      }
    }

    for (const issue of issues.values()) {
      if (present.has(issue.key) || issue.status !== "open") continue;
      if (inconclusiveChecks.has(issue.checkId)) {
        issue.unverified = true;
        continue;
      }
      issue.status = "fixed";
      issue.fixedAt = scan.createdAt;
      issue.unverified = false;
      fixedIssues.push(toRef(issue));
    }

    const openIssueCounts: Record<IssueSeverity, number> = { high: 0, medium: 0, low: 0 };
    for (const f of present.values()) openIssueCounts[f.severity] += 1;

    runs.push({
      scanId: scan.id,
      status: scan.status,
      createdAt: scan.createdAt,
      openIssueCounts,
      baseline,
      newIssues,
      regressedIssues,
      fixedIssues,
      inconclusiveChecks: [...inconclusiveChecks].sort(),
    });
  }

  const sortedIssues = [...issues.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return a.title.localeCompare(b.title);
  });

  return { runs: runs.reverse(), issues: sortedIssues };
}

export function toHistoryScan(scan: { id: string; status: ScanStatus; createdAt: Date; findings: Finding[] }): HistoryScan {
  return {
    id: scan.id,
    status: scan.status,
    createdAt: scan.createdAt,
    findings: scan.findings.map((f) => ({
      checkId: f.checkId,
      severity: f.severity,
      title: f.title,
      evidence: f.evidence,
    })),
  };
}
