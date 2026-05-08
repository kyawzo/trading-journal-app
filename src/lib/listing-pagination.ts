export const DEFAULT_PAGE = 1;

export function buildListingHref(
  pathname: string,
  entries: Array<[string, string | number | null | undefined]>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of entries) {
    if (value === null || value === undefined) {
      continue;
    }

    const normalized = typeof value === "number" ? String(value) : value;
    if (normalized === "") {
      continue;
    }

    params.set(key, normalized);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function normalizePage(totalCount: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  return Math.min(Math.max(page, 1), totalPages);
}

export function paginationMeta(totalCount: number, page: number, pageSize: number) {
  const safePage = normalizePage(totalCount, page, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const skip = (safePage - 1) * pageSize;

  return {
    totalCount,
    totalPages,
    page: safePage,
    pageSize,
    skip,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
  };
}

