import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorDateFor,
  describeRecurrence,
  firstRunAfterCreate,
  nextRunAfterClaim,
  nextRunAfterReschedule,
  normalizeRecurrence,
  Recurrence,
  upcomingRuns,
  validateRecurrence,
  zonedTimeToInstant,
} from "./recurrence";

const iso = (d: Date) => d.toISOString();
const isos = (ds: Date[]) => ds.map(iso);
const HOUR = 60 * 60 * 1000;

test("validation accepts good recurrences and explains bad ones", () => {
  assert.deepEqual(validateRecurrence({ unit: "hours", every: 6 }), []);
  assert.deepEqual(
    validateRecurrence({ unit: "weeks", every: 2, daysOfWeek: [1, 4], times: ["09:00", "17:30"], timezone: "Europe/Rome" }),
    []
  );
  const errs = (r: Recurrence) => validateRecurrence(r).join(" | ");
  assert.match(errs({ unit: "hours", every: 0 }), /between 1 and 168/);
  assert.match(errs({ unit: "hours", every: 1.5 }), /whole number/);
  assert.match(errs({ unit: "months", every: 13, daysOfMonth: [1], times: ["09:00"], timezone: "UTC" }), /between 1 and 12/);
  assert.match(errs({ unit: "days", every: 1, times: [], timezone: "UTC" }), /at least one time/);
  assert.match(errs({ unit: "days", every: 1, times: ["9:00"], timezone: "UTC" }), /not a valid time/);
  assert.match(errs({ unit: "days", every: 1, times: ["24:00"], timezone: "UTC" }), /not a valid time/);
  assert.match(errs({ unit: "days", every: 1, times: ["09:00"], timezone: "Mars/Olympus" }), /Unknown time zone/);
  assert.match(errs({ unit: "days", every: 1, times: ["09:00", "09:30"], timezone: "UTC" }), /60 minutes apart/);
  // Wrap-around across midnight counts too.
  assert.match(errs({ unit: "days", every: 1, times: ["23:30", "00:10"], timezone: "UTC" }), /60 minutes apart/);
  assert.match(errs({ unit: "weeks", every: 1, daysOfWeek: [], times: ["09:00"], timezone: "UTC" }), /day of the week/);
  assert.match(errs({ unit: "weeks", every: 1, daysOfWeek: [7], times: ["09:00"], timezone: "UTC" }), /0 \(Sunday\) to 6/);
  assert.match(errs({ unit: "months", every: 1, daysOfMonth: [32], times: ["09:00"], timezone: "UTC" }), /1 to 31/);
});

test("descriptions read naturally", () => {
  assert.equal(describeRecurrence({ unit: "hours", every: 1 }), "Every hour");
  assert.equal(describeRecurrence({ unit: "hours", every: 6 }), "Every 6 hours");
  assert.equal(describeRecurrence({ unit: "days", every: 1, times: ["09:00"], timezone: "UTC" }), "Every day at 09:00 (UTC)");
  assert.equal(
    describeRecurrence({ unit: "days", every: 3, times: ["18:00", "06:00"], timezone: "UTC" }),
    "Every 3 days at 06:00 and 18:00 (UTC)"
  );
  assert.equal(
    describeRecurrence({ unit: "weeks", every: 1, daysOfWeek: [1, 2, 3, 4, 5], times: ["09:00"], timezone: "Europe/Rome" }),
    "Every weekday at 09:00 (Europe/Rome)"
  );
  assert.equal(
    describeRecurrence({ unit: "weeks", every: 2, daysOfWeek: [0, 1, 4], times: ["09:00"], timezone: "UTC" }),
    "Every 2 weeks on Monday, Thursday and Sunday at 09:00 (UTC)"
  );
  assert.equal(
    describeRecurrence({ unit: "months", every: 1, daysOfMonth: [15, 1], times: ["06:00"], timezone: "UTC" }),
    "Monthly on the 1st and 15th at 06:00 (UTC)"
  );
  assert.equal(
    describeRecurrence({ unit: "months", every: 3, daysOfMonth: [31], times: ["06:00"], timezone: "UTC" }),
    "Every 3 months on the 31st (or the last day of shorter months) at 06:00 (UTC)"
  );
});

test("normalize sorts and de-duplicates", () => {
  assert.deepEqual(
    normalizeRecurrence({ unit: "weeks", every: 1, daysOfWeek: [5, 1, 5], times: ["17:00", "09:00", "09:00"], timezone: "UTC" }),
    { unit: "weeks", every: 1, daysOfWeek: [1, 5], times: ["09:00", "17:00"], timezone: "UTC" }
  );
});

test("wall-clock times map to the right instant, including across DST", () => {
  // New York: EST (UTC-5) in January, EDT (UTC-4) in July.
  assert.equal(iso(zonedTimeToInstant({ y: 2026, m: 1, d: 15 }, 9 * 60, "America/New_York")), "2026-01-15T14:00:00.000Z");
  assert.equal(iso(zonedTimeToInstant({ y: 2026, m: 7, d: 15 }, 9 * 60, "America/New_York")), "2026-07-15T13:00:00.000Z");
  // Spring forward 2026-03-08: 02:30 doesn't exist, runs at 03:30 EDT instead.
  assert.equal(iso(zonedTimeToInstant({ y: 2026, m: 3, d: 8 }, 150, "America/New_York")), "2026-03-08T07:30:00.000Z");
  // Fall back 2026-11-01: 01:30 happens twice; the first (EDT) is used.
  assert.equal(iso(zonedTimeToInstant({ y: 2026, m: 11, d: 1 }, 90, "America/New_York")), "2026-11-01T05:30:00.000Z");
  // Half-hour offset zone.
  assert.equal(iso(zonedTimeToInstant({ y: 2026, m: 1, d: 15 }, 9 * 60, "Asia/Kolkata")), "2026-01-15T03:30:00.000Z");
});

test("daily runs keep their local time across a DST change", () => {
  const r: Recurrence = { unit: "days", every: 1, times: ["09:00"], timezone: "Europe/Rome" };
  // Europe switches to summer time on 2026-03-29.
  const runs = upcomingRuns(r, "2026-03-27", new Date("2026-03-27T08:00:00Z"), 4);
  assert.deepEqual(isos(runs), [
    "2026-03-27T08:00:00.000Z", // 09:00 CET
    "2026-03-28T08:00:00.000Z",
    "2026-03-29T07:00:00.000Z", // 09:00 CEST
    "2026-03-30T07:00:00.000Z",
  ]);
});

test("first run after creation and multiple times per day", () => {
  const r: Recurrence = { unit: "days", every: 1, times: ["09:00", "17:00"], timezone: "UTC" };
  const now = new Date("2026-05-04T12:00:00Z");
  const anchor = anchorDateFor(r, now);
  assert.equal(anchor, "2026-05-04");
  const first = firstRunAfterCreate(r, anchor, now);
  assert.deepEqual(isos(upcomingRuns(r, anchor, first, 3)), [
    "2026-05-04T17:00:00.000Z",
    "2026-05-05T09:00:00.000Z",
    "2026-05-05T17:00:00.000Z",
  ]);
  assert.equal(iso(firstRunAfterCreate({ unit: "hours", every: 6 }, anchor, now)), "2026-05-04T18:00:00.000Z");
});

test("anchor date is today in the recurrence's time zone", () => {
  // 23:30 UTC on May 4 is already May 5 in Tokyo.
  const now = new Date("2026-05-04T23:30:00Z");
  assert.equal(anchorDateFor({ unit: "days", every: 1, times: ["09:00"], timezone: "Asia/Tokyo" }, now), "2026-05-05");
});

test("every N days counts from the anchor date", () => {
  const r: Recurrence = { unit: "days", every: 3, times: ["06:00"], timezone: "UTC" };
  const first = firstRunAfterCreate(r, "2026-05-04", new Date("2026-05-04T12:00:00Z"));
  assert.deepEqual(isos(upcomingRuns(r, "2026-05-04", first, 3)), [
    "2026-05-07T06:00:00.000Z",
    "2026-05-10T06:00:00.000Z",
    "2026-05-13T06:00:00.000Z",
  ]);
});

test("every 2 weeks on chosen weekdays runs in the anchor week, then every other week", () => {
  // 2026-05-06 is a Wednesday; anchor week is Mon 4 – Sun 10 May.
  const r: Recurrence = { unit: "weeks", every: 2, daysOfWeek: [1, 4], times: ["09:00"], timezone: "UTC" };
  const anchor = "2026-05-06";
  const first = firstRunAfterCreate(r, anchor, new Date("2026-05-06T10:00:00Z"));
  assert.deepEqual(isos(upcomingRuns(r, anchor, first, 4)), [
    "2026-05-07T09:00:00.000Z", // Thu, anchor week
    "2026-05-18T09:00:00.000Z", // Mon, two weeks later
    "2026-05-21T09:00:00.000Z", // Thu
    "2026-06-01T09:00:00.000Z", // Mon
  ]);
});

test("Sunday belongs to the week that started on the previous Monday", () => {
  const r: Recurrence = { unit: "weeks", every: 2, daysOfWeek: [0], times: ["09:00"], timezone: "UTC" };
  // Anchor Monday 2026-05-04: its Sunday is May 10, then May 24.
  const first = firstRunAfterCreate(r, "2026-05-04", new Date("2026-05-04T10:00:00Z"));
  assert.deepEqual(isos(upcomingRuns(r, "2026-05-04", first, 2)), ["2026-05-10T09:00:00.000Z", "2026-05-24T09:00:00.000Z"]);
});

test("monthly on the 31st falls back to the last day of shorter months", () => {
  const r: Recurrence = { unit: "months", every: 1, daysOfMonth: [31], times: ["06:00"], timezone: "UTC" };
  const first = firstRunAfterCreate(r, "2026-01-10", new Date("2026-01-10T00:00:00Z"));
  assert.deepEqual(isos(upcomingRuns(r, "2026-01-10", first, 4)), [
    "2026-01-31T06:00:00.000Z",
    "2026-02-28T06:00:00.000Z",
    "2026-03-31T06:00:00.000Z",
    "2026-04-30T06:00:00.000Z",
  ]);
});

test("monthly with several days doesn't double-run when they clamp to the same day", () => {
  const r: Recurrence = { unit: "months", every: 1, daysOfMonth: [30, 31], times: ["06:00"], timezone: "UTC" };
  const first = firstRunAfterCreate(r, "2026-02-01", new Date("2026-02-01T00:00:00Z"));
  assert.deepEqual(isos(upcomingRuns(r, "2026-02-01", first, 3)), [
    "2026-02-28T06:00:00.000Z",
    "2026-03-30T06:00:00.000Z",
    "2026-03-31T06:00:00.000Z",
  ]);
});

test("every 3 months counts from the anchor month", () => {
  const r: Recurrence = { unit: "months", every: 3, daysOfMonth: [1], times: ["06:00"], timezone: "UTC" };
  const first = firstRunAfterCreate(r, "2026-01-15", new Date("2026-01-15T00:00:00Z"));
  assert.deepEqual(isos(upcomingRuns(r, "2026-01-15", first, 3)), [
    "2026-04-01T06:00:00.000Z",
    "2026-07-01T06:00:00.000Z",
    "2026-10-01T06:00:00.000Z",
  ]);
});

test("the sparsest recurrence still finds its next run", () => {
  const r: Recurrence = { unit: "months", every: 12, daysOfMonth: [31], times: ["06:00"], timezone: "UTC" };
  // Anchor month Feb 2026 runs on the 28th; the next matching month is a year later.
  assert.equal(iso(firstRunAfterCreate(r, "2026-02-01", new Date("2026-02-01T00:00:00Z"))), "2026-02-28T06:00:00.000Z");
  assert.equal(iso(firstRunAfterCreate(r, "2026-02-01", new Date("2026-03-01T00:00:00Z"))), "2027-02-28T06:00:00.000Z");
});

test("claiming a late run skips missed slots (hourly keeps its cadence)", () => {
  const hourly: Recurrence = { unit: "hours", every: 24 };
  const due = new Date("2026-01-01T00:00:00Z");
  assert.equal(iso(nextRunAfterClaim(hourly, "2026-01-01", due, new Date(due.getTime() + 0.01 * HOUR))), "2026-01-02T00:00:00.000Z");
  assert.equal(iso(nextRunAfterClaim(hourly, "2026-01-01", due, new Date(due.getTime() + 84 * HOUR))), "2026-01-05T00:00:00.000Z");

  const daily: Recurrence = { unit: "days", every: 1, times: ["09:00"], timezone: "UTC" };
  // Due Jan 1 09:00, scheduler down until Jan 4 10:00: next is Jan 5 09:00.
  assert.equal(
    iso(nextRunAfterClaim(daily, "2026-01-01", new Date("2026-01-01T09:00:00Z"), new Date("2026-01-04T10:00:00Z"))),
    "2026-01-05T09:00:00.000Z"
  );
});

test("the next run after a claim is always in the future", () => {
  const recurrences: Recurrence[] = [
    { unit: "hours", every: 1 },
    { unit: "hours", every: 7 },
    { unit: "days", every: 2, times: ["00:00", "12:00"], timezone: "America/New_York" },
    { unit: "weeks", every: 3, daysOfWeek: [0, 3], times: ["02:30"], timezone: "America/New_York" },
    { unit: "months", every: 1, daysOfMonth: [29, 30, 31], times: ["23:59"], timezone: "Pacific/Auckland" },
  ];
  const due = new Date("2026-03-01T00:00:00Z");
  for (const r of recurrences) {
    for (const lateHours of [0, 0.5, 1, 5, 23.99, 24, 200, 1000]) {
      const now = new Date(due.getTime() + lateHours * HOUR);
      const next = nextRunAfterClaim(r, "2026-02-27", due, now);
      assert.ok(next > now, `${describeRecurrence(r)} late=${lateHours}`);
    }
  }
});

test("rescheduling: hourly waits N hours from the last run; calendar uses the next slot", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  assert.equal(iso(nextRunAfterReschedule({ unit: "hours", every: 24 }, "", new Date("2026-01-01T08:00:00Z"), now)), "2026-01-02T08:00:00.000Z");
  assert.equal(iso(nextRunAfterReschedule({ unit: "hours", every: 1 }, "", new Date("2026-01-01T08:00:00Z"), now)), iso(now));
  assert.equal(iso(nextRunAfterReschedule({ unit: "hours", every: 6 }, "", null, now)), iso(now));
  const daily: Recurrence = { unit: "days", every: 1, times: ["09:00"], timezone: "UTC" };
  assert.equal(iso(nextRunAfterReschedule(daily, "2026-01-01", null, now)), "2026-01-02T09:00:00.000Z");
});
