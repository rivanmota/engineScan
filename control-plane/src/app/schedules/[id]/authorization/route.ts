import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { scheduleFromDoc } from "@/lib/converters";
import { AUTHORIZATION_EXPIRED_ERROR_PREFIX } from "@/lib/schedules/authorization";
import { SCHEDULES_COLLECTION } from "@/lib/schedules/runner";
import { attestationSchema } from "@/lib/schedules/validation";
import { buildScheduleDetailView, getScheduleForOrg } from "@/lib/schedules/store";

const renewSchema = z.object(attestationSchema).strict();

// Renews (re-attests) a schedule's authorization: someone confirms again that
// they're authorized to have this target scanned, and picks a new expiry.
// Can be done at any time, before or after the previous one expired. Each
// scan records the attestation that was current when it ran.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await requireOrgApiKey(req);
    const { id } = await params;

    const parsed = renewSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const db = getDb();
    const ref = db.collection(SCHEDULES_COLLECTION).doc(id);
    const found = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.organizationId !== organizationId) return false;

      const current = scheduleFromDoc(snap);
      const now = new Date();
      tx.update(ref, {
        authorizedByName: body.authorizedByName,
        authorizedByEmail: body.authorizedByEmail,
        authorizedAt: now,
        authorizationExpiresAt: body.authorizationExpiresAt,
        // An "authorization expired" error no longer applies.
        ...(current.lastError?.startsWith(AUTHORIZATION_EXPIRED_ERROR_PREFIX) ? { lastError: null } : {}),
        updatedAt: now,
      });
      return true;
    });
    if (!found) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    const schedule = (await getScheduleForOrg(id, organizationId))!;
    return NextResponse.json(await buildScheduleDetailView(schedule));
  } catch (e) {
    return errorResponse(e);
  }
}
