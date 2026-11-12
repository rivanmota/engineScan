import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { runChunkedBatch } from "@/lib/batch";

// Kill switch — see docs/SAFETY_AND_SCOPE.md. Must work even mid-run.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { organizationId } = await requireOrgApiKey(req);
    const db = getDb();

    const campaignRef = db.collection("campaigns").doc(id);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists || campaignSnap.data()?.organizationId !== organizationId) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    await campaignRef.update({ status: "aborted" });

    // Mark any still-queued jobs as failed so agents won't execute them if
    // they already pulled a batch (agents should also re-check campaign
    // status — see agent/agent.py). Firestore has no updateMany, so this is
    // done via chunked batched writes (500-op limit per batch).
    const queuedJobsSnap = await db
      .collection("jobs")
      .where("campaignId", "==", id)
      .where("status", "==", "queued")
      .get();

    await runChunkedBatch(
      db,
      queuedJobsSnap.docs.map((doc) => (batch) => batch.update(doc.ref, { status: "failed" }))
    );

    return NextResponse.json({ status: "aborted" });
  } catch (e) {
    return errorResponse(e);
  }
}
