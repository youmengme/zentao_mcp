import { existsSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

const CONFIG_DIR = join(homedir(), ".ahs-zentao");
const ENV_PATH = join(CONFIG_DIR, ".env");

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function initConfig(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("配置禅道 MCP Server 账号信息\n");

  const zentaoUrl = await ask(rl, "禅道地址 (如 http://zentao.xxx.com/zentao/): ");
  const casUrl = await ask(rl, "CAS 登录地址 (如 https://sso.xxx.com/cas/login): ");
  const user = await ask(rl, "用户名: ");
  const password = await ask(rl, "密码: ");

  rl.close();

  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  const content = [
    `ZENTAO_URL=${zentaoUrl}`,
    `CAS_URL=${casUrl}`,
    `ZENTAO_USER=${user}`,
    `ZENTAO_PASSWORD=${password}`,
    "",
  ].join("\n");

  writeFileSync(ENV_PATH, content);
  console.log(`\n✅ 配置已保存到 ${ENV_PATH}`);
}
