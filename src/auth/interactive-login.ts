export interface SessionRecord {
  zentaosid: string;
  expiresAt: number;
}

export interface InteractiveWindow {
  readSessionId(): Promise<string | undefined>;
  close(): Promise<void>;
  onClosed(callback: () => void | Promise<void>): void;
}

export interface InteractiveLoginDependencies {
  openWindow(): Promise<InteractiveWindow>;
  verifySession(sid: string): Promise<boolean>;
  saveSession(session: SessionRecord): void;
  now(): number;
  schedule(callback: () => void | Promise<void>, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export type FinishLoginResult =
  | { status: "success" }
  | { status: "waiting" }
  | { status: "missing" }
  | { status: "unavailable"; message: string };

export class InteractiveLoginRequiredError extends Error {
  constructor() {
    super("Interactive SSO login is waiting for the user");
    this.name = "InteractiveLoginRequiredError";
  }
}

const INTERACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class InteractiveLoginManager {
  private window: InteractiveWindow | undefined;
  private starting: Promise<void> | undefined;
  private finishing: Promise<FinishLoginResult> | undefined;
  private timer: unknown;

  constructor(private readonly deps: InteractiveLoginDependencies) {}

  isPending(): boolean {
    return Boolean(this.window || this.starting);
  }

  async start(): Promise<void> {
    if (this.window) return;
    if (!this.starting) {
      this.starting = this.open().finally(() => {
        this.starting = undefined;
      });
    }
    await this.starting;
  }

  private async open(): Promise<void> {
    const opened = await this.deps.openWindow();
    this.window = opened;
    opened.onClosed(() => this.cleanup(opened));
    this.timer = this.deps.schedule(
      () => this.cleanup(opened),
      INTERACTIVE_TIMEOUT_MS,
    );
  }

  finish(): Promise<FinishLoginResult> {
    if (!this.finishing) {
      this.finishing = this.complete().finally(() => {
        this.finishing = undefined;
      });
    }
    return this.finishing;
  }

  private async complete(): Promise<FinishLoginResult> {
    if (this.starting) await this.starting;
    const opened = this.window;
    if (!opened) return { status: "missing" };

    try {
      const sid = await opened.readSessionId();
      if (!sid || !(await this.deps.verifySession(sid))) {
        return { status: "waiting" };
      }

      this.deps.saveSession({
        zentaosid: sid,
        expiresAt: this.deps.now() + SESSION_TTL_MS,
      });
      await this.cleanup(opened);
      return { status: "success" };
    } catch (error) {
      await this.cleanup(opened);
      return {
        status: "unavailable",
        message: error instanceof Error
          ? error.message
          : "Interactive browser is unavailable",
      };
    }
  }

  async shutdown(): Promise<void> {
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        return;
      }
    }
    if (this.finishing) await this.finishing;
    await this.cleanup();
  }

  private async cleanup(expected?: InteractiveWindow): Promise<void> {
    if (expected && this.window !== expected) return;

    const opened = this.window;
    this.window = undefined;
    if (this.timer !== undefined) {
      this.deps.cancel(this.timer);
      this.timer = undefined;
    }

    try {
      await opened?.close();
    } catch {
      // The user may already have closed the browser.
    }
  }
}
