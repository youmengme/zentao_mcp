import assert from "node:assert/strict";
import test from "node:test";
import { performAutomaticLogin } from "../dist/auth/automatic-login.js";
import {
  AuthenticationIncompleteError,
  AutomaticLoginEnvironmentError,
} from "../dist/auth/login-fallback.js";

function harness({ sid = "sid-1", verified = true } = {}) {
  const calls = [];
  let saved;
  const window = {
    navigate: async () => { calls.push("navigate"); },
    submitCredentials: async () => { calls.push("submit"); return true; },
    waitForAuthenticatedPage: async () => { calls.push("wait"); },
    readSessionId: async () => { calls.push("cookie"); return sid; },
    close: async () => { calls.push("close"); },
    isConnected: () => false,
  };
  const deps = {
    openWindow: async () => { calls.push("open"); return window; },
    verifySession: async (candidate) => {
      calls.push(`verify:${candidate}`);
      return verified;
    },
    saveSession: (session) => { calls.push("save"); saved = session; },
    now: () => 1_000,
  };
  return { calls, deps, window, saved: () => saved };
}

test("executes and closes the automatic login flow", async () => {
  const h = harness();
  const session = await performAutomaticLogin(h.deps);

  assert.deepEqual(session, {
    zentaosid: "sid-1",
    expiresAt: 1_000 + 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(h.saved(), session);
  assert.deepEqual(h.calls, [
    "open", "navigate", "submit", "wait", "cookie",
    "verify:sid-1", "save", "close",
  ]);
});

test("classifies an unfinished credential flow for visible fallback", async () => {
  const h = harness();
  h.window.waitForAuthenticatedPage = async () => {
    throw new Error("still on MFA page ticket=secret");
  };

  await assert.rejects(
    performAutomaticLogin(h.deps),
    AuthenticationIncompleteError,
  );
  assert.equal(h.calls.at(-1), "close");
  assert.equal(h.saved(), undefined);
});

test("does not classify navigation, verification, or save failures as interactive", async () => {
  for (const stage of ["navigate", "verify", "save"]) {
    const h = harness();
    if (stage === "navigate") {
      h.window.navigate = async () => { throw new Error("network ticket=secret"); };
    } else if (stage === "verify") {
      h.deps.verifySession = async () => { throw new Error("server ticket=secret"); };
    } else {
      h.deps.saveSession = () => { throw new Error("disk password=secret"); };
    }

    await assert.rejects(
      performAutomaticLogin(h.deps),
      (error) => {
        assert.equal(error instanceof AutomaticLoginEnvironmentError, true);
        assert.doesNotMatch(error.message, /ticket|password|secret/);
        return true;
      },
      stage,
    );
    assert.equal(h.calls.at(-1), "close");
  }
});

test("treats a missing or rejected session as incomplete authentication", async () => {
  for (const options of [{ sid: null }, { sid: "anonymous", verified: false }]) {
    const h = harness(options);
    await assert.rejects(
      performAutomaticLogin(h.deps),
      AuthenticationIncompleteError,
    );
    assert.equal(h.saved(), undefined);
    assert.equal(h.calls.at(-1), "close");
  }
});

test("blocks visible fallback when the automatic browser cannot be closed", async () => {
  const h = harness();
  h.window.waitForAuthenticatedPage = async () => {
    throw new Error("authentication incomplete");
  };
  h.window.close = async () => {
    throw new Error("close failed ticket=secret");
  };
  h.window.isConnected = () => true;

  await assert.rejects(
    performAutomaticLogin(h.deps),
    AutomaticLoginEnvironmentError,
  );
  assert.equal(h.saved(), undefined);
});
