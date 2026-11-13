import { getDb } from "./firestore";
import { scanFromDoc, findingFromDoc } from "./converters";
import { isSafeScanTarget } from "./scanScope";
import { runScan } from "./scanner";
import { runChunkedBatch } from "./batch";
import { Finding, Scan } from "@/types/firestore";

// The single code path that creates and runs a scan, shared by one-off scans
// (POST /scans) and scheduled re-scans (src/lib/schedules/runner.ts).
//
// isSafeScanTarget runs here, before the scan document is created, so every
// caller gets the SSRF check. That matters most for scheduled scans: a
// hostname that was public when the schedule was created can later be
// re-pointed at a private address. Throws ScopeViolation if the target is out
// of scope.

export interface ExecuteScanInput {
  organizationId: string;
  targetUrl: string;
  authorizedByName: string;
  authorizedByEmail: string;
  // When the attestation was made. For one-off scans that's "now"; for
  // scheduled scans it's when the schedule was created.
  authorizedAt: Date;
  scheduleId: string | null;
}

export type ScanWithFindings = Scan & { findings: Finding[] };

export async function executeScan(input: ExecuteScanInput): Promise<ScanWithFindings> {
  await isSafeScanTarget(input.targetUrl);

  const db = getDb();
  const scanRef = db.collection("scans").doc();
  await scanRef.set({
    organizationId: input.organizationId,
    targetUrl: input.targetUrl,
    authorizedByName: input.authorizedByName,
    authorizedByEmail: input.authorizedByEmail,
    authorizedAt: input.authorizedAt,
    status: "running",
    createdAt: new Date(),
    completedAt: null,
    scheduleId: input.scheduleId,
  });

  let findings: Awaited<ReturnType<typeof runScan>>;
  let status: "completed" | "failed" = "completed";
  try {
    findings = await runScan(input.targetUrl);
  } catch (e) {
    status = "failed";
    findings = [];
    console.error(e);
  }

  const findingRefs = findings.map(() => db.collection("findings").doc());
  await runChunkedBatch(
    db,
    findingRefs.map((ref, i) => (batch) =>
      batch.set(ref, {
        scanId: scanRef.id,
        checkId: findings[i].checkId,
        severity: findings[i].severity,
        title: findings[i].title,
        evidence: findings[i].evidence,
        createdAt: new Date(),
      })
    )
  );

  await scanRef.update({ status, completedAt: new Date() });

  const scan = scanFromDoc(await scanRef.get());
  const findingDocs = await Promise.all(findingRefs.map((ref) => ref.get()));

  return { ...scan, findings: findingDocs.map(findingFromDoc) };
}
