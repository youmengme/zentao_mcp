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
