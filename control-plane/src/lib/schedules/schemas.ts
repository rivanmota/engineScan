import { z } from "zod";
import { normalizeRecurrence, Recurrence, validateRecurrence } from "./recurrence";

// Request-body schemas shared by the /schedules routes.

const every = z.number().int();
const times = z.array(z.string());
const timezone = z.string();

export const recurrenceSchema = z
  .discriminatedUnion("unit", [
    z.object({ unit: z.literal("hours"), every }).strict(),
    z.object({ unit: z.literal("days"), every, times, timezone }).strict(),
    z.object({ unit: z.literal("weeks"), every, daysOfWeek: z.array(z.number().int()), times, timezone }).strict(),
    z.object({ unit: z.literal("months"), every, daysOfMonth: z.array(z.number().int()), times, timezone }).strict(),
  ])
  .superRefine((r, ctx) => {
    for (const message of validateRecurrence(r as Recurrence)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  })
  .transform((r) => normalizeRecurrence(r as Recurrence));

// The attestation. `authorizationExpiresAt` is an ISO-8601 timestamp; when
// omitted it defaults to DEFAULT_AUTHORIZATION_DAYS from now. Its range is
// checked against the current time in the route (validateAuthorizationExpiry).
export const authorizationSchema = z.object({
  authorizedByName: z.string().trim().min(1),
  authorizedByEmail: z.string().email(),
  authorizationExpiresAt: z.string().datetime({ offset: true }).optional(),
});
