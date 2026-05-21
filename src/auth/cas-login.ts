import { chromium, type Browser } from "playwright-core";
import { config } from "../config.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { isDebug, log } from "../debug.js";

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

export async function casLogin(): Promise<Session> {
  const headless = !isDebug();
  log("casLogin start", { zentaoUrl: config.zentaoUrl, headless });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: "chrome", headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to zentao — triggers CAS redirect
    const entryUrl = `${config.zentaoUrl}/my/`;
    log("navigating to", entryUrl);
    await page.goto(entryUrl, { waitUntil: "networkidle" });

    // Check if CAS login page is shown
    const casUrl = page.url();
    log("current url after navigation:", casUrl);
    if (casUrl.includes("sso.aihuishou.com/cas/login")) {
      log("CAS login page detected, filling credentials");
      await page.fill("#username", config.username);
      await page.fill("#password", config.password);
      await page.click('button[name="submitBtn"]');

      // Wait for redirect back to zentao
      await page.waitForURL(/zentao/, { timeout: 15000 });
      await page.waitForLoadState("networkidle");
      log("redirected back to zentao:", page.url());
    }

    // Extract zentaosid cookie
    const cookies = await context.cookies();
    const sid = cookies.find((c) => c.name === "zentaosid");

    if (!sid) {
      throw new Error("Login succeeded but zentaosid cookie not found");
    }

    const session: Session = {
      zentaosid: sid.value,
      expiresAt: Date.now() + SESSION_TTL,
    };

    saveSession(session);
    return session;
  } finally {
    await browser?.close();
  }
}

export async function getOrRefreshSession(): Promise<Session> {
  const existing = await loadSession();
  if (existing) return existing;
  return casLogin();
}
