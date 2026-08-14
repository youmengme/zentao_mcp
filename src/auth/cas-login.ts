import { chromium } from "playwright-core";
import { config } from "../config.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { isDebug, log } from "../debug.js";
import {
  InteractiveLoginManager,
  InteractiveLoginRequiredError,
  type InteractiveWindow,
} from "./interactive-login.js";
import {
  classifySessionResponse,
  isAuthenticatedSessionResponse,
  submitConfiguredCredentials,
} from "./login-page.js";
import {
  runWithInteractiveLoginFallback,
} from "./login-fallback.js";
import {
  performAutomaticLogin,
  type AutomaticLoginWindow,
} from "./automatic-login.js";

export interface Session {
  zentaosid: string;
  expiresAt: number;
}

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

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function safeLocation(candidate: string): { origin: string; pathname: string } {
  try {
    const url = new URL(candidate);
    return { origin: url.origin, pathname: url.pathname };
  } catch {
    return { origin: "invalid", pathname: "invalid" };
  }
}

async function verifySession(sid: string): Promise<boolean> {
  const response = await fetch(`${config.zentaoUrl}/my/`, {
    headers: { Cookie: `zentaosid=${sid}` },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });

  const classification = classifySessionResponse(response.status);
  if (classification === "error") {
    throw new Error("Session verification request failed");
  }
  return isAuthenticatedSessionResponse(response.status, response.headers.get("location"));
}

async function openInteractiveLoginWindow(): Promise<InteractiveWindow> {
  const browser = await chromium.launch({ channel: "chrome", headless: false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${config.zentaoUrl}/my/`, { waitUntil: "domcontentloaded" });

    try {
      await submitConfiguredCredentials(page, config);
    } catch (error) {
      log("interactive credential submission did not finish", {
        errorType: errorType(error),
      });
    }

    return {
      async readSessionId(): Promise<string | undefined> {
        const cookies = await context.cookies(config.zentaoUrl);
        return cookies.find((cookie) => cookie.name === "zentaosid")?.value;
      },
      close: () => browser.close(),
      onClosed(callback): void {
        browser.on("disconnected", () => {
          Promise.resolve(callback()).catch((error) => {
            log("interactive login cleanup failed", {
              errorType: errorType(error),
            });
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
      log("interactive login timeout cleanup failed", {
        errorType: errorType(error),
      });
    });
  }, delayMs),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
});

export const finishInteractiveLogin = () => interactiveLogin.finish();
export const shutdownInteractiveLogin = () => interactiveLogin.shutdown();

async function openAutomaticLoginWindow(
  headless: boolean,
): Promise<AutomaticLoginWindow> {
  const browser = await chromium.launch({ channel: "chrome", headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    return {
      async navigate(): Promise<void> {
        const entryUrl = `${config.zentaoUrl}/my/`;
        log("navigating to", safeLocation(entryUrl));
        await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
      },
      async submitCredentials(): Promise<boolean> {
        log("current location after navigation", safeLocation(page.url()));
        const submitted = await submitConfiguredCredentials(page, config);
        if (submitted) log("CAS login page detected, filling credentials");
        return submitted;
      },
      async waitForAuthenticatedPage(): Promise<void> {
        const zentaoHost = new URL(config.zentaoUrl).hostname;
        await page.waitForURL(
          (url) => url.hostname === zentaoHost && !url.pathname.includes("/cas/"),
          { timeout: 15000 },
        );
        await page.waitForLoadState("domcontentloaded");
        log("redirected back to zentao", safeLocation(page.url()));
      },
      async readSessionId(): Promise<string | undefined> {
        const cookies = await context.cookies(config.zentaoUrl);
        return cookies.find((cookie) => cookie.name === "zentaosid")?.value;
      },
      close: () => browser.close(),
      isConnected: () => browser.isConnected(),
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function automaticCasLogin(): Promise<Session> {
  const headless = !isDebug();
  log("casLogin start", { location: safeLocation(config.zentaoUrl), headless });

  const session = await performAutomaticLogin({
    openWindow: () => openAutomaticLoginWindow(headless),
    verifySession,
    saveSession,
    now: Date.now,
    onCleanupError: (cleanupErrorType) => {
      log("automatic login browser cleanup failed", {
        errorType: cleanupErrorType,
      });
    },
  });
  log("session saved, zentaosid length:", session.zentaosid.length);
  return session;
}

export async function casLogin(): Promise<Session> {
  if (interactiveLogin.isPending()) {
    throw new InteractiveLoginRequiredError();
  }

  return runWithInteractiveLoginFallback(
    automaticCasLogin,
    () => interactiveLogin.start(),
  );
}

export async function getOrRefreshSession(): Promise<Session> {
  const existing = await loadSession();
  if (existing) return existing;
  return casLogin();
}
