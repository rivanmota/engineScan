"use client";

import { useEffect, useState, use } from "react";
import { useApiKey } from "../../ApiKeyProvider";

interface TechniqueResult {
  id: string;
  techniqueId: string;
  target: string;
  detected: boolean | null;
  blocked: boolean | null;
  evidence: string;
}

interface CampaignRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  results: TechniqueResult[];
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  scopeTargets: string[];
  allowedTechniques: string[];
  windowStart: string;
  windowEnd: string;
  runs: CampaignRun[];
}

interface Agent {
  id: string;
  name: string;
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { apiKey } = useApiKey();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!apiKey) return;
    try {
      const [campaignsRes, agentsRes] = await Promise.all([
        fetch("/campaigns", { headers: { "X-Api-Key": apiKey } }),
        fetch("/agents", { headers: { "X-Api-Key": apiKey } }),
      ]);
      const campaigns: Campaign[] = await campaignsRes.json();
      const found = campaigns.find((c) => c.id === id);
      if (!found) throw new Error("Campaign not found");
      setCampaign(found);
      setAgents(await agentsRes.json());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, id]);

  async function startRun() {
    if (!selectedAgentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/campaigns/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ agentId: selectedAgentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function abort() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/campaigns/${id}/abort`, {
        method: "POST",
        headers: { "X-Api-Key": apiKey },
      });
      if (!res.ok) throw new Error(JSON.stringify((await res.json()).error));
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!apiKey) return <p>Enter your X-Api-Key above to view this campaign.</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!campaign) return <p>Loading…</p>;

  return (
    <div>
      <h1>{campaign.name}</h1>
      <p>
        Status: <code>{campaign.status}</code> · Scope: {campaign.scopeTargets.join(", ")} · Techniques:{" "}
        {campaign.allowedTechniques.join(", ")}
      </p>
      <p>
        Window: {new Date(campaign.windowStart).toLocaleString()} → {new Date(campaign.windowEnd).toLocaleString()}
      </p>

      <section style={{ margin: "16px 0" }}>
        <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
          <option value="">Select an agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>{" "}
        <button onClick={startRun} disabled={busy || !selectedAgentId || campaign.status === "aborted"}>
          Start run
        </button>{" "}
        <button onClick={abort} disabled={busy || campaign.status === "aborted"}>
          Abort (kill switch)
        </button>
      </section>

      <h2>Runs</h2>
      {campaign.runs.length === 0 && <p>No runs yet.</p>}
      {campaign.runs.map((run) => (
        <div key={run.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 8 }}>
          <p>
            Run {run.id} — started {new Date(run.startedAt).toLocaleString()}
          </p>
          {run.results.length === 0 && <p>No results reported yet.</p>}
          <ul>
            {run.results.map((r) => (
              <li key={r.id}>
                {r.techniqueId} @ {r.target}: detected={String(r.detected)}, blocked={String(r.blocked)} —{" "}
                {r.evidence}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
