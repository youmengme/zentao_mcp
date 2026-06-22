import { config } from "../config.js";
import { getOrRefreshSession, casLogin } from "../auth/cas-login.js";
import { log } from "../debug.js";

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  followRedirects?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(path: string, options: RequestOptions = {}): Promise<string> {
  const session = await getOrRefreshSession();
  const url = `${config.zentaoUrl}/${path.replace(/^\//, "")}`;
  log("request:", options.method ?? "GET", url);

  const headers: Record<string, string> = {
    Cookie: `zentaosid=${session.zentaosid}`,
    ...options.headers,
  };

  let body: string | undefined;
  if (options.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    // ZenTao guards write actions with a Referer same-origin check; without it
    // POSTs are bounced to the login/deny page.
    headers["Referer"] = `${config.zentaoUrl}/`;
    body = encodeForm(options.body);
  }

  const resp = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
    redirect: options.followRedirects ? "follow" : "manual",
  });

  // Session expired — re-login and retry once
  if (resp.status === 401 || resp.status === 302) {
    const location = resp.headers.get("location") ?? "";
    if (location.includes("cas/login") || resp.status === 401) {
      const newSession = await casLogin();
      headers.Cookie = `zentaosid=${newSession.zentaosid}`;
      const retry = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body,
        redirect: options.followRedirects ? "follow" : "manual",
      });
      if (!retry.ok && retry.status !== 302) {
        throw new ApiError(retry.status, `API request failed after re-login: ${retry.statusText}`);
      }
      return retry.text();
    }
  }

  if (!resp.ok && resp.status !== 302) {
    const text = await resp.text();
    throw new ApiError(resp.status, `API request failed: ${resp.statusText}`, text);
  }

  return resp.text();
}

export async function getJson<T>(path: string): Promise<T> {
  const text = await request(path);
  try {
    const wrapper = JSON.parse(text);
    if (wrapper.status === "success" && typeof wrapper.data === "string") {
      return JSON.parse(wrapper.data) as T;
    }
    return wrapper as T;
  } catch {
    const preview = text.slice(0, 200);
    throw new ApiError(500, `Invalid JSON response from ${path}: ${preview}`, text);
  }
}

/**
 * Serialize a form body into application/x-www-form-urlencoded.
 * Array values are appended once per item (e.g. `openedBuild[]=a&openedBuild[]=b`),
 * which is how ZenTao expects multi-value fields. Null/undefined are skipped.
 */
function encodeForm(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  return params.toString();
}

/**
 * POST a ZenTao write action and interpret its response.
 *
 * ZenTao wraps action results as `{status:"success", data:"<json string>"}`,
 * where the inner JSON is `{result:"success"|"fail", message, locate}`. A plain
 * `{locate:...}` (or an HTML redirect with no JSON) also means success. We throw
 * an ApiError carrying the field messages when the inner result is "fail".
 */
export async function postAction(path: string, body: Record<string, unknown>): Promise<void> {
  const text = await request(path, { method: "POST", body });

  let inner: { result?: string; message?: unknown; locate?: unknown };
  try {
    const wrapper = JSON.parse(text);
    inner =
      wrapper.status === "success" && typeof wrapper.data === "string"
        ? JSON.parse(wrapper.data)
        : wrapper;
  } catch {
    // Non-JSON body (HTML redirect) — ZenTao treats this as success.
    return;
  }

  if (inner.result === "fail") {
    throw new ApiError(422, `ZenTao rejected the request: ${formatMessage(inner.message)}`, text);
  }
}

/** Flatten ZenTao's `message` (string | string[] | {field: string[]}) to one line. */
function formatMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.join("; ");
  if (message && typeof message === "object") {
    return Object.entries(message as Record<string, unknown>)
      .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(",") : String(msgs)}`)
      .join("; ");
  }
  return "unknown error";
}
