// TypeScript interfaces for Firestore documents, replacing the generated
// Prisma types (@prisma/client) used by the old Express app.

import type { ScheduleCadence } from "@/lib/schedules/cadence";
export type { ScheduleCadence };

export interface Organization {
  id: string;
  name: string;
  createdAt: Date;
}

// Stored in the `apiKeys` collection, queried by `key`.
export interface ApiKey {
  id: string;
  key: string;
  organizationId: string;
  createdAt: Date;
}

export type ScanStatus = "pending" | "running" | "completed" | "failed";

// A Scan is the unit of authorization and execution: it declares the target
// URL and who attests they're authorized to scan it. See
// docs/SAFETY_AND_SCOPE.md — nothing is scanned without this attestation.
export interface Scan {
  id: string;
  organizationId: string;
  targetUrl: string;
  // Timestamped authorization attestation — who confirmed they're allowed to scan this target
  authorizedByName: string;
  authorizedByEmail: string;
  authorizedAt: Date;
  status: ScanStatus;
  createdAt: Date;
  completedAt: Date | null;
  // Set when this scan was run by a ScanSchedule; null for one-off scans.
  scheduleId: string | null;
}

export type ScheduleRunStatus = "completed" | "failed" | "skipped";

// A ScanSchedule re-scans one target URL on a recurring cadence so findings
// can be tracked over time (fixed / still open / regressed). Stored in the
// `scanSchedules` collection. The authorization attestation is captured when
// the schedule is created (and again on each renewal), is copied onto every
// scan it runs, and expires at authorizationExpiresAt. The target is still
// re-checked with isSafeScanTarget before every run.
export interface ScanSchedule {
  id: string;
  organizationId: string;
  targetUrl: string;
  cadence: ScheduleCadence;
  // IANA timezone that the cadence's wall-clock times are interpreted in.
  timeZone: string;
  // Reference point for the cadence's "every N" counting.
  cadenceAnchorAt: Date;
  authorizedByName: string;
  authorizedByEmail: string;
  authorizedAt: Date;
  // Runs are skipped from this moment on until the authorization is renewed.
  authorizationExpiresAt: Date;
  enabled: boolean;
  // When the next automatic run is due. Always null while paused, so the
  // "due schedules" query (nextRunAt <= now) never returns paused schedules.
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastScanId: string | null;
  lastRunStatus: ScheduleRunStatus | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FindingSeverity = "info" | "low" | "medium" | "high";

export interface Finding {
  id: string;
  scanId: string;
  checkId: string; // "security-headers" | "tls-config" | "exposed-paths" | "cookie-flags"
  severity: FindingSeverity;
  title: string;
  evidence: string;
  createdAt: Date;
}
