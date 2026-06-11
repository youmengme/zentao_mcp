import { chromium } from "playwright-core";
import { getOrRefreshSession } from "../auth/cas-login.js";
import { config } from "../config.js";
import { textToHtml } from "../html.js";

export async function addComment(
  bugId: number,
  comment: string,
): Promise<{ result: string }> {
  const session = await getOrRefreshSession();
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "zentaosid", value: session.zentaosid, domain: new URL(config.zentaoUrl).hostname, path: "/" },
    ]);

    const page = await context.newPage();
    await page.goto(`${config.zentaoUrl}/bug-edit-${bugId}.html`, { waitUntil: "networkidle" });

    await page.evaluate((text) => {
      const ke = (window as any).KindEditor;
      const keys = Object.keys(ke.instances);
      for (const key of keys) {
        const editor = ke.instances[key];
        if (editor.srcElement?.attr("id") === "comment") {
          editor.html(text);
          editor.sync();
          return;
        }
      }
      // fallback: use last editor
      const last = ke.instances[keys[keys.length - 1]];
      last.html(text);
      last.sync();
    }, textToHtml(comment));

    await page.click('button[type="submit"], #submit');
    await page.waitForURL(/bug-view/, { timeout: 10000 }).catch(() => {});

    return { result: "success" };
  } finally {
    await browser.close();
  }
}

