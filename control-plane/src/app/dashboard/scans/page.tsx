"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiKey } from "../ApiKeyProvider";

interface ScanSummary {
  id: string;
  targetUrl: string;
  status: string;
  createdAt: string;
  findings: { id: string; severity: string }[];
}

export default function ScansOverviewPage() {
  const { apiKey } = useApiKey();
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    fetch("/scans", { headers: { "X-Api-Key": apiKey } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setScans(data))
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Scans</h1>
          <p className="page-subtitle">History of every scan run for your organization.</p>
        </div>
        <Link href="/dashboard/scans/new" className="btn btn-primary">
          New scan
        </Link>
      </div>

      {!apiKey && (
        <div className="card card-padded empty-state">Enter your X-Api-Key above to load scans.</div>
      )}

      {apiKey && error && <p className="error-banner">{error}</p>}

      {apiKey && !scans && !error && <div className="card card-padded empty-state">Loading…</div>}

      {apiKey && scans && scans.length === 0 && (
        <div className="card card-padded empty-state">
          No scans yet.{" "}
          <Link href="/dashboard/scans/new">Start your first scan</Link> to see findings here.
        </div>
      )}

      {apiKey && scans && scans.length > 0 && (
        <ul className="scan-list">
          {scans.map((s) => {
            const highestSeverity = ["high", "medium", "low", "info"].find((sev) =>
              s.findings.some((f) => f.severity === sev),
            );
            return (
              <li key={s.id}>
                <Link href={`/dashboard/scans/${s.id}`} className="scan-row">
                  <div className="scan-row-main">
                    <span className="scan-row-url">{s.targetUrl}</span>
                    <span className="scan-row-meta">
                      Created {new Date(s.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="scan-row-aside">
                    <span className="finding-count">
                      {s.findings.length} finding{s.findings.length === 1 ? "" : "s"}
                    </span>
                    {highestSeverity && (
                      <span className={`badge badge-severity-${highestSeverity}`}>{highestSeverity}</span>
                    )}
                    <span className={`badge badge-status-${s.status}`}>{s.status}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
