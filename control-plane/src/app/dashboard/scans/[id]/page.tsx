"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useApiKey } from "../../ApiKeyProvider";

interface Finding {
  id: string;
  checkId: string;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  evidence: string;
}

interface Scan {
  id: string;
  targetUrl: string;
  status: string;
  authorizedByName: string;
  authorizedByEmail: string;
  createdAt: string;
  completedAt: string | null;
  scheduleId: string | null;
  findings: Finding[];
}

const SEVERITY_ORDER: Finding["severity"][] = ["high", "medium", "low", "info"];

export default function ScanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { apiKey } = useApiKey();
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    fetch(`/scans/${id}`, { headers: { "X-Api-Key": apiKey } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setScan(data))
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [apiKey, id]);

  if (!apiKey) {
    return <div className="card card-padded empty-state">Enter your X-Api-Key above to view this scan.</div>;
  }
  if (error) return <p className="error-banner">{error}</p>;
  if (!scan) return <div className="card card-padded empty-state">Loading…</div>;

  const findingsBySeverity = SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: scan.findings.filter((f) => f.severity === severity),
  })).filter((group) => group.findings.length > 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{scan.targetUrl}</h1>
          <p className="page-subtitle">
            Authorized by {scan.authorizedByName} ({scan.authorizedByEmail})
          </p>
        </div>
        <span className={`badge badge-status-${scan.status}`}>{scan.status}</span>
      </div>

      <p className="text-sm muted" style={{ marginBottom: 24 }}>
        Created {new Date(scan.createdAt).toLocaleString()}
        {scan.completedAt && <> · Completed {new Date(scan.completedAt).toLocaleString()}</>}
        {" · "}
        {scan.scheduleId ? (
          <>
            Scheduled scan · <Link href={`/dashboard/schedules/${scan.scheduleId}`}>View schedule history</Link>
          </>
        ) : (
          <Link href={`/dashboard/schedules/new?targetUrl=${encodeURIComponent(scan.targetUrl)}`}>
            Re-scan this target on a schedule
          </Link>
        )}
      </p>

      <h2 style={{ marginBottom: 16 }}>Findings</h2>

      {scan.findings.length === 0 && <div className="card card-padded empty-state">No findings yet.</div>}

      {findingsBySeverity.map(({ severity, findings }) => (
        <section key={severity} className="severity-section">
          <div className="severity-section-title">
            <span className={`badge badge-severity-${severity}`}>{severity}</span>
            <span className="severity-section-count">
              {findings.length} finding{findings.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="finding-list">
            {findings.map((f) => (
              <li key={f.id} className={`finding-item sev-${f.severity}`}>
                <div className="finding-title-row">
                  <span className="finding-title">{f.title}</span>
                  <span className="finding-check-id">{f.checkId}</span>
                </div>
                <p className="finding-evidence">{f.evidence}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
