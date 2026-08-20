import { converter, clampChroma } from "culori";

/**
 * Org theme derivation. See DESIGN.md §2.
 *
 * Input: up to 3 org colours (colour 1 mandatory). Output: every themable CSS
 * variable, both modes, prefixed `--l-` / `--d-`. Static CSS in globals.css
 * maps the active mode's set onto the unprefixed tokens.
 *
 * All maths in OKLCH so lightness steps stay perceptually even across hues.
 * Semantic colours (profit/loss/warn/danger) are fixed in globals.css and are
 * never produced here.
 */

export interface OrgPalette {
  /** Colour 1 — mandatory. Becomes primary. */
  primary: string;
  /** Colour 2 — optional. Becomes accent. Derived from primary when absent. */
  accent?: string | null;
  /** Colour 3 — optional. Becomes the surface tint. Derived when absent. */
  tint?: string | null;
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export type ThemeVars = Record<string, string>;

const toOklch = converter("oklch");
const toRgb = converter("rgb");

export function parseToOklch(color: string): Oklch | null {
  const parsed = toOklch(color);
  if (!parsed || Number.isNaN(parsed.l)) return null;
  return { l: parsed.l, c: parsed.c ?? 0, h: parsed.h ?? 0 };
}

function css(color: Oklch): string {
  const clamped = clampChroma(
    { mode: "oklch", l: color.l, c: color.c, h: color.h },
    "oklch",
  );
  const l = Math.round(clamped.l * 1000) / 1000;
  const c = Math.round((clamped.c ?? 0) * 1000) / 1000;
  const h = Math.round((clamped.h ?? 0) * 10) / 10;
  return `oklch(${l} ${c} ${h})`;
}

export function toHex(color: Oklch): string {
  const clamped = clampChroma(
    { mode: "oklch", l: color.l, c: color.c, h: color.h },
    "oklch",
  );
  const rgb = toRgb(clamped);
  const chan = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${chan(rgb.r)}${chan(rgb.g)}${chan(rgb.b)}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: Oklch): number {
  const clamped = clampChroma(
    { mode: "oklch", l: color.l, c: color.c, h: color.h },
    "oklch",
  );
  const rgb = toRgb(clamped);
  const lin = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Scales ---------------------------------------------------------------

export const SCALE_STEPS = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
] as const;

const SCALE_LIGHTNESS: Record<number, number> = {
  50: 0.985,
  100: 0.96,
  200: 0.92,
  300: 0.86,
  400: 0.78,
  500: 0.68,
  600: 0.58,
  700: 0.5,
  800: 0.42,
  900: 0.35,
  950: 0.28,
};

/** Chroma multiplier — peaks mid-scale so ends stay quiet. */
const SCALE_CHROMA: Record<number, number> = {
  50: 0.15,
  100: 0.25,
  200: 0.45,
  300: 0.65,
  400: 0.85,
  500: 1,
  600: 1,
  700: 0.92,
  800: 0.8,
  900: 0.65,
  950: 0.5,
};

export function buildScale(anchor: Oklch): Record<number, Oklch> {
  const baseChroma = Math.min(Math.max(anchor.c, 0.02), 0.24);
  const scale: Record<number, Oklch> = {};
  for (const step of SCALE_STEPS) {
    scale[step] = {
      l: SCALE_LIGHTNESS[step],
      c: baseChroma * SCALE_CHROMA[step],
      h: anchor.h,
    };
  }
  return scale;
}

// --- Derivation of missing colours ---------------------------------------

/** Fixed semantic hues the derived accent must keep clear of. */
const SEMANTIC_HUES = [150, 27, 75]; // profit, loss/danger, warn

function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

/** Accent when colour 2 is absent: primary hue ±30°, whichever rotation lands
 * furthest from the semantic hues. */
export function deriveAccent(primary: Oklch): Oklch {
  const candidates = [primary.h + 30, primary.h - 30].map((h) => ({
    h: (h + 360) % 360,
    clearance: Math.min(
      ...SEMANTIC_HUES.map((s) => hueDistance((h + 360) % 360, s)),
    ),
  }));
  candidates.sort((a, b) => b.clearance - a.clearance);
  return { l: primary.l, c: primary.c, h: candidates[0].h };
}

/** Surface tint when colour 3 is absent: primary's hue, whisper of chroma. */
export function deriveTint(primary: Oklch): Oklch {
  return { l: 0.985, c: 0.015, h: primary.h };
}

// --- Role assembly --------------------------------------------------------

const INK_L = 0.185;

function ink(hue: number): Oklch {
  return { l: INK_L, c: 0.012, h: hue };
}

function paper(hue: number): Oklch {
  return { l: 0.995, c: 0.004, h: hue };
}

/** Foreground for a solid fill: warm paper if it passes AA, else warm ink. */
export function onColor(fill: Oklch, tintHue: number): Oklch {
  const light = paper(tintHue);
  return contrastRatio(light, fill) >= 4.5 ? light : ink(tintHue);
}

export interface ResolvedPalette {
  primary: Oklch;
  accent: Oklch;
  accentDerived: boolean;
  tint: Oklch;
  tintDerived: boolean;
}

export function resolvePalette(palette: OrgPalette): ResolvedPalette | null {
  const primary = parseToOklch(palette.primary);
  if (!primary) return null;
  const pickedAccent = palette.accent ? parseToOklch(palette.accent) : null;
  const pickedTint = palette.tint ? parseToOklch(palette.tint) : null;
  return {
    primary,
    accent: pickedAccent ?? deriveAccent(primary),
    accentDerived: !pickedAccent,
    tint: pickedTint ?? deriveTint(primary),
    tintDerived: !pickedTint,
  };
}

/** The primary as it renders in dark mode: lifted into the readable band. */
export function darkModePrimary(primary: Oklch): Oklch {
  return {
    l: Math.max(primary.l, 0.72),
    c: Math.min(Math.max(primary.c, 0.02), 0.19),
    h: primary.h,
  };
}

/** The accent as it renders in dark mode. */
export function darkModeAccent(accent: Oklch): Oklch {
  return {
    l: Math.max(accent.l, 0.74),
    c: Math.min(Math.max(accent.c, 0.02), 0.17),
    h: accent.h,
  };
}

export function deriveThemeVars(palette: OrgPalette): ThemeVars | null {
  const resolved = resolvePalette(palette);
  if (!resolved) return null;
  const { primary, accent, tint } = resolved;

  const p = buildScale(primary);
  const a = buildScale(accent);
  const hue = tint.h;

  const vars: ThemeVars = {};
  for (const step of SCALE_STEPS) {
    vars[`--primary-${step}`] = css(p[step]);
    vars[`--accent-${step}`] = css(a[step]);
  }

  // ---- Light mode ----
  const lBg: Oklch = { l: Math.max(tint.l, 0.975), c: Math.min(tint.c, 0.03), h: hue };
  const lCard = paper(hue);
  const lPrimary = primary;
  const lAccentSoft: Oklch = { l: 0.94, c: Math.min(accent.c * 0.3, 0.05), h: accent.h };

  Object.assign(vars, {
    "--l-background": css(lBg),
    "--l-foreground": css(ink(hue)),
    "--l-card": css(lCard),
    "--l-card-foreground": css(ink(hue)),
    "--l-popover": css(lCard),
    "--l-popover-foreground": css(ink(hue)),
    "--l-primary": css(lPrimary),
    "--l-primary-foreground": css(onColor(lPrimary, hue)),
    "--l-primary-soft": css({ l: 0.955, c: Math.min(primary.c * 0.22, 0.045), h: primary.h }),
    "--l-secondary": css({ l: 0.955, c: Math.min(tint.c, 0.012), h: hue }),
    "--l-secondary-foreground": css({ l: 0.32, c: 0.014, h: hue }),
    "--l-muted": css({ l: 0.955, c: Math.min(tint.c, 0.01), h: hue }),
    "--l-muted-foreground": css({ l: 0.48, c: 0.014, h: hue }),
    "--l-accent": css(lAccentSoft),
    "--l-accent-foreground": css({ l: 0.34, c: Math.min(accent.c, 0.1), h: accent.h }),
    "--l-accent-strong": css(accent),
    "--l-border": css({ l: 0.9, c: 0.009, h: hue }),
    "--l-input": css({ l: 0.9, c: 0.009, h: hue }),
    "--l-ring": css({ l: Math.min(primary.l + 0.12, 0.75), c: primary.c * 0.8, h: primary.h }),
    "--l-chart-1": css(lPrimary),
    "--l-chart-2": css(accent),
    "--l-chart-3": css(p[700]),
    "--l-chart-4": css(a[700]),
    "--l-chart-5": css(p[300]),
    // Sequential heat scale (heatmaps): the primary ramp, light → intense.
    // Semantic heatmaps override with fixed amber/red levelColors.
    "--l-chart-scale-1": css(p[100]),
    "--l-chart-scale-2": css(p[300]),
    "--l-chart-scale-3": css(p[500]),
    "--l-chart-scale-4": css(p[700]),
    "--l-chart-scale-5": css(p[900]),
  });

  // ---- Dark mode ----
  const dBg: Oklch = { l: 0.155, c: Math.min(tint.c, 0.012), h: hue };
  const dCard: Oklch = { l: 0.205, c: Math.min(tint.c, 0.014), h: hue };
  const dPrimary = darkModePrimary(primary);
  const dAccent = darkModeAccent(accent);

  Object.assign(vars, {
    "--d-background": css(dBg),
    "--d-foreground": css({ l: 0.93, c: 0.006, h: hue }),
    "--d-card": css(dCard),
    "--d-card-foreground": css({ l: 0.93, c: 0.006, h: hue }),
    "--d-popover": css({ l: 0.225, c: Math.min(tint.c, 0.014), h: hue }),
    "--d-popover-foreground": css({ l: 0.93, c: 0.006, h: hue }),
    "--d-primary": css(dPrimary),
    "--d-primary-foreground": css({ l: 0.17, c: 0.014, h: primary.h }),
    "--d-primary-soft": css({ l: 0.26, c: Math.min(primary.c * 0.35, 0.055), h: primary.h }),
    "--d-secondary": css({ l: 0.27, c: 0.012, h: hue }),
    "--d-secondary-foreground": css({ l: 0.85, c: 0.008, h: hue }),
    "--d-muted": css({ l: 0.26, c: 0.01, h: hue }),
    "--d-muted-foreground": css({ l: 0.7, c: 0.01, h: hue }),
    "--d-accent": css({ l: 0.29, c: Math.min(accent.c * 0.3, 0.05), h: accent.h }),
    "--d-accent-foreground": css({ l: 0.86, c: Math.min(accent.c * 0.5, 0.08), h: accent.h }),
    "--d-accent-strong": css(dAccent),
    "--d-border": css({ l: 0.29, c: 0.01, h: hue }),
    "--d-input": css({ l: 0.31, c: 0.01, h: hue }),
    "--d-ring": css({ l: 0.6, c: primary.c * 0.7, h: primary.h }),
    "--d-chart-1": css(dPrimary),
    "--d-chart-2": css(dAccent),
    "--d-chart-3": css(p[400]),
    "--d-chart-4": css(a[400]),
    "--d-chart-5": css(p[200]),
    // Dark heat ramp runs dim → bright so intensity still reads as "more".
    "--d-chart-scale-1": css(p[950]),
    "--d-chart-scale-2": css(p[800]),
    "--d-chart-scale-3": css(p[600]),
    "--d-chart-scale-4": css(p[400]),
    "--d-chart-scale-5": css(p[200]),
  });

  return vars;
}
