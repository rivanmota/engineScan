import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { scanFromDoc, findingFromDoc } from "@/lib/converters";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const { id } = await params;
    const db = getDb();

    const scanSnap = await db.collection("scans").doc(id).get();
    if (!scanSnap.exists || scanSnap.data()?.organizationId !== organizationId) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    const scan = scanFromDoc(scanSnap);
    const findingsSnap = await db.collection("findings").where("scanId", "==", scan.id).get();

    return NextResponse.json({ ...scan, findings: findingsSnap.docs.map(findingFromDoc) });
  } catch (e) {
    return errorResponse(e);
  }
}
