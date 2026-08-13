import { getJson, getBinary } from "./client.js";
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

/** An image embedded in a bug's steps/comments or attached to it. */
export interface BugImageRef {
  fileId: number;
  filename: string; // e.g. "134868.png"
  url: string; // download path, e.g. "file-read-134868.png"
  source: "steps" | "comment" | "attachment";
}

export interface BugDetail extends BugListItem {
  steps: string;
  /** Image references gathered from steps, comment history, and attachments. */
  images: BugImageRef[];
  /** Raw ZenTao attachment list (shape varies); parsed into `images`. */
  files?: unknown;
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
  /** Action/comment history — array or id-keyed object depending on ZenTao build. */
  actions?: unknown;
}

const IMAGE_EXT = /^(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Pull `file-read-<id>.<ext>` image references out of a chunk of ZenTao HTML. */
function extractInlineImages(html: string | undefined, source: BugImageRef["source"]): BugImageRef[] {
  if (!html) return [];
  const refs: BugImageRef[] = [];
  const re = /file-read-(\d+)\.([a-z0-9]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!IMAGE_EXT.test(m[2])) continue;
    const filename = `${m[1]}.${m[2]}`;
    refs.push({ fileId: Number(m[1]), filename, url: `file-read-${filename}`, source });
  }
  return refs;
}

function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
}

/**
 * Collect every image tied to a bug: inline images in the steps, inline images
 * in comment history, and explicit file attachments. KindEditor-embedded images
 * never show up in `bug.files`, so the inline scan is the main source; the
 * attachment list adds screenshots uploaded as files. Deduped by fileId.
 */
function collectImages(bug: BugDetail, actions: unknown): BugImageRef[] {
  const refs: BugImageRef[] = [...extractInlineImages(bug.steps, "steps")];

  for (const a of toList(actions) as Array<{ comment?: string }>) {
    refs.push(...extractInlineImages(a?.comment, "comment"));
  }

  for (const f of toList(bug.files) as Array<{ id?: number | string; extension?: string }>) {
    if (f?.id == null || !f.extension || !IMAGE_EXT.test(f.extension)) continue;
    const filename = `${f.id}.${f.extension.toLowerCase()}`;
    refs.push({ fileId: Number(f.id), filename, url: `file-read-${filename}`, source: "attachment" });
  }

  const seen = new Set<number>();
  return refs.filter((r) => (seen.has(r.fileId) ? false : seen.add(r.fileId) && true));
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
  const bug = data.bug;
  bug.images = collectImages(bug, data.actions);
  return bug;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/**
 * Download one image belonging to a bug. The fileId comes from getBug()'s
 * `images` list; we re-resolve it there to validate ownership and recover the
 * filename/extension, then fetch the bytes with the session cookie.
 */
export async function getBugImage(
  bugId: number,
  fileId: number,
): Promise<{ data: Buffer; mimeType: string; filename: string }> {
  log("getBugImage", { bugId, fileId });
  const bug = await getBug(bugId);
  const ref = bug.images.find((i) => i.fileId === fileId);
  if (!ref) {
    const available = bug.images.map((i) => i.fileId).join(", ") || "none";
    throw new Error(`Bug #${bugId} has no image with fileId ${fileId} (available: ${available})`);
  }

  const { data, contentType } = await getBinary(ref.url);
  const ext = ref.filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = contentType.startsWith("image/") ? contentType : MIME_BY_EXT[ext] ?? "application/octet-stream";
  return { data, mimeType, filename: ref.filename };
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
