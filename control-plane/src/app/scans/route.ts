import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { scanFromDoc, findingFromDoc } from "@/lib/converters";
import { isSafeScanTarget } from "@/lib/scanScope";
import { runScan } from "@/lib/scanner";
import { runChunkedBatch } from "@/lib/batch";

const createScanSchema = z.object({
  targetUrl: z.string().url(),
  // Required: who is attesting they're authorized to scan this target.
  // See docs/SAFETY_AND_SCOPE.md — this is a product requirement, not optional metadata.
  authorizedByName: z.string().min(1),
  authorizedByEmail: z.string().email(),
});

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);

    const parsed = createScanSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    await isSafeScanTarget(body.targetUrl);

    const db = getDb();
    const scanRef = db.collection("scans").doc();
    await scanRef.set({
      organizationId,
      targetUrl: body.targetUrl,
      authorizedByName: body.authorizedByName,
      authorizedByEmail: body.authorizedByEmail,
      authorizedAt: new Date(),
      status: "running",
      createdAt: new Date(),
      completedAt: null,
    });

    let findings: Awaited<ReturnType<typeof runScan>>;
    let status: "completed" | "failed" = "completed";
    try {
      findings = await runScan(body.targetUrl);
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
          checkId: findings![i].checkId,
          severity: findings![i].severity,
          title: findings![i].title,
          evidence: findings![i].evidence,
          createdAt: new Date(),
        })
      )
    );

    await scanRef.update({ status, completedAt: new Date() });

    const scan = scanFromDoc(await scanRef.get());
    const findingDocs = await Promise.all(findingRefs.map((ref) => ref.get()));

    return NextResponse.json(
      { ...scan, findings: findingDocs.map(findingFromDoc) },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const db = getDb();

    const scansSnap = await db
      .collection("scans")
      .where("organizationId", "==", organizationId)
      .get();

    const scans = await Promise.all(
      scansSnap.docs.map(async (doc) => {
        const scan = scanFromDoc(doc);
        const findingsSnap = await db.collection("findings").where("scanId", "==", scan.id).get();
        return { ...scan, findings: findingsSnap.docs.map(findingFromDoc) };
      })
    );

    scans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return NextResponse.json(scans);
  } catch (e) {
    return errorResponse(e);
  }
}
