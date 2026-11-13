import { CheckContext, FindingInput, CHECK_FAILED_EVIDENCE_PREFIX } from "./types";
import { safeFetch } from "./safeFetch";

const CHECK_ID = "cookie-flags";

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export async function checkCookieFlags(ctx: CheckContext): Promise<FindingInput[]> {
  try {
    const res = await safeFetch(ctx.targetUrl);
    const setCookieHeaders = getSetCookieHeaders(res.headers);

    if (setCookieHeaders.length === 0) {
      return [
        {
          checkId: CHECK_ID,
          severity: "info",
          title: "No cookies set",
          evidence: "The response did not set any cookies.",
        },
      ];
    }

    const findings: FindingInput[] = [];
    for (const cookieHeader of setCookieHeaders) {
      const name = cookieHeader.split("=")[0]?.trim() || "(unnamed)";
      const lower = cookieHeader.toLowerCase();
      const missing: string[] = [];
      if (!lower.includes("secure")) missing.push("Secure");
      if (!lower.includes("httponly")) missing.push("HttpOnly");
      if (!lower.includes("samesite")) missing.push("SameSite");

      if (missing.length > 0) {
        findings.push({
          checkId: CHECK_ID,
          severity: missing.includes("Secure") || missing.includes("HttpOnly") ? "medium" : "low",
          title: `Cookie "${name}" is missing security flags`,
          evidence: `Missing: ${missing.join(", ")}.`,
        });
      }
    }

    if (findings.length === 0) {
      findings.push({
        checkId: CHECK_ID,
        severity: "info",
        title: "Cookies have recommended security flags",
        evidence: `Checked ${setCookieHeaders.length} cookie(s); all had Secure, HttpOnly, and SameSite set.`,
      });
    }

    return findings;
  } catch (e) {
    return [
      {
        checkId: CHECK_ID,
        severity: "info",
        title: "Cookie flags check failed",
        evidence: `${CHECK_FAILED_EVIDENCE_PREFIX} ${String(e)}`,
      },
    ];
  }
}
