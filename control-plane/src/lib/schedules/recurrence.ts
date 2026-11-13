// When a schedule re-scans its target. Pure functions only (no Firestore,
// no clock access: callers pass `now`), shared by the server (computing
// nextRunAt) and the dashboard (validating the form and previewing upcoming
// runs), so both always agree.
//
// A recurrence is "every N <unit>", like a calendar app:
//   - hours:  every N hours, counted from the previous run.
//   - days:   every N days, at one or more times of day.
//   - weeks:  every N weeks, on selected weekdays, at one or more times.
//   - months: every N months, on selected days of the month, at one or more
//             times. Days past the end of a shorter month (e.g. the 31st)
//             run on that month's last day instead.
// Times of day are wall-clock times in the recurrence's IANA time zone, so
// "09:00 Europe/Rome" stays 09:00 across daylight-saving changes. The
// "every N" count starts from the schedule's anchor date (the local date the
// recurrence was set), e.g. "every 2 weeks" means the anchor's week, then
// every other week after it.

export type RecurrenceUnit = "hours" | "days" | "weeks" | "months";

export type Recurrence =
  | { unit: "hours"; every: number }
  | { unit: "days"; every: number; times: string[]; timezone: string }
  | { unit: "weeks"; every: number; daysOfWeek: number[]; times: string[]; timezone: string }
  | { unit: "months"; every: number; daysOfMonth: number[]; times: string[]; timezone: string };

export type CalendarRecurrence = Exclude<Recurrence, { unit: "hours" }>;

// Upper bound of "every N" per unit.
export const MAX_EVERY: Record<RecurrenceUnit, number> = { hours: 168, days: 365, weeks: 52, months: 12 };
export const MAX_TIMES_PER_DAY = 12;
// Each run makes a dozen-plus requests to the target, so runs are never
// closer together than an hour: that's the hours-unit floor, and times of
// day must be at least this far apart.
export const MIN_MINUTES_BETWEEN_TIMES = 60;

// 0 = Sunday ... 6 = Saturday (same as Date.getDay()).
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Long enough to find the next run of any valid recurrence ("every 12
// months on the 31st" is the sparsest).
const MAX_SEARCH_DAYS = 800;

// ---------------------------------------------------------------- validation

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function timeToMinutes(time: string): number {
  const [, h, m] = TIME_RE.exec(time)!;
  return Number(h) * 60 + Number(m);
}

/** Human-readable problems with a recurrence; empty when it's valid. */
export function validateRecurrence(r: Recurrence): string[] {
  const errors: string[] = [];
  const max = MAX_EVERY[r.unit];
  if (!Number.isInteger(r.every) || r.every < 1 || r.every > max) {
    errors.push(`"Every" must be a whole number of ${r.unit} between 1 and ${max}.`);
  }
  if (r.unit === "hours") return errors;

  if (!isValidTimeZone(r.timezone)) errors.push(`Unknown time zone "${r.timezone}".`);

  if (r.times.length === 0) errors.push("Add at least one time of day.");
  if (r.times.length > MAX_TIMES_PER_DAY) errors.push(`At most ${MAX_TIMES_PER_DAY} times of day.`);
  const badTime = r.times.find((t) => !TIME_RE.test(t));
  if (badTime !== undefined) {
    errors.push(`"${badTime}" is not a valid time (use 24-hour HH:MM).`);
  } else if (r.times.length > 1) {
    const minutes = [...r.times].map(timeToMinutes).sort((a, b) => a - b);
    // Include the wrap-around gap (e.g. 23:30 -> 00:10 the next day).
    const gaps = minutes.map((m, i) => (i === 0 ? minutes[0] + 1440 - minutes[minutes.length - 1] : m - minutes[i - 1]));
    if (Math.min(...gaps) < MIN_MINUTES_BETWEEN_TIMES) {
      errors.push(`Times of day must be at least ${MIN_MINUTES_BETWEEN_TIMES} minutes apart.`);
    }
  }

  if (r.unit === "weeks") {
    if (r.daysOfWeek.length === 0) errors.push("Pick at least one day of the week.");
    if (r.daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push("Days of the week must be 0 (Sunday) to 6 (Saturday).");
  }
  if (r.unit === "months") {
    if (r.daysOfMonth.length === 0) errors.push("Pick at least one day of the month.");
    if (r.daysOfMonth.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) errors.push("Days of the month must be 1 to 31.");
  }
  return errors;
}

/** Sorted, de-duplicated copy, so equal recurrences compare equal. */
export function normalizeRecurrence(r: Recurrence): Recurrence {
  const uniqSorted = <T,>(xs: T[], cmp: (a: T, b: T) => number) => [...new Set(xs)].sort(cmp);
  const byNumber = (a: number, b: number) => a - b;
  const byString = (a: string, b: string) => a.localeCompare(b);
  switch (r.unit) {
    case "hours":
      return { unit: "hours", every: r.every };
    case "days":
      return { unit: "days", every: r.every, times: uniqSorted(r.times, byString), timezone: r.timezone };
    case "weeks":
      return {
        unit: "weeks",
        every: r.every,
        daysOfWeek: uniqSorted(r.daysOfWeek, byNumber),
        times: uniqSorted(r.times, byString),
        timezone: r.timezone,
      };
    case "months":
      return {
        unit: "months",
        every: r.every,
        daysOfMonth: uniqSorted(r.daysOfMonth, byNumber),
        times: uniqSorted(r.times, byString),
        timezone: r.timezone,
      };
  }
}

export function recurrencesEqual(a: Recurrence, b: Recurrence): boolean {
  return JSON.stringify(normalizeRecurrence(a)) === JSON.stringify(normalizeRecurrence(b));
}

// ---------------------------------------------------------------- description

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  const suffix = rem100 >= 11 && rem100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function describeWeekdays(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "every day";
  if (set.join() === "1,2,3,4,5") return "weekdays";
  if (set.join() === "0,6") return "weekends";
  // Monday-first reads more naturally.
  const mondayFirst = [...set.filter((d) => d !== 0), ...set.filter((d) => d === 0)];
  return joinList(mondayFirst.map((d) => WEEKDAY_NAMES[d]));
}

/** e.g. "Every 2 weeks on Monday and Thursday at 09:00 and 17:00 (Europe/Rome)". */
export function describeRecurrence(r: Recurrence): string {
  if (r.unit === "hours") return r.every === 1 ? "Every hour" : `Every ${r.every} hours`;

  const at = `at ${joinList([...new Set(r.times)].sort())}`;
  const tz = `(${r.timezone})`;
  switch (r.unit) {
    case "days":
      return `${r.every === 1 ? "Every day" : `Every ${r.every} days`} ${at} ${tz}`;
    case "weeks": {
      const days = describeWeekdays(r.daysOfWeek);
      if (r.every === 1) {
        if (days === "every day") return `Every day ${at} ${tz}`;
        if (days === "weekdays" || days === "weekends") return `Every ${days.slice(0, -1)} ${at} ${tz}`;
        return `Weekly on ${days} ${at} ${tz}`;
      }
      return `Every ${r.every} weeks on ${days} ${at} ${tz}`;
    }
    case "months": {
      const sorted = [...new Set(r.daysOfMonth)].sort((a, b) => a - b);
      const days = `the ${joinList(sorted.map(ordinal))}`;
      const clampNote = sorted.some((d) => d > 28) ? " (or the last day of shorter months)" : "";
      const lead = r.every === 1 ? "Monthly" : `Every ${r.every} months`;
      return `${lead} on ${days}${clampNote} ${at} ${tz}`;
    }
  }
}

// ---------------------------------------------------------------- time zones

interface LocalDate {
  y: number;
  m: number; // 1-12
  d: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function zonedParts(instantMs: number, tz: string) {
  const parts: Record<string, number> = {};
  for (const p of zoneFormatter(tz).formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { y: parts.year, m: parts.month, d: parts.day, hh: parts.hour, mm: parts.minute, ss: parts.second };
}

/** UTC offset of `tz` at the given instant, in ms (e.g. +1h for Europe/Rome in winter). */
function offsetMs(instantMs: number, tz: string): number {
  const p = zonedParts(instantMs, tz);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` shows the given local date and
 * time. A time skipped by a DST jump (e.g. 02:30 on spring-forward day) maps
 * to the same moment shifted forward (03:30); a repeated time (fall-back)
 * maps to its first occurrence.
 */
export function zonedTimeToInstant(date: LocalDate, minutesOfDay: number, tz: string): Date {
  const wall = Date.UTC(date.y, date.m - 1, date.d, Math.floor(minutesOfDay / 60), minutesOfDay % 60);
  const o1 = offsetMs(wall, tz);
  const t1 = wall - o1;
  const o2 = offsetMs(t1, tz);
  if (o1 === o2) return new Date(t1);
  const t2 = wall - o2;
  if (offsetMs(t2, tz) === o2) return new Date(t2);
  return new Date(t1); // in a DST gap
}

// ---------------------------------------------------------------- calendar math

const dayNumber = (ld: LocalDate) => Math.floor(Date.UTC(ld.y, ld.m - 1, ld.d) / DAY_MS);
function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
const weekdayOf = (n: number) => new Date(n * DAY_MS).getUTCDay();
// Monday-based week number (day 0, 1970-01-01, was a Thursday).
const weekNumber = (n: number) => Math.floor((n + 3) / 7);
const monthNumber = (ld: LocalDate) => ld.y * 12 + (ld.m - 1);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const mod = (a: number, n: number) => ((a % n) + n) % n;

export function parseLocalDate(s: string): LocalDate {
  const match = DATE_RE.exec(s);
  if (!match) throw new Error(`Invalid local date "${s}"`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatLocalDate(ld: LocalDate): string {
  return `${ld.y}-${String(ld.m).padStart(2, "0")}-${String(ld.d).padStart(2, "0")}`;
}

/**
 * The anchor date to store when a recurrence is set at `now`: today's date
 * in the recurrence's time zone (UTC for the hours unit, where it's unused).
 */
export function anchorDateFor(r: Recurrence, now: Date): string {
  const p = zonedParts(now.getTime(), r.unit === "hours" ? "UTC" : r.timezone);
  return formatLocalDate(p);
}

function matchesDay(r: CalendarRecurrence, anchor: LocalDate, n: number): boolean {
  switch (r.unit) {
    case "days":
      return mod(n - dayNumber(anchor), r.every) === 0;
    case "weeks":
      return r.daysOfWeek.includes(weekdayOf(n)) && mod(weekNumber(n) - weekNumber(dayNumber(anchor)), r.every) === 0;
    case "months": {
      const ld = fromDayNumber(n);
      if (mod(monthNumber(ld) - monthNumber(anchor), r.every) !== 0) return false;
      const last = daysInMonth(ld.y, ld.m);
      return r.daysOfMonth.some((dom) => Math.min(dom, last) === ld.d);
    }
  }
}

/** First calendar occurrence strictly after `after`. */
function nextCalendarOccurrence(r: CalendarRecurrence, anchorDate: string, after: Date): Date {
  const anchor = parseLocalDate(anchorDate);
  const minutes = [...new Set(r.times)].map(timeToMinutes).sort((a, b) => a - b);
  const start = Math.max(dayNumber(zonedParts(after.getTime(), r.timezone)), dayNumber(anchor));

  for (let n = start; n < start + MAX_SEARCH_DAYS; n++) {
    if (!matchesDay(r, anchor, n)) continue;
    const date = fromDayNumber(n);
    for (const m of minutes) {
      const at = zonedTimeToInstant(date, m, r.timezone);
      if (at.getTime() > after.getTime()) return at;
    }
  }
  throw new Error(`No upcoming run found for recurrence ${JSON.stringify(r)}`);
}

// ---------------------------------------------------------------- scheduling

/** When the first automatic run is due, for a schedule whose baseline scan just ran at `now`. */
export function firstRunAfterCreate(r: Recurrence, anchorDate: string, now: Date): Date {
  if (r.unit === "hours") return new Date(now.getTime() + r.every * HOUR_MS);
  return nextCalendarOccurrence(r, anchorDate, now);
}

/**
 * The next run after a run that was due at `dueAt` has been claimed at `now`.
 * Always in the future. If the scheduler was down and several runs were
 * missed, they're skipped (one catch-up run, not a burst). Hourly schedules
 * stay on their original cadence (dueAt + k * N hours).
 */
export function nextRunAfterClaim(r: Recurrence, anchorDate: string, dueAt: Date, now: Date): Date {
  if (r.unit === "hours") {
    const intervalMs = r.every * HOUR_MS;
    const elapsed = now.getTime() - dueAt.getTime();
    const slots = elapsed < 0 ? 1 : Math.floor(elapsed / intervalMs) + 1;
    return new Date(dueAt.getTime() + slots * intervalMs);
  }
  return nextCalendarOccurrence(r, anchorDate, now);
}

/**
 * The next run when a schedule is resumed or its recurrence changes. Hourly:
 * N hours after the last run, or right away if that has passed. Calendar
 * units: the next matching date/time.
 */
export function nextRunAfterReschedule(r: Recurrence, anchorDate: string, lastRunAt: Date | null, now: Date): Date {
  if (r.unit === "hours") {
    if (!lastRunAt) return now;
    return new Date(Math.max(lastRunAt.getTime() + r.every * HOUR_MS, now.getTime()));
  }
  return nextCalendarOccurrence(r, anchorDate, now);
}

/** `first` followed by the runs after it, assuming none are missed (for previews). */
export function upcomingRuns(r: Recurrence, anchorDate: string, first: Date, count: number): Date[] {
  const runs = [first];
  while (runs.length < count) {
    const prev = runs[runs.length - 1];
    runs.push(
      r.unit === "hours" ? new Date(prev.getTime() + r.every * HOUR_MS) : nextCalendarOccurrence(r, anchorDate, prev)
    );
  }
  return runs;
}
