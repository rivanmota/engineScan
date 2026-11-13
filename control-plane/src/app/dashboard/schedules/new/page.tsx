"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApiKey } from "../../ApiKeyProvider";
import { AuthorizedEmailField } from "../../AuthorizedEmailField";
import { authorizerDomainError } from "@/lib/authorizedDomain";
import {
  AuthorizationExpiryPicker,
  CadenceEditor,
  cadenceDraftError,
  defaultCadenceDraft,
  defaultExpiryDraft,
  draftStartAt,
  draftToCadence,
  expiryDraftError,
  expiryDraftToDate,
} from "../ScheduleInputs";

interface CreateError {
  message: string;
  existingScheduleId?: string;
}

function NewScheduleForm() {
  const { apiKey } = useApiKey();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [targetUrl, setTargetUrl] = useState(searchParams.get("targetUrl") ?? "");
  const [cadence, setCadence] = useState(defaultCadenceDraft);
  const [expiry, setExpiry] = useState(defaultExpiryDraft);
  // Fixed per visit so the preview doesn't shift on every keystroke.
  const [anchor] = useState(() => new Date());
  const [authorizedByName, setAuthorizedByName] = useState("");
  const [authorizedByEmail, setAuthorizedByEmail] = useState("");
  const [error, setError] = useState<CreateError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitAttempted(true);
    // Same rule the API enforces; the field shows the explanation.
    if (authorizerDomainError(targetUrl, authorizedByEmail)) {
      document.getElementById("authorizedByEmail")?.focus();
      return;
    }
    const now = new Date();
    const problem = cadenceDraftError(cadence) ?? expiryDraftError(expiry, now);
    if (problem) {
      setError({ message: problem });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({
          targetUrl,
          cadence: draftToCadence(cadence),
          timeZone: cadence.timeZone,
          startAt: draftStartAt(cadence)?.toISOString(),
          authorizedByName,
          authorizedByEmail,
          authorizationExpiresAt: expiryDraftToDate(expiry, now)!.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({
          message: typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data),
          existingScheduleId: data.scheduleId,
        });
        return;
      }
      router.push(`/dashboard/schedules/${data.id}`);
    } catch (e) {
      setError({ message: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  if (!apiKey) {
    return <div className="card card-padded empty-state">Enter your X-Api-Key above to create a schedule.</div>;
  }

  return (
    <div className="card card-padded" style={{ maxWidth: 600 }}>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="field">
          <label className="field-label" htmlFor="targetUrl">
            Target URL
          </label>
          <input
            id="targetUrl"
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
            required
            className="input"
          />
        </div>

        <div className="field">
          <CadenceEditor value={cadence} onChange={setCadence} anchor={anchor} />
          <span className="field-hint">
            Nothing is scanned when you create the schedule; the first scan happens at the first run. To scan right
            away, use Run now on the schedule&apos;s page.
          </span>
        </div>

        <p className="panel-note">
          By submitting, you attest that you are authorized to scan this URL, and to have it scanned repeatedly on
          this schedule until the authorization below expires.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="authorizedByName">
            Authorized by (name)
          </label>
          <input
            id="authorizedByName"
            value={authorizedByName}
            onChange={(e) => setAuthorizedByName(e.target.value)}
            required
            className="input"
          />
        </div>

        <AuthorizedEmailField
          id="authorizedByEmail"
          value={authorizedByEmail}
          onChange={setAuthorizedByEmail}
          targetUrl={targetUrl}
          forceShowError={submitAttempted}
        />

        <AuthorizationExpiryPicker value={expiry} onChange={setExpiry} />

        {error && (
          <p className="error-banner">
            {error.message}
            {error.existingScheduleId && (
              <>
                {" "}
                <Link href={`/dashboard/schedules/${error.existingScheduleId}`}>View the existing schedule</Link>
              </>
            )}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting ? "Creating…" : "Create schedule"}
        </button>
      </form>
    </div>
  );
}

export default function NewSchedulePage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New schedule</h1>
          <p className="page-subtitle">Re-scan a target automatically and track which findings get fixed or regress.</p>
        </div>
      </div>
      {/* useSearchParams (for the ?targetUrl= prefill) requires a Suspense boundary. */}
      <Suspense fallback={<div className="card card-padded empty-state">Loading…</div>}>
        <NewScheduleForm />
      </Suspense>
    </div>
  );
}
