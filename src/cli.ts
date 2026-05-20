#!/usr/bin/env node

import { homedir } from "os";
import { join } from "path";
import { addToClient } from "./commands/add.js";
import { initConfig } from "./commands/init.js";
import { update } from "./commands/update.js";

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
  case "update":
    await update();
    break;
  case "version":
  case "-v":
  case "--version": {
    const { readFileSync } = await import("fs");
    const { dirname, join } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    console.log(pkg.version);
    break;
  }
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
  update        检查并升级到最新版本
  serve         启动 MCP Server

Examples:
  npx ahs-zentao add claude
  npx ahs-zentao init
  npx ahs-zentao update
`);
}
