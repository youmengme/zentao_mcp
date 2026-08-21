import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("loads Zentao settings only from the global env when cwd has a conflicting .env", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "ahs-zentao-config-"));
  const testHome = join(testRoot, "home");
  const workingDirectory = join(testRoot, "project");
  const globalConfigDirectory = join(testHome, ".ahs-zentao");

  mkdirSync(globalConfigDirectory, { recursive: true });
  mkdirSync(workingDirectory, { recursive: true });
  writeFileSync(
    join(globalConfigDirectory, ".env"),
    [
      "ZENTAO_URL=https://zentao.example.com/",
      "CAS_URL=https://cas.example.com",
      "ZENTAO_USER=test-user",
      "ZENTAO_PASSWORD=test-password",
    ].join("\n"),
  );
  writeFileSync(
    join(workingDirectory, ".env"),
    [
      "ZENTAO_URL=https://local-zentao.example.com/",
      "CAS_URL=https://local-cas.example.com",
      "ZENTAO_USER=local-user",
      "ZENTAO_PASSWORD=local-password",
    ].join("\n"),
  );

  const {
    ZENTAO_URL: _zentaoUrl,
    CAS_URL: _casUrl,
    ZENTAO_USER: _zentaoUser,
    ZENTAO_PASSWORD: _zentaoPassword,
    ...cleanEnvironment
  } = process.env;
  const configModuleUrl = pathToFileURL(resolve("dist/config.js")).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { config } = await import(${JSON.stringify(configModuleUrl)}); console.log(JSON.stringify(config));`,
    ],
    {
      cwd: workingDirectory,
      env: { ...cleanEnvironment, HOME: testHome },
      encoding: "utf8",
    },
  );

  try {
    assert.equal(child.status, 0, child.stderr);
    const loadedConfig = JSON.parse(child.stdout);
    assert.equal(loadedConfig.zentaoUrl, "https://zentao.example.com");
    assert.equal(loadedConfig.casUrl, "https://cas.example.com");
    assert.equal(loadedConfig.username, "test-user");
    assert.equal(loadedConfig.password, "test-password");
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
