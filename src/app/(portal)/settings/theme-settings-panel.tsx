"use client";

import { useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "trading-journal-theme";

function getInitialTheme(): ThemeMode {
  if (typeof document === "undefined") {
    return "light";
  }

  const currentTheme = document.documentElement.getAttribute("data-theme");
  return currentTheme === "dark" ? "dark" : "light";
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function ThemeSettingsPanel() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  function handleThemeChange(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <section className="panel-strong section-stack">
      <div>
        <p className="eyebrow">Appearance</p>
        <h3 className="section-heading">Theme Mode</h3>
        <p className="section-copy">Choose how the portal looks while you work. Your selection is saved in this browser.</p>
      </div>

      <div className="theme-toggle-grid">
        <button
          type="button"
          onClick={() => handleThemeChange("light")}
          className={theme === "light" ? "theme-choice theme-choice-active" : "theme-choice"}
          aria-pressed={theme === "light"}
        >
          <span className="theme-choice-label">Light Mode</span>
          <span className="theme-choice-copy">Bright paper-style workspace with soft contrast.</span>
        </button>

        <button
          type="button"
          onClick={() => handleThemeChange("dark")}
          className={theme === "dark" ? "theme-choice theme-choice-active" : "theme-choice"}
          aria-pressed={theme === "dark"}
        >
          <span className="theme-choice-label">Dark Mode</span>
          <span className="theme-choice-copy">Darker portal surfaces for lower-glare sessions.</span>
        </button>
      </div>
    </section>
  );
}
