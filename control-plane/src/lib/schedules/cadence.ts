// Pure timing logic for scan schedules: when does a schedule run next?
// No Firestore and no clock access (callers pass the times in), and no
// Node-only APIs, so it's unit tested directly and also imported by the
// dashboard to preview upcoming runs while the user edits a schedule.
//
// A cadence is "repeat every N <unit>", where the unit decides what else can
// be chosen:
//   hours   every N hours, counted from the anchor (e.g. 09:14, 15:14, ...)
//   days    every N days at HH:MM
//   weeks   every N weeks on the chosen weekdays at HH:MM
//   months  every N months on day D at HH:MM (clamped to the month's last day)
//
// Wall-clock times (HH:MM, weekdays, dates) are interpreted in the schedule's
// IANA timezone, so "daily at 06:00 Europe/Rome" stays at 06:00 across DST
// changes. The "every N" counting starts from the schedule's anchor: its
// start date if one was chosen, otherwise when it was created (or the last
// run, when the cadence is changed). Nothing is ever scheduled before the
// anchor, which is how a future start date is honoured.

export type ScheduleCadence =
  | { unit: "hours"; every: number }
  | { unit: "days"; every: number; time: string }
  | { unit: "weeks"; every: number; time: string; daysOfWeek: number[] } // 0 = Sunday ... 6 = Saturday
  | { unit: "months"; every: number; time: string; dayOfMonth: number };

export type CadenceUnit = ScheduleCadence["unit"];

// Upper bounds for "every N". The 1-hour floor is deliberate: every run sends
// a dozen-plus requests to the target, and a monitor has no reason to hit a
// customer's site more often than that.
export const CADENCE_LIMITS: Record<CadenceUnit, { min: number; max: number }> = {
  hours: { min: 1, max: 168 },
  days: { min: 1, max: 365 },
  weeks: { min: 1, max: 52 },
  months: { min: 1, max: 12 },
};

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Returns a human-readable problem with the cadence, or null if it's valid. */
export function validateCadence(cadence: ScheduleCadence): string | null {
  const limits = CADENCE_LIMITS[cadence.unit];
  if (!limits) return "Unknown repeat unit.";
  if (!Number.isInteger(cadence.every) || cadence.every < limits.min || cadence.every > limits.max) {
    return `Repeat every must be a whole number of ${cadence.unit} between ${limits.min} and ${limits.max}.`;
  }
  if (cadence.unit === "hours") return null;

  if (!TIME_PATTERN.test(cadence.time)) return "Time must be in 24-hour HH:MM format.";
  if (cadence.unit === "weeks") {
    const days = cadence.daysOfWeek;
    if (days.length === 0) return "Pick at least one day of the week.";
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Days of the week must be 0 (Sun) to 6 (Sat).";
    if (new Set(days).size !== days.length) return "Days of the week must not repeat.";
  }
  if (cadence.unit === "months") {
    if (!Number.isInteger(cadence.dayOfMonth) || cadence.dayOfMonth < 1 || cadence.dayOfMonth > 31) {
      return "Day of month must be between 1 and 31.";
    }
  }
  return null;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// ---------- Timezone helpers (Intl-based, no dependencies) ----------

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallTimeIn(date: Date, timeZone: string): WallTime {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatterCache.set(timeZone, fmt);
  }
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (e.g. +1h for Rome in winter). */
function offsetAt(instantMs: number, timeZone: string): number {
  const wholeSecond = Math.floor(instantMs / 1000) * 1000;
  const w = wallTimeIn(new Date(wholeSecond), timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - wholeSecond;
}

/**
 * The instant at which the wall clock in `timeZone` reads the given local
 * date/time. DST edge cases follow the usual "compatible" convention: a time
 * that doesn't exist (skipped by spring-forward) moves later by the gap; a
 * time that occurs twice (fall-back) resolves to the first occurrence.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetAt(asUtc, timeZone);
  const second = asUtc - offsetAt(first, timeZone);

  const matches = (candidate: number) => {
    const w = wallTimeIn(new Date(candidate), timeZone);
    return w.year === year && w.month === month && w.day === day && w.hour === hour && w.minute === minute;
  };
  const exact = [first, second].filter(matches);
  if (exact.length > 0) return new Date(Math.min(...exact));
  return new Date(Math.max(first, second)); // inside a DST gap
}

// Calendar arithmetic on plain dates (no time, no timezone).
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
const fromDayNumber = (n: number) => {
  const dt = new Date(n * DAY_MS);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), weekday: dt.getUTCDay() };
};
// Weeks start on Monday. Day 0 (1970-01-01) was a Thursday.
const weekNumber = (dayNum: number) => Math.floor((dayNum + 3) / 7);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const mod = (a: number, n: number) => ((a % n) + n) % n;

function parseTime(time: string): [number, number] {
  const [h, m] = time.split(":").map(Number);
  return [h, m];
}

// ---------- Next run computation ----------

export interface CadenceContext {
  cadence: ScheduleCadence;
  timeZone: string;
  // Reference point for "every N" counting, and the earliest possible run.
  anchor: Date;
}

/**
 * The first scheduled run strictly after `after`, and never before the
 * anchor (so a schedule with a future start date doesn't run early).
 */
export function nextRunAfter({ cadence, timeZone, anchor }: CadenceContext, requestedAfter: Date): Date {
  const after = new Date(Math.max(requestedAfter.getTime(), anchor.getTime() - 1));

  if (cadence.unit === "hours") {
    const step = cadence.every * HOUR_MS;
    const k = Math.floor((after.getTime() - anchor.getTime()) / step) + 1;
    return new Date(anchor.getTime() + k * step);
  }

  const [hour, minute] = parseTime(cadence.time);
  const anchorWall = wallTimeIn(anchor, timeZone);
  const anchorDay = dayNumber(anchorWall.year, anchorWall.month, anchorWall.day);
  const afterWall = wallTimeIn(after, timeZone);
  const startDay = dayNumber(afterWall.year, afterWall.month, afterWall.day);

  if (cadence.unit === "months") {
    const anchorMonth = anchorWall.year * 12 + (anchorWall.month - 1);
    const startMonth = afterWall.year * 12 + (afterWall.month - 1);
    for (let monthIndex = startMonth; monthIndex <= startMonth + cadence.every + 1; monthIndex++) {
      if (mod(monthIndex - anchorMonth, cadence.every) !== 0) continue;
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const day = Math.min(cadence.dayOfMonth, daysInMonth(year, month));
      const candidate = zonedTimeToInstant(year, month, day, hour, minute, timeZone);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
  } else {
    const horizon = cadence.unit === "days" ? cadence.every + 1 : 7 * cadence.every + 7;
    for (let dayNum = startDay; dayNum <= startDay + horizon; dayNum++) {
      const date = fromDayNumber(dayNum);
      const onCadence =
        cadence.unit === "days"
          ? mod(dayNum - anchorDay, cadence.every) === 0
          : cadence.daysOfWeek.includes(date.weekday) &&
            mod(weekNumber(dayNum) - weekNumber(anchorDay), cadence.every) === 0;
      if (!onCadence) continue;
      const candidate = zonedTimeToInstant(date.year, date.month, date.day, hour, minute, timeZone);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
  }

  // Unreachable for a valid cadence: the search windows above always contain
  // at least one matching slot.
  throw new Error(`No upcoming run found for cadence ${JSON.stringify(cadence)}`);
}

/**
 * The first run of a schedule that starts at `startAt`: `startAt` itself for
 * "every N hours", otherwise the first matching day/time on or after it.
 */
export function firstRunFrom(cadence: ScheduleCadence, timeZone: string, startAt: Date): Date {
  return nextRunAfter({ cadence, timeZone, anchor: startAt }, new Date(startAt.getTime() - 1));
}

/** The next `count` runs after `after`, e.g. for previews. */
export function upcomingRuns(ctx: CadenceContext, after: Date, count: number): Date[] {
  const runs: Date[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    cursor = nextRunAfter(ctx, cursor);
    runs.push(cursor);
  }
  return runs;
}

// ---------- Display ----------

function formatList(days: number[]): string {
  // Monday-first, matching the editor.
  return [...days]
    .sort((a, b) => mod(a - 1, 7) - mod(b - 1, 7))
    .map((d) => WEEKDAY_LABELS[d])
    .join(", ");
}

export function describeCadence(cadence: ScheduleCadence, timeZone: string): string {
  const n = cadence.every;
  const plural = (word: string) => (n === 1 ? word : `${n} ${word}s`);
  switch (cadence.unit) {
    case "hours":
      return n === 1 ? "Every hour" : `Every ${n} hours`;
    case "days":
      return `${n === 1 ? "Daily" : `Every ${plural("day")}`} at ${cadence.time} (${timeZone})`;
    case "weeks":
      return `${n === 1 ? "Weekly" : `Every ${plural("week")}`} on ${formatList(cadence.daysOfWeek)} at ${cadence.time} (${timeZone})`;
    case "months":
      return `${n === 1 ? "Monthly" : `Every ${plural("month")}`} on day ${cadence.dayOfMonth} at ${cadence.time} (${timeZone})`;
  }
}

/** Whether two cadences describe the same schedule (ignores weekday order). */
export function sameCadence(a: ScheduleCadence, b: ScheduleCadence): boolean {
  const key = (c: ScheduleCadence) =>
    [
      c.unit,
      c.every,
      "time" in c ? c.time : "",
      c.unit === "weeks" ? [...c.daysOfWeek].sort((x, y) => x - y).join(",") : "",
      c.unit === "months" ? c.dayOfMonth : "",
    ].join("|");
  return key(a) === key(b);
}
