import assert from "node:assert/strict";
import test from "node:test";
import { isCasLoginUrl } from "../dist/auth/login-page.js";

test("matches the configured CAS login URL while ignoring query and trailing slash", () => {
  const configured = "https://sso.example.com/cas/login";
  assert.equal(isCasLoginUrl("https://sso.example.com/cas/login?service=x", configured), true);
  assert.equal(isCasLoginUrl("https://sso.example.com/cas/login/", configured), true);
});

test("rejects a different CAS host or path", () => {
  const configured = "https://sso.example.com/cas/login";
  assert.equal(isCasLoginUrl("https://other.example.com/cas/login", configured), false);
  assert.equal(isCasLoginUrl("https://sso.example.com/cas/logout", configured), false);
});

test("returns false for malformed URLs", () => {
  assert.equal(isCasLoginUrl("not a url", "https://sso.example.com/cas/login"), false);
});
