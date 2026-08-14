import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveLoginManager } from "../dist/auth/interactive-login.js";

function harness({ sid, verified = true } = {}) {
  let opened = 0;
  let closed = 0;
  let saved;
  let timeoutCallback;
  let closedCallback;

  const manager = new InteractiveLoginManager({
    openWindow: async () => {
      opened += 1;
      return {
        readSessionId: async () => sid,
        close: async () => { closed += 1; },
        onClosed: (callback) => { closedCallback = callback; },
      };
    },
    verifySession: async () => verified,
    saveSession: (session) => { saved = session; },
    now: () => 1_000,
    schedule: (callback) => { timeoutCallback = callback; return 1; },
    cancel: () => {},
  });

  return {
    manager,
    counts: () => ({ opened, closed }),
    saved: () => saved,
    expire: async () => { await timeoutCallback(); },
    closeFromBrowser: async () => { await closedCallback(); },
  };
}

test("opens only one visible login window", async () => {
  const h = harness();
  await Promise.all([h.manager.start(), h.manager.start()]);
  assert.deepEqual(h.counts(), { opened: 1, closed: 0 });
  assert.equal(h.manager.isPending(), true);
});

test("keeps the window open when login is incomplete", async () => {
  const h = harness();
  await h.manager.start();
  assert.deepEqual(await h.manager.finish(), { status: "waiting" });
  assert.deepEqual(h.counts(), { opened: 1, closed: 0 });
});

test("saves a verified session and closes the window", async () => {
  const h = harness({ sid: "sid-1" });
  await h.manager.start();
  assert.deepEqual(await h.manager.finish(), { status: "success" });
  assert.equal(h.saved().zentaosid, "sid-1");
  assert.equal(h.saved().expiresAt, 1_000 + 24 * 60 * 60 * 1000);
  assert.deepEqual(h.counts(), { opened: 1, closed: 1 });
});

test("does not save an unverified session", async () => {
  const h = harness({ sid: "anonymous", verified: false });
  await h.manager.start();
  assert.deepEqual(await h.manager.finish(), { status: "waiting" });
  assert.equal(h.saved(), undefined);
  assert.deepEqual(h.counts(), { opened: 1, closed: 0 });
});

test("closes and clears the window after ten minutes", async () => {
  const h = harness();
  await h.manager.start();
  await h.expire();
  assert.equal(h.manager.isPending(), false);
  assert.deepEqual(h.counts(), { opened: 1, closed: 1 });
  assert.deepEqual(await h.manager.finish(), { status: "missing" });
});

test("clears state when the user closes the browser", async () => {
  const h = harness();
  await h.manager.start();
  await h.closeFromBrowser();
  assert.equal(h.manager.isPending(), false);
});
