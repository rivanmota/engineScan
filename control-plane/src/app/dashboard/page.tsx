"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiKey } from "./ApiKeyProvider";

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  scopeTargets: string[];
  allowedTechniques: string[];
  runs: { id: string; results: unknown[] }[];
}

export default function CampaignsOverviewPage() {
  const { apiKey } = useApiKey();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    fetch("/campaigns", { headers: { "X-Api-Key": apiKey } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setCampaigns(data))
      .catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  if (!apiKey) {
    return <p>Enter your X-Api-Key above to load campaigns.</p>;
  }

  return (
    <div>
      <h1>Campaigns</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!campaigns && !error && <p>Loading…</p>}
      {campaigns && campaigns.length === 0 && <p>No campaigns yet. Create one to get started.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {campaigns?.map((c) => {
          const resultCount = c.runs.reduce((sum, r) => sum + r.results.length, 0);
          return (
            <li key={c.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <Link href={`/dashboard/campaigns/${c.id}`}>
                <strong>{c.name}</strong>
              </Link>{" "}
              — status: <code>{c.status}</code>, techniques: {c.allowedTechniques.join(", ")}, runs:{" "}
              {c.runs.length}, results: {resultCount}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
