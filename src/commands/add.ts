import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join, dirname } from "path";

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
}

function readJsonFile(path: string): McpConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function installGlobally(): void {
  console.log("正在全局安装 ahs-zentao...");
  try {
    execSync("npm install -g ahs-zentao --registry https://registry.npmjs.com", {
      stdio: "inherit",
    });
  } catch {
    console.log("⚠️  全局安装失败，将使用 npx 方式启动");
  }
}

function isInstalledGlobally(): boolean {
  try {
    execSync("which ahs-zentao", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function addToClient(client: "claude" | "codex"): Promise<void> {
  if (!isInstalledGlobally()) {
    installGlobally();
  }

  const serverEntry = isInstalledGlobally()
    ? { command: "ahs-zentao", args: ["serve"] }
    : { command: "npx", args: ["-y", "ahs-zentao", "serve"] };

  const configPath =
    client === "claude"
      ? join(homedir(), ".claude", ".mcp.json")
      : join(process.cwd(), ".codex", "config.json");

  const config = readJsonFile(configPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.zentao = serverEntry;
  writeJsonFile(configPath, config);

  console.log(`✅ 已添加 zentao MCP Server 到 ${configPath}`);
  console.log("");

  const globalEnv = join(homedir(), ".ahs-zentao", ".env");
  if (!existsSync(globalEnv)) {
    console.log("⚠️  尚未配置禅道账号，请运行：");
    console.log("   npx ahs-zentao init");
  } else {
    console.log("🎉 配置完成，重启 " + (client === "claude" ? "Claude Code" : "Codex") + " 即可使用");
  }
}
