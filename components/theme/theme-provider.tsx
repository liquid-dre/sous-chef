"use client";

import * as React from "react";
import { deriveThemeVars, type OrgPalette } from "@/lib/theme/derive";
import { runContrastGuard, type GuardResult } from "@/lib/theme/contrast";

/**
 * Theme state, script-free:
 * - Mode: system users are covered before hydration by the
 *   `prefers-color-scheme` block in globals.css; an explicit choice is stored
 *   in localStorage and stamped as `data-mode` on <html> at hydration.
 * - Palette: org colours derive the full token set (lib/theme/derive.ts),
 *   applied as CSS variables on <html>. The server injects the same variables
 *   inline for first paint, so the client only touches them when the palette
 *   actually changes.
 */

export type Mode = "light" | "dark";

interface ThemeContextValue {
  palette: OrgPalette;
  /** Applies a candidate palette live. Returns its guard result. */
  setPalette: (palette: OrgPalette) => GuardResult | null;
  mode: Mode;
  setMode: (mode: Mode) => void;
  guard: GuardResult | null;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function usePalette(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("usePalette must be used within ThemeProvider");
  return ctx;
}

export const useThemeMode = usePalette;

function systemMode(): Mode {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const MODE_EVENT = "sous-mode-change";

function subscribeMode(onChange: () => void): () => void {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(MODE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(MODE_EVENT, onChange);
  };
}

function getModeSnapshot(): Mode {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("sous-mode");
  } catch {
    // storage unavailable — fall through to system preference
  }
  return stored === "light" || stored === "dark" ? stored : systemMode();
}

let pendingVarsFrame = 0;

/** Applies derived vars on the next frame — colour-wheel drags fire dozens of
 * updates a second, and every write restyles the whole document. */
function applyVars(palette: OrgPalette) {
  const vars = deriveThemeVars(palette);
  if (!vars) return;
  cancelAnimationFrame(pendingVarsFrame);
  pendingVarsFrame = requestAnimationFrame(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  });
}

export function ThemeProvider({
  defaultPalette,
  children,
}: {
  defaultPalette: OrgPalette;
  children: React.ReactNode;
}) {
  const [palette, setPaletteState] = React.useState<OrgPalette>(defaultPalette);
  const [guard, setGuard] = React.useState<GuardResult | null>(() =>
    runContrastGuard(defaultPalette),
  );
  // Explicit choice wins, else the OS; pre-hydration paint is handled by the
  // prefers-color-scheme block in globals.css.
  const mode = React.useSyncExternalStore(
    subscribeMode,
    getModeSnapshot,
    () => "light" as Mode,
  );

  // Keep the attribute in step so explicit choices override the media query.
  React.useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const setPalette = React.useCallback((next: OrgPalette): GuardResult | null => {
    setPaletteState(next);
    applyVars(next);
    const result = runContrastGuard(next);
    setGuard(result);
    return result;
  }, []);

  const setMode = React.useCallback((next: Mode) => {
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem("sous-mode", next);
    } catch {
      // private browsing — the choice simply won't persist
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  }, []);

  const value = React.useMemo(
    () => ({ palette, setPalette, mode, setMode, guard }),
    [palette, setPalette, mode, setMode, guard],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
