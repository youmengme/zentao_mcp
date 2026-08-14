import {
  InteractiveLoginRequiredError,
} from "./interactive-login.js";

export class AuthenticationIncompleteError extends Error {
  constructor() {
    super("Automatic SSO authentication did not complete");
    this.name = "AuthenticationIncompleteError";
  }
}

export class AutomaticLoginEnvironmentError extends Error {
  constructor() {
    super("Automatic SSO login is unavailable");
    this.name = "AutomaticLoginEnvironmentError";
  }
}

export class InteractiveLoginEnvironmentError extends Error {
  constructor() {
    super("Unable to open the visible SSO login browser");
    this.name = "InteractiveLoginEnvironmentError";
  }
}

export function normalizeAutomaticLoginError(error: unknown): Error {
  if (error instanceof AuthenticationIncompleteError) return error;
  if (error instanceof AutomaticLoginEnvironmentError) return error;
  return new AutomaticLoginEnvironmentError();
}

export async function runWithInteractiveLoginFallback<T>(
  automaticLogin: () => Promise<T>,
  startInteractiveLogin: () => Promise<void>,
): Promise<T> {
  try {
    return await automaticLogin();
  } catch (error) {
    if (!(error instanceof AuthenticationIncompleteError)) throw error;

    try {
      await startInteractiveLogin();
    } catch {
      throw new InteractiveLoginEnvironmentError();
    }
    throw new InteractiveLoginRequiredError();
  }
}
