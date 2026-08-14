import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveLoginRequiredError } from "../dist/auth/interactive-login.js";
import {
  AutomaticLoginEnvironmentError,
  AuthenticationIncompleteError,
  InteractiveLoginEnvironmentError,
  normalizeAutomaticLoginError,
  runWithInteractiveLoginFallback,
} from "../dist/auth/login-fallback.js";

test("returns automatic login result without opening a visible browser", async () => {
  let visibleStarts = 0;
  const result = await runWithInteractiveLoginFallback(
    async () => ({ zentaosid: "sid-1" }),
    async () => { visibleStarts += 1; },
  );

  assert.deepEqual(result, { zentaosid: "sid-1" });
  assert.equal(visibleStarts, 0);
});

test("opens a visible browser only for incomplete authentication", async () => {
  let visibleStarts = 0;
  await assert.rejects(
    runWithInteractiveLoginFallback(
      async () => { throw new AuthenticationIncompleteError(); },
      async () => { visibleStarts += 1; },
    ),
    InteractiveLoginRequiredError,
  );
  assert.equal(visibleStarts, 1);
});

test("does not open a visible browser for network or persistence errors", async () => {
  let visibleStarts = 0;
  const failure = new Error("network down");
  await assert.rejects(
    runWithInteractiveLoginFallback(
      async () => { throw failure; },
      async () => { visibleStarts += 1; },
    ),
    (error) => error === failure,
  );
  assert.equal(visibleStarts, 0);
});

test("redacts visible browser launch failures", async () => {
  await assert.rejects(
    runWithInteractiveLoginFallback(
      async () => { throw new AuthenticationIncompleteError(); },
      async () => { throw new Error("secret ticket=abc123"); },
    ),
    (error) => {
      assert.equal(error instanceof InteractiveLoginEnvironmentError, true);
      assert.doesNotMatch(error.message, /secret|abc123/);
      return true;
    },
  );
});

test("redacts automatic browser, network, and persistence failures", () => {
  const incomplete = new AuthenticationIncompleteError();
  assert.equal(normalizeAutomaticLoginError(incomplete), incomplete);

  const normalized = normalizeAutomaticLoginError(
    new Error("https://sso.example/cas?ticket=secret-ticket password=hunter2"),
  );
  assert.equal(normalized instanceof AutomaticLoginEnvironmentError, true);
  assert.doesNotMatch(normalized.message, /secret-ticket|hunter2|ticket|password/);
});
