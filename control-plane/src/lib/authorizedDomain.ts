import { parse } from "tldts";

// Policy: whoever attests they're authorized to scan a target must have an
// email address at the target's domain. "Same domain" means the same
// registrable domain (the organization's domain, e.g. example.com or
// example.co.uk), per the Public Suffix List, so:
//
//   jane@example.com       -> https://example.com, https://www.example.com,
//                             https://shop.example.com              allowed
//   jane@corp.example.com  -> https://www.example.com               allowed
//   jane@example.com       -> https://example.org                   refused
//   x@co.uk                -> https://victim.co.uk                  refused (co.uk is a public suffix)
//   alice@alice.github.io  -> https://bob.github.io                 refused (different sites on a shared host)
//
// IP-address targets are refused: an IP can't be tied to an email domain.
//
// This is a consistency check on the attestation, not proof of identity:
// the email isn't verified. It stops scans being authorized by someone
// outside the target's organization by mistake, or casually.
//
// Shared by the dashboard (inline form validation) and the API (the actual
// enforcement), so both give the same message. Pure: no Node-only APIs.

export const AUTHORIZER_DOMAIN_ERROR_CODE = "AUTHORIZER_DOMAIN_MISMATCH";

const PSL_OPTIONS = { allowPrivateDomains: true } as const;

function hostOf(targetUrl: string): string | null {
  try {
    // URL lowercases and punycode-encodes the hostname. Drop IPv6 brackets
    // and a trailing root dot.
    return new URL(targetUrl).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const raw = email.slice(at + 1).trim().replace(/\.$/, "");
  if (!raw) return null;
  try {
    // Same normalization as URL hostnames (lowercase, punycode for IDNs).
    return new URL(`http://${raw}`).hostname;
  } catch {
    return null;
  }
}

/** The registrable domain of a target URL (e.g. "example.com"), or null. */
export function targetRegistrableDomain(targetUrl: string): string | null {
  const host = hostOf(targetUrl);
  if (!host) return null;
  const parsed = parse(host, PSL_OPTIONS);
  return parsed.isIp ? null : parsed.domain;
}

/**
 * Returns a message explaining why `email` can't authorize a scan of
 * `targetUrl`, or null if it can. Also returns null when either value isn't
 * well-formed yet: URL/email format is validated separately.
 */
export function authorizerDomainError(targetUrl: string, email: string): string | null {
  const host = hostOf(targetUrl);
  const emailDomain = emailDomainOf(email);
  if (!host || !emailDomain) return null;

  const target = parse(host, PSL_OPTIONS);
  if (target.isIp) {
    return (
      `The target URL uses an IP address (${host}), which can't be matched to the authorizer's email domain. ` +
      `Use the site's domain name instead (e.g. https://www.${emailDomain}/).`
    );
  }
  if (!target.domain) {
    return `The target URL's host (${host}) isn't a registrable domain, so it can't be matched to the authorizer's email domain.`;
  }

  const authorizer = parse(emailDomain, PSL_OPTIONS);
  if (!authorizer.domain) {
    return (
      `The authorizer's email domain (${emailDomain}) isn't an organization's domain, so it can't authorize scans. ` +
      `Use an email address at ${target.domain}.`
    );
  }

  if (authorizer.domain !== target.domain) {
    return (
      `The authorizer's email (${emailDomain}) and the target URL (${host}) must belong to the same domain. ` +
      `To scan ${host}, the authorization must come from an email address at ${target.domain}.`
    );
  }
  return null;
}
