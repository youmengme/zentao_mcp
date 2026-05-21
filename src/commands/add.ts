import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

const CLIENT_MAP: Record<string, string> = {
  claude: "claude-code",
  codex: "codex",
  cursor: "cursor",
  windsurf: "windsurf",
  gemini: "gemini-cli",
};

export const SUPPORTED_CLIENTS = Object.keys(CLIENT_MAP);

export async function addToClient(client: string, local = false): Promise<void> {
  const installMcpClient = CLIENT_MAP[client];
  if (!installMcpClient) {
    console.log(`不支持的客户端: ${client}`);
    console.log(`支持的客户端: ${SUPPORTED_CLIENTS.join(", ")}`);
    process.exit(1);
  }

  const args = [
    "-y", "install-mcp@latest",
    "ahs-zentao serve",
    "--client", installMcpClient,
    "--name", "zentao",
    "-y",
  ];
  if (local) {
    args.push("--local");
  }

  console.log(`正在添加 zentao MCP Server 到 ${installMcpClient}${local ? " (本地)" : " (全局)"}...`);

  const result = spawnSync("npx", args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.log("❌ 添加失败，请检查 install-mcp 是否可用");
    process.exit(1);
  }

  const globalEnv = join(homedir(), ".ahs-zentao", ".env");
  if (!existsSync(globalEnv)) {
    console.log("");
    console.log("⚠️  尚未配置禅道账号，请运行：");
    console.log("   npx ahs-zentao init");
  }
}
