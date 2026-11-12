// TypeScript interfaces for Firestore documents, replacing the generated
// Prisma types (@prisma/client) used by the old Express app. These mirror
// prisma/schema.prisma field-for-field so the rest of the app's logic
// (scope.ts, attackMatrix.ts) ports over with minimal changes.

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

// Stored in the `agents` collection, queried by `token`.
export interface Agent {
  id: string;
  name: string;
  token: string;
  organizationId: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export type CampaignStatus = "pending" | "running" | "completed" | "aborted";

// A Campaign is the unit of authorization: it declares exactly what may be
// tested, with what techniques, and in what time window. See
// docs/SAFETY_AND_SCOPE.md — nothing runs outside this declared scope.
export interface Campaign {
  id: string;
  name: string;
  organizationId: string;
  // Scope: hosts/CIDRs authorized for this campaign, e.g. ["10.0.1.0/24", "jump-box.internal"]
  scopeTargets: string[];
  // Technique IDs allowed to run, e.g. ["T1046", "T1071"] — see attackMatrix.ts
  allowedTechniques: string[];
  windowStart: Date;
  windowEnd: Date;
  // Timestamped authorization attestation — who confirmed they're allowed to test this scope
  authorizedByName: string;
  authorizedByEmail: string;
  authorizedAt: Date;
  status: CampaignStatus;
  createdAt: Date;
}

export interface CampaignRun {
  id: string;
  campaignId: string;
  startedAt: Date;
  completedAt: Date | null;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

// One unit of work dispatched to one agent. `campaignId` is denormalized
// from the parent campaignRun so the abort kill switch and dashboard views
// can query by a single field instead of joining through campaignRuns.
export interface Job {
  id: string;
  agentId: string;
  campaignRunId: string;
  campaignId: string;
  techniqueId: string; // e.g. "T1046"
  target: string; // single host/IP this specific job is scoped to
  status: JobStatus;
  createdAt: Date;
}

export interface TechniqueResult {
  id: string;
  campaignRunId: string;
  techniqueId: string;
  target: string;
  detected: boolean | null; // did the customer's own tooling flag it? (agent-reported, best-effort)
  blocked: boolean | null; // was the action itself blocked/prevented?
  evidence: string; // human-readable detail, e.g. "EICAR file removed within 2s"
  createdAt: Date;
}
