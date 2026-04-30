import Link from "next/link";

type PaginationControlsProps = {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  makeHref: (page: number) => string;
};

export function PaginationControls({
  page,
  totalPages,
  totalCount,
  pageSize,
  makeHref,
}: PaginationControlsProps) {
  if (totalCount === 0) {
    return null;
  }

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalCount, page * pageSize);
  const pagesToShow = Array.from(
    new Set([1, page - 2, page - 1, page, page + 1, page + 2, totalPages].filter((value) => value >= 1 && value <= totalPages)),
  ).sort((a, b) => a - b);

  return (
    <div className="panel section-stack">
      <div className="item-row justify-between">
        <p className="note">
          Showing {start}-{end} of {totalCount}
        </p>

        <div className="item-row">
          <Link
            href={makeHref(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={page <= 1 ? "btn-ghost pointer-events-none opacity-50" : "btn-ghost"}
          >
            Previous
          </Link>
          <span className="chip-neutral">
            Page {page} / {totalPages}
          </span>
          <Link
            href={makeHref(Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={page >= totalPages ? "btn-ghost pointer-events-none opacity-50" : "btn-ghost"}
          >
            Next
          </Link>
        </div>
      </div>

      <div className="item-row">
        {pagesToShow.map((pageNumber) => (
          <Link key={pageNumber} href={makeHref(pageNumber)} className={pageNumber === page ? "btn-primary" : "btn-ghost"}>
            {pageNumber}
          </Link>
        ))}
      </div>
    </div>
  );
}
