import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiKey } from "@/lib/auth";
import { getDb } from "@/lib/firestore";
import { errorResponse } from "@/lib/httpErrors";
import { scanFromDoc } from "@/lib/converters";
import { loadFindingsForScans } from "@/lib/findings";
import { executeScan } from "@/lib/executeScan";

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

    const scan = await executeScan({
      organizationId,
      targetUrl: body.targetUrl,
      authorizedByName: body.authorizedByName,
      authorizedByEmail: body.authorizedByEmail,
      authorizedAt: new Date(),
      scheduleId: null,
    });

    return NextResponse.json(scan, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

const listScansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // The `nextCursor` from the previous page.
  cursor: z.string().min(1).optional(),
});

// Cursor-paginated, newest first:
//   GET /scans?limit=20               -> first page
//   GET /scans?limit=20&cursor=<id>   -> the page after the scan with that id
// Response: { scans, nextCursor, total }. nextCursor is null on the last page.
// Cursors stay stable while new scans arrive, unlike page numbers/offsets.
export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireOrgApiKey(req);

    const parsed = listScansQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { limit, cursor } = parsed.data;

    const db = getDb();
    const orgScans = db.collection("scans").where("organizationId", "==", organizationId);

    // Requires the (organizationId ASC, createdAt DESC) composite index in
    // firestore.indexes.json.
    let pageQuery = orgScans.orderBy("createdAt", "desc");
    if (cursor) {
      const cursorSnap = await db.collection("scans").doc(cursor).get();
      if (!cursorSnap.exists || cursorSnap.data()?.organizationId !== organizationId) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      pageQuery = pageQuery.startAfter(cursorSnap);
    }

    // One extra row tells us whether there's a next page.
    const [pageSnap, countSnap] = await Promise.all([pageQuery.limit(limit + 1).get(), orgScans.count().get()]);
    const hasMore = pageSnap.docs.length > limit;
    const scans = pageSnap.docs.slice(0, limit).map(scanFromDoc);

    const findingsByScan = await loadFindingsForScans(scans.map((s) => s.id));

    return NextResponse.json({
      scans: scans.map((scan) => ({ ...scan, findings: findingsByScan.get(scan.id) ?? [] })),
      nextCursor: hasMore ? scans[scans.length - 1].id : null,
      total: countSnap.data().count,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
