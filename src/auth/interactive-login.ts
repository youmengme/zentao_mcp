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
  shutdownGraceMs?: number;
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
  private generation = 0;

  constructor(private readonly deps: InteractiveLoginDependencies) {}

  isPending(): boolean {
    return Boolean(this.window || this.starting);
  }

  async start(): Promise<void> {
    if (this.window) return;
    if (!this.starting) {
      const generation = this.generation;
      let tracked: Promise<void>;
      tracked = this.open(generation).finally(() => {
        if (this.starting === tracked) this.starting = undefined;
      });
      this.starting = tracked;
    }
    await this.starting;
  }

  private async open(generation: number): Promise<void> {
    const opened = await this.deps.openWindow();
    if (generation !== this.generation) {
      await opened.close().catch(() => {});
      return;
    }

    this.window = opened;
    opened.onClosed(() => this.cleanup(opened));
    this.timer = this.deps.schedule(
      () => this.cleanup(opened),
      INTERACTIVE_TIMEOUT_MS,
    );
  }

  finish(): Promise<FinishLoginResult> {
    if (!this.finishing) {
      let tracked: Promise<FinishLoginResult>;
      tracked = this.complete().finally(() => {
        if (this.finishing === tracked) this.finishing = undefined;
      });
      this.finishing = tracked;
    }
    return this.finishing;
  }

  private async complete(): Promise<FinishLoginResult> {
    let opened: InteractiveWindow | undefined;
    try {
      if (this.starting) await this.starting;
      opened = this.window;
      if (!opened) return { status: "missing" };

      const sid = await opened.readSessionId();
      if (this.window !== opened) return { status: "missing" };
      if (!sid) return { status: "waiting" };

      const verified = await this.deps.verifySession(sid);
      if (this.window !== opened) return { status: "missing" };
      if (!verified) {
        return { status: "waiting" };
      }

      this.deps.saveSession({
        zentaosid: sid,
        expiresAt: this.deps.now() + SESSION_TTL_MS,
      });
      await this.cleanup(opened);
      return { status: "success" };
    } catch {
      if (!opened) {
        return {
          status: "unavailable",
          message: "Interactive browser session is unavailable",
        };
      }
      if (this.window !== opened) return { status: "missing" };
      await this.cleanup(opened);
      return {
        status: "unavailable",
        message: "Interactive browser session is unavailable",
      };
    }
  }

  async shutdown(): Promise<void> {
    const starting = this.starting;
    this.starting = undefined;
    this.finishing = undefined;
    await this.cleanup();
    if (starting) await this.waitForStartupDuringShutdown(starting);
  }

  private waitForStartupDuringShutdown(starting: Promise<void>): Promise<void> {
    const graceMs = this.deps.shutdownGraceMs ?? 2_000;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, graceMs);
      void starting.then(finish, finish);
    });
  }

  private async cleanup(expected?: InteractiveWindow): Promise<void> {
    if (expected && this.window !== expected) return;

    this.generation += 1;
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
