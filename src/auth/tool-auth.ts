import { InteractiveLoginRequiredError } from "./interactive-login.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function runAuthenticated(
  ensureSession: () => Promise<unknown>,
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    await ensureSession();
    return await action();
  } catch (error) {
    if (!(error instanceof InteractiveLoginRequiredError)) throw error;
    return {
      content: [{
        type: "text",
        text: [
          "[INTERACTIVE_LOGIN_REQUIRED]",
          "自动登录未完成，已打开可见的 SSO 登录窗口。",
          "请在窗口中完成登录，然后回复“继续”。原操作尚未执行。",
        ].join("\n"),
      }],
    };
  }
}
