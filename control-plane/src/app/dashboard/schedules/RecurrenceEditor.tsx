"use client";

import { useMemo } from "react";
import {
  anchorDateFor,
  describeRecurrence,
  firstRunAfterCreate,
  MAX_EVERY,
  MAX_TIMES_PER_DAY,
  Recurrence,
  RecurrenceUnit,
  recurrencesEqual,
  upcomingRuns,
  validateRecurrence,
  WEEKDAY_NAMES,
} from "@/lib/schedules/recurrence";

// Form state for a recurrence. Keeps every unit's fields (not just the
// current unit's) so switching e.g. weeks -> months -> weeks doesn't lose the
// picked weekdays. `every` is a string so the number input can be cleared
// while typing.
export interface RecurrenceDraft {
  unit: RecurrenceUnit;
  every: string;
  times: string[];
  daysOfWeek: number[];
  daysOfMonth: number[];
  timezone: string;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultRecurrenceDraft(): RecurrenceDraft {
  return { unit: "days", every: "1", times: ["09:00"], daysOfWeek: [1], daysOfMonth: [1], timezone: browserTimeZone() };
}

export function draftFromRecurrence(r: Recurrence): RecurrenceDraft {
  const base = defaultRecurrenceDraft();
  if (r.unit === "hours") return { ...base, unit: "hours", every: String(r.every) };
  return {
    ...base,
    unit: r.unit,
    every: String(r.every),
    times: r.times,
    timezone: r.timezone,
    daysOfWeek: r.unit === "weeks" ? r.daysOfWeek : base.daysOfWeek,
    daysOfMonth: r.unit === "months" ? r.daysOfMonth : base.daysOfMonth,
  };
}

export function draftToRecurrence(d: RecurrenceDraft): Recurrence {
  const every = d.every.trim() === "" ? NaN : Number(d.every);
  const calendar = { every, times: d.times, timezone: d.timezone };
  switch (d.unit) {
    case "hours":
      return { unit: "hours", every };
    case "days":
      return { unit: "days", ...calendar };
    case "weeks":
      return { unit: "weeks", ...calendar, daysOfWeek: d.daysOfWeek };
    case "months":
      return { unit: "months", ...calendar, daysOfMonth: d.daysOfMonth };
  }
}

/** Problems with the draft, in the same words the API would use. */
export function recurrenceDraftErrors(d: RecurrenceDraft): string[] {
  return validateRecurrence(draftToRecurrence(d));
}

type Preset = { label: string; recurrence: (tz: string) => Recurrence };

const PRESETS: Preset[] = [
  { label: "Every hour", recurrence: () => ({ unit: "hours", every: 1 }) },
  { label: "Every 6 hours", recurrence: () => ({ unit: "hours", every: 6 }) },
  { label: "Daily", recurrence: (tz) => ({ unit: "days", every: 1, times: ["09:00"], timezone: tz }) },
  {
    label: "Weekdays",
    recurrence: (tz) => ({ unit: "weeks", every: 1, daysOfWeek: [1, 2, 3, 4, 5], times: ["09:00"], timezone: tz }),
  },
  { label: "Weekly", recurrence: (tz) => ({ unit: "weeks", every: 1, daysOfWeek: [1], times: ["09:00"], timezone: tz }) },
  {
    label: "Monthly",
    recurrence: (tz) => ({ unit: "months", every: 1, daysOfMonth: [1], times: ["09:00"], timezone: tz }),
  },
];

const UNIT_LABELS: Record<RecurrenceUnit, [string, string]> = {
  hours: ["hour", "hours"],
  days: ["day", "days"],
  weeks: ["week", "weeks"],
  months: ["month", "months"],
};

// Monday first.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    // Older browsers: fall back to the current zone and UTC.
  }
  return [...new Set(["UTC", current, ...zones])].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

function toggle(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

export function formatRunTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function RecurrenceEditor({
  value,
  onChange,
  disabled,
}: {
  value: RecurrenceDraft;
  onChange: (next: RecurrenceDraft) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<RecurrenceDraft>) => onChange({ ...value, ...patch });
  const isCalendar = value.unit !== "hours";
  const everyNumber = Number(value.every);
  const zones = useMemo(() => timeZoneOptions(value.timezone), [value.timezone]);

  const errors = recurrenceDraftErrors(value);
  const recurrence = draftToRecurrence(value);
  let preview: Date[] = [];
  if (errors.length === 0) {
    const now = new Date();
    const anchor = anchorDateFor(recurrence, now);
    preview = upcomingRuns(recurrence, anchor, firstRunAfterCreate(recurrence, anchor, now), 3);
  }

  return (
    <fieldset className="recurrence-editor" disabled={disabled}>
      <div className="preset-chips" role="group" aria-label="Presets">
        {PRESETS.map((p) => {
          const presetRecurrence = p.recurrence(value.timezone);
          const active = errors.length === 0 && recurrencesEqual(presetRecurrence, recurrence);
          return (
            <button
              key={p.label}
              type="button"
              className={`chip-toggle${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => onChange({ ...draftFromRecurrence(presetRecurrence), timezone: value.timezone })}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="recurrence-row">
        <label className="recurrence-label" htmlFor="recurrence-every">
          Repeat every
        </label>
        <input
          id="recurrence-every"
          type="number"
          min={1}
          max={MAX_EVERY[value.unit]}
          step={1}
          value={value.every}
          onChange={(e) => set({ every: e.target.value })}
          className="input input-every"
          aria-label="Repeat every"
        />
        <select
          value={value.unit}
          onChange={(e) => set({ unit: e.target.value as RecurrenceUnit })}
          className="input input-unit"
          aria-label="Unit"
        >
          {(Object.keys(UNIT_LABELS) as RecurrenceUnit[]).map((u) => (
            <option key={u} value={u}>
              {everyNumber === 1 ? UNIT_LABELS[u][0] : UNIT_LABELS[u][1]}
            </option>
          ))}
        </select>
      </div>

      {value.unit === "weeks" && (
        <div className="recurrence-row">
          <span className="recurrence-label">On</span>
          <div className="weekday-toggles" role="group" aria-label="Days of the week">
            {WEEKDAY_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                title={WEEKDAY_NAMES[d]}
                aria-label={WEEKDAY_NAMES[d]}
                aria-pressed={value.daysOfWeek.includes(d)}
                className={`chip-toggle day-toggle${value.daysOfWeek.includes(d) ? " active" : ""}`}
                onClick={() => set({ daysOfWeek: toggle(value.daysOfWeek, d) })}
              >
                {WEEKDAY_NAMES[d].slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      )}

      {value.unit === "months" && (
        <div className="recurrence-row recurrence-row-top">
          <span className="recurrence-label">On day</span>
          <div>
            <div className="monthday-grid" role="group" aria-label="Days of the month">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={value.daysOfMonth.includes(d)}
                  className={`chip-toggle monthday-toggle${value.daysOfMonth.includes(d) ? " active" : ""}`}
                  onClick={() => set({ daysOfMonth: toggle(value.daysOfMonth, d) })}
                >
                  {d}
                </button>
              ))}
            </div>
            {value.daysOfMonth.some((d) => d > 28) && (
              <span className="field-hint">In shorter months, days past the end run on the month&apos;s last day.</span>
            )}
          </div>
        </div>
      )}

      {isCalendar && (
        <div className="recurrence-row recurrence-row-top">
          <span className="recurrence-label">At</span>
          <div className="time-list">
            {value.times.map((t, i) => (
              <span key={i} className="time-item">
                <input
                  type="time"
                  value={t}
                  aria-label={`Time ${i + 1}`}
                  onChange={(e) => set({ times: value.times.map((x, j) => (j === i ? e.target.value : x)) })}
                  className="input input-time"
                />
                {value.times.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${t}`}
                    onClick={() => set({ times: value.times.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {value.times.length < MAX_TIMES_PER_DAY && (
              <button
                type="button"
                className="btn-link"
                onClick={() => set({ times: [...value.times, addHour(value.times[value.times.length - 1] ?? "08:00")] })}
              >
                + Add time
              </button>
            )}
          </div>
        </div>
      )}

      {isCalendar && (
        <div className="recurrence-row">
          <label className="recurrence-label" htmlFor="recurrence-tz">
            Time zone
          </label>
          <select
            id="recurrence-tz"
            value={value.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
            className="input input-tz"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={`recurrence-summary${errors.length ? " has-errors" : ""}`} aria-live="polite">
        {errors.length > 0 ? (
          <ul className="recurrence-errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <>
            <p className="recurrence-description">{describeRecurrence(recurrence)}</p>
            <p className="text-sm muted" style={{ margin: 0 }}>
              {value.unit === "hours" && "Counted from the previous run. "}
              Next runs: {preview.map((d) => formatRunTime(d, isCalendar ? value.timezone : undefined)).join(" · ")}
            </p>
          </>
        )}
      </div>
    </fieldset>
  );
}
