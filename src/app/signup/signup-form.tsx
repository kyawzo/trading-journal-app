"use client";

import Link from "next/link";
import { useState } from "react";

export function SignupForm({ nextPath }: { nextPath: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit() {
    setIsSubmitting(true);
  }

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-6" onSubmit={handleSubmit} aria-busy={isSubmitting}>
      <input type="hidden" name="next" value={nextPath} />

      <fieldset className="space-y-6">
        <label className="field-stack">
          <span className="field-label">Display Name</span>
          <input name="displayName" className="input-field" placeholder="Optional name" autoComplete="name" />
        </label>

        <label className="field-stack">
          <span className="field-label">Email</span>
          <input name="email" type="email" className="input-field" placeholder="you@example.com" autoComplete="email" required />
        </label>

        <label className="field-stack">
          <span className="field-label">Password</span>
          <input name="password" type="password" className="input-field" placeholder="At least 8 characters" autoComplete="new-password" required />
        </label>

        <label className="field-stack">
          <span className="field-label">Confirm Password</span>
          <input name="confirmPassword" type="password" className="input-field" placeholder="Repeat your password" autoComplete="new-password" required />
        </label>
      </fieldset>

      <div className="hero-actions mt-4">
        <button className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Creating Account..." : "Create Account"}
        </button>
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className={isSubmitting ? "btn-ghost pointer-events-none opacity-60" : "btn-ghost"}>
          Already have an account?
        </Link>
      </div>
    </form>
  );
}

