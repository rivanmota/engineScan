# StubEngine Attack Simulation

A breach-and-attack-simulation (BAS) SaaS: an endpoint **agent** runs safe,
non-destructive simulated attack techniques against a customer's own
authorized assets, and a **control plane** schedules the work and reports
whether existing defenses (AV/EDR, firewall/egress monitoring, IDS) actually
caught it.

This is the same category as SafeBreach, AttackIQ, and Cymulate, aimed at
mid-market/SMB teams who are priced out of those, or who have no in-house
red team to run this manually.

## Why this and not a real pentest

A real pentest or red-team exercise uses actual exploit code and is run by
licensed humans who hold liability insurance. This product deliberately does
**not** do that. Every technique module below is a *safe stand-in* for a
real attacker action:

| Real attacker action | What this product does instead |
|---|---|
| Drop real malware, see if AV catches it | Drop the official EICAR test string, see if AV/EDR quarantines or alerts on it |
| Establish real C2 and exfiltrate data | Send a clearly-tagged HTTP beacon to infrastructure *you* control, see if it's blocked/alerted |
| Scan a network to find exploitable services | Scan only hosts the customer explicitly listed, TCP-connect only, no exploitation |

Deliberately out of scope (see `docs/SAFETY_AND_SCOPE.md`):
credential dumping, real exploitation of CVEs, ransomware-style file
encryption, and spoofed phishing landing pages that harvest credentials.
Those require a different liability/legal model (signed rules-of-engagement,
licensed operators) than a self-serve SaaS can offer.

## Architecture

```
┌──────────────┐      jobs       ┌──────────────┐     runs techniques    ┌──────────────┐
│  Dashboard   │ ───────────────▶│ Control Plane│◀───────────────────────│  Agent       │
│  (built-in,  │                 │ (Next.js App │      posts results     │  (Python,    │
│  same app)   │◀─────reports────│  + Firestore)│────────────────────────▶ customer host)│
└──────────────┘                 └──────────────┘                        └──────────────┘
```

- **Control plane** (`control-plane/`): a single Next.js (App Router) app.
  Route Handlers under `src/app/**` serve the same API the agent/dashboard
  always used (`/campaigns`, `/agents`, `/agents/jobs`, `/results`,
  `/health`), and `src/app/dashboard/**` serves the dashboard UI — one app,
  one deploy target (e.g. Cloud Run). Data is stored in **Firestore**
  (via `firebase-admin`) instead of Postgres/Prisma. Campaigns define
  *scope* (which hosts/CIDRs, which techniques, what time window) up front.
  It never lets an agent run a job outside the declared scope — see
  `scopeGuard` (`assertJobInScope`) in `src/lib/scope.ts`.
- **Agent** (`agent/`): a small Python poller installed on a customer
  endpoint or jump box. Pulls its assigned jobs, runs the matching module,
  posts the result back. Unchanged by the control-plane rewrite — it still
  talks to the same paths, just on whatever host/port you pass via
  `--control-plane`.

## Quick start

The control plane runs locally against the **Firestore emulator** — no real
GCP project or credentials needed for development.

```bash
cd control-plane
npm install
cp .env.local.example .env.local

# Terminal 1: Firestore emulator (localhost:8090, UI at localhost:4001)
npm run dev:emulator

# Terminal 2: seed a dev Organization + ApiKey, then start the app
npm run seed        # prints an X-Api-Key to use below
npm run dev          # Next.js app (API + dashboard) on :4000
```

Open http://localhost:4000/dashboard, paste the `X-Api-Key` printed by
`npm run seed`, and create a campaign from the UI — or call the API
directly:

```bash
curl -H "X-Api-Key: <key>" http://localhost:4000/campaigns
```

Then run the agent against it:

```bash
cd ../agent
pip install -r requirements.txt
python agent.py --control-plane http://localhost:4000 --agent-token <token>
```

(`<token>` comes from registering an agent, either via the dashboard's
Agents page or `POST /agents`.)

## To be done in future releases

- Auth/billing (Stripe), Firebase Auth for the dashboard, multi-tenant
  signup flow, SIEM webhook integrations (Splunk/Elastic), PDF reporting,
  campaign scheduling cron, a real secrets store for agent tokens, and
  deploying the app to Cloud Run/Cloud Firestore.

