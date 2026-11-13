// TypeScript interfaces for Firestore documents, replacing the generated
// Prisma types (@prisma/client) used by the old Express app.

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
