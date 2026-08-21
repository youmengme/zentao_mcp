import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { config as dotenvConfig } from "dotenv";

const globalEnvPath = join(homedir(), ".ahs-zentao", ".env");

if (existsSync(globalEnvPath)) {
  dotenvConfig({ path: globalEnvPath });
}

function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}. Run "npx ahs-zentao init" to configure.`);
  return value;
}

export const config = {
  zentaoUrl: env("ZENTAO_URL").replace(/\/+$/, ""),
  casUrl: env("CAS_URL"),
  username: env("ZENTAO_USER"),
  password: env("ZENTAO_PASSWORD"),
  sessionFile: join(homedir(), ".ahs-zentao", "session.json"),
};
