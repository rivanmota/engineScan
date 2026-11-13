import { QueryDocumentSnapshot, DocumentSnapshot } from "firebase-admin/firestore";
import { Scan, Finding } from "@/types/firestore";

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
