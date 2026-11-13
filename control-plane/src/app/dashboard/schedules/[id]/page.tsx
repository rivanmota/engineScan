"use client";

import { useCallback, useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApiKey } from "../../ApiKeyProvider";
import { AuthorizedEmailField } from "../../AuthorizedEmailField";
import { authorizerDomainError } from "@/lib/authorizedDomain";
import { DETAIL_HISTORY_LIMIT } from "@/lib/schedules/history";
import { describeCadence, sameCadence } from "@/lib/schedules/cadence";
import { authorizationState, daysUntil } from "@/lib/schedules/authorization";
import {
  apiFetch,
  ChangeChips,
  formatDate,
  formatDay,
  IssueRef,
  RunSummary,
  ScheduleDetail,
  SeverityCounts,
} from "../shared";
import {
  AuthorizationExpiryPicker,
  CadenceDraft,
  CadenceEditor,
  cadenceDraftError,
  cadenceToDraft,
  defaultExpiryDraft,
  draftStartAt,
  draftToCadence,
  expiryDraftError,
  expiryDraftToDate,
} from "../ScheduleInputs";

function RunChangeList({ run }: { run: RunSummary }) {
  const groups: Array<[string, IssueRef[]]> = [
    ["New", run.newIssues],
    ["Regressed", run.regressedIssues],
    ["Fixed", run.fixedIssues],
  ];
  const nonEmpty = groups.filter(([, issues]) => issues.length > 0);
  if (nonEmpty.length === 0 && run.inconclusiveChecks.length === 0) return null;

  return (
    <ul className="run-changes">
      {nonEmpty.map(([label, issues]) => (
        <li key={label}>
          <strong>{label}:</strong> {issues.map((i) => i.title).join("; ")}
        </li>
      ))}
      {run.inconclusiveChecks.length > 0 && (
        <li>
          <strong>Couldn&apos;t complete:</strong> {run.inconclusiveChecks.join(", ")} (issues from these checks were
          left unchanged)
        </li>
      )}
    </ul>
  );
}

function AuthorizationPanel({
  schedule,
  onRenew,
}: {
  schedule: ScheduleDetail;
  onRenew: (body: { authorizedByName: string; authorizedByEmail: string; authorizationExpiresAt: string }) => Promise<void>;
}) {
  const now = new Date();
  const expiresAt = new Date(schedule.authorizationExpiresAt);
  const state = authorizationState(expiresAt, now);
  const [renewing, setRenewing] = useState(false);
  const [name, setName] = useState(schedule.authorizedByName);
  const [email, setEmail] = useState(schedule.authorizedByEmail);
  const [expiry, setExpiry] = useState(defaultExpiryDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    // Same rule the API enforces; the field shows the explanation.
    if (authorizerDomainError(schedule.targetUrl, email)) {
      document.getElementById("renew-email")?.focus();
      return;
    }
    const submittedAt = new Date();
    const problem = expiryDraftError(expiry, submittedAt);
    if (problem) return setError(problem);
    setSubmitting(true);
    setError(null);
    try {
      await onRenew({
        authorizedByName: name,
        authorizedByEmail: email,
        authorizationExpiresAt: expiryDraftToDate(expiry, submittedAt)!.toISOString(),
      });
      setRenewing(false);
      setExpiry(defaultExpiryDraft());
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`card card-padded auth-panel auth-panel-${state}`}>
      <div className="auth-panel-top">
        <div>
          <p className="meta-label">Authorization</p>
          <p className="meta-value">
            {schedule.authorizedByName} ({schedule.authorizedByEmail}) on {formatDay(schedule.authorizedAt)} ·{" "}
            {state === "expired" ? "expired" : "expires"} {formatDate(schedule.authorizationExpiresAt)}
            {state !== "expired" && (
              <span className="muted"> ({daysUntil(expiresAt, now)} days left)</span>
            )}
          </p>
          {state === "expired" && (
            <p className="auth-panel-warning">
              Scheduled scans are skipped until the authorization is renewed.
            </p>
          )}
          {state === "expiring-soon" && (
            <p className="auth-panel-warning">
              Renew it before then to keep scheduled scans running.
            </p>
          )}
        </div>
        {!renewing && (
          <button
            type="button"
            className={`btn ${state === "valid" ? "btn-secondary" : "btn-primary"}`}
            onClick={() => setRenewing(true)}
          >
            Renew authorization
          </button>
        )}
      </div>

      {renewing && (
        <form onSubmit={submit} className="renew-form">
          <p className="panel-note">
            By renewing, you attest that you are authorized to have {schedule.targetUrl} scanned on this schedule
            until the new expiry date.
          </p>
          <div className="renew-form-fields">
            <div className="field">
              <label className="field-label" htmlFor="renew-name">
                Authorized by (name)
              </label>
              <input id="renew-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <AuthorizedEmailField
              id="renew-email"
              value={email}
              onChange={setEmail}
              targetUrl={schedule.targetUrl}
              forceShowError={submitAttempted}
            />
          </div>
          <AuthorizationExpiryPicker value={expiry} onChange={setExpiry} idPrefix="renew-expiry" />
          {error && <p className="error-banner">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Renewing…" : "Renew"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setRenewing(false)} disabled={submitting}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { apiKey } = useApiKey();
  const router = useRouter();
  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "run" | "toggle" | "cadence" | "delete">(null);
  // Non-null while the Re-scan editor is open.
  const [cadenceDraft, setCadenceDraft] = useState<CadenceDraft | null>(null);

  const load = useCallback(async () => {
    if (!apiKey) return;
    try {
      setSchedule(await apiFetch<ScheduleDetail>(`/schedules/${id}`, apiKey));
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    }
  }, [apiKey, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The anchor the server will count "every N" from if the draft is saved
  // (see PATCH /schedules/:id), so the preview matches what will happen.
  const previewAnchor = useMemo(() => {
    if (!schedule || !cadenceDraft) return new Date();
    const currentAnchor = new Date(schedule.cadenceAnchorAt);
    const unchanged =
      !cadenceDraftError(cadenceDraft) &&
      sameCadence(draftToCadence(cadenceDraft), schedule.cadence) &&
      cadenceDraft.timeZone === schedule.timeZone;
    // A schedule that hasn't reached its start date keeps it.
    if (unchanged || currentAnchor.getTime() > Date.now()) return currentAnchor;
    return schedule.lastRunAt ? new Date(schedule.lastRunAt) : new Date();
  }, [schedule, cadenceDraft]);

  async function act(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const update = (body: Record<string, unknown>) =>
    apiFetch<ScheduleDetail>(`/schedules/${id}`, apiKey, { method: "PATCH", body: JSON.stringify(body) }).then(
      setSchedule
    );

  if (!apiKey) {
    return <div className="card card-padded empty-state">Enter your X-Api-Key above to view this schedule.</div>;
  }
  if (loadError) return <p className="error-banner">{loadError}</p>;
  if (!schedule) return <div className="card card-padded empty-state">Loading…</div>;

  const openIssues = schedule.issues.filter((i) => i.status === "open");
  const cadenceProblem = cadenceDraft ? cadenceDraftError(cadenceDraft) : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{schedule.targetUrl}</h1>
          <p className="page-subtitle">{describeCadence(schedule.cadence, schedule.timeZone)}</p>
        </div>
        <span className={`badge badge-status-${schedule.enabled ? "active" : "paused"}`}>
          {schedule.enabled ? "active" : "paused"}
        </span>
      </div>

      <AuthorizationPanel
        key={schedule.authorizedAt}
        schedule={schedule}
        onRenew={async (body) => {
          const renewed = await apiFetch<ScheduleDetail>(`/schedules/${id}/authorization`, apiKey, {
            method: "POST",
            body: JSON.stringify(body),
          });
          setSchedule(renewed);
          setActionError(null);
        }}
      />

      <div className="card card-padded" style={{ marginTop: 16 }}>
        {cadenceDraft ? (
          <div className="cadence-edit">
            <CadenceEditor
              value={cadenceDraft}
              onChange={setCadenceDraft}
              anchor={previewAnchor}
              disabled={busy !== null}
              nextStartLabel="Keep the current timing"
            />
            <div className="form-actions">
              <button
                className="btn btn-primary"
                disabled={busy !== null || !!cadenceProblem}
                onClick={() =>
                  act("cadence", async () => {
                    await update({
                      cadence: draftToCadence(cadenceDraft),
                      timeZone: cadenceDraft.timeZone,
                      startAt: draftStartAt(cadenceDraft)?.toISOString(),
                    });
                    setCadenceDraft(null);
                  })
                }
              >
                {busy === "cadence" ? "Saving…" : "Save"}
              </button>
              <button className="btn btn-secondary" disabled={busy !== null} onClick={() => setCadenceDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="schedule-controls">
            <div className="schedule-cadence-summary">
              <p className="meta-label">Re-scan</p>
              <p className="meta-value">
                {describeCadence(schedule.cadence, schedule.timeZone)}{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setCadenceDraft(cadenceToDraft(schedule.cadence, schedule.timeZone))}
                >
                  Change
                </button>
              </p>
            </div>
            <button
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => act("toggle", () => update({ enabled: !schedule.enabled }))}
            >
              {busy === "toggle" ? "Saving…" : schedule.enabled ? "Pause" : "Resume"}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() =>
                act("run", async () => {
                  let runError: unknown = null;
                  try {
                    await apiFetch(`/schedules/${id}/run`, apiKey, { method: "POST" });
                  } catch (e) {
                    runError = e;
                  }
                  // A skipped/failed run is recorded on the schedule, which shows
                  // it as "Last run …" — only surface errors that weren't recorded.
                  const fresh = await apiFetch<ScheduleDetail>(`/schedules/${id}`, apiKey);
                  setSchedule(fresh);
                  if (runError && !fresh.lastError) throw runError;
                })
              }
            >
              {busy === "run" ? "Scanning…" : "Run now"}
            </button>
            <button
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() => {
                if (!window.confirm("Delete this schedule? Scans it already ran are kept.")) return;
                void act("delete", async () => {
                  await apiFetch(`/schedules/${id}`, apiKey, { method: "DELETE" });
                  router.push("/dashboard/schedules");
                });
              }}
            >
              Delete
            </button>
          </div>
        )}

        <div className="meta-grid" style={{ marginTop: 16 }}>
          <div>
            <p className="meta-label">{schedule.lastRunAt ? "Next run" : "First run"}</p>
            <p className="meta-value">{schedule.enabled ? formatDate(schedule.nextRunAt) : "Paused"}</p>
          </div>
          <div>
            <p className="meta-label">Last run</p>
            <p className="meta-value">
              {formatDate(schedule.lastRunAt)}
              {schedule.lastRunStatus && (
                <>
                  {" "}
                  <span className={`badge badge-status-${schedule.lastRunStatus}`}>{schedule.lastRunStatus}</span>
                </>
              )}
            </p>
          </div>
          <div>
            <p className="meta-label">Open issues</p>
            <p className="meta-value">
              {schedule.runs.length > 0 ? <SeverityCounts counts={schedule.summary.openIssueCounts} /> : "—"}
            </p>
          </div>
        </div>

        {schedule.lastError && schedule.lastRunStatus !== "completed" && (
          <p className="error-banner" style={{ marginTop: 16, marginBottom: 0 }}>
            Last run {schedule.lastRunStatus}: {schedule.lastError}
          </p>
        )}
        {actionError && (
          <p className="error-banner" style={{ marginTop: 16, marginBottom: 0 }}>
            {actionError}
          </p>
        )}
      </div>

      <h2 className="section-title">
        Issues{" "}
        <span className="muted text-sm" style={{ fontWeight: 500 }}>
          {openIssues.length} open · {schedule.issues.length - openIssues.length} fixed
        </span>
      </h2>
      {schedule.issues.length === 0 ? (
        <div className="card card-padded empty-state">
          {schedule.runs.length === 0
            ? "Issues will appear here after the first scan."
            : "No issues found in any run so far."}
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="issue-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Severity</th>
                <th>Status</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {schedule.issues.map((issue) => (
                <tr key={issue.key} className={issue.status === "fixed" ? "issue-fixed" : undefined}>
                  <td>
                    <div className="finding-title">{issue.title}</div>
                    <div className="issue-tags">
                      <span className="finding-check-id">{issue.checkId}</span>
                      {issue.regressionCount > 0 && (
                        <span className="badge badge-muted" title="Times this issue came back after being fixed">
                          regressed ×{issue.regressionCount}
                        </span>
                      )}
                      {issue.unverified && (
                        <span className="badge badge-muted" title="The check couldn't run in the latest scan">
                          unverified in latest run
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-severity-${issue.severity}`}>{issue.severity}</span>
                  </td>
                  <td>
                    <span className={`badge badge-issue-${issue.status}`}>{issue.status}</span>
                    {issue.fixedAt && <div className="muted text-sm">{formatDate(issue.fixedAt)}</div>}
                  </td>
                  <td>{formatDate(issue.firstSeenAt)}</td>
                  <td>{formatDate(issue.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">Run history</h2>
      {schedule.runs.length === 0 ? (
        <div className="card card-padded empty-state">
          No runs yet.{" "}
          {schedule.enabled && schedule.nextRunAt
            ? `The first scan is scheduled for ${formatDate(schedule.nextRunAt)}.`
            : "The schedule is paused."}{" "}
          Use Run now to scan right away.
        </div>
      ) : (
        <ul className="scan-list">
          {schedule.runs.map((run) => (
            <li key={run.scanId} className="run-row">
              <div className="run-row-top">
                <div className="scan-row-main">
                  <Link href={`/dashboard/scans/${run.scanId}`} className="scan-row-url">
                    {formatDate(run.createdAt)}
                  </Link>
                </div>
                <div className="scan-row-aside">
                  <ChangeChips run={run} />
                  {run.openIssueCounts && <SeverityCounts counts={run.openIssueCounts} />}
                  <span className={`badge badge-status-${run.status}`}>{run.status}</span>
                </div>
              </div>
              <RunChangeList run={run} />
            </li>
          ))}
        </ul>
      )}
      {schedule.runs.length >= DETAIL_HISTORY_LIMIT && (
        <p className="text-sm muted">
          Showing the {DETAIL_HISTORY_LIMIT} most recent runs; issue history is based on these runs.
        </p>
      )}
    </div>
  );
}
