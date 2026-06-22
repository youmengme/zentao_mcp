import { config } from "../config.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { log } from "../debug.js";

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

/* ------------------------------------------------------------------ *
 * Minimal cookie jar — enough to carry CAS (sso host) and ZenTao
 * cookies across the redirect chain. fetch() has no jar of its own and
 * does not expose Set-Cookie from followed redirects, so we follow
 * redirects manually and track cookies per domain ourselves.
 * ------------------------------------------------------------------ */
interface Cookie {
  domain: string;
  name: string;
  value: string;
}
type Jar = Cookie[];

function storeCookies(jar: Jar, host: string, setCookies: string[]): void {
  for (const sc of setCookies) {
    const semi = sc.indexOf(";");
    const pair = semi === -1 ? sc : sc.slice(0, semi);
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();

    let domain = host;
    for (const attr of sc.slice(semi + 1).split(";")) {
      const [k, v] = attr.split("=");
      if (k.trim().toLowerCase() === "domain" && v) domain = v.trim().replace(/^\./, "");
    }

    const existing = jar.find((c) => c.domain === domain && c.name === name);
    if (existing) existing.value = value;
    else jar.push({ domain, name, value });
  }
}

function cookieHeader(jar: Jar, host: string): string {
  return jar
    .filter((c) => host === c.domain || host.endsWith("." + c.domain))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

interface FollowResult {
  resp: Response;
  url: string;
}

/** fetch() that manually follows redirects while maintaining the cookie jar. */
async function fetchFollow(
  jar: Jar,
  startUrl: string,
  init: { method?: string; body?: string } = {},
  maxRedirects = 10,
): Promise<FollowResult> {
  let url = startUrl;
  let method = init.method ?? "GET";
  let body = init.body;

  for (let i = 0; i < maxRedirects; i++) {
    const host = new URL(url).host;
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const cookie = cookieHeader(jar, host);
    if (cookie) headers["Cookie"] = cookie;

    const resp = await fetch(url, { method, headers, body, redirect: "manual" });
    storeCookies(jar, host, resp.headers.getSetCookie?.() ?? []);

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return { resp, url };
      url = new URL(loc, url).toString();
      method = "GET";
      body = undefined; // a redirected request carries no body
      continue;
    }
    return { resp, url };
  }
  throw new Error("CAS login: too many redirects");
}

/** Pull a hidden field's value out of the CAS login form (#fm1). */
function formField(html: string, name: string): string {
  const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i");
  const m = html.match(re);
  if (!m) throw new Error(`CAS login: field "${name}" not found on login page`);
  return m[1];
}

/**
 * Log in to ZenTao through CAS SSO using plain HTTP (no browser).
 *
 * Flow: GET /my/ → 302 to the CAS login page (collect XSRF/session cookies) →
 * POST credentials + execution/_csrf to CAS → 302 back to ZenTao with a service
 * ticket → ZenTao validates it and sets `zentaosid`.
 */
export async function casLogin(): Promise<Session> {
  log("casLogin (pure HTTP) start", { zentaoUrl: config.zentaoUrl });
  const jar: Jar = [];

  // 1. Entry point → follow redirect to the CAS login page.
  const entry = await fetchFollow(jar, `${config.zentaoUrl}/my/`);
  const loginUrl = entry.url;
  if (!loginUrl.includes("/cas/")) {
    // Already authenticated (unlikely without cookies) — fall through to verify.
    log("casLogin: no CAS redirect, landed on", loginUrl);
  }
  const loginHtml = await entry.resp.text();

  // 2. Extract webflow tokens and post credentials.
  const execution = formField(loginHtml, "execution");
  const csrf = formField(loginHtml, "_csrf");
  const body = new URLSearchParams({
    username: config.username,
    password: config.password,
    execution,
    _eventId: "submit",
    _csrf: csrf,
    geolocation: "",
  }).toString();

  const post = await fetchFollow(jar, loginUrl, { method: "POST", body });

  // 3. The redirect chain should have landed back on ZenTao and set zentaosid.
  const sid = jar.find((c) => c.name === "zentaosid");
  if (!sid) {
    const finalHtml = await post.resp.text();
    const hint = /用户名或密码|password is incorrect|credential/i.test(finalHtml)
      ? " (credentials rejected?)"
      : "";
    throw new Error(`CAS login failed: zentaosid cookie not obtained${hint}`);
  }

  // 4. Verify the session is authenticated, not an anonymous SID.
  const verify = await fetch(`${config.zentaoUrl}/my/`, {
    headers: { Cookie: `zentaosid=${sid.value}` },
    redirect: "manual",
  });
  if (verify.status === 302 && (verify.headers.get("location") ?? "").includes("cas/login")) {
    throw new Error("CAS login appeared to succeed but session is not authenticated (anonymous SID)");
  }

  const session: Session = { zentaosid: sid.value, expiresAt: Date.now() + SESSION_TTL };
  saveSession(session);
  log("casLogin ok, zentaosid length:", sid.value.length);
  return session;
}

export async function getOrRefreshSession(): Promise<Session> {
  const existing = await loadSession();
  if (existing) return existing;
  return casLogin();
}
