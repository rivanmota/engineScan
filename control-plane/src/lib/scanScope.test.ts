import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import dns from "dns/promises";
import { isSafeScanTarget, ScopeViolation } from "./scanScope";

// dns.lookup is stubbed so these tests don't depend on the machine's DNS.
function stubLookup(impl: (host: string) => Promise<Array<{ address: string; family: number }>>) {
  mock.method(dns, "lookup", (host: string) => impl(host));
}
const dnsError = (code: string) => Object.assign(new Error(`getaddrinfo ${code}`), { code });
afterEach(() => mock.restoreAll());

async function rejection(url: string): Promise<string> {
  const err = await isSafeScanTarget(url).then(() => null, (e) => e);
  assert.ok(err instanceof ScopeViolation, `expected ScopeViolation for ${url}, got ${err}`);
  return (err as Error).message;
}

test("a public address passes", async () => {
  stubLookup(async () => [{ address: "93.184.216.34", family: 4 }]);
  await isSafeScanTarget("https://test.com/");
});

test("a private/local address passes (desktop/offline mode)", async () => {
  stubLookup(async () => [{ address: "192.168.1.1", family: 4 }]);
  await isSafeScanTarget("http://192.168.1.1/");

  stubLookup(async () => [{ address: "10.0.0.1", family: 4 }]);
  await isSafeScanTarget("http://myapp.local/");

  await isSafeScanTarget("http://localhost:3000/");
  await isSafeScanTarget("http://127.0.0.1:8080/");
});

test("a name with no address records says so, with the hostname and a www hint", async () => {
  stubLookup(async () => Promise.reject(dnsError("ENOTFOUND")));
  const message = await rejection("https://test.com/");
  assert.match(message, /"test\.com" has no DNS address records/);
  assert.match(message, /"www\.test\.com"/);
  // No www hint when the URL already uses www.
  assert.doesNotMatch(await rejection("https://www.test.com/"), /only answer on/);
});

test("a DNS failure on the server is reported as such, not as a bad target", async () => {
  for (const code of ["EAI_AGAIN", "EAI_FAIL", "ETIMEOUT"]) {
    stubLookup(async () => Promise.reject(dnsError(code)));
    const message = await rejection("https://test.com/");
    assert.match(message, new RegExp(`failed on the scanning server \\(${code}\\)`));
    assert.match(message, /not with the target/);
    mock.restoreAll();
  }
});

test("non-http/https protocols are rejected", async () => {
  assert.match(await rejection("ftp://example.com/"), /must use http or https/);
});

test("invalid URLs are rejected", async () => {
  assert.match(await rejection("not-a-url"), /not a valid URL/);
});
