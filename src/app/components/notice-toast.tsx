"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type NoticeToastProps = {
  notice?: string;
  tone?: string;
};

export function NoticeToast({ notice, tone }: NoticeToastProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("notice");
      nextParams.delete("tone");

      const nextUrl = nextParams.toString()
        ? `${pathname}?${nextParams.toString()}`
        : pathname;

      router.replace(nextUrl, { scroll: false });
    }, 3800);

    return () => window.clearTimeout(timeout);
  }, [notice, pathname, router, searchParams]);

  if (!notice) {
    return null;
  }

  return (
    <section className={tone === "error" ? "alert-error" : "alert-success"} role="status" aria-live="polite">
      <p className="font-semibold">{tone === "error" ? "Something needs attention" : "Update completed"}</p>
      <p className="mt-1 text-sm">{notice}</p>
    </section>
  );
}
