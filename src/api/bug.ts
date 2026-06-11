import { getJson } from "./client.js";
import { chromium } from "playwright-core";
import { getOrRefreshSession } from "../auth/cas-login.js";
import { config } from "../config.js";
import { isDebug, log } from "../debug.js";
import { textToHtml } from "../html.js";

export interface BugListItem {
  id: string;
  title: string;
  severity: string;
  pri: string;
  type: string;
  status: string;
  assignedTo: string;
  openedBy: string;
  openedDate: string;
  resolvedBy: string;
  resolution: string;
}

export interface BugDetail extends BugListItem {
  steps: string;
  product: string;
  module: string;
  project: string;
  os: string;
  browser: string;
  deadline: string;
  openedBuild: string;
  resolvedDate: string;
  closedBy: string;
  closedDate: string;
  lastEditedBy: string;
  lastEditedDate: string;
}

interface BugBrowseResponse {
  bugs: Record<string, BugListItem>;
  pager: unknown;
}

interface MyBugResponse {
  title: string;
  bugs: BugListItem[];
}

interface BugViewResponse {
  bug: BugDetail;
}

/**
 * "我的地盘-我的Bug" — bugs related to the current logged-in user.
 * type:
 *   assignedTo — 指派给我 (default)
 *   openedBy   — 由我创建
 *   resolvedBy — 由我解决
 */
export async function getMyBugs(
  type: "assignedTo" | "openedBy" | "resolvedBy" = "assignedTo",
  limit?: number,
): Promise<BugListItem[]> {
  const data = await getJson<MyBugResponse>(`my-bug-${type}.json`);
  let bugs = data.bugs ?? [];
  if (limit) bugs = bugs.slice(0, limit);
  return bugs;
}

export async function listBugs(params: {
  productId?: number;
  projectId?: number;
  assignedTo?: string;
  status?: string;
  limit?: number;
}): Promise<BugListItem[]> {
  let path = "bug-browse";

  if (params.projectId) {
    path = `project-bug-${params.projectId}`;
  } else if (params.productId) {
    path = `bug-browse-${params.productId}`;
  }

  if (params.status) {
    path += `-0-${params.status}`;
  }

  path += ".json";

  const data = await getJson<BugBrowseResponse>(path);
  let bugs = Object.values(data.bugs ?? {});

  if (params.assignedTo) {
    bugs = bugs.filter((b) => b.assignedTo === params.assignedTo);
  }

  if (params.limit) {
    bugs = bugs.slice(0, params.limit);
  }

  return bugs;
}

export async function getBug(bugId: number): Promise<BugDetail> {
  const data = await getJson<BugViewResponse>(`bug-view-${bugId}.json`);
  return data.bug;
}

export async function resolveBug(
  bugId: number,
  resolution: string = "fixed",
  build: string = "trunk",
  comment?: string,
): Promise<{ result: string }> {
  const session = await getOrRefreshSession();
  const headless = !isDebug();
  log("resolveBug", { bugId, resolution, build, headless });
  const browser = await chromium.launch({ channel: "chrome", headless });

  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "zentaosid", value: session.zentaosid, domain: new URL(config.zentaoUrl).hostname, path: "/" },
    ]);

    const page = await context.newPage();
    await page.goto(`${config.zentaoUrl}/bug-resolve-${bugId}.html?onlybody=yes`, { waitUntil: "networkidle" });

    const commentHtml = comment ? textToHtml(comment) : "";
    await page.evaluate(
      ({ resolution, build, commentHtml }) => {
        const resSelect = document.querySelector("#resolution") as HTMLSelectElement;
        if (resSelect) {
          resSelect.value = resolution;
          resSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const buildSelect = document.querySelector("#resolvedBuild") as HTMLSelectElement;
        if (buildSelect) buildSelect.value = build;

        if (commentHtml) {
          const ke = (window as any).KindEditor;
          if (ke) {
            const keys = Object.keys(ke.instances);
            const editor = ke.instances[keys[keys.length - 1]];
            editor.html(commentHtml);
            editor.sync();
          }
        }
      },
      { resolution, build, commentHtml },
    );

    await page.click("#submit");
    await page.waitForTimeout(3000);

    return { result: "success" };
  } finally {
    await browser.close();
  }
}
