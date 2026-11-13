"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiKey } from "../ApiKeyProvider";
import { describeCadence } from "@/lib/schedules/cadence";
import { apiFetch, AuthorizationBadge, ChangeChips, formatDate, Schedule, SeverityCounts } from "./shared";

export default function SchedulesOverviewPage() {
  const { apiKey } = useApiKey();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    apiFetch<Schedule[]>("/schedules", apiKey)
      .then((data) => !cancelled && setSchedules(data))
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Schedules</h1>
          <p className="page-subtitle">
            Targets that are re-scanned automatically, so you can see what got fixed and what regressed.
          </p>
        </div>
        <Link href="/dashboard/schedules/new" className="btn btn-primary">
          New schedule
        </Link>
      </div>

      {!apiKey && <div className="card card-padded empty-state">Enter your X-Api-Key above to load schedules.</div>}

      {apiKey && error && <p className="error-banner">{error}</p>}

      {apiKey && !schedules && !error && <div className="card card-padded empty-state">Loading…</div>}

      {apiKey && schedules && schedules.length === 0 && (
        <div className="card card-padded empty-state">
          No schedules yet. <Link href="/dashboard/schedules/new">Schedule a target</Link> to have it re-scanned
          automatically.
        </div>
      )}

      {apiKey && schedules && schedules.length > 0 && (
        <ul className="scan-list">
          {schedules.map((s) => (
            <li key={s.id}>
              <Link href={`/dashboard/schedules/${s.id}`} className="scan-row">
                <div className="scan-row-main">
                  <span className="scan-row-url">{s.targetUrl}</span>
                  <span className="scan-row-meta">
                    {describeCadence(s.cadence, s.timeZone)}
                    {s.enabled ? (
                      <>
                        {" "}
                        · {s.lastRunAt ? "Next run" : "First run"} {formatDate(s.nextRunAt)}
                      </>
                    ) : (
                      <> · Paused</>
                    )}
                    {s.lastRunAt && <> · Last run {formatDate(s.lastRunAt)}</>}
                  </span>
                  {s.lastRunStatus && s.lastRunStatus !== "completed" && s.lastError && (
                    <span className="scan-row-meta" style={{ color: "var(--color-danger)" }}>
                      Last run {s.lastRunStatus}: {s.lastError}
                    </span>
                  )}
                </div>
                <div className="scan-row-aside">
                  {s.summary.latestRun && <ChangeChips run={s.summary.latestRun} />}
                  {s.summary.latestRun && <SeverityCounts counts={s.summary.openIssueCounts} />}
                  <AuthorizationBadge expiresAt={s.authorizationExpiresAt} />
                  <span className={`badge badge-status-${s.enabled ? "active" : "paused"}`}>
                    {s.enabled ? "active" : "paused"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
