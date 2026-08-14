# Interactive SSO Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-stage CAS login flow that falls back from automatic headless login to one visible Chrome window, then completes authentication when the user replies and the AI calls `zentao_finish_login`.

**Architecture:** Keep automatic login in `cas-login.ts`, extract CAS URL matching into a small helper, and add an injected `InteractiveLoginManager` that owns exactly one visible login window and its 10-minute timeout. Authentication-aware MCP handlers translate the manager's pending signal into a stable text protocol; a new completion tool verifies `zentaosid`, saves the session, closes Chrome, and asks the AI to retry the original operation.

**Tech Stack:** TypeScript ES2022, Playwright Core, MCP TypeScript SDK, Node.js built-in test runner, npm.

---

## File map

- Create `src/auth/login-page.ts`: CAS URL matching and shared credential submission helpers.
- Create `src/auth/interactive-login.ts`: browser-agnostic interactive login state machine, timeout, verification, and cleanup.
- Create `src/auth/tool-auth.ts`: stable MCP pending response and authenticated action wrapper.
- Modify `src/auth/cas-login.ts`: automatic login, headed fallback adapter, shared verification, and exported completion/cleanup functions.
- Modify `src/index.ts`: wrap authenticated tools, register `zentao_finish_login`, and clean up on process exit.
- Modify `package.json`: build before running tests so tests can import compiled modules.
- Create `test/login-page.test.mjs`: configured CAS URL matching regression tests.
- Create `test/interactive-login.test.mjs`: state machine, singleton, verification, and timeout tests.
- Create `test/tool-auth.test.mjs`: MCP pending response and error propagation tests.
- Modify `test/playwright-restoration.test.mjs`: verify headed fallback and completion tool remain wired.
- Modify `README.md`: document automatic fallback, visible window, `继续`, and the 10-minute limit.

### Task 1: Test harness and configured CAS URL matching

**Files:**
- Create: `src/auth/login-page.ts`
- Create: `test/login-page.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Make tests build production code first and add the failing URL tests**

Change the test script to:

```json
"test": "npm run build && node --test test/*.test.mjs"
```

Create `test/login-page.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test and verify RED**

Run: `rtk npm test`

Expected: FAIL because `dist/auth/login-page.js` does not exist.

- [ ] **Step 3: Implement the URL matcher**

Create `src/auth/login-page.ts`:

```ts
function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function isCasLoginUrl(candidate: string, configuredCasUrl: string): boolean {
  try {
    const current = new URL(candidate);
    const configured = new URL(configuredCasUrl);
    return (
      current.origin === configured.origin &&
      normalizePath(current.pathname) === normalizePath(configured.pathname)
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the focused and full tests**

Run: `rtk npm test`

Expected: all URL tests and the existing Playwright restoration test PASS.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add package.json src/auth/login-page.ts test/login-page.test.mjs
rtk git commit -m "test: cover configured CAS login URL"
```

### Task 2: Interactive login state machine

**Files:**
- Create: `src/auth/interactive-login.ts`
- Create: `test/interactive-login.test.mjs`

- [ ] **Step 1: Add failing tests for one window, completion, incomplete login, and timeout**

Create `test/interactive-login.test.mjs` with a fake window and injected clock:

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk npm run build && rtk node --test test/interactive-login.test.mjs`

Expected: FAIL because `InteractiveLoginManager` is not implemented.

- [ ] **Step 3: Implement the injected manager**

Create `src/auth/interactive-login.ts` with these public contracts and behavior:

```ts
export interface SessionRecord {
  zentaosid: string;
  expiresAt: number;
}

export interface InteractiveWindow {
  readSessionId(): Promise<string | undefined>;
  close(): Promise<void>;
  onClosed(callback: () => void | Promise<void>): void;
}

export interface InteractiveLoginDependencies {
  openWindow(): Promise<InteractiveWindow>;
  verifySession(sid: string): Promise<boolean>;
  saveSession(session: SessionRecord): void;
  now(): number;
  schedule(callback: () => void | Promise<void>, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export type FinishLoginResult =
  | { status: "success" }
  | { status: "waiting" }
  | { status: "missing" }
  | { status: "unavailable"; message: string };

export class InteractiveLoginRequiredError extends Error {
  constructor() {
    super("Interactive SSO login is waiting for the user");
    this.name = "InteractiveLoginRequiredError";
  }
}

const INTERACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class InteractiveLoginManager {
  private window: InteractiveWindow | undefined;
  private starting: Promise<void> | undefined;
  private timer: unknown;

  constructor(private readonly deps: InteractiveLoginDependencies) {}

  isPending(): boolean {
    return Boolean(this.window || this.starting);
  }

  async start(): Promise<void> {
    if (this.window) return;
    if (!this.starting) {
      this.starting = this.open().finally(() => { this.starting = undefined; });
    }
    await this.starting;
  }

  private async open(): Promise<void> {
    const opened = await this.deps.openWindow();
    this.window = opened;
    opened.onClosed(() => this.cleanup(opened));
    this.timer = this.deps.schedule(() => this.cleanup(opened), INTERACTIVE_TIMEOUT_MS);
  }

  async finish(): Promise<FinishLoginResult> {
    if (this.starting) await this.starting;
    const opened = this.window;
    if (!opened) return { status: "missing" };

    try {
      const sid = await opened.readSessionId();
      if (!sid || !(await this.deps.verifySession(sid))) return { status: "waiting" };
      this.deps.saveSession({ zentaosid: sid, expiresAt: this.deps.now() + SESSION_TTL_MS });
      await this.cleanup(opened);
      return { status: "success" };
    } catch (error) {
      await this.cleanup(opened);
      return {
        status: "unavailable",
        message: error instanceof Error ? error.message : "Interactive browser is unavailable",
      };
    }
  }

  async shutdown(): Promise<void> {
    if (this.starting) {
      try { await this.starting; } catch { return; }
    }
    await this.cleanup();
  }

  private async cleanup(expected?: InteractiveWindow): Promise<void> {
    if (expected && this.window !== expected) return;
    const opened = this.window;
    this.window = undefined;
    if (this.timer !== undefined) {
      this.deps.cancel(this.timer);
      this.timer = undefined;
    }
    try {
      await opened?.close();
    } catch {
      // The user may already have closed the browser.
    }
  }
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `rtk npm run build && rtk node --test test/interactive-login.test.mjs && rtk npm test`

Expected: five state-machine tests PASS; full suite PASS.

- [ ] **Step 5: Commit Task 2**

```bash
rtk git add src/auth/interactive-login.ts test/interactive-login.test.mjs
rtk git commit -m "feat: add interactive login state manager"
```

### Task 3: Connect Playwright automatic login to headed fallback

**Files:**
- Modify: `src/auth/login-page.ts`
- Modify: `src/auth/cas-login.ts`
- Modify: `test/login-page.test.mjs`
- Modify: `test/playwright-restoration.test.mjs`

- [ ] **Step 1: Add failing regression assertions for configured CAS and headed fallback**

Extend `test/playwright-restoration.test.mjs` inside the existing test:

```js
assert.match(login, /headless: false/);
assert.match(login, /config\.casUrl/);
assert.match(login, /export const finishInteractiveLogin/);
assert.doesNotMatch(login, /sso\.aihuishou\.com\/cas\/login/);
```

Import `submitConfiguredCredentials` in `test/login-page.test.mjs` and append:

```js
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
```

- [ ] **Step 2: Run tests and verify RED**

Run: `rtk npm test`

Expected: FAIL because headed fallback exports and shared credential submission do not exist.

- [ ] **Step 3: Add shared credential submission**

Extend `src/auth/login-page.ts` with a narrow page interface and helper:

```ts
export interface LoginPage {
  url(): string;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
}

export interface LoginPageConfig {
  casUrl: string;
  username: string;
  password: string;
}

export async function submitConfiguredCredentials(
  page: LoginPage,
  loginConfig: LoginPageConfig,
): Promise<boolean> {
  if (!isCasLoginUrl(page.url(), loginConfig.casUrl)) return false;
  await page.fill("#username", loginConfig.username);
  await page.fill("#password", loginConfig.password);
  await page.click('button[name="submitBtn"]');
  return true;
}
```

- [ ] **Step 4: Refactor `cas-login.ts` and wire the singleton manager**

Keep `loadSession`, `saveSession`, and the 24-hour TTL. Add `verifySession(sid)` that requests `/my/` and returns false only when the response redirects to CAS according to `config.casUrl`.

Create one module-level manager with production dependencies:

```ts
const interactiveLogin = new InteractiveLoginManager({
  openWindow: openInteractiveLoginWindow,
  verifySession,
  saveSession,
  now: Date.now,
  schedule: (callback, delayMs) => setTimeout(() => void callback(), delayMs),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
});
```

`openInteractiveLoginWindow()` launches `{ channel: "chrome", headless: false }`, creates a context/page, navigates to `${config.zentaoUrl}/my/`, and attempts `submitConfiguredCredentials`. Selector or submit errors are logged without credentials and leave the visible window open. Its adapter reads `zentaosid` from `context.cookies()`, closes the browser, and implements `onClosed` with Playwright's `browser.on("disconnected", callback)` so manually closing Chrome clears manager state.

Refactor automatic `casLogin()` to:

1. Throw `InteractiveLoginRequiredError` immediately when `interactiveLogin.isPending()`.
2. Launch headless Chrome and set `pageReached = true` only after the entry navigation succeeds.
3. Use `submitConfiguredCredentials` instead of the hard-coded URL check.
4. Wait for the configured ZenTao host after credentials are submitted.
5. Verify and save a valid session as today.
6. On an error after `pageReached`, close the headless browser, start the visible manager, and throw `InteractiveLoginRequiredError`.
7. On browser launch, DNS, or entry navigation failure before a page is reached, rethrow the original error without claiming a visible window exists.

Export:

```ts
export const finishInteractiveLogin = () => interactiveLogin.finish();
export const shutdownInteractiveLogin = () => interactiveLogin.shutdown();
```

- [ ] **Step 5: Run full verification for the auth layer**

Run: `rtk npm test && rtk npm run build`

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit Task 3**

```bash
rtk git add src/auth/login-page.ts src/auth/cas-login.ts test/login-page.test.mjs test/playwright-restoration.test.mjs
rtk git commit -m "feat: fall back to visible SSO login"
```

### Task 4: MCP pending protocol and completion tool

**Files:**
- Create: `src/auth/tool-auth.ts`
- Create: `test/tool-auth.test.mjs`
- Modify: `src/index.ts`
- Modify: `test/playwright-restoration.test.mjs`

- [ ] **Step 1: Add failing tests for the stable MCP response**

Create `test/tool-auth.test.mjs`:

```js
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
});

test("rethrows unrelated authentication errors", async () => {
  await assert.rejects(
    runAuthenticated(async () => { throw new Error("network down"); }, async () => ({ content: [] })),
    /network down/,
  );
});
```

Extend the restoration test to assert that `src/index.ts` registers `zentao_finish_login` and uses `runAuthenticated`.

- [ ] **Step 2: Run tests and verify RED**

Run: `rtk npm test`

Expected: FAIL because `tool-auth.ts` and the completion tool do not exist.

- [ ] **Step 3: Implement the authenticated action wrapper**

Create `src/auth/tool-auth.ts`:

```ts
import { InteractiveLoginRequiredError } from "./interactive-login.js";

export interface TextToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export async function runAuthenticated<T>(
  ensureSession: () => Promise<unknown>,
  action: () => Promise<T>,
): Promise<T | TextToolResult> {
  try {
    await ensureSession();
    return await action();
  } catch (error) {
    if (!(error instanceof InteractiveLoginRequiredError)) throw error;
    return {
      content: [{
        type: "text",
        text: "[INTERACTIVE_LOGIN_REQUIRED]\n自动登录未完成，已打开可见的 SSO 登录窗口。\n请在窗口中完成登录，然后回复“继续”。原操作尚未执行。",
      }],
    };
  }
}
```

- [ ] **Step 4: Register and format `zentao_finish_login`**

In `src/index.ts`, import `finishInteractiveLogin`, `shutdownInteractiveLogin`, and `runAuthenticated`. Add a local `ensureSession` function using `loadSession() ?? casLogin()`.

Wrap every authenticated business handler (`zentao_login`, `zentao_list_bugs`, `zentao_my_bugs`, `zentao_get_bug`, `zentao_get_bug_image`, `zentao_resolve_bug`, and `zentao_add_comment`) with `runAuthenticated`. For example, the complete `zentao_get_bug` callback becomes:

```ts
return runAuthenticated(ensureSession, async () => {
  const bug = await getBug(bugId);
  const lines = [
    `Bug #${bug.id}: ${bug.title}`,
    `Status: ${bug.status} | Severity: ${bug.severity} | Priority: ${bug.pri}`,
    `Type: ${bug.type}`,
    `Assigned To: ${bug.assignedTo}`,
    `Opened By: ${bug.openedBy} at ${bug.openedDate}`,
    `Product: ${bug.product} | Module: ${bug.module}`,
    bug.resolvedBy ? `Resolved By: ${bug.resolvedBy} (${bug.resolution})` : null,
    "--- Steps ---",
    bug.steps,
  ].filter(Boolean);
  if (bug.images.length > 0) {
    lines.push(`--- 图片附件 (${bug.images.length}) ---`);
    for (const img of bug.images) {
      lines.push(`  - fileId=${img.fileId}  ${img.filename}  (来源: ${img.source})`);
    }
  }
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
});
```

Register `zentao_finish_login` with no parameters and these exact result meanings:

- `success`: `登录验证成功，session 已保存，浏览器已关闭。请继续执行用户原先的禅道操作。`
- `waiting`: `登录尚未完成，请继续在已打开的浏览器中操作，完成后再次回复“继续”。`
- `missing`: `交互登录窗口不存在或已超时，请重新执行原先的禅道操作以发起登录。`
- `unavailable`: include the sanitized manager message and state that the window was cleaned up.

The explicit `zentao_login` tool must use the same wrapper so automatic failure also produces the pending protocol.

- [ ] **Step 5: Run full tests and build**

Run: `rtk npm test && rtk npm run build`

Expected: all tests PASS; all MCP handlers type-check.

- [ ] **Step 6: Commit Task 4**

```bash
rtk git add src/auth/tool-auth.ts src/index.ts test/tool-auth.test.mjs test/playwright-restoration.test.mjs
rtk git commit -m "feat: add interactive login completion tool"
```

### Task 5: Lifecycle cleanup, documentation, and release verification

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `test/playwright-restoration.test.mjs`

- [ ] **Step 1: Add failing lifecycle assertions**

Extend `test/playwright-restoration.test.mjs` with:

```js
const index = read("src/index.ts");
assert.match(index, /process\.once\("SIGINT"/);
assert.match(index, /process\.once\("SIGTERM"/);
assert.match(index, /await shutdownInteractiveLogin\(\)/);
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `rtk npm test`

Expected: FAIL because signal cleanup is not registered.

- [ ] **Step 3: Add idempotent process cleanup**

In `src/index.ts`, register one guarded async shutdown function:

```ts
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await shutdownInteractiveLogin();
  process.exit(signal === "SIGTERM" ? 143 : 130);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
```

Do not log credentials, cookies, or full SSO query strings during shutdown or login.

- [ ] **Step 4: Document the two-stage flow**

Update `README.md` to state that authentication is normally headless and automatic. Document that a visible local Chrome window opens only when automatic SSO authentication cannot finish, the user replies `继续`, the AI calls `zentao_finish_login`, and the window expires after 10 minutes. State that remote/headless hosts cannot display the fallback window.

- [ ] **Step 5: Run complete verification**

Run:

```bash
rtk npm test
rtk npm run build
rtk npm pack --dry-run --json --cache /private/tmp/zentao-npm-cache
rtk git diff --check
```

Expected: all tests PASS, build exits 0, the package contains compiled auth modules and README, and diff check emits no errors.

- [ ] **Step 6: Commit Task 5**

```bash
rtk git add src/index.ts README.md test/playwright-restoration.test.mjs
rtk git commit -m "docs: explain interactive SSO fallback"
```

- [ ] **Step 7: Review final branch state**

Run: `rtk git status --short && rtk git log --oneline --decorate -8`

Expected: clean worktree with the five implementation commits on `feature/interactive-sso-fallback`.
