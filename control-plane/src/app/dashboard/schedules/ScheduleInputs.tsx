"use client";

import { useMemo } from "react";
import {
  CADENCE_LIMITS,
  CadenceUnit,
  ScheduleCadence,
  upcomingRuns,
  validateCadence,
  WEEKDAY_LABELS,
  zonedTimeToInstant,
} from "@/lib/schedules/cadence";
import {
  addDays,
  AUTHORIZATION_PRESET_DAYS,
  DEFAULT_AUTHORIZATION_DAYS,
  MAX_AUTHORIZATION_DAYS,
  validateAuthorizationExpiry,
} from "@/lib/schedules/authorization";

// Form inputs shared by the "new schedule" and schedule detail pages:
//   - CadenceEditor: the "Re-scan" field (presets + a custom
//     "repeat every N hours/days/weeks/months" builder, with a live preview)
//   - AuthorizationExpiryPicker: how long the authorization attestation lasts

// ---------- Cadence ----------

// Editor state. Keeps every unit's settings so switching unit back and forth
// doesn't lose what was picked, and keeps "every" as raw text so the number
// field can be cleared while typing.
export interface CadenceDraft {
  unit: CadenceUnit;
  every: string;
  time: string;
  daysOfWeek: number[];
  dayOfMonth: number;
  timeZone: string;
  // "next": first run at the cadence's next slot. "date": not before startLocal.
  startMode: "next" | "date";
  // yyyy-mm-ddThh:mm wall-clock time in `timeZone`.
  startLocal: string;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function tomorrowAt(time: string): string {
  const t = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${time}`;
}

export function defaultCadenceDraft(): CadenceDraft {
  return {
    unit: "days",
    every: "1",
    time: "06:00",
    daysOfWeek: [new Date().getDay()],
    dayOfMonth: 1,
    timeZone: browserTimeZone(),
    startMode: "next",
    startLocal: tomorrowAt("06:00"),
  };
}

export function cadenceToDraft(cadence: ScheduleCadence, timeZone: string): CadenceDraft {
  const base = defaultCadenceDraft();
  return {
    ...base,
    unit: cadence.unit,
    every: String(cadence.every),
    time: "time" in cadence ? cadence.time : base.time,
    daysOfWeek: cadence.unit === "weeks" ? cadence.daysOfWeek : base.daysOfWeek,
    dayOfMonth: cadence.unit === "months" ? cadence.dayOfMonth : base.dayOfMonth,
    timeZone,
  };
}

export function draftToCadence(d: CadenceDraft): ScheduleCadence {
  const every = Number(d.every);
  switch (d.unit) {
    case "hours":
      return { unit: "hours", every };
    case "days":
      return { unit: "days", every, time: d.time };
    case "weeks":
      return { unit: "weeks", every, time: d.time, daysOfWeek: [...d.daysOfWeek].sort((a, b) => a - b) };
    case "months":
      return { unit: "months", every, time: d.time, dayOfMonth: d.dayOfMonth };
  }
}

/** The chosen start instant, or null for "next scheduled time" (or an incomplete date). */
export function draftStartAt(d: CadenceDraft): Date | null {
  if (d.startMode !== "date") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(d.startLocal);
  if (!m) return null;
  const [, y, mo, day, h, mi] = m.map(Number);
  return zonedTimeToInstant(y, mo, day, h, mi, d.timeZone);
}

/** Problem with the draft as the user would read it, or null if it can be saved. */
export function cadenceDraftError(d: CadenceDraft): string | null {
  if (d.every.trim() === "") return "Enter how often to repeat.";
  const problem = validateCadence(draftToCadence(d));
  if (problem) return problem;
  if (d.startMode === "date") {
    const startAt = draftStartAt(d);
    if (!startAt) return "Pick the start date and time.";
    if (startAt.getTime() <= Date.now()) return "The start must be in the future.";
  }
  return null;
}

const UNIT_LABELS: Record<CadenceUnit, [string, string]> = {
  hours: ["hour", "hours"],
  days: ["day", "days"],
  weeks: ["week", "weeks"],
  months: ["month", "months"],
};

// Monday-first display order; values are JS weekday numbers (0 = Sunday).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WORKDAYS = [1, 2, 3, 4, 5];

interface Preset {
  label: string;
  apply: (d: CadenceDraft) => CadenceDraft;
  matches: (d: CadenceDraft) => boolean;
}

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

const PRESETS: Preset[] = [
  {
    label: "Every hour",
    apply: (d) => ({ ...d, unit: "hours", every: "1" }),
    matches: (d) => d.unit === "hours" && d.every === "1",
  },
  {
    label: "Every 6 hours",
    apply: (d) => ({ ...d, unit: "hours", every: "6" }),
    matches: (d) => d.unit === "hours" && d.every === "6",
  },
  {
    label: "Daily",
    apply: (d) => ({ ...d, unit: "days", every: "1" }),
    matches: (d) => d.unit === "days" && d.every === "1",
  },
  {
    label: "Weekdays",
    apply: (d) => ({ ...d, unit: "weeks", every: "1", daysOfWeek: WORKDAYS }),
    matches: (d) => d.unit === "weeks" && d.every === "1" && sameDays(d.daysOfWeek, WORKDAYS),
  },
  {
    label: "Weekly",
    apply: (d) => ({
      ...d,
      unit: "weeks",
      every: "1",
      daysOfWeek: d.unit === "weeks" && d.daysOfWeek.length === 1 ? d.daysOfWeek : [new Date().getDay()],
    }),
    matches: (d) => d.unit === "weeks" && d.every === "1" && d.daysOfWeek.length === 1,
  },
  {
    label: "Monthly",
    apply: (d) => ({ ...d, unit: "months", every: "1" }),
    matches: (d) => d.unit === "months" && d.every === "1",
  },
];

function timeZoneOptions(current: string): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = new Set(supported ? supported("timeZone") : []);
  zones.add("UTC");
  zones.add(current);
  zones.add(browserTimeZone());
  return [...zones].sort();
}

function formatRun(run: Date, timeZone: string | undefined): string {
  return run.toLocaleString(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function CadenceEditor({
  value,
  onChange,
  anchor,
  idPrefix = "cadence",
  disabled = false,
  label = "Re-scan",
  nextStartLabel = "At the next scheduled time",
}: {
  label?: string;
  // Label for the "don't set a start date" choice.
  nextStartLabel?: string;
  value: CadenceDraft;
  onChange: (draft: CadenceDraft) => void;
  // Reference point for "every N" counting, used for the preview. Should
  // match what the server will use (see PATCH /schedules/:id).
  anchor: Date;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const error = cadenceDraftError(value);
  const limits = CADENCE_LIMITS[value.unit];
  const plural = Number(value.every) === 1 ? 0 : 1;
  const zones = useMemo(() => timeZoneOptions(value.timeZone), [value.timeZone]);

  const preview = useMemo(() => {
    if (error) return [];
    try {
      const cadence = draftToCadence(value);
      const startAt = draftStartAt(value);
      if (startAt) {
        // First run on/after the start, then onwards from there.
        return upcomingRuns({ cadence, timeZone: value.timeZone, anchor: startAt }, new Date(startAt.getTime() - 1), 3);
      }
      return upcomingRuns({ cadence, timeZone: value.timeZone, anchor }, new Date(), 3);
    } catch {
      return [];
    }
  }, [value, anchor, error]);

  const timeZoneSelect = (
    <select
      aria-label="Timezone"
      value={value.timeZone}
      onChange={(e) => set({ timeZone: e.target.value })}
      className="input input-auto input-timezone"
    >
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );

  const set = (patch: Partial<CadenceDraft>) => onChange({ ...value, ...patch });
  const toggleDay = (day: number) =>
    set({
      daysOfWeek: value.daysOfWeek.includes(day)
        ? value.daysOfWeek.filter((d) => d !== day)
        : [...value.daysOfWeek, day],
    });

  return (
    <fieldset className="cadence-editor" disabled={disabled}>
      <legend className="field-label">{label}</legend>
      <div className="preset-chips" role="group" aria-label="Quick choices">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`preset-chip${p.matches(value) ? " active" : ""}`}
            aria-pressed={p.matches(value)}
            onClick={() => onChange(p.apply(value))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="cadence-row">
        <label htmlFor={`${idPrefix}-every`}>Repeat every</label>
        <input
          id={`${idPrefix}-every`}
          type="number"
          inputMode="numeric"
          min={limits.min}
          max={limits.max}
          value={value.every}
          onChange={(e) => set({ every: e.target.value })}
          className="input input-narrow"
        />
        <select
          aria-label="Repeat unit"
          value={value.unit}
          onChange={(e) => set({ unit: e.target.value as CadenceUnit })}
          className="input input-auto"
        >
          {(Object.keys(UNIT_LABELS) as CadenceUnit[]).map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABELS[unit][plural]}
            </option>
          ))}
        </select>
      </div>

      {value.unit === "weeks" && (
        <div className="cadence-row">
          <span className="cadence-row-label">On</span>
          <div className="weekday-toggles" role="group" aria-label="Days of the week">
            {WEEKDAY_ORDER.map((day) => (
              <button
                key={day}
                type="button"
                className={`weekday-toggle${value.daysOfWeek.includes(day) ? " active" : ""}`}
                aria-pressed={value.daysOfWeek.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {WEEKDAY_LABELS[day]}
              </button>
            ))}
          </div>
        </div>
      )}

      {value.unit === "months" && (
        <div className="cadence-row">
          <label htmlFor={`${idPrefix}-dom`}>On day</label>
          <select
            id={`${idPrefix}-dom`}
            value={value.dayOfMonth}
            onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
            className="input input-auto"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          {value.dayOfMonth > 28 && <span className="field-hint">Shorter months run on their last day.</span>}
        </div>
      )}

      {value.unit !== "hours" && (
        <div className="cadence-row">
          <label htmlFor={`${idPrefix}-time`}>At</label>
          <input
            id={`${idPrefix}-time`}
            type="time"
            value={value.time}
            onChange={(e) => set({ time: e.target.value })}
            className="input input-auto"
            required
          />
          {timeZoneSelect}
        </div>
      )}

      <div className="cadence-row">
        <label htmlFor={`${idPrefix}-start`}>Starts</label>
        <select
          id={`${idPrefix}-start`}
          value={value.startMode}
          onChange={(e) => set({ startMode: e.target.value as CadenceDraft["startMode"] })}
          className="input input-auto"
        >
          <option value="next">{nextStartLabel}</option>
          <option value="date">On a date…</option>
        </select>
        {value.startMode === "date" && (
          <>
            <input
              type="datetime-local"
              aria-label="Start date and time"
              value={value.startLocal}
              onChange={(e) => set({ startLocal: e.target.value })}
              className="input input-auto"
              required
            />
            {/* For hourly schedules the timezone isn't shown above, but the start still needs one. */}
            {value.unit === "hours" ? timeZoneSelect : <span className="field-hint">{value.timeZone.replace(/_/g, " ")} time</span>}
          </>
        )}
      </div>

      {error ? (
        <p className="field-error">{error}</p>
      ) : (
        <div className="cadence-preview">
          <span className="field-hint">{value.startMode === "date" ? "First runs:" : "Next runs:"}</span>
          <ul>
            {preview.map((run) => (
              <li key={run.getTime()}>{formatRun(run, value.unit === "hours" ? undefined : value.timeZone)}</li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}

// ---------- Authorization expiry ----------

export interface ExpiryDraft {
  // A preset number of days ("30", "90", ...) or "custom".
  choice: string;
  // yyyy-mm-dd, used when choice === "custom".
  customDate: string;
}

export function defaultExpiryDraft(): ExpiryDraft {
  return { choice: String(DEFAULT_AUTHORIZATION_DAYS), customDate: "" };
}

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The expiry instant the draft stands for, or null if it's incomplete. */
export function expiryDraftToDate(draft: ExpiryDraft, now: Date): Date | null {
  if (draft.choice !== "custom") return addDays(now, Number(draft.choice));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.customDate);
  if (!match) return null;
  // A custom date is valid through the end of that day, in the user's timezone.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
}

export function expiryDraftError(draft: ExpiryDraft, now: Date): string | null {
  const date = expiryDraftToDate(draft, now);
  if (!date) return "Pick the date the authorization expires.";
  return validateAuthorizationExpiry(date, now);
}

function presetLabel(days: number): string {
  return days === 365 ? "1 year" : `${days} days`;
}

export function AuthorizationExpiryPicker({
  value,
  onChange,
  idPrefix = "expiry",
}: {
  value: ExpiryDraft;
  onChange: (draft: ExpiryDraft) => void;
  idPrefix?: string;
}) {
  const now = new Date();
  const expiry = expiryDraftToDate(value, now);
  const error = expiryDraftError(value, now);

  return (
    <div className="field">
      <label className="field-label" htmlFor={`${idPrefix}-choice`}>
        Authorization valid for
      </label>
      <div className="cadence-row">
        <select
          id={`${idPrefix}-choice`}
          value={value.choice}
          onChange={(e) => onChange({ ...value, choice: e.target.value })}
          className="input input-auto"
        >
          {AUTHORIZATION_PRESET_DAYS.map((days) => (
            <option key={days} value={String(days)}>
              {presetLabel(days)}
            </option>
          ))}
          <option value="custom">Until a specific date…</option>
        </select>
        {value.choice === "custom" && (
          <input
            type="date"
            aria-label="Authorization expiry date"
            value={value.customDate}
            min={toDateInputValue(addDays(now, 1))}
            max={toDateInputValue(addDays(now, MAX_AUTHORIZATION_DAYS))}
            onChange={(e) => onChange({ ...value, customDate: e.target.value })}
            className="input input-auto"
            required
          />
        )}
      </div>
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        <span className="field-hint">
          Expires {expiry!.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Scheduled scans
          stop after that until the authorization is renewed.
        </span>
      )}
    </div>
  );
}
