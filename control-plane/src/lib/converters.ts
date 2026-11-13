import { QueryDocumentSnapshot, DocumentSnapshot, DocumentData } from "firebase-admin/firestore";
import { Scan, Finding, ScanSchedule, ScheduleCadence } from "@/types/firestore";
import { addDays, LEGACY_AUTHORIZATION_DAYS } from "./schedules/authorization";

// Firestore returns Timestamp objects for Date fields; these helpers
// convert a raw doc into the typed shape the rest of the app (JSON
// responses) expects.

export function scanFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): Scan {
  const data = doc.data()!;
  return {
    id: doc.id,
    organizationId: data.organizationId,
    targetUrl: data.targetUrl,
    authorizedByName: data.authorizedByName,
    authorizedByEmail: data.authorizedByEmail,
    authorizedAt: data.authorizedAt.toDate(),
    status: data.status,
    createdAt: data.createdAt.toDate(),
    completedAt: data.completedAt ? data.completedAt.toDate() : null,
    // Scans created before scheduling existed have no scheduleId field.
    scheduleId: data.scheduleId ?? null,
  };
}

// Schedules saved before calendar cadences existed stored a bare
// `intervalHours`. It maps exactly onto an "every N hours" cadence.
function cadenceFromDoc(data: DocumentData): ScheduleCadence {
  if (data.cadence) return data.cadence as ScheduleCadence;
  return { unit: "hours", every: data.intervalHours };
}

export function scheduleFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): ScanSchedule {
  const data = doc.data()!;
  const authorizedAt: Date = data.authorizedAt.toDate();
  const createdAt: Date = data.createdAt.toDate();
  return {
    id: doc.id,
    organizationId: data.organizationId,
    targetUrl: data.targetUrl,
    cadence: cadenceFromDoc(data),
    timeZone: data.timeZone ?? "UTC",
    cadenceAnchorAt: data.cadenceAnchorAt ? data.cadenceAnchorAt.toDate() : createdAt,
    authorizedByName: data.authorizedByName,
    authorizedByEmail: data.authorizedByEmail,
    authorizedAt,
    authorizationExpiresAt: data.authorizationExpiresAt
      ? data.authorizationExpiresAt.toDate()
      : addDays(authorizedAt, LEGACY_AUTHORIZATION_DAYS),
    enabled: data.enabled,
    nextRunAt: data.nextRunAt ? data.nextRunAt.toDate() : null,
    lastRunAt: data.lastRunAt ? data.lastRunAt.toDate() : null,
    lastScanId: data.lastScanId ?? null,
    lastRunStatus: data.lastRunStatus ?? null,
    lastError: data.lastError ?? null,
    createdAt,
    updatedAt: data.updatedAt.toDate(),
  };
}

export function findingFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): Finding {
  const data = doc.data()!;
  return {
    id: doc.id,
    scanId: data.scanId,
    checkId: data.checkId,
    severity: data.severity,
    title: data.title,
    evidence: data.evidence,
    createdAt: data.createdAt.toDate(),
  };
}
