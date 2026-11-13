"use client";

import type { ScheduleCadence } from "@/lib/schedules/cadence";
import { authorizationState, daysUntil } from "@/lib/schedules/authorization";

// Client-side shapes of the /schedules API responses (dates arrive as ISO
// strings), plus small display helpers shared by the schedule pages.

export type Severity = "high" | "medium" | "low";

export interface IssueRef {
  key: string;
  checkId: string;
  title: string;
  severity: Severity;
}

export interface RunSummary {
  scanId: string;
  status: string;
  createdAt: string;
  openIssueCounts: Record<Severity, number> | null;
  baseline: boolean;
  newIssues: IssueRef[];
  regressedIssues: IssueRef[];
  fixedIssues: IssueRef[];
  inconclusiveChecks: string[];
}

export interface TrackedIssue extends IssueRef {
  status: "open" | "fixed";
  firstSeenAt: string;
  lastSeenAt: string;
  fixedAt: string | null;
  regressionCount: number;
  unverified: boolean;
}

export interface Schedule {
  id: string;
  targetUrl: string;
  cadence: ScheduleCadence;
  timeZone: string;
  cadenceAnchorAt: string;
  authorizedByName: string;
  authorizedByEmail: string;
  authorizedAt: string;
  authorizationExpiresAt: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastScanId: string | null;
  lastRunStatus: "completed" | "failed" | "skipped" | null;
  lastError: string | null;
  createdAt: string;
  summary: {
    openIssueCounts: Record<Severity, number>;
    latestRun: RunSummary | null;
  };
}

export interface ScheduleDetail extends Schedule {
  runs: RunSummary[];
  issues: TrackedIssue[];
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export async function apiFetch<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) {
    const error = typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data);
    throw new Error(error);
  }
  return data as T;
}

export function SeverityCounts({ counts }: { counts: Record<Severity, number> }) {
  const nonZero = (["high", "medium", "low"] as const).filter((s) => counts[s] > 0);
  if (nonZero.length === 0) return <span className="change-chip change-chip-fixed">No open issues</span>;
  return (
    <span className="severity-counts">
      {nonZero.map((s) => (
        <span key={s} className={`badge badge-severity-${s}`}>
          {counts[s]} {s}
        </span>
      ))}
    </span>
  );
}

export function ChangeChips({ run }: { run: RunSummary }) {
  if (run.status !== "completed") return null;
  if (run.baseline) return <span className="change-chip change-chip-neutral">Baseline</span>;

  const chips: Array<[string, string]> = [];
  if (run.newIssues.length) chips.push(["new", `+${run.newIssues.length} new`]);
  if (run.regressedIssues.length) chips.push(["regressed", `${run.regressedIssues.length} regressed`]);
  if (run.fixedIssues.length) chips.push(["fixed", `${run.fixedIssues.length} fixed`]);
  if (chips.length === 0) chips.push(["neutral", "No changes"]);

  return (
    <span className="change-chips">
      {chips.map(([kind, label]) => (
        <span key={kind} className={`change-chip change-chip-${kind}`}>
          {label}
        </span>
      ))}
    </span>
  );
}

/** Badge for a schedule's authorization: nothing while it's comfortably valid. */
export function AuthorizationBadge({ expiresAt }: { expiresAt: string }) {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const state = authorizationState(expiry, now);
  if (state === "valid") return null;
  if (state === "expired") return <span className="badge badge-auth-expired">Authorization expired</span>;
  const days = daysUntil(expiry, now);
  return (
    <span className="badge badge-auth-expiring">
      Authorization expires in {days} day{days === 1 ? "" : "s"}
    </span>
  );
}
