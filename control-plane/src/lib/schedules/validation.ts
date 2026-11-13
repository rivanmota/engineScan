import { z } from "zod";
import { isValidTimeZone, ScheduleCadence, TIME_PATTERN, validateCadence } from "./cadence";
import { validateAuthorizationExpiry } from "./authorization";

// Request-body schemas for the /schedules API. The range/consistency rules
// themselves live in cadence.ts and authorization.ts (shared with the
// dashboard); these schemas just wire them into zod.

const time = z.string().regex(TIME_PATTERN, "Time must be in 24-hour HH:MM format");

export const cadenceSchema: z.ZodType<ScheduleCadence> = z
  .discriminatedUnion("unit", [
    z.object({ unit: z.literal("hours"), every: z.number().int() }).strict(),
    z.object({ unit: z.literal("days"), every: z.number().int(), time }).strict(),
    z
      .object({ unit: z.literal("weeks"), every: z.number().int(), time, daysOfWeek: z.array(z.number().int()) })
      .strict(),
    z.object({ unit: z.literal("months"), every: z.number().int(), time, dayOfMonth: z.number().int() }).strict(),
  ])
  .superRefine((cadence, ctx) => {
    const problem = validateCadence(cadence);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  })
  // Store weekdays in a canonical order so equal cadences compare equal.
  .transform((cadence) =>
    cadence.unit === "weeks" ? { ...cadence, daysOfWeek: [...cadence.daysOfWeek].sort((a, b) => a - b) } : cadence
  );

export const timeZoneSchema = z.string().refine(isValidTimeZone, { message: "Unknown timezone" });

// ISO-8601 timestamp, e.g. "2026-12-31T22:59:59.999Z".
export const authorizationExpirySchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .superRefine((date, ctx) => {
    const problem = validateAuthorizationExpiry(date, new Date());
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export const attestationSchema = {
  authorizedByName: z.string().min(1),
  authorizedByEmail: z.string().email(),
  authorizationExpiresAt: authorizationExpirySchema,
};

// When a schedule should start; nothing runs before it. ISO-8601 timestamp.
export const startAtSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .refine((date) => date.getTime() > Date.now(), { message: "Start must be in the future." });

/**
 * A schedule whose first run would come after its authorization expires
 * could never scan anything; refuse it rather than create a dead schedule.
 */
export function firstRunAfterExpiryError(firstRun: Date, authorizationExpiresAt: Date): string | null {
  if (firstRun.getTime() < authorizationExpiresAt.getTime()) return null;
  return (
    `The first run (${firstRun.toISOString()}) would be after the authorization expires ` +
    `(${authorizationExpiresAt.toISOString()}). Pick an earlier start or a later expiry.`
  );
}
