#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { casLogin, loadSession } from "./auth/cas-login.js";
import { listBugs, getBug, resolveBug, getMyBugs } from "./api/bug.js";
import { addComment } from "./api/comment.js";

const server = new McpServer({
  name: "zentao",
  version: "0.1.0",
});

// ---------- Tool: Login ----------

server.tool(
  "zentao_login",
  "Login to ZenTao via CAS SSO. Returns session status.",
  {},
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
    // Ensure logged in
    await loadSession() || await casLogin();

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
    await loadSession() || await casLogin();

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
    await loadSession() || await casLogin();

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

    return { content: [{ type: "text", text: lines.join("\n") }] };
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
    comment: z.string().optional().describe("Comment/备注: describe what was fixed, impact, and side effects"),
  },
  async ({ bugId, resolution, build, comment }) => {
    await loadSession() || await casLogin();

    await resolveBug(bugId, resolution, build, comment);
    return {
      content: [{ type: "text", text: `Bug #${bugId} resolved as "${resolution}".` }],
    };
  },
);

// ---------- Tool: Add Comment ----------

server.tool(
  "zentao_add_comment",
  "Add a comment to a bug in ZenTao.",
  {
    bugId: z.number().describe("Bug ID to comment on"),
    content: z.string().describe("Comment content"),
  },
  async ({ bugId, content }) => {
    await loadSession() || await casLogin();

    await addComment(bugId, content);
    return {
      content: [{ type: "text", text: `Comment added to Bug #${bugId}.` }],
    };
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
