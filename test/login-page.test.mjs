import assert from "node:assert/strict";
import test from "node:test";
import {
  isCasLoginUrl,
  submitConfiguredCredentials,
} from "../dist/auth/login-page.js";

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

test("submits configured credentials only on the configured CAS page", async () => {
  const calls = [];
  const page = {
    url: () => "https://sso.example.com/cas/login?service=x",
    fill: async (selector, value) => calls.push(["fill", selector, value]),
    click: async (selector) => calls.push(["click", selector]),
  };

  const submitted = await submitConfiguredCredentials(page, {
    casUrl: "https://sso.example.com/cas/login",
    username: "alice",
    password: "secret",
  });

  assert.equal(submitted, true);
  assert.deepEqual(calls, [
    ["fill", "#username", "alice"],
    ["fill", "#password", "secret"],
    ["click", 'button[name="submitBtn"]'],
  ]);
});

test("does not touch a non-CAS page", async () => {
  const page = {
    url: () => "https://zentao.example.com/my/",
    fill: async () => assert.fail("fill must not run"),
    click: async () => assert.fail("click must not run"),
  };

  assert.equal(await submitConfiguredCredentials(page, {
    casUrl: "https://sso.example.com/cas/login",
    username: "alice",
    password: "secret",
  }), false);
});
