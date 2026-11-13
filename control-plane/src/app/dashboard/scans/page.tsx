"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiKey } from "../ApiKeyProvider";

interface ScanSummary {
  id: string;
  targetUrl: string;
  status: string;
  createdAt: string;
  scheduleId: string | null;
  findings: { id: string; severity: string }[];
}

interface ScanPage {
  scans: ScanSummary[];
  nextCursor: string | null;
  total: number;
}

const PAGE_SIZES = [10, 20, 50, 100];

export default function ScansOverviewPage() {
  const { apiKey } = useApiKey();
  const [page, setPage] = useState<ScanPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  // cursors[i] is the cursor that loads page i (page 0 has none), so
  // "Previous" can step back without the API needing backwards cursors.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const pageIndex = cursors.length - 1;
  const cursor = cursors[pageIndex];

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    const params = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    setPage(null);
    setError(null);

    fetch(`/scans?${params}`, { headers: { "X-Api-Key": apiKey } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setPage(data))
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [apiKey, cursor, pageSize]);

  const scans = page?.scans ?? null;
  const firstItem = pageIndex * pageSize + 1;

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

      {apiKey && scans && scans.length === 0 && pageIndex === 0 && (
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
                    <span className="scan-row-url">
                      {s.targetUrl}
                      {s.scheduleId && <span className="scan-row-tag">Scheduled</span>}
                    </span>
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

      {apiKey && page && (page.total > 0 || pageIndex > 0) && (
        <div className="pagination">
          <span className="text-sm muted">
            {scans!.length > 0
              ? `Showing ${firstItem}–${firstItem + scans!.length - 1} of ${page.total}`
              : `No more scans (${page.total} total)`}
          </span>
          <div className="pagination-controls">
            <label className="text-sm muted" htmlFor="pageSize">
              Per page
            </label>
            <select
              id="pageSize"
              className="input input-auto"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCursors([null]);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              disabled={pageIndex === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              Previous
            </button>
            <button
              className="btn btn-secondary"
              disabled={!page.nextCursor}
              onClick={() => setCursors((c) => [...c, page.nextCursor])}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
