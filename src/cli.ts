#!/usr/bin/env node

import { homedir } from "os";
import { join } from "path";
import { addToClient } from "./commands/add.js";
import { initConfig } from "./commands/init.js";

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "add": {
    const client = args[1];
    if (!client || !["claude", "codex"].includes(client)) {
      console.log("Usage: ahs-zentao add <claude|codex>");
      process.exit(1);
    }
    await addToClient(client as "claude" | "codex");
    break;
  }
  case "init":
    await initConfig();
    break;
  case "serve":
  case undefined:
    await import("./index.js");
    break;
  default:
    console.log(`ahs-zentao - 禅道 MCP Server

Commands:
  add claude    添加到 Claude Code
  add codex     添加到 OpenAI Codex
  init          配置禅道账号信息
  serve         启动 MCP Server

Examples:
  npx ahs-zentao add claude
  npx ahs-zentao init
`);
}
