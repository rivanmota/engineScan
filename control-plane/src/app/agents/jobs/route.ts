import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { jobFromDoc } from "@/lib/converters";
import { runChunkedBatch } from "@/lib/batch";

// Called repeatedly by the installed agent. Only returns jobs whose
// campaign is still "running" (not aborted) — this is the agent-side half
// of the kill switch in campaigns/[id]/abort/route.ts.
export async function GET(req: NextRequest) {
  try {
    const { agentId } = await requireAgentToken(req);
    const db = getDb();

    const queuedSnap = await db
      .collection("jobs")
      .where("agentId", "==", agentId)
      .where("status", "==", "queued")
      .limit(10)
      .get();

    // Firestore has no relational "include campaign" — filter in app code
    // by looking up each job's campaign status.
    const campaignIds = Array.from(new Set(queuedSnap.docs.map((d) => d.data().campaignId as string)));
    const runningCampaignIds = new Set<string>();
    await Promise.all(
      campaignIds.map(async (campaignId) => {
        const campaignSnap = await db.collection("campaigns").doc(campaignId).get();
        if (campaignSnap.exists && campaignSnap.data()?.status === "running") {
          runningCampaignIds.add(campaignId);
        }
      })
    );

    const eligibleDocs = queuedSnap.docs.filter((d) => runningCampaignIds.has(d.data().campaignId));

    await runChunkedBatch(
      db,
      eligibleDocs.map((doc) => (batch) => batch.update(doc.ref, { status: "running" }))
    );

    const jobs = eligibleDocs.map(jobFromDoc);
    return NextResponse.json(jobs);
  } catch (e) {
    return errorResponse(e);
  }
}
