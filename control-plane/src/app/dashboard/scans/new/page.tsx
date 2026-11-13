"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApiKey } from "../../ApiKeyProvider";
import { AuthorizedEmailField } from "../../AuthorizedEmailField";
import { authorizerDomainError } from "@/lib/authorizedDomain";

export default function NewScanPage() {
  const { apiKey } = useApiKey();
  const router = useRouter();

  const [targetUrl, setTargetUrl] = useState("");
  const [authorizedByName, setAuthorizedByName] = useState("");
  const [authorizedByEmail, setAuthorizedByEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    setSubmitting(true);
    try {
      const res = await fetch("/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ targetUrl, authorizedByName, authorizedByEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data));
        return;
      }
      router.push(`/dashboard/scans/${data.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New scan</h1>
          <p className="page-subtitle">Run a security headers, TLS, exposed-paths, and cookie-flags audit.</p>
        </div>
      </div>

      {!apiKey ? (
        <div className="card card-padded empty-state">Enter your X-Api-Key above to start a scan.</div>
      ) : (
        <div className="card card-padded" style={{ maxWidth: 520 }}>
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

            <p className="panel-note">
              By submitting, you attest that you are authorized to scan this URL.
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

            {error && <p className="error-banner">{error}</p>}

            <button type="submit" disabled={submitting} className="btn btn-primary">
              {submitting ? "Scanning…" : "Start scan"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
