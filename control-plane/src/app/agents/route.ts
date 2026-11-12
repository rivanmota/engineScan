import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";

const registerSchema = z.object({ name: z.string().min(1) });

// Called once by an operator (not the agent itself) to provision a new
// agent and get back a token to install on the endpoint.
export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);

    const parsed = registerSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("agents").doc(uuidv4());
    await ref.set({
      name: parsed.data.name,
      token: uuidv4(),
      organizationId,
      lastSeenAt: null,
      createdAt: new Date(),
    });

    const agentSnap = await ref.get();
    const data = agentSnap.data()!;
    // token is only ever shown here — treat like a password
    return NextResponse.json(
      {
        id: agentSnap.id,
        name: data.name,
        token: data.token,
        organizationId: data.organizationId,
        lastSeenAt: data.lastSeenAt,
        createdAt: data.createdAt.toDate(),
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}

// Lists agents for the authenticated organization. Not part of the original
// Express API (which only ever registered agents), but needed by the
// dashboard to show registered agents and let an operator pick one to run
// a campaign against.
export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const db = getDb();

    const snapshot = await db.collection("agents").where("organizationId", "==", organizationId).get();
    const agents = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        organizationId: data.organizationId,
        lastSeenAt: data.lastSeenAt ? data.lastSeenAt.toDate() : null,
        createdAt: data.createdAt.toDate(),
        // token is intentionally omitted here — only shown once at creation
      };
    });

    return NextResponse.json(agents);
  } catch (e) {
    return errorResponse(e);
  }
}
