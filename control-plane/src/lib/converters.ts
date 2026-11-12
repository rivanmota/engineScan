import { QueryDocumentSnapshot, DocumentSnapshot } from "firebase-admin/firestore";
import { Campaign, CampaignRun, Job, TechniqueResult } from "@/types/firestore";

// Firestore returns Timestamp objects for Date fields; these helpers
// convert a raw doc into the typed shape the rest of the app (scope.ts,
// JSON responses) expects, mirroring what Prisma used to hand back.

export function campaignFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): Campaign {
  const data = doc.data()!;
  return {
    id: doc.id,
    name: data.name,
    organizationId: data.organizationId,
    scopeTargets: data.scopeTargets,
    allowedTechniques: data.allowedTechniques,
    windowStart: data.windowStart.toDate(),
    windowEnd: data.windowEnd.toDate(),
    authorizedByName: data.authorizedByName,
    authorizedByEmail: data.authorizedByEmail,
    authorizedAt: data.authorizedAt.toDate(),
    status: data.status,
    createdAt: data.createdAt.toDate(),
  };
}

export function campaignRunFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): CampaignRun {
  const data = doc.data()!;
  return {
    id: doc.id,
    campaignId: data.campaignId,
    startedAt: data.startedAt.toDate(),
    completedAt: data.completedAt ? data.completedAt.toDate() : null,
  };
}

export function jobFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): Job {
  const data = doc.data()!;
  return {
    id: doc.id,
    agentId: data.agentId,
    campaignRunId: data.campaignRunId,
    campaignId: data.campaignId,
    techniqueId: data.techniqueId,
    target: data.target,
    status: data.status,
    createdAt: data.createdAt.toDate(),
  };
}

export function techniqueResultFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): TechniqueResult {
  const data = doc.data()!;
  return {
    id: doc.id,
    campaignRunId: data.campaignRunId,
    techniqueId: data.techniqueId,
    target: data.target,
    detected: data.detected,
    blocked: data.blocked,
    evidence: data.evidence,
    createdAt: data.createdAt.toDate(),
  };
}
