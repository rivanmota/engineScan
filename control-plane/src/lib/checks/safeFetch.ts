import { isSafeScanTarget } from "@/lib/scanScope";

// A shared `fetch` wrapper for check modules. Plain `fetch` with
// `redirect: "follow"` would let a target redirect the scanner to an
// internal address after the initial SSRF check passed; this instead
// follows redirects manually, re-validating every hop with
// isSafeScanTarget before requesting it.

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_REDIRECTS = 5;

export async function safeFetch(targetUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = DEFAULT_MAX_REDIRECTS, headers } = options;

  let currentUrl = targetUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await isSafeScanTarget(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, { redirect: "manual", signal: controller.signal, headers });
    } finally {
      clearTimeout(timer);
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return res;
  }

  throw new Error(`Too many redirects (> ${maxRedirects}) while fetching ${targetUrl}`);
}
