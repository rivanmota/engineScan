import { getDb } from "./firestore";
import { findingFromDoc } from "./converters";
import { Finding } from "@/types/firestore";

// Firestore caps `in` queries at 30 values.
const IN_QUERY_CHUNK = 30;

/**
 * Loads the findings of many scans with one query per 30 scans (instead of
 * one per scan). Every requested scan ID gets an entry, possibly empty.
 */
export async function loadFindingsForScans(scanIds: string[]): Promise<Map<string, Finding[]>> {
  const byScan = new Map<string, Finding[]>(scanIds.map((id) => [id, []]));
  for (let i = 0; i < scanIds.length; i += IN_QUERY_CHUNK) {
    const ids = scanIds.slice(i, i + IN_QUERY_CHUNK);
    const snap = await getDb().collection("findings").where("scanId", "in", ids).get();
    for (const doc of snap.docs) {
      const finding = findingFromDoc(doc);
      byScan.get(finding.scanId)?.push(finding);
    }
  }
  return byScan;
}
