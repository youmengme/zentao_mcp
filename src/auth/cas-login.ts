import { chromium, type Browser } from "playwright-core";
import { config } from "../config.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

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
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to zentao — triggers CAS redirect
    await page.goto(`${config.zentaoUrl}/my/`, { waitUntil: "networkidle" });

    // Check if CAS login page is shown
    const casUrl = page.url();
    if (casUrl.includes("sso.aihuishou.com/cas/login")) {
      await page.fill("#username", config.username);
      await page.fill("#password", config.password);
      await page.click('button[name="submitBtn"]');

      // Wait for redirect back to zentao
      await page.waitForURL(/zentao/, { timeout: 15000 });
      await page.waitForLoadState("networkidle");
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
