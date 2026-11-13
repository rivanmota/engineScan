import { CheckContext, FindingInput } from "./types";
import { safeFetch } from "./safeFetch";

const CHECK_ID = "security-headers";

// Audits a handful of high-signal, low-effort response headers. Missing
// any of these doesn't mean the site is broken, but it does mean a whole
// class of attacks (clickjacking, MIME-sniffing, protocol downgrade,
// script injection) has one less layer of defense.
export async function checkSecurityHeaders(ctx: CheckContext): Promise<FindingInput[]> {
  try {
    const res = await safeFetch(ctx.targetUrl);
    const headers = res.headers;
    const findings: FindingInput[] = [];

    if (!headers.get("content-security-policy")) {
      findings.push({
        checkId: CHECK_ID,
        severity: "medium",
        title: "Missing Content-Security-Policy header",
        evidence: "The response did not include a Content-Security-Policy header, which helps mitigate XSS and data-injection attacks.",
      });
    }

    if (!headers.get("strict-transport-security")) {
      findings.push({
        checkId: CHECK_ID,
        severity: "medium",
        title: "Missing Strict-Transport-Security header",
        evidence: "The response did not include an HSTS header, so browsers aren't told to always use HTTPS for this site.",
      });
    }

    if (!headers.get("x-frame-options")) {
      findings.push({
        checkId: CHECK_ID,
        severity: "low",
        title: "Missing X-Frame-Options header",
        evidence: "The response did not include an X-Frame-Options header, leaving the site potentially embeddable in a clickjacking iframe.",
      });
    }

    const contentTypeOptions = headers.get("x-content-type-options");
    if (!contentTypeOptions || contentTypeOptions.toLowerCase() !== "nosniff") {
      findings.push({
        checkId: CHECK_ID,
        severity: "low",
        title: "Missing X-Content-Type-Options header",
        evidence: "The response did not include 'X-Content-Type-Options: nosniff', allowing browsers to MIME-sniff responses.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        checkId: CHECK_ID,
        severity: "info",
        title: "Security headers look good",
        evidence: "Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, and X-Content-Type-Options were all present.",
      });
    }

    return findings;
  } catch (e) {
    return [
      {
        checkId: CHECK_ID,
        severity: "info",
        title: "Security headers check failed",
        evidence: `Could not complete this check: ${String(e)}`,
      },
    ];
  }
}
