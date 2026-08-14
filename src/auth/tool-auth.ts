import { InteractiveLoginRequiredError } from "./interactive-login.js";
import {
  AutomaticLoginEnvironmentError,
  InteractiveLoginEnvironmentError,
} from "./login-fallback.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function runAuthenticated(
  ensureSession: () => Promise<unknown>,
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    await ensureSession();
    return await action();
  } catch (error) {
    if (error instanceof AutomaticLoginEnvironmentError) {
      return {
        content: [{
          type: "text",
          text: [
            "[AUTOMATIC_LOGIN_UNAVAILABLE]",
            "自动登录因浏览器、网络、服务端或本地会话存储异常而未完成，请检查运行环境后重试。",
          ].join("\n"),
        }],
        isError: true,
      };
    }
    if (error instanceof InteractiveLoginEnvironmentError) {
      return {
        content: [{
          type: "text",
          text: [
            "[INTERACTIVE_LOGIN_UNAVAILABLE]",
            "自动登录未完成，但无法打开可见的 SSO 登录窗口。请确认本机已安装 Chrome 并重试。",
          ].join("\n"),
        }],
        isError: true,
      };
    }
    if (!(error instanceof InteractiveLoginRequiredError)) throw error;
    return {
      content: [{
        type: "text",
        text: [
          "[INTERACTIVE_LOGIN_REQUIRED]",
          "自动登录未完成，已打开可见的 SSO 登录窗口。",
          "请在窗口中完成登录，然后回复“继续”。收到回复后请调用 zentao_finish_login；原操作尚未执行。",
        ].join("\n"),
      }],
    };
  }
}
