"use client";

import {
  AUTHORIZATION_PRESET_DAYS,
  DEFAULT_AUTHORIZATION_DAYS,
  validateAuthorizationExpiry,
} from "@/lib/schedules/authorization";

// The attestation part of the create / renew forms: who is authorizing the
// scans and until when.

export interface AuthorizationDraft {
  authorizedByName: string;
  authorizedByEmail: string;
  // A preset number of days, or "custom" to use `customDate`.
  validity: string;
  customDate: string; // YYYY-MM-DD, local
}

export function defaultAuthorizationDraft(prefill?: { authorizedByName?: string; authorizedByEmail?: string }): AuthorizationDraft {
  return {
    authorizedByName: prefill?.authorizedByName ?? "",
    authorizedByEmail: prefill?.authorizedByEmail ?? "",
    validity: String(DEFAULT_AUTHORIZATION_DAYS),
    customDate: "",
  };
}

/** The expiry instant the draft describes; a custom date means the end of that day, local time. */
export function expiryFromDraft(d: AuthorizationDraft, now: Date): Date | null {
  if (d.validity !== "custom") return new Date(now.getTime() + Number(d.validity) * 24 * 60 * 60 * 1000);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.customDate);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59);
}

export function authorizationDraftError(d: AuthorizationDraft, now: Date): string | null {
  const expiry = expiryFromDraft(d, now);
  if (!expiry) return "Pick the date the authorization is valid until.";
  return validateAuthorizationExpiry(expiry, now);
}

/** Request body for POST /schedules and PUT /schedules/:id/authorization. */
export function authorizationPayload(d: AuthorizationDraft, now: Date) {
  return {
    authorizedByName: d.authorizedByName,
    authorizedByEmail: d.authorizedByEmail,
    authorizationExpiresAt: expiryFromDraft(d, now)?.toISOString(),
  };
}

function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presetLabel(days: number): string {
  return days === 365 ? "1 year" : `${days} days`;
}

export function AuthorizationFields({
  value,
  onChange,
  idPrefix,
}: {
  value: AuthorizationDraft;
  onChange: (next: AuthorizationDraft) => void;
  idPrefix: string;
}) {
  const set = (patch: Partial<AuthorizationDraft>) => onChange({ ...value, ...patch });
  const now = new Date();
  const expiry = expiryFromDraft(value, now);
  const problem = authorizationDraftError(value, now);
  const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-name`}>
          Authorized by (name)
        </label>
        <input
          id={`${idPrefix}-name`}
          value={value.authorizedByName}
          onChange={(e) => set({ authorizedByName: e.target.value })}
          required
          className="input"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-email`}>
          Authorized by (email)
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          value={value.authorizedByEmail}
          onChange={(e) => set({ authorizedByEmail: e.target.value })}
          required
          className="input"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-validity`}>
          Authorization valid for
        </label>
        <div className="inline-fields">
          <select
            id={`${idPrefix}-validity`}
            value={value.validity}
            onChange={(e) => set({ validity: e.target.value })}
            className="input"
          >
            {AUTHORIZATION_PRESET_DAYS.map((days) => (
              <option key={days} value={String(days)}>
                {presetLabel(days)}
              </option>
            ))}
            <option value="custom">Until a specific date…</option>
          </select>
          {value.validity === "custom" && (
            <input
              type="date"
              aria-label="Valid until"
              value={value.customDate}
              min={localDateString(now)}
              max={localDateString(maxDate)}
              onChange={(e) => set({ customDate: e.target.value })}
              required
              className="input"
            />
          )}
        </div>
        {problem ? (
          <span className="field-hint field-hint-error">{problem}</span>
        ) : (
          <span className="field-hint">
            Valid until {expiry!.toLocaleString()}. After that, scheduled scans stop until the authorization is renewed.
          </span>
        )}
      </div>
    </>
  );
}
