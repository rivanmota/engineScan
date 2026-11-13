# StubEngineScan Web Vulnerability Scanner

A minimal **web-app vulnerability scanner SaaS**: a user submits a target
URL, the control plane runs a set of safe, non-destructive, server-side
HTTP checks against it, and the dashboard shows the findings.

## Why this and not a real pentest

A real pentest or red-team exercise uses actual exploit code and is run by
licensed humans who hold liability insurance. This product deliberately does
**not** do that. Every check below is passive and non-destructive: it reads
response headers, certificate metadata, and probes for commonly-exposed
paths with plain GET requests — it never attempts to exploit a vulnerability
or write/modify anything on the target.

Deliberately out of scope: active exploitation, credential-based
testing, and anything that could disrupt the target. If you need that,
look for a licensed pentest/red-team provider instead.

## Architecture

```
┌──────────────┐      X-Api-Key      ┌──────────────┐     HTTP requests    ┌──────────────┐
│  Dashboard   │ ────────────────────▶│ Control Plane│──────────────────────▶ Target Site  │
│  (built-in,  │                      │ (Next.js App │                      │  (customer-  │
│  same app)   │◀────scan+findings────│  + Firestore)│                      │  owned URL)  │
└──────────────┘                      └──────────────┘                      └──────────────┘
```

- **Control plane** (`control-plane/`): a single Next.js (App Router) app.
  Route Handlers under `src/app/**` serve the API (`/scans`, `/scans/[id]`,
  `/health`), and `src/app/dashboard/**` serves the dashboard UI — one app,
  one deploy target (e.g. Cloud Run). Data is stored in **Firestore** (via
  `firebase-admin`) instead of Postgres/Prisma.
- A `Scan` is the unit of authorization: it records the target URL and who
  attested they're authorized to scan it (see `docs/SAFETY_AND_SCOPE.md`).
  `POST /scans` validates the target isn't a private/internal address (see
  `src/lib/scanScope.ts`), then runs every check module directly against it
  and stores the resulting `Finding` documents.
- There is **no customer-installed agent**. Scans target public URLs, so
  the control plane calls the target directly over HTTP.

### Check modules (`control-plane/src/lib/checks/`)

| Check | What it does |
|---|---|
| `securityHeaders.ts` | Flags missing/misconfigured CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers. |
| `tlsConfig.ts` | Checks certificate validity/expiry, and whether HTTP redirects to HTTPS. |
| `exposedPaths.ts` | Passive GETs to common sensitive paths (`.env`, `.git/`, `/admin`, backup files); flags any that return HTTP 200. |
| `cookieFlags.ts` | Flags cookies missing `Secure`, `HttpOnly`, or `SameSite`. |

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
npm run seed        # prints an X-Api-Key to use below (re-run anytime — it's idempotent)
npm run dev          # Next.js app (API + dashboard) on :4000
```

Open http://localhost:4000/dashboard, paste the `X-Api-Key` printed by
`npm run seed`, and submit a scan from the UI — or call the API directly:

```bash
curl -H "X-Api-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com","authorizedByName":"Jane Doe","authorizedByEmail":"jane@example.com"}' \
  http://localhost:4000/scans
```

### Emulator data persistence

`npm run dev:emulator` imports from and exports to
`control-plane/firestore-emulator-data/` (gitignored), so scans survive
restarts — **as long as you stop it with a single `Ctrl+C`** and wait for
the "Export complete" message before closing the terminal. Force-killing
the process (closing the terminal window, a crash, `kill -9`) skips that
export and silently wipes all data on next start, which also orphans any
`X-Api-Key` you were using (it authenticates fine, it's just empty). If you
suspect that happened, or just want a safety-net snapshot while the emulator
is running, save it manually at any time with:

```bash
npm run export:emulator
```

## Future checks to-do list

These are common in full web-vulnerability scanners but are deliberately
left out of this MVP's four checks — tracked here as follow-ups:

- CORS misconfiguration detection
- Mixed-content detection (HTTPS pages loading HTTP resources)
- Outdated/vulnerable JS library detection
- Subresource Integrity (SRI) checks
- DNS/subdomain enumeration
- Open redirect detection
- Clickjacking protections beyond the `X-Frame-Options` header (e.g. CSP `frame-ancestors`)

## To be done in future releases

- Auth/billing (Stripe), Firebase Auth for the dashboard, multi-tenant
  signup flow, SIEM webhook integrations (Splunk/Elastic), PDF reporting,
  async/queued scan execution and scheduling, a real secrets store, and
  deploying the app to Cloud Run/Cloud Firestore.
