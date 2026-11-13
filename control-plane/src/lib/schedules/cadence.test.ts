import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeCadence,
  firstRunFrom,
  nextRunAfter,
  sameCadence,
  ScheduleCadence,
  upcomingRuns,
  validateCadence,
  zonedTimeToInstant,
} from "./cadence";

const d = (iso: string) => new Date(iso);
const next = (cadence: ScheduleCadence, anchor: string, after: string, timeZone = "UTC") =>
  nextRunAfter({ cadence, timeZone, anchor: d(anchor) }, d(after)).toISOString();

test("validateCadence enforces ranges and required fields", () => {
  assert.equal(validateCadence({ unit: "hours", every: 1 }), null);
  assert.match(validateCadence({ unit: "hours", every: 0 })!, /between 1 and 168/);
  assert.match(validateCadence({ unit: "hours", every: 1.5 })!, /whole number/);
  assert.match(validateCadence({ unit: "days", every: 400, time: "06:00" })!, /between 1 and 365/);
  assert.match(validateCadence({ unit: "days", every: 1, time: "24:00" })!, /HH:MM/);
  assert.match(validateCadence({ unit: "days", every: 1, time: "6:00" })!, /HH:MM/);
  assert.match(validateCadence({ unit: "weeks", every: 1, time: "06:00", daysOfWeek: [] })!, /at least one day/);
  assert.match(validateCadence({ unit: "weeks", every: 1, time: "06:00", daysOfWeek: [7] })!, /0 \(Sun\) to 6/);
  assert.match(validateCadence({ unit: "weeks", every: 1, time: "06:00", daysOfWeek: [1, 1] })!, /repeat/);
  assert.match(validateCadence({ unit: "months", every: 1, time: "06:00", dayOfMonth: 32 })!, /1 and 31/);
  assert.equal(validateCadence({ unit: "months", every: 12, time: "23:59", dayOfMonth: 31 }), null);
});

test("hours: every N hours from the anchor, skipping missed slots", () => {
  const c: ScheduleCadence = { unit: "hours", every: 6 };
  assert.equal(next(c, "2026-01-01T09:14:00Z", "2026-01-01T09:14:00Z"), "2026-01-01T15:14:00.000Z");
  assert.equal(next(c, "2026-01-01T09:14:00Z", "2026-01-01T15:14:00Z"), "2026-01-01T21:14:00.000Z"); // strictly after
  // Scheduler down for two days: next slot on the original cadence.
  assert.equal(next(c, "2026-01-01T09:14:00Z", "2026-01-03T10:00:00Z"), "2026-01-03T15:14:00.000Z");
});

test("days: at a fixed time, every N days counted from the anchor date", () => {
  const daily: ScheduleCadence = { unit: "days", every: 1, time: "06:00" };
  assert.equal(next(daily, "2026-01-01T12:00:00Z", "2026-01-05T05:00:00Z"), "2026-01-05T06:00:00.000Z");
  assert.equal(next(daily, "2026-01-01T12:00:00Z", "2026-01-05T06:00:00Z"), "2026-01-06T06:00:00.000Z");

  const every3: ScheduleCadence = { unit: "days", every: 3, time: "06:00" };
  // Anchor Jan 1 -> runs on Jan 1, 4, 7, ...
  assert.equal(next(every3, "2026-01-01T12:00:00Z", "2026-01-01T12:00:00Z"), "2026-01-04T06:00:00.000Z");
  assert.equal(next(every3, "2026-01-01T12:00:00Z", "2026-01-04T07:00:00Z"), "2026-01-07T06:00:00.000Z");
});

test("days: wall-clock time holds across DST in the schedule's timezone", () => {
  const c: ScheduleCadence = { unit: "days", every: 1, time: "06:00" };
  const rome = (after: string) => next(c, "2026-01-01T00:00:00Z", after, "Europe/Rome");
  assert.equal(rome("2026-03-28T12:00:00Z"), "2026-03-29T04:00:00.000Z"); // DST starts Mar 29: 06:00 CEST
  assert.equal(rome("2026-03-27T12:00:00Z"), "2026-03-28T05:00:00.000Z"); // day before: 06:00 CET
  assert.equal(rome("2026-10-24T12:00:00Z"), "2026-10-25T05:00:00.000Z"); // DST ends Oct 25: back to CET
});

test("zonedTimeToInstant handles DST gaps and overlaps", () => {
  // New York springs forward 2026-03-08 02:00 -> 03:00: 02:30 doesn't exist, shift to 03:30 EDT.
  assert.equal(zonedTimeToInstant(2026, 3, 8, 2, 30, "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
  // Falls back 2026-11-01 02:00 -> 01:00: 01:30 happens twice, take the first (EDT).
  assert.equal(zonedTimeToInstant(2026, 11, 1, 1, 30, "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
  // Ordinary times, including a non-whole-hour offset.
  assert.equal(zonedTimeToInstant(2026, 7, 1, 9, 0, "Asia/Kolkata").toISOString(), "2026-07-01T03:30:00.000Z");
});

test("weeks: chosen weekdays, every N weeks (weeks start Monday)", () => {
  const monThu: ScheduleCadence = { unit: "weeks", every: 1, time: "09:00", daysOfWeek: [1, 4] };
  // 2026-01-06 is a Tuesday -> Thursday the 8th.
  assert.equal(next(monThu, "2026-01-05T00:00:00Z", "2026-01-06T12:00:00Z"), "2026-01-08T09:00:00.000Z");
  // After Thursday's run -> next Monday the 12th.
  assert.equal(next(monThu, "2026-01-05T00:00:00Z", "2026-01-08T09:00:00Z"), "2026-01-12T09:00:00.000Z");

  const biweeklyMon: ScheduleCadence = { unit: "weeks", every: 2, time: "09:00", daysOfWeek: [1] };
  // Anchored in the week of Mon Jan 5 -> Jan 5, Jan 19, Feb 2, ...
  assert.equal(next(biweeklyMon, "2026-01-07T00:00:00Z", "2026-01-07T00:00:00Z"), "2026-01-19T09:00:00.000Z");
  // Sunday Jan 11 belongs to the anchor week (Mon-start), so it doesn't reset the count.
  const biweeklySun: ScheduleCadence = { unit: "weeks", every: 2, time: "09:00", daysOfWeek: [0] };
  assert.equal(next(biweeklySun, "2026-01-07T00:00:00Z", "2026-01-07T00:00:00Z"), "2026-01-11T09:00:00.000Z");
  assert.equal(next(biweeklySun, "2026-01-07T00:00:00Z", "2026-01-11T10:00:00Z"), "2026-01-25T09:00:00.000Z");
});

test("months: day of month, clamped to the month's last day", () => {
  const on31: ScheduleCadence = { unit: "months", every: 1, time: "08:00", dayOfMonth: 31 };
  assert.equal(next(on31, "2026-01-01T00:00:00Z", "2026-01-31T09:00:00Z"), "2026-02-28T08:00:00.000Z");
  assert.equal(next(on31, "2026-01-01T00:00:00Z", "2026-03-31T09:00:00Z"), "2026-04-30T08:00:00.000Z");

  const quarterly: ScheduleCadence = { unit: "months", every: 3, time: "08:00", dayOfMonth: 1 };
  // Anchored in January -> Jan, Apr, Jul, Oct.
  assert.equal(next(quarterly, "2026-01-15T00:00:00Z", "2026-01-15T00:00:00Z"), "2026-04-01T08:00:00.000Z");
  assert.equal(next(quarterly, "2026-01-15T00:00:00Z", "2026-11-20T00:00:00Z"), "2027-01-01T08:00:00.000Z");
});

test("property: next run is always in the future and on the configured wall time", () => {
  const zones = ["UTC", "Europe/Rome", "America/New_York", "Asia/Kolkata", "Australia/Sydney", "Pacific/Auckland"];
  const cadences: ScheduleCadence[] = [
    { unit: "hours", every: 1 },
    { unit: "hours", every: 7 },
    { unit: "days", every: 1, time: "02:30" },
    { unit: "days", every: 5, time: "23:45" },
    { unit: "weeks", every: 1, time: "00:00", daysOfWeek: [0, 6] },
    { unit: "weeks", every: 3, time: "12:15", daysOfWeek: [2] },
    { unit: "months", every: 1, time: "07:00", dayOfMonth: 29 },
    { unit: "months", every: 5, time: "18:00", dayOfMonth: 31 },
  ];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const start = d("2026-01-01T00:00:00Z").getTime();
  let gapRuns = 0;

  for (let i = 0; i < 400; i++) {
    const timeZone = zones[i % zones.length];
    const cadence = cadences[i % cadences.length];
    const anchor = new Date(start + rand() * 365 * 864e5);
    const after = new Date(anchor.getTime() + rand() * 400 * 864e5);
    const runs = upcomingRuns({ cadence, timeZone, anchor }, after, 4);

    let prev = after;
    for (const run of runs) {
      assert.ok(run > prev, `${JSON.stringify(cadence)} ${timeZone}: ${run.toISOString()} not after ${prev.toISOString()}`);
      prev = run;
      if (cadence.unit === "hours") continue;
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).formatToParts(run).map((p) => [p.type, p.value])
      );
      const wall = `${parts.hour}:${parts.minute}`;
      if (wall === cadence.time) continue;
      // Off the configured time is only allowed when that time doesn't exist
      // on that day (DST gap), in which case it's shifted later.
      const [h, m] = cadence.time.split(":").map(Number);
      const intended = zonedTimeToInstant(+parts.year, +parts.month, +parts.day, h, m, timeZone);
      const intendedWall = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(intended);
      assert.ok(intendedWall !== cadence.time && wall > cadence.time, `${JSON.stringify(cadence)} ${timeZone}: ran at ${wall} on ${run.toISOString()}`);
      gapRuns++;
    }
  }
  // 400 random cases over ~2 years rarely land exactly on a DST gap day;
  // gaps are covered explicitly in the zonedTimeToInstant test above.
  assert.ok(gapRuns <= 2, `unexpectedly many off-time runs: ${gapRuns}`);
});

test("sameCadence ignores weekday order; describeCadence reads naturally", () => {
  assert.equal(
    sameCadence(
      { unit: "weeks", every: 1, time: "09:00", daysOfWeek: [4, 1] },
      { unit: "weeks", every: 1, time: "09:00", daysOfWeek: [1, 4] }
    ),
    true
  );
  assert.equal(sameCadence({ unit: "hours", every: 1 }, { unit: "hours", every: 2 }), false);

  assert.equal(describeCadence({ unit: "hours", every: 1 }, "UTC"), "Every hour");
  assert.equal(describeCadence({ unit: "hours", every: 6 }, "UTC"), "Every 6 hours");
  assert.equal(describeCadence({ unit: "days", every: 1, time: "06:00" }, "Europe/Rome"), "Daily at 06:00 (Europe/Rome)");
  assert.equal(
    describeCadence({ unit: "weeks", every: 2, time: "09:00", daysOfWeek: [0, 1, 4] }, "UTC"),
    "Every 2 weeks on Mon, Thu, Sun at 09:00 (UTC)"
  );
  assert.equal(
    describeCadence({ unit: "months", every: 1, time: "08:00", dayOfMonth: 31 }, "UTC"),
    "Monthly on day 31 at 08:00 (UTC)"
  );
});

test("a future start date: first run on/after it, never before it", () => {
  const start = d("2026-03-10T14:00:00Z");
  const every6h: ScheduleCadence = { unit: "hours", every: 6 };
  assert.equal(firstRunFrom(every6h, "UTC", start).toISOString(), "2026-03-10T14:00:00.000Z"); // hours: exactly at start

  const daily9: ScheduleCadence = { unit: "days", every: 1, time: "09:00" };
  // 09:00 on the start day has already passed at 14:00 -> next day.
  assert.equal(firstRunFrom(daily9, "UTC", start).toISOString(), "2026-03-11T09:00:00.000Z");
  assert.equal(firstRunFrom(daily9, "UTC", d("2026-03-10T08:00:00Z")).toISOString(), "2026-03-10T09:00:00.000Z");

  const fridays: ScheduleCadence = { unit: "weeks", every: 1, time: "09:00", daysOfWeek: [5] };
  assert.equal(firstRunFrom(fridays, "UTC", start).toISOString(), "2026-03-13T09:00:00.000Z"); // Tue -> Fri

  const monthly1st: ScheduleCadence = { unit: "months", every: 1, time: "06:00", dayOfMonth: 1 };
  assert.equal(firstRunFrom(monthly1st, "UTC", start).toISOString(), "2026-04-01T06:00:00.000Z");

  // Asking for "next run after now" while the start is still in the future
  // (e.g. resuming a paused schedule) still respects the start.
  const now = d("2026-02-01T00:00:00Z");
  for (const c of [every6h, daily9, fridays, monthly1st]) {
    assert.equal(
      nextRunAfter({ cadence: c, timeZone: "UTC", anchor: start }, now).toISOString(),
      firstRunFrom(c, "UTC", start).toISOString(),
      JSON.stringify(c)
    );
  }
});

test("a start date is interpreted in the schedule's timezone by the caller", () => {
  // 2026-03-10 00:00 in Tokyo is 2026-03-09T15:00Z; daily 09:00 Tokyo -> 00:00Z on the 10th.
  const start = zonedTimeToInstant(2026, 3, 10, 0, 0, "Asia/Tokyo");
  const c: ScheduleCadence = { unit: "days", every: 1, time: "09:00" };
  assert.equal(firstRunFrom(c, "Asia/Tokyo", start).toISOString(), "2026-03-10T00:00:00.000Z");
});
