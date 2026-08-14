import {
  AuthenticationIncompleteError,
  AutomaticLoginEnvironmentError,
  normalizeAutomaticLoginError,
} from "./login-fallback.js";

export interface AutomaticLoginWindow {
  navigate(): Promise<void>;
  submitCredentials(): Promise<boolean>;
  waitForAuthenticatedPage(): Promise<void>;
  readSessionId(): Promise<string | undefined>;
  close(): Promise<void>;
  isConnected(): boolean;
}

export interface AutomaticSession {
  zentaosid: string;
  expiresAt: number;
}

export interface AutomaticLoginDependencies {
  openWindow(): Promise<AutomaticLoginWindow>;
  verifySession(sid: string): Promise<boolean>;
  saveSession(session: AutomaticSession): void;
  now(): number;
  onCleanupError?(errorType: string): void;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function performAutomaticLogin(
  deps: AutomaticLoginDependencies,
): Promise<AutomaticSession> {
  let opened: AutomaticLoginWindow | undefined;
  try {
    opened = await deps.openWindow();
    await opened.navigate();

    try {
      if (await opened.submitCredentials()) {
        await opened.waitForAuthenticatedPage();
      }
    } catch {
      throw new AuthenticationIncompleteError();
    }

    const sid = await opened.readSessionId();
    if (!sid || !(await deps.verifySession(sid))) {
      throw new AuthenticationIncompleteError();
    }

    const session: AutomaticSession = {
      zentaosid: sid,
      expiresAt: deps.now() + SESSION_TTL_MS,
    };
    deps.saveSession(session);
    return session;
  } catch (error) {
    throw normalizeAutomaticLoginError(error);
  } finally {
    try {
      await opened?.close();
    } catch (error) {
      deps.onCleanupError?.(
        error instanceof Error ? error.name : "UnknownError",
      );
      let connected = true;
      try {
        connected = opened?.isConnected() ?? false;
      } catch {
        // If connection state cannot be read, assume the browser may still live.
      }
      if (connected) throw new AutomaticLoginEnvironmentError();
    }
  }
}
