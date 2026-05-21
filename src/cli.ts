#!/usr/bin/env node

import { addToClient, SUPPORTED_CLIENTS } from "./commands/add.js";
import { initConfig } from "./commands/init.js";
import { update } from "./commands/update.js";
import { toggleDebug, isDebug } from "./debug.js";

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "add": {
    const client = args[1];
    if (!client || !SUPPORTED_CLIENTS.includes(client)) {
      console.log(`Usage: ahs-zentao add <${SUPPORTED_CLIENTS.join("|")}> [-g]`);
      process.exit(1);
    }
    const local = !args.includes("-g");
    await addToClient(client, local);
    break;
  }
  case "init":
    await initConfig();
    break;
  case "update":
    await update();
    break;
  case "debug": {
    const enabled = toggleDebug();
    console.log(`Debug 模式已${enabled ? "开启" : "关闭"}`);
    if (enabled) {
      console.log("  - Playwright 将以有头模式运行（可看到浏览器）");
      console.log("  - API 请求和响应将输出详细日志");
    }
    break;
  }
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
  add <client> [-g]  添加到 AI 客户端 (支持: ${SUPPORTED_CLIENTS.join(", ")})
                     -g 安装到全局配置，不加则安装到当前项目
  init               配置禅道账号信息
  update             检查并升级到最新版本
  debug              切换 debug 模式（有头浏览器 + 详细日志）
  serve              启动 MCP Server

Examples:
  npx ahs-zentao add claude -g    全局添加到 Claude Code
  npx ahs-zentao add codex -g     全局添加到 OpenAI Codex
  npx ahs-zentao add cursor       添加到当前项目的 Cursor 配置
  npx ahs-zentao debug            开启/关闭 debug 模式
  npx ahs-zentao init
`);
}
