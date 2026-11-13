import dns from "dns/promises";
import net from "net";

// This file is the single place that decides "is this a safe scan target".
// Every path that initiates a scan MUST go through isSafeScanTarget before
// making any outbound request. See docs/SAFETY_AND_SCOPE.md.
//
// It guards against SSRF: a scan could otherwise be used to probe internal
// infrastructure (localhost, private IP ranges, link-local/metadata
// endpoints) that the operator never authorized access to. Hostnames are
// resolved to IPs before checking so DNS-rebinding-style targets (a
// hostname that resolves to a private address) are also rejected.

export class ScopeViolation extends Error {}

// Private/loopback/link-local/metadata IPv4 ranges that a scan must never
// be allowed to touch.
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ["127.0.0.0", 8], // loopback
  ["10.0.0.0", 8], // private
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["169.254.0.0", 16], // link-local (includes cloud metadata 169.254.169.254)
  ["0.0.0.0", 8], // "this network"
  ["100.64.0.0", 10], // carrier-grade NAT
];

function ipv4ToLong(ip: string): number {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  );
}

function isIpv4InCidr(ip: string, range: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_IPV4_CIDRS.some(([range, bits]) => isIpv4InCidr(ip, range, bits));
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address, check the embedded IPv4 part
    const mapped = lower.replace("::ffff:", "");
    if (net.isIPv4(mapped)) return isBlockedIpv4(mapped);
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unrecognized shape, fail closed
}

// dns.lookup (getaddrinfo) reports "the name doesn't exist" and "it exists
// but has no A/AAAA records" both as ENOTFOUND. Anything else means the
// lookup itself failed on this server (resolver unreachable, timeout,
// SERVFAIL), which says nothing about the target.
function dnsFailureMessage(hostname: string, code: string | undefined): string {
  if (code === "ENOTFOUND" || code === "ENODATA") {
    const wwwHint = hostname.startsWith("www.") ? "" : ` (some sites only answer on "www.${hostname}")`;
    return (
      `The target's hostname "${hostname}" has no DNS address records, so there's nothing to scan. ` +
      `Check the URL for typos and that the site is live${wwwHint}. ` +
      `If it does open in a browser, the scanning server's DNS may not be able to see it.`
    );
  }
  return (
    `The DNS lookup for "${hostname}" failed on the scanning server (${code ?? "unknown error"}), ` +
    `so the target couldn't be checked. This is usually a temporary DNS problem on the server, not with the target. Try again shortly.`
  );
}

/**
 * Throws ScopeViolation if this URL is not a safe scan target. Call this
 * before making any outbound HTTP request to a user-submitted URL.
 */
export async function isSafeScanTarget(targetUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new ScopeViolation("Target URL is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScopeViolation("Target URL must use http or https.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ScopeViolation("Target URL may not point at localhost.");
  }

  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true });
      addresses = records.map((r) => r.address);
    } catch (e) {
      // Still fail closed (an unresolvable target can't be checked), but say
      // why, and keep the underlying error for whoever operates the server.
      const code = (e as NodeJS.ErrnoException)?.code;
      console.warn(`[scanScope] DNS lookup failed for ${hostname}: ${code ?? e}`);
      throw new ScopeViolation(dnsFailureMessage(hostname, code));
    }
  }

  if (addresses.length === 0) {
    throw new ScopeViolation("Target URL's hostname did not resolve to any address.");
  }

  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new ScopeViolation("Target URL resolves to a private/internal address and cannot be scanned.");
    }
  }
}
