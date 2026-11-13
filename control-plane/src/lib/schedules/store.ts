import { getDb } from "@/lib/firestore";
import { scanFromDoc, scheduleFromDoc } from "@/lib/converters";
import { loadFindingsForScans } from "@/lib/findings";
import { ScanSchedule } from "@/types/firestore";
import { analyzeScanHistory, DETAIL_HISTORY_LIMIT, HistoryAnalysis, IssueSeverity, RunSummary, toHistoryScan } from "./history";
import { SCHEDULES_COLLECTION } from "./runner";

// Read side of scan schedules: loading a schedule's scan history and shaping
// it into the JSON the API returns.

// The list view only needs the latest changes and current open issues.
export const LIST_HISTORY_LIMIT = 10;

export async function getScheduleForOrg(id: string, organizationId: string): Promise<ScanSchedule | null> {
  const snap = await getDb().collection(SCHEDULES_COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.organizationId !== organizationId) return null;
  return scheduleFromDoc(snap);
}

export async function listSchedulesForOrg(organizationId: string): Promise<ScanSchedule[]> {
  const snap = await getDb().collection(SCHEDULES_COLLECTION).where("organizationId", "==", organizationId).get();
  return snap.docs.map(scheduleFromDoc).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function findScheduleByTarget(organizationId: string, targetUrl: string): Promise<ScanSchedule | null> {
  const snap = await getDb()
    .collection(SCHEDULES_COLLECTION)
    .where("organizationId", "==", organizationId)
    .where("targetUrl", "==", targetUrl)
    .limit(1)
    .get();
  return snap.empty ? null : scheduleFromDoc(snap.docs[0]);
}

/** The schedule's most recent `limit` scans (newest first), with findings. */
async function loadRecentScans(scheduleId: string, limit: number) {
  // Requires the (scheduleId ASC, createdAt DESC) composite index in
  // firestore.indexes.json.
  const scansSnap = await getDb()
    .collection("scans")
    .where("scheduleId", "==", scheduleId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const scans = scansSnap.docs.map(scanFromDoc);

  const findingsByScan = await loadFindingsForScans(scans.map((s) => s.id));
  return scans.map((scan) => ({ ...scan, findings: findingsByScan.get(scan.id) ?? [] }));
}

export interface ScheduleSummary {
  // Issues currently believed open (as of the most recent completed run).
  openIssueCounts: Record<IssueSeverity, number>;
  latestRun: RunSummary | null;
}

export type ScheduleView = ScanSchedule & { summary: ScheduleSummary };
export type ScheduleDetailView = ScheduleView & Pick<HistoryAnalysis, "runs" | "issues">;

function summarize(analysis: HistoryAnalysis): ScheduleSummary {
  const openIssueCounts: Record<IssueSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const issue of analysis.issues) {
    if (issue.status === "open") openIssueCounts[issue.severity] += 1;
  }
  return { openIssueCounts, latestRun: analysis.runs[0] ?? null };
}

async function analyze(schedule: ScanSchedule, limit: number): Promise<HistoryAnalysis> {
  const scans = await loadRecentScans(schedule.id, limit);
  return analyzeScanHistory(scans.map(toHistoryScan));
}

export async function buildScheduleView(schedule: ScanSchedule): Promise<ScheduleView> {
  const analysis = await analyze(schedule, LIST_HISTORY_LIMIT);
  return { ...schedule, summary: summarize(analysis) };
}

export async function buildScheduleDetailView(schedule: ScanSchedule): Promise<ScheduleDetailView> {
  const analysis = await analyze(schedule, DETAIL_HISTORY_LIMIT);
  return { ...schedule, summary: summarize(analysis), runs: analysis.runs, issues: analysis.issues };
}
