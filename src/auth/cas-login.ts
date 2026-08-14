import { chromium, type Browser } from "playwright-core";
import { config } from "../config.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { isDebug, log } from "../debug.js";
import {
  InteractiveLoginManager,
  InteractiveLoginRequiredError,
  type InteractiveWindow,
} from "./interactive-login.js";
import {
  isCasLoginUrl,
  submitConfiguredCredentials,
} from "./login-page.js";

export interface Session {
  zentaosid: string;
  expiresAt: number;
}

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function loadSession(): Promise<Session | null> {
  if (!existsSync(config.sessionFile)) return null;
  try {
    const raw = JSON.parse(readFileSync(config.sessionFile, "utf-8"));
    if (raw.expiresAt > Date.now()) return raw as Session;
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  writeFileSync(config.sessionFile, JSON.stringify(session, null, 2));
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function verifySession(sid: string): Promise<boolean> {
  const response = await fetch(`${config.zentaoUrl}/my/`, {
    headers: { Cookie: `zentaosid=${sid}` },
    redirect: "manual",
  });

  if (response.status === 401) return false;
  if (response.status === 302) {
    const location = response.headers.get("location") ?? "";
    const target = new URL(location, config.zentaoUrl).toString();
    return !isCasLoginUrl(target, config.casUrl);
  }
  return response.ok;
}

async function openInteractiveLoginWindow(): Promise<InteractiveWindow> {
  const browser = await chromium.launch({ channel: "chrome", headless: false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${config.zentaoUrl}/my/`, { waitUntil: "networkidle" });

    try {
      await submitConfiguredCredentials(page, config);
    } catch (error) {
      log("interactive credential submission did not finish", errorSummary(error));
    }

    return {
      async readSessionId(): Promise<string | undefined> {
        const cookies = await context.cookies();
        return cookies.find((cookie) => cookie.name === "zentaosid")?.value;
      },
      close: () => browser.close(),
      onClosed(callback): void {
        browser.on("disconnected", () => {
          Promise.resolve(callback()).catch((error) => {
            log("interactive login cleanup failed", errorSummary(error));
          });
        });
      },
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

const interactiveLogin = new InteractiveLoginManager({
  openWindow: openInteractiveLoginWindow,
  verifySession,
  saveSession,
  now: Date.now,
  schedule: (callback, delayMs) => setTimeout(() => {
    Promise.resolve(callback()).catch((error) => {
      log("interactive login timeout cleanup failed", errorSummary(error));
    });
  }, delayMs),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
});

export const finishInteractiveLogin = () => interactiveLogin.finish();
export const shutdownInteractiveLogin = () => interactiveLogin.shutdown();

export async function casLogin(): Promise<Session> {
  if (interactiveLogin.isPending()) {
    throw new InteractiveLoginRequiredError();
  }

  const headless = !isDebug();
  log("casLogin start", { zentaoUrl: config.zentaoUrl, headless });

  let browser: Browser | undefined;
  let pageReached = false;
  try {
    browser = await chromium.launch({ channel: "chrome", headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to zentao — triggers CAS redirect
    const entryUrl = `${config.zentaoUrl}/my/`;
    log("navigating to", entryUrl);
    await page.goto(entryUrl, { waitUntil: "networkidle" });
    pageReached = true;

    // Check if CAS login page is shown
    const currentUrl = new URL(page.url());
    log("current location after navigation", {
      origin: currentUrl.origin,
      pathname: currentUrl.pathname,
    });
    if (await submitConfiguredCredentials(page, config)) {
      log("CAS login page detected, filling credentials");

      // Wait for redirect back to zentao (must be on the actual zentao host, not CAS service param)
      const zentaoHost = new URL(config.zentaoUrl).hostname;
      await page.waitForURL(
        (url) => url.hostname === zentaoHost && !url.pathname.includes("/cas/"),
        { timeout: 15000 },
      );
      await page.waitForLoadState("networkidle");
      log("redirected back to zentao:", page.url());
    }

    // Extract zentaosid cookie
    const cookies = await context.cookies();
    const sid = cookies.find((c) => c.name === "zentaosid");

    if (!sid) {
      throw new Error("Login succeeded but zentaosid cookie not found");
    }

    // Verify the session is actually authenticated (not an anonymous SID)
    if (!(await verifySession(sid.value))) {
      throw new Error("CAS login appeared to succeed but session is not authenticated (got anonymous SID)");
    }

    const session: Session = {
      zentaosid: sid.value,
      expiresAt: Date.now() + SESSION_TTL,
    };

    saveSession(session);
    log("session saved, zentaosid length:", sid.value.length);
    return session;
  } catch (error) {
    if (!pageReached) throw error;

    log("automatic CAS login failed; opening visible browser", errorSummary(error));
    await browser?.close().catch(() => {});
    browser = undefined;
    await interactiveLogin.start();
    throw new InteractiveLoginRequiredError();
  } finally {
    await browser?.close();
  }
}

export async function getOrRefreshSession(): Promise<Session> {
  const existing = await loadSession();
  if (existing) return existing;
  return casLogin();
}
