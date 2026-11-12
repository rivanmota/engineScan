import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { requireOrgApiKey } from "@/lib/auth";
import { assertJobInScope, ScopeViolation } from "@/lib/scope";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { campaignFromDoc, campaignRunFromDoc } from "@/lib/converters";
import { runChunkedBatch } from "@/lib/batch";

// Starts a run: for every (technique x target) pair in scope, create a Job
// for the chosen agent. assertJobInScope is the safety gate — nothing here
// bypasses it.
const startRunSchema = z.object({ agentId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { organizationId } = await requireOrgApiKey(req);

    const parsed = startRunSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const db = getDb();

    const campaignRef = db.collection("campaigns").doc(id);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists || campaignSnap.data()?.organizationId !== organizationId) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const campaign = campaignFromDoc(campaignSnap);

    const agentSnap = await db.collection("agents").doc(parsed.data.agentId).get();
    if (!agentSnap.exists || agentSnap.data()?.organizationId !== organizationId) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const agentId = agentSnap.id;

    const runRef = db.collection("campaignRuns").doc();
    await runRef.set({ campaignId: campaign.id, startedAt: new Date(), completedAt: null });

    const createdJobs: { techniqueId: string; target: string }[] = [];
    const rejected: { techniqueId: string; target: string; reason: string }[] = [];
    const jobOps: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

    for (const techniqueId of campaign.allowedTechniques) {
      for (const target of campaign.scopeTargets) {
        try {
          assertJobInScope(campaign, techniqueId, target);
          // Jobs use a uuid as their id (not Firestore's auto-id) so they
          // match the `z.string().uuid()` contract the agent/results route
          // already expects (same as the old Prisma `@default(uuid())`).
          const jobRef = db.collection("jobs").doc(uuidv4());
          jobOps.push((batch) =>
            batch.set(jobRef, {
              agentId,
              campaignRunId: runRef.id,
              campaignId: campaign.id,
              techniqueId,
              target,
              status: "queued",
              createdAt: new Date(),
            })
          );
          createdJobs.push({ techniqueId, target });
        } catch (e) {
          if (e instanceof ScopeViolation) {
            rejected.push({ techniqueId, target, reason: e.message });
          } else {
            throw e;
          }
        }
      }
    }

    await runChunkedBatch(db, jobOps);
    await campaignRef.update({ status: "running" });

    const run = campaignRunFromDoc(await runRef.get());
    return NextResponse.json({ run, createdJobs: createdJobs.length, rejected }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
