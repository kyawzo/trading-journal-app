"use client";

import Link from "next/link";
import { useState } from "react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Don't prevent default - let form submit naturally
    // (preventing it disabled the fieldset, which prevented fields from being sent)
    setIsSubmitting(true);
  }

  return (
    <form method="POST" action="/api/auth/login" className="space-y-6" onSubmit={handleSubmit} aria-busy={isSubmitting}>
      <input type="hidden" name="next" value={nextPath} />

      <fieldset className="space-y-6" disabled={false}>
        <label className="field-stack">
          <span className="field-label">Email</span>
          <input name="email" type="email" className="input-field" placeholder="you@example.com" autoComplete="email" required />
        </label>

        <label className="field-stack">
          <span className="field-label">Password</span>
          <input name="password" type="password" className="input-field" placeholder="Your password" autoComplete="current-password" required />
        </label>
      </fieldset>

      <div className="hero-actions mt-4">
        <button className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
        <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className={isSubmitting ? "btn-ghost pointer-events-none opacity-60" : "btn-ghost"}>
          Create Account
        </Link>
      </div>
    </form>
  );
}

