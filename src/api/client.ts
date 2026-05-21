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
    body = new URLSearchParams(
      options.body as Record<string, string>,
    ).toString();
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

export async function postForm<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const text = await request(path, { method: "POST", body });
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some zentao actions return HTML redirect on success
    return { result: "success" } as T;
  }
}
