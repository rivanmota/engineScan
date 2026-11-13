# StubEngineScan Web Vulnerability Scanner

An authorized user submits a target URL, the control plane runs a set of safe, non-destructive, server-side
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

### Check modules (`control-plane/src/lib/checks/`)

| Check | What it does |
|---|---|
| `securityHeaders.ts` | Flags missing/misconfigured CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers. |
| `tlsConfig.ts` | Checks certificate validity/expiry, and whether HTTP redirects to HTTPS. |
| `exposedPaths.ts` | Passive GETs to common sensitive paths (`.env`, `.git/`, `/admin`, backup files); flags any that return HTTP 200. |
| `cookieFlags.ts` | Flags cookies missing `Secure`, `HttpOnly`, or `SameSite`. |

## Scheduled re-scans

A target can be put on a schedule so it's re-scanned automatically. The
schedule's page then shows, per issue, whether it's still **open**, was
**fixed**, or **regressed** (came back after being fixed), along with a
run-by-run history of what changed. Create one from **Schedules → New
schedule** in the dashboard, or via "Re-scan this target on a schedule" on any
scan.

**Re-scan options.** Quick presets (every hour, every 6 hours, daily,
weekdays, weekly, monthly) or a custom "repeat every N …":

| Unit | Options | Example |
|---|---|---|
| hours | every 1–168 hours, counted from when the schedule was created | Every 6 hours |
| days | every 1–365 days, at a time of day | Every 2 days at 03:00 |
| weeks | every 1–52 weeks, on chosen weekdays, at a time of day | Every 2 weeks on Mon, Thu at 09:00 |
| months | every 1–12 months, on a day of the month (1–31, clamped to shorter months' last day), at a time of day | Monthly on day 1 at 06:00 |

Times of day are in the schedule's IANA timezone (defaults to the browser's),
so "06:00 Europe/Rome" stays 06:00 across daylight-saving changes. A time
skipped by a DST change runs just after it. A time that occurs twice runs the
first time. The form previews the next runs before you save. Changing the
cadence counts "every N" from the last run.

**Authorization and expiry.** A schedule takes the same attestation as a
one-off scan, plus how long it's valid: 30, 90 (default), 180 days, 1 year,
or until a chosen date (at most 365 days ahead). Once it expires, runs are
skipped (nothing is sent to the target) and the schedule shows "Authorization
expired" until someone renews it with a fresh attestation and a new expiry.
The dashboard warns 7 days ahead. Every scan records the attestation that was
current when it ran. The target URL can't be edited; a different target needs
a new schedule. Every run also re-checks the target with `isSafeScanTarget`,
so a hostname that later resolves to a private address is skipped (with the
reason shown) rather than scanned.

How it works:

- **Runs are ordinary scans** tagged with `scheduleId`, so they also appear in
  the Scans list and detail pages. Creating a schedule runs a baseline scan
  immediately.
- **Fixed vs. regressed** is computed on read by comparing the schedule's
  recent scans (up to 30). An issue is identified by its check and title.
  `info` findings aren't tracked. If a check couldn't complete in a run
  (timeout, target down), its issues are left unchanged and marked
  "unverified" instead of being reported as fixed.
- **Who triggers runs.** Either or both of:
  - the in-process scheduler: `SCHEDULER_ENABLED=true` (the default in
    `.env.local.example`) checks for due schedules every
    `SCHEDULER_TICK_SECONDS` (default 60). Suited to `npm run dev` and
    long-running `npm start`.
  - an external cron calling `POST /internal/schedules/run-due` with
    `Authorization: Bearer $SCHEDULER_SECRET`, for serverless deployments.
    The endpoint is disabled unless `SCHEDULER_SECRET` is set.

  Each due run is claimed in a Firestore transaction, so several instances,
  or both triggers at once, never double-scan. If the scheduler was down, a
  schedule runs once to catch up rather than replaying every missed run.
- **Indexes.** The scan list and schedule history queries need the composite
  indexes in `firestore.indexes.json` (`scans` by `organizationId`/`createdAt`
  and by `scheduleId`/`createdAt`). The emulator doesn't need them, but
  deploy them (`firebase deploy --only firestore:indexes`) before using a real
  Firestore project.

Schedules API (all require `X-Api-Key`):

| Method & path | Purpose |
|---|---|
| `POST /schedules` | Create: `{targetUrl, cadence, timeZone, authorizedByName, authorizedByEmail, authorizationExpiresAt}`. Runs the baseline scan; 409 if the target already has a schedule. |
| `GET /schedules` | List, with open-issue counts and the latest run's changes. |
| `GET /schedules/:id` | Detail: tracked issues (open/fixed/regressed) and run history. |
| `PATCH /schedules/:id` | `{enabled?, cadence?, timeZone?}`: pause/resume or change when it runs. |
| `POST /schedules/:id/authorization` | Renew: `{authorizedByName, authorizedByEmail, authorizationExpiresAt}`. |
| `POST /schedules/:id/run` | Run now (also works while paused; refused if the authorization has expired). |
| `DELETE /schedules/:id` | Stop monitoring. Scans already run are kept. |

`cadence` is one of:

```json
{ "unit": "hours",  "every": 6 }
{ "unit": "days",   "every": 1, "time": "06:00" }
{ "unit": "weeks",  "every": 2, "time": "09:00", "daysOfWeek": [1, 4] }
{ "unit": "months", "every": 1, "time": "06:00", "dayOfMonth": 1 }
```

`daysOfWeek` uses 0 = Sunday … 6 = Saturday. `time` is 24-hour `HH:MM`.
`timeZone` is an IANA name (default `UTC`). `authorizationExpiresAt` is an
ISO-8601 timestamp.

## Listing scans (pagination)

`GET /scans` is cursor-paginated, newest first:

```bash
curl -H "X-Api-Key: <key>" "http://localhost:4000/scans?limit=20"
# -> { "scans": [...], "nextCursor": "<scanId>" | null, "total": 345 }
curl -H "X-Api-Key: <key>" "http://localhost:4000/scans?limit=20&cursor=<nextCursor>"
```

`limit` is 1–100 (default 20). `nextCursor` is `null` on the last page.

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

Unit tests (no emulator needed): `npm test`.

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

