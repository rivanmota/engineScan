import dns from "dns/promises";
import net from "net";

// Validates that the target URL is well-formed and reachable before the
// scanner makes any outbound request. Private/local addresses are allowed
// so the scanner can be used on a desktop with no internet connection.

export class ScopeViolation extends Error {}

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
 * Throws ScopeViolation if this URL is not a valid scan target. Call this
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

  // For IP literals, no DNS lookup needed.
  if (net.isIP(hostname)) return;

  // Resolve the hostname to verify it exists and is reachable.
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) {
      throw new ScopeViolation("Target URL's hostname did not resolve to any address.");
    }
  } catch (e) {
    if (e instanceof ScopeViolation) throw e;
    const code = (e as NodeJS.ErrnoException)?.code;
    console.warn(`[scanScope] DNS lookup failed for ${hostname}: ${code ?? e}`);
    throw new ScopeViolation(dnsFailureMessage(hostname, code));
  }
}
