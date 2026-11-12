"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApiKey } from "../../ApiKeyProvider";
import { TECHNIQUES } from "@/lib/attackMatrix";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function NewCampaignPage() {
  const { apiKey } = useApiKey();
  const router = useRouter();

  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const [name, setName] = useState("");
  const [scopeTargets, setScopeTargets] = useState("");
  const [allowedTechniques, setAllowedTechniques] = useState<string[]>([]);
  const [windowStart, setWindowStart] = useState(toLocalInputValue(now));
  const [windowEnd, setWindowEnd] = useState(toLocalInputValue(inTwoHours));
  const [authorizedByName, setAuthorizedByName] = useState("");
  const [authorizedByEmail, setAuthorizedByEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleTechnique(id: string) {
    setAllowedTechniques((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({
          name,
          scopeTargets: scopeTargets
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          allowedTechniques,
          windowStart: new Date(windowStart).toISOString(),
          windowEnd: new Date(windowEnd).toISOString(),
          authorizedByName,
          authorizedByEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
      router.push(`/dashboard/campaigns/${data.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!apiKey) {
    return <p>Enter your X-Api-Key above to create a campaign.</p>;
  }

  return (
    <div>
      <h1>New campaign</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: "100%" }} />
        </label>

        <label>
          Scope targets (comma-separated hosts/CIDRs)
          <input
            value={scopeTargets}
            onChange={(e) => setScopeTargets(e.target.value)}
            placeholder="10.0.1.0/24, jump-box.internal"
            required
            style={{ width: "100%" }}
          />
        </label>

        <fieldset>
          <legend>Allowed techniques</legend>
          {Object.values(TECHNIQUES).map((t) => (
            <label key={t.id} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={allowedTechniques.includes(t.id)}
                onChange={() => toggleTechnique(t.id)}
              />{" "}
              {t.id} — {t.name}
            </label>
          ))}
        </fieldset>

        <label>
          Window start
          <input
            type="datetime-local"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Window end
          <input
            type="datetime-local"
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>

        <p>
          <em>
            Authorization attestation — see docs/SAFETY_AND_SCOPE.md. By submitting, you attest you are authorized
            to test the scope above.
          </em>
        </p>

        <label>
          Authorized by (name)
          <input
            value={authorizedByName}
            onChange={(e) => setAuthorizedByName(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Authorized by (email)
          <input
            type="email"
            value={authorizedByEmail}
            onChange={(e) => setAuthorizedByEmail(e.target.value)}
            required
            style={{ width: "100%" }}
          />
        </label>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button type="submit" disabled={submitting || allowedTechniques.length === 0}>
          {submitting ? "Creating…" : "Create campaign"}
        </button>
      </form>
    </div>
  );
}
