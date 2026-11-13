import { getDb } from "./firestore";
import { findingFromDoc } from "./converters";
import { Finding, Scan } from "@/types/firestore";

// Firestore caps `in` queries at 30 values.
const IN_QUERY_CHUNK = 30;

/**
 * Loads the findings for a batch of scans with one `in` query per 30 scans,
 * instead of one query per scan.
 */
export async function attachFindings(scans: Scan[]): Promise<Array<Scan & { findings: Finding[] }>> {
  const db = getDb();
  const findingsByScan = new Map<string, Finding[]>(scans.map((s) => [s.id, []]));

  for (let i = 0; i < scans.length; i += IN_QUERY_CHUNK) {
    const ids = scans.slice(i, i + IN_QUERY_CHUNK).map((s) => s.id);
    const snap = await db.collection("findings").where("scanId", "in", ids).get();
    for (const doc of snap.docs) {
      const finding = findingFromDoc(doc);
      findingsByScan.get(finding.scanId)?.push(finding);
    }
  }

  return scans.map((scan) => ({ ...scan, findings: findingsByScan.get(scan.id) ?? [] }));
}
