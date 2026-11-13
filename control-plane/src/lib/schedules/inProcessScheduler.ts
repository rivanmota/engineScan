import { runDueSchedules } from "./runner";

// Runs due schedules from inside the Next.js server process on a timer.
// Enabled with SCHEDULER_ENABLED=true (see .env.local.example) and started
// from src/instrumentation.ts. This suits local development and long-running
// `next start` deployments. For serverless deployments, leave it off and
// point a cron at POST /internal/schedules/run-due instead. Running both, or
// several instances, is safe: each run is claimed transactionally (see
// runner.ts), so nothing is scanned twice.

const DEFAULT_TICK_SECONDS = 60;

declare global {
  // eslint-disable-next-line no-var
  var __scanSchedulerTimer: NodeJS.Timeout | undefined;
}

export function startInProcessScheduler(): void {
  // Guard against double-start (e.g. dev-server reloads re-running register()).
  if (global.__scanSchedulerTimer) return;

  const parsed = Number(process.env.SCHEDULER_TICK_SECONDS);
  const tickSeconds = Number.isFinite(parsed) && parsed >= 5 ? parsed : DEFAULT_TICK_SECONDS;

  let ticking = false;
  const tick = async () => {
    // A slow tick (many due scans) must not overlap with the next one.
    if (ticking) return;
    ticking = true;
    try {
      const result = await runDueSchedules();
      if (result.ran > 0) {
        console.log(`[scheduler] ran ${result.ran} scheduled scan(s)`, result.results);
      }
    } catch (e) {
      console.error("[scheduler] tick failed", e);
    } finally {
      ticking = false;
    }
  };

  global.__scanSchedulerTimer = setInterval(tick, tickSeconds * 1000);
  console.log(`[scheduler] in-process scheduler started (every ${tickSeconds}s)`);
  void tick();
}
