import { getJson, postAction } from "./client.js";
import { log } from "../debug.js";
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
  branch: string;
  plan: string;
  story: string;
  task: string;
  os: string;
  browser: string;
  keywords: string;
  deadline: string;
  openedBuild: string;
  resolvedBuild: string;
  resolvedDate: string;
  duplicateBug: string;
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

/**
 * Resolve a bug via a plain HTTP POST (no browser needed).
 *
 * ZenTao's bug->resolve only writes the fields we post (resolvedBy/resolvedDate/
 * assignedTo default server-side), so a minimal payload is safe. We must NOT send
 * `createBuild`, or ZenTao tries to create a new build and demands buildName.
 * The `comment` is recorded in the bug's action history.
 */
export async function resolveBug(
  bugId: number,
  resolution: string = "fixed",
  build: string = "trunk",
  comment?: string,
): Promise<{ result: string }> {
  log("resolveBug", { bugId, resolution, build });

  const body: Record<string, unknown> = {
    resolution,
    resolvedBuild: build,
  };
  if (comment) body.comment = textToHtml(comment);

  await postAction(`bug-resolve-${bugId}.json`, body);
  return { result: "success" };
}
