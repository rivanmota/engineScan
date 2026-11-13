import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizerDomainError, targetRegistrableDomain } from "./authorizedDomain";

const ok = (url: string, email: string) => assert.equal(authorizerDomainError(url, email), null, `${email} -> ${url}`);
const refused = (url: string, email: string, pattern: RegExp) => {
  const message = authorizerDomainError(url, email);
  assert.ok(message, `${email} -> ${url} should be refused`);
  assert.match(message!, pattern, message!);
};

test("same registrable domain is allowed, including subdomains on either side", () => {
  ok("https://example.com", "jane@example.com");
  ok("https://www.example.com/path?q=1", "jane@example.com");
  ok("https://shop.eu.example.com:8443/", "jane@example.com");
  ok("https://www.example.com", "jane@corp.example.com");
  ok("https://EXAMPLE.com", "Jane@Example.COM"); // case-insensitive
  ok("https://example.com./", "jane@example.com."); // trailing root dot
  ok("https://shop.example.co.uk", "jane@example.co.uk"); // multi-part public suffix
  ok("https://münchen.de", "anna@münchen.de"); // IDN: unicode on both sides
  ok("https://xn--mnchen-3ya.de", "anna@münchen.de"); // IDN: punycode URL vs unicode email
  ok("https://alice.github.io/project", "alice@alice.github.io");
});

test("a different domain is refused with a message naming both and the fix", () => {
  refused("https://example.org", "jane@example.com", /email \(example\.com\) and the target URL \(example\.org\) must belong to the same domain.*email address at example\.org/);
  // Look-alikes that a naive "ends with" check would get wrong.
  refused("https://example.com.evil.net", "jane@example.com", /same domain/);
  refused("https://notexample.com", "jane@example.com", /same domain/);
  refused("https://example.com", "jane@example.com.evil.net", /same domain/);
  // Different sites on a shared host.
  refused("https://bob.github.io", "alice@alice.github.io", /same domain/);
  refused("https://victim.co.uk", "x@attacker.co.uk", /same domain/);
});

test("public-suffix email domains can't authorize anything", () => {
  refused("https://victim.co.uk", "x@co.uk", /co\.uk\) isn't an organization's domain.*victim\.co\.uk/);
  refused("https://bob.github.io", "x@github.io", /isn't an organization's domain/);
});

test("IP-address and non-registrable targets are refused", () => {
  refused("https://93.184.216.34/", "jane@example.com", /IP address \(93\.184\.216\.34\).*https:\/\/www\.example\.com\//);
  refused("http://[2001:db8::1]/", "jane@example.com", /IP address \(2001:db8::1\)/);
  refused("http://intranet/", "jane@example.com", /isn't a registrable domain/);
});

test("incomplete input is left to the format validators", () => {
  assert.equal(authorizerDomainError("not a url", "jane@example.com"), null);
  assert.equal(authorizerDomainError("https://example.org", "jane"), null);
  assert.equal(authorizerDomainError("https://example.org", "jane@"), null);
});

test("targetRegistrableDomain", () => {
  assert.equal(targetRegistrableDomain("https://www.shop.example.co.uk/x"), "example.co.uk");
  assert.equal(targetRegistrableDomain("https://93.184.216.34/"), null);
  assert.equal(targetRegistrableDomain("nope"), null);
});
