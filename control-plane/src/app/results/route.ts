import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { requireAgentToken } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";

const resultSchema = z.object({
  jobId: z.string().uuid(),
  detected: z.boolean().nullable(),
  blocked: z.boolean().nullable(),
  evidence: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const { agentId } = await requireAgentToken(req);

    const parsed = resultSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const db = getDb();
    const jobRef = db.collection("jobs").doc(parsed.data.jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists || jobSnap.data()?.agentId !== agentId) {
      return NextResponse.json({ error: "Job not found for this agent" }, { status: 404 });
    }
    const job = jobSnap.data()!;

    const resultRef = db.collection("techniqueResults").doc(uuidv4());
    await resultRef.set({
      campaignRunId: job.campaignRunId,
      techniqueId: job.techniqueId,
      target: job.target,
      detected: parsed.data.detected,
      blocked: parsed.data.blocked,
      evidence: parsed.data.evidence,
      createdAt: new Date(),
    });

    await jobRef.update({ status: "done" });

    const resultSnap = await resultRef.get();
    const data = resultSnap.data()!;
    return NextResponse.json(
      {
        id: resultSnap.id,
        campaignRunId: data.campaignRunId,
        techniqueId: data.techniqueId,
        target: data.target,
        detected: data.detected,
        blocked: data.blocked,
        evidence: data.evidence,
        createdAt: data.createdAt.toDate(),
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
