"use client";

import { useEffect, useState } from "react";
import { useApiKey } from "../ApiKeyProvider";

interface Agent {
  id: string;
  name: string;
  lastSeenAt: string | null;
}

export default function AgentsPage() {
  const { apiKey } = useApiKey();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!apiKey) return;
    try {
      const res = await fetch("/agents", { headers: { "X-Api-Key": apiKey } });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setAgents(await res.json());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  async function registerAgent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
      setNewToken(data.token);
      setName("");
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (!apiKey) return <p>Enter your X-Api-Key above to view agents.</p>;

  return (
    <div>
      <h1>Agents</h1>

      <form onSubmit={registerAgent} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" required />
        <button type="submit">Register agent</button>
      </form>

      {newToken && (
        <p style={{ background: "#eef", padding: 8 }}>
          New agent token (shown once — copy it into the agent&apos;s <code>--agent-token</code>): <code>{newToken}</code>
        </p>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!agents && !error && <p>Loading…</p>}
      {agents && agents.length === 0 && <p>No agents registered yet.</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {agents?.map((a) => (
          <li key={a.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 8 }}>
            <strong>{a.name}</strong> — last seen:{" "}
            {a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : "never"}
          </li>
        ))}
      </ul>
    </div>
  );
}
