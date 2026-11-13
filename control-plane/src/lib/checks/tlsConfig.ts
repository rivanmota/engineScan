import tls from "tls";
import { CheckContext, FindingInput, CHECK_FAILED_EVIDENCE_PREFIX } from "./types";
import { isSafeScanTarget } from "@/lib/scanScope";

const CHECK_ID = "tls-config";
const SOCKET_TIMEOUT_MS = 4000;
const EXPIRY_WARNING_DAYS = 30;

function fetchCertificate(hostname: string, port: number): Promise<tls.PeerCertificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: SOCKET_TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || Object.keys(cert).length === 0) {
        reject(new Error("Target did not present a TLS certificate"));
      } else {
        resolve(cert);
      }
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timed out"));
    });
    socket.on("error", (err) => reject(err));
  });
}

async function checkHttpRedirectsToHttps(targetUrl: string): Promise<FindingInput> {
  await isSafeScanTarget(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCKET_TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, { redirect: "manual", signal: controller.signal });
    const location = res.headers.get("location");
    const redirectsToHttps =
      res.status >= 300 && res.status < 400 && !!location && new URL(location, targetUrl).protocol === "https:";

    if (redirectsToHttps) {
      return {
        checkId: CHECK_ID,
        severity: "info",
        title: "HTTP redirects to HTTPS",
        evidence: `An HTTP request to ${targetUrl} redirected to ${location}.`,
      };
    }
    return {
      checkId: CHECK_ID,
      severity: "high",
      title: "Site does not redirect HTTP to HTTPS",
      evidence: `An HTTP request to ${targetUrl} did not receive a redirect to an HTTPS URL (status ${res.status}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Checks certificate validity/expiry for https targets, and whether an
// http target at least redirects to https.
export async function checkTlsConfig(ctx: CheckContext): Promise<FindingInput[]> {
  const url = new URL(ctx.targetUrl);

  if (url.protocol === "http:") {
    try {
      return [await checkHttpRedirectsToHttps(ctx.targetUrl)];
    } catch (e) {
      return [
        {
          checkId: CHECK_ID,
          severity: "info",
          title: "TLS config check failed",
          evidence: `${CHECK_FAILED_EVIDENCE_PREFIX} ${String(e)}`,
        },
      ];
    }
  }

  try {
    const port = url.port ? parseInt(url.port, 10) : 443;
    const cert = await fetchCertificate(url.hostname, port);
    const now = new Date();
    const validTo = new Date(cert.valid_to);
    const validFrom = new Date(cert.valid_from);

    if (now > validTo) {
      return [
        {
          checkId: CHECK_ID,
          severity: "high",
          title: "TLS certificate has expired",
          evidence: `Certificate expired on ${validTo.toISOString()}.`,
        },
      ];
    }

    if (now < validFrom) {
      return [
        {
          checkId: CHECK_ID,
          severity: "high",
          title: "TLS certificate is not yet valid",
          evidence: `Certificate is not valid until ${validFrom.toISOString()}.`,
        },
      ];
    }

    const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
      return [
        {
          checkId: CHECK_ID,
          severity: "medium",
          title: "TLS certificate expires soon",
          evidence: `Certificate expires on ${validTo.toISOString()} (${daysUntilExpiry} day(s) from now).`,
        },
      ];
    }

    return [
      {
        checkId: CHECK_ID,
        severity: "info",
        title: "TLS certificate is valid",
        evidence: `Certificate is valid until ${validTo.toISOString()}.`,
      },
    ];
  } catch (e) {
    return [
      {
        checkId: CHECK_ID,
        severity: "info",
        title: "TLS config check failed",
        evidence: `${CHECK_FAILED_EVIDENCE_PREFIX} ${String(e)}`,
      },
    ];
  }
}
