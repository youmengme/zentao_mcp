import "dotenv/config";
import { homedir } from "os";
import { join } from "path";

function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

export const config = {
  zentaoUrl: env("ZENTAO_URL").replace(/\/+$/, ""),
  casUrl: env("CAS_URL"),
  username: env("ZENTAO_USER"),
  password: env("ZENTAO_PASSWORD"),
  sessionFile: join(homedir(), ".zentao-session"),
};
