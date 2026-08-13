import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Playwright drives CAS login and ZenTao write forms", () => {
  const pkg = JSON.parse(read("package.json"));
  const login = read("src/auth/cas-login.ts");
  const bug = read("src/api/bug.ts");
  const comment = read("src/api/comment.ts");

  assert.equal(pkg.dependencies["playwright-core"], "^1.52.0");
  assert.match(login, /chromium\.launch\(\{ channel: "chrome", headless \}\)/);
  assert.match(bug, /bug-resolve-\$\{bugId\}\.html\?onlybody=yes/);
  assert.match(comment, /bug-edit-\$\{bugId\}\.html/);
  assert.doesNotMatch(bug, /postAction\(/);
  assert.doesNotMatch(comment, /postAction\(/);
});
