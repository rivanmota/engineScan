import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, authorizationState, daysUntil, validateAuthorizationExpiry } from "./authorization";

const now = new Date("2026-06-01T12:00:00Z");

test("expiry must be in the future and at most a year out", () => {
  assert.equal(validateAuthorizationExpiry(addDays(now, 90), now), null);
  assert.equal(validateAuthorizationExpiry(addDays(now, 365), now), null);
  assert.equal(validateAuthorizationExpiry(addDays(now, 365.9), now), null); // end of the last allowed day
  assert.match(validateAuthorizationExpiry(addDays(now, 367), now)!, /at most 365 days/);
  assert.match(validateAuthorizationExpiry(now, now)!, /future/);
  assert.match(validateAuthorizationExpiry(addDays(now, -1), now)!, /future/);
  assert.match(validateAuthorizationExpiry(new Date("nope"), now)!, /valid date/);
});

test("authorization state and days left", () => {
  assert.equal(authorizationState(addDays(now, 30), now), "valid");
  assert.equal(authorizationState(addDays(now, 7), now), "expiring-soon");
  assert.equal(authorizationState(addDays(now, 0.5), now), "expiring-soon");
  assert.equal(authorizationState(now, now), "expired"); // expires at that exact moment
  assert.equal(authorizationState(addDays(now, -3), now), "expired");

  assert.equal(daysUntil(addDays(now, 0.2), now), 1);
  assert.equal(daysUntil(addDays(now, 30), now), 30);
  assert.equal(daysUntil(addDays(now, -2), now), 0);
});
