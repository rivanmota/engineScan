// Next.js calls register() once when the server starts.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  // The scheduler uses firebase-admin and Node APIs, so it must only load in
  // the Node.js runtime. Keep the import *inside* this exact
  // `NEXT_RUNTIME === "nodejs"` check: that's the form webpack can strip from
  // the Edge bundle (an early `return` for other runtimes isn't).
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SCHEDULER_ENABLED === "true") {
    const { startInProcessScheduler } = await import("./lib/schedules/inProcessScheduler");
    startInProcessScheduler();
  }
}
