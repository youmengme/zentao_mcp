import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DEBUG_FILE = join(homedir(), ".ahs-zentao", "debug.json");

interface DebugConfig {
  enabled: boolean;
}

function load(): DebugConfig {
  if (!existsSync(DEBUG_FILE)) return { enabled: false };
  try {
    return JSON.parse(readFileSync(DEBUG_FILE, "utf-8"));
  } catch {
    return { enabled: false };
  }
}

function save(cfg: DebugConfig): void {
  writeFileSync(DEBUG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

export function isDebug(): boolean {
  return load().enabled;
}

export function toggleDebug(): boolean {
  const cfg = load();
  cfg.enabled = !cfg.enabled;
  save(cfg);
  return cfg.enabled;
}

export function log(...args: unknown[]): void {
  if (isDebug()) {
    console.error("[DEBUG]", ...args);
  }
}
