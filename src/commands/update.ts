import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export async function update(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const currentVersion = pkg.version;

  console.log(`当前版本: ${currentVersion}`);
  console.log("检查更新中...");

  try {
    const latest = execSync("npm view ahs-zentao version --registry https://registry.npmjs.com", {
      encoding: "utf-8",
    }).trim();

    if (latest === currentVersion) {
      console.log("✅ 已是最新版本");
    } else {
      console.log(`发现新版本: ${latest}`);
      console.log("正在升级...");
      execSync("npm install -g ahs-zentao@latest --registry https://registry.npmjs.com", {
        stdio: "inherit",
      });
      console.log(`✅ 已升级到 ${latest}`);
    }
  } catch (err) {
    console.error("检查更新失败，请检查网络连接");
    process.exit(1);
  }
}
