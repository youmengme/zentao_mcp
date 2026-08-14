#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  casLogin,
  finishInteractiveLogin,
  loadSession,
  shutdownInteractiveLogin,
} from "./auth/cas-login.js";
import { listBugs, getBug, getBugImage, resolveBug, getMyBugs } from "./api/bug.js";
import { addComment } from "./api/comment.js";
import { runAuthenticated } from "./auth/tool-auth.js";

const server = new McpServer({
  name: "zentao",
  version: "0.1.0",
});

async function ensureSession() {
  return (await loadSession()) ?? casLogin();
}

let shuttingDown = false;
async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await shutdownInteractiveLogin();
  process.exit(signal === "SIGTERM" ? 143 : 130);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

// ---------- Tool: Login ----------

server.tool(
  "zentao_login",
  "Login to ZenTao via CAS SSO. Returns session status.",
  {},
  async () => {
    return runAuthenticated(
      async () => {},
      async () => {
        const session = await casLogin();
        return {
          content: [
            {
              type: "text",
              text: `Login successful. Session expires at ${new Date(session.expiresAt).toISOString()}`,
            },
          ],
        };
      },
    );
  },
);

// ---------- Tool: Finish Interactive Login ----------

server.tool(
  "zentao_finish_login",
  "Finish a visible interactive SSO login. Call this when the user says they completed login or replies '继续'.",
  {},
  async () => {
    const result = await finishInteractiveLogin();
    switch (result.status) {
      case "success":
        return {
          content: [{
            type: "text",
            text: "登录验证成功，session 已保存，浏览器已关闭。请继续执行用户原先的禅道操作。",
          }],
        };
      case "waiting":
        return {
          content: [{
            type: "text",
            text: "登录尚未完成，请继续在已打开的浏览器中操作，完成后再次回复“继续”。",
          }],
        };
      case "missing":
        return {
          content: [{
            type: "text",
            text: "交互登录窗口不存在或已超时，请重新执行原先的禅道操作以发起登录。",
          }],
        };
      case "unavailable":
        return {
          content: [{
            type: "text",
            text: `交互登录浏览器不可用，窗口已清理：${result.message}`,
          }],
          isError: true,
        };
    }
  },
);

// ---------- Tool: List Bugs ----------

server.tool(
  "zentao_list_bugs",
  "List bugs from ZenTao. Optionally filter by product, project, assignee, or status.",
  {
    productId: z.number().optional().describe("Product ID to filter bugs"),
    projectId: z.number().optional().describe("Project ID to filter bugs"),
    assignedTo: z.string().optional().describe("Username to filter assigned bugs"),
    status: z.string().optional().describe("Bug status filter (active, resolved, closed)"),
    limit: z.number().optional().default(20).describe("Max number of bugs to return"),
  },
  async (params) => {
    return runAuthenticated(ensureSession, async () => {
      const bugs = await listBugs(params);
      if (bugs.length === 0) {
        return { content: [{ type: "text", text: "No bugs found." }] };
      }

      const text = bugs
        .map(
          (b) =>
            `#${b.id} [${b.status}] P${b.pri} S${b.severity} — ${b.title}\n  Assigned: ${b.assignedTo} | Opened: ${b.openedBy} ${b.openedDate}`,
        )
        .join("\n\n");

      return { content: [{ type: "text", text }] };
    });
  },
);

// ---------- Tool: My Bugs ----------

server.tool(
  "zentao_my_bugs",
  "Get bugs related to the current logged-in user (我的地盘-我的Bug). Defaults to bugs assigned to me.",
  {
    type: z
      .enum(["assignedTo", "openedBy", "resolvedBy"])
      .optional()
      .default("assignedTo")
      .describe("Which set of my bugs: assignedTo(指派给我), openedBy(由我创建), resolvedBy(由我解决)"),
    limit: z.number().optional().default(50).describe("Max number of bugs to return"),
  },
  async ({ type, limit }) => {
    return runAuthenticated(ensureSession, async () => {
      const bugs = await getMyBugs(type, limit);
      if (bugs.length === 0) {
        return { content: [{ type: "text", text: "No bugs found." }] };
      }

      const text = bugs
        .map(
          (b) =>
            `#${b.id} [${b.status}] P${b.pri} S${b.severity} — ${b.title}\n  Assigned: ${b.assignedTo} | Opened: ${b.openedBy} ${b.openedDate}`,
        )
        .join("\n\n");

      return { content: [{ type: "text", text: `${bugs.length} bug(s):\n\n${text}` }] };
    });
  },
);

// ---------- Tool: Get Bug ----------

server.tool(
  "zentao_get_bug",
  "Get detailed information about a specific bug.",
  {
    bugId: z.number().describe("Bug ID"),
  },
  async ({ bugId }) => {
    return runAuthenticated(ensureSession, async () => {
      const bug = await getBug(bugId);
      const lines = [
        `Bug #${bug.id}: ${bug.title}`,
        `Status: ${bug.status} | Severity: ${bug.severity} | Priority: ${bug.pri}`,
        `Type: ${bug.type}`,
        `Assigned To: ${bug.assignedTo}`,
        `Opened By: ${bug.openedBy} at ${bug.openedDate}`,
        `Product: ${bug.product} | Module: ${bug.module}`,
        bug.resolvedBy ? `Resolved By: ${bug.resolvedBy} (${bug.resolution})` : null,
        `--- Steps ---`,
        bug.steps,
      ].filter(Boolean);

      if (bug.images.length > 0) {
        lines.push(`--- 图片附件 (${bug.images.length}) ---`);
        for (const img of bug.images) {
          lines.push(`  - fileId=${img.fileId}  ${img.filename}  (来源: ${img.source})`);
        }
        lines.push(`提示: 用 zentao_get_bug_image(bugId=${bug.id}, fileId=...) 读取图片内容。`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    });
  },
);

// ---------- Tool: Get Bug Image ----------

server.tool(
  "zentao_get_bug_image",
  "Download and view an image embedded in or attached to a bug. Use a fileId from the image attachment list returned by zentao_get_bug.",
  {
    bugId: z.number().describe("Bug ID the image belongs to"),
    fileId: z.number().describe("Image fileId from the bug's attachment list (e.g. 134868)"),
  },
  async ({ bugId, fileId }) => {
    return runAuthenticated(ensureSession, async () => {
      const { data, mimeType, filename } = await getBugImage(bugId, fileId);
      return {
        content: [
          { type: "text", text: `${filename} (${mimeType}, ${data.length} bytes)` },
          { type: "image", data: data.toString("base64"), mimeType },
        ],
      };
    });
  },
);

// ---------- Tool: Resolve Bug ----------

server.tool(
  "zentao_resolve_bug",
  "Resolve a bug in ZenTao.",
  {
    bugId: z.number().describe("Bug ID to resolve"),
    resolution: z
      .enum(["fixed", "bydesign", "data", "duplicate", "external", "notrepro", "postponed", "willnotfix", "c2b", "xuqiu", "bushiwenti", "config", "prodbug"])
      .optional()
      .default("fixed")
      .describe("Resolution type: fixed(已解决), bydesign(设计如此), data(数据原因), duplicate(重复Bug), external(外部原因), notrepro(无法重现), postponed(延期处理), willnotfix(不予解决), c2b(C端问题), xuqiu(转为需求), bushiwenti(不是问题), config(配置问题), prodbug(线上问题)"),
    build: z.string().optional().default("trunk").describe("Build version (default: trunk/主干)"),
    comment: z.string().optional().describe("备注(给测试人员看,非代码细节): 用通俗语言说明本次修改的影响范围、测试时需要重点回归/关注的功能点。面向测试视角,不要罗列代码改动。支持多行,空行分段、单换行会转为 <br/>。"),
  },
  async ({ bugId, resolution, build, comment }) => {
    return runAuthenticated(ensureSession, async () => {
      await resolveBug(bugId, resolution, build, comment);
      return {
        content: [{ type: "text", text: `Bug #${bugId} resolved as "${resolution}".` }],
      };
    });
  },
);

// ---------- Tool: Add Comment ----------

server.tool(
  "zentao_add_comment",
  "Add a comment to a bug in ZenTao.",
  {
    bugId: z.number().describe("Bug ID to comment on"),
    content: z.string().describe("Comment content. 支持多行: 空行分段, 单个换行会转为 <br/>。"),
  },
  async ({ bugId, content }) => {
    return runAuthenticated(ensureSession, async () => {
      await addComment(bugId, content);
      return {
        content: [{ type: "text", text: `Comment added to Bug #${bugId}.` }],
      };
    });
  },
);

// ---------- Start ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
