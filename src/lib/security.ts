export function safeRedirectPath(path: string | null | undefined, fallback = "/dashboard") {
  if (!path) {
    return fallback;
  }

  const trimmed = path.trim();

  if (
    !trimmed ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\r\n]/.test(trimmed)
  ) {
    return fallback;
  }

  return trimmed;
}

export function safeRedirectPathFromReferer(referer: string | null | undefined, reqUrl: string, fallback = "/dashboard") {
  if (!referer) {
    return fallback;
  }

  try {
    const requestUrl = new URL(reqUrl);
    const refererUrl = new URL(referer);

    if (refererUrl.origin !== requestUrl.origin) {
      return fallback;
    }

    const path = `${refererUrl.pathname}${refererUrl.search}`;
    return safeRedirectPath(path, fallback);
  } catch {
    return fallback;
  }
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
