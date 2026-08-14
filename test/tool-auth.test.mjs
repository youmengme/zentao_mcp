import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveLoginRequiredError } from "../dist/auth/interactive-login.js";
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
