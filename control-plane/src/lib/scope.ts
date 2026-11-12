import { Campaign } from "@/types/firestore";
import { isKnownTechnique } from "./attackMatrix";

// This file is the single place that decides "is this job allowed to run".
// Every path that dispatches a job to an agent MUST go through
// assertJobInScope before creating it. See docs/SAFETY_AND_SCOPE.md.

export class ScopeViolation extends Error {}

function ipToLong(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) return ip === cidr; // bare host match
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
}

export function isTargetInScope(target: string, scopeTargets: string[]): boolean {
  return scopeTargets.some((entry) => {
    // allow exact hostname matches alongside CIDR/IP matches
    if (!/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(entry)) {
      return entry === target;
    }
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(target)) return false;
    return isIpInCidr(target, entry);
  });
}

export function isWithinTimeWindow(campaign: Pick<Campaign, "windowStart" | "windowEnd">, now: Date = new Date()): boolean {
  return now >= campaign.windowStart && now <= campaign.windowEnd;
}

/**
 * Throws ScopeViolation if this (technique, target) is not authorized for
 * this campaign right now. Call this before creating any Job row.
 */
export function assertJobInScope(
  campaign: Pick<Campaign, "scopeTargets" | "allowedTechniques" | "windowStart" | "windowEnd" | "status">,
  techniqueId: string,
  target: string
): void {
  if (campaign.status === "aborted") {
    throw new ScopeViolation("Campaign has been aborted; no further jobs may be dispatched.");
  }
  if (!isKnownTechnique(techniqueId)) {
    throw new ScopeViolation(`Unknown technique id: ${techniqueId}`);
  }
  const allowedTechniques = campaign.allowedTechniques;
  if (!allowedTechniques.includes(techniqueId)) {
    throw new ScopeViolation(`Technique ${techniqueId} is not in this campaign's allowed list.`);
  }
  const scopeTargets = campaign.scopeTargets;
  if (!isTargetInScope(target, scopeTargets)) {
    throw new ScopeViolation(`Target ${target} is not within this campaign's declared scope.`);
  }
  if (!isWithinTimeWindow(campaign)) {
    throw new ScopeViolation("Current time is outside this campaign's authorized window.");
  }
}
