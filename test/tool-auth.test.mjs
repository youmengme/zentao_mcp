import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveLoginRequiredError } from "../dist/auth/interactive-login.js";
import {
  AutomaticLoginEnvironmentError,
  InteractiveLoginEnvironmentError,
} from "../dist/auth/login-fallback.js";
import { runAuthenticated } from "../dist/auth/tool-auth.js";

test("returns a stable pending response and does not run the action", async () => {
  let ran = false;
  const result = await runAuthenticated(
    async () => { throw new InteractiveLoginRequiredError(); },
    async () => { ran = true; return { content: [] }; },
  );

  assert.equal(ran, false);
  assert.match(result.content[0].text, /^\[INTERACTIVE_LOGIN_REQUIRED\]/);
  assert.match(result.content[0].text, /回复“继续”/);
  assert.match(result.content[0].text, /zentao_finish_login/);
  assert.match(result.content[0].text, /原操作尚未执行/);
});

test("rethrows unrelated authentication errors", async () => {
  await assert.rejects(
    runAuthenticated(
      async () => { throw new Error("network down"); },
      async () => ({ content: [] }),
    ),
    /network down/,
  );
});

test("returns a stable error when a visible browser cannot be opened", async () => {
  const result = await runAuthenticated(
    async () => { throw new InteractiveLoginEnvironmentError(); },
    async () => ({ content: [] }),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^\[INTERACTIVE_LOGIN_UNAVAILABLE\]/);
  assert.doesNotMatch(result.content[0].text, /playwright|ticket|password/i);
});

test("returns a stable error for automatic login environment failures", async () => {
  const result = await runAuthenticated(
    async () => { throw new AutomaticLoginEnvironmentError(); },
    async () => ({ content: [] }),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^\[AUTOMATIC_LOGIN_UNAVAILABLE\]/);
});
