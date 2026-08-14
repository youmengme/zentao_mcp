function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function isCasLoginUrl(candidate: string, configuredCasUrl: string): boolean {
  try {
    const current = new URL(candidate);
    const configured = new URL(configuredCasUrl);
    return (
      current.origin === configured.origin &&
      normalizePath(current.pathname) === normalizePath(configured.pathname)
    );
  } catch {
    return false;
  }
}

export interface LoginPage {
  url(): string;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
}

export interface LoginPageConfig {
  casUrl: string;
  username: string;
  password: string;
}

export async function submitConfiguredCredentials(
  page: LoginPage,
  loginConfig: LoginPageConfig,
): Promise<boolean> {
  if (!isCasLoginUrl(page.url(), loginConfig.casUrl)) return false;

  await page.fill("#username", loginConfig.username);
  await page.fill("#password", loginConfig.password);
  await page.click('button[name="submitBtn"]');
  return true;
}
