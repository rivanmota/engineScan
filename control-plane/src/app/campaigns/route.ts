import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { isKnownTechnique } from "@/lib/attackMatrix";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { campaignFromDoc, campaignRunFromDoc, techniqueResultFromDoc } from "@/lib/converters";

const createCampaignSchema = z.object({
  name: z.string().min(1),
  scopeTargets: z.array(z.string()).min(1, "At least one target host/CIDR is required"),
  allowedTechniques: z.array(z.string()).min(1),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  // Required: who is attesting they're authorized to test this scope.
  // See docs/SAFETY_AND_SCOPE.md — this is a product requirement, not optional metadata.
  authorizedByName: z.string().min(1),
  authorizedByEmail: z.string().email(),
});

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);

    const parsed = createCampaignSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const unknown = body.allowedTechniques.filter((t) => !isKnownTechnique(t));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown technique id(s): ${unknown.join(", ")}` }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("campaigns").doc();
    await ref.set({
      name: body.name,
      organizationId,
      scopeTargets: body.scopeTargets,
      allowedTechniques: body.allowedTechniques,
      windowStart: new Date(body.windowStart),
      windowEnd: new Date(body.windowEnd),
      authorizedByName: body.authorizedByName,
      authorizedByEmail: body.authorizedByEmail,
      authorizedAt: new Date(),
      status: "pending",
      createdAt: new Date(),
    });

    const campaign = campaignFromDoc(await ref.get());
    return NextResponse.json(campaign, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const db = getDb();

    const campaignsSnap = await db
      .collection("campaigns")
      .where("organizationId", "==", organizationId)
      .get();

    const campaigns = await Promise.all(
      campaignsSnap.docs.map(async (doc) => {
        const campaign = campaignFromDoc(doc);

        const runsSnap = await db
          .collection("campaignRuns")
          .where("campaignId", "==", campaign.id)
          .get();

        const runs = await Promise.all(
          runsSnap.docs.map(async (runDoc) => {
            const run = campaignRunFromDoc(runDoc);
            const resultsSnap = await db
              .collection("techniqueResults")
              .where("campaignRunId", "==", run.id)
              .get();
            return { ...run, results: resultsSnap.docs.map(techniqueResultFromDoc) };
          })
        );

        return { ...campaign, runs };
      })
    );

    return NextResponse.json(campaigns);
  } catch (e) {
    return errorResponse(e);
  }
}
