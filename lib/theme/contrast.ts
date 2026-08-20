import {
  contrastRatio,
  darkModeAccent,
  darkModePrimary,
  deriveTint,
  onColor,
  parseToOklch,
  resolvePalette,
  toHex,
  type Oklch,
  type OrgPalette,
} from "./derive";

/**
 * The contrast guard. See DESIGN.md §2.
 *
 * Checks every picked colour against the surfaces it will actually land on, in
 * both modes, while she is choosing. Failures come with plain language and the
 * nearest passing shade — a door, not a wall. Committing is disabled while any
 * check fails; there is no "save anyway".
 */

export type PaletteSlot = "primary" | "accent" | "tint";
export type Mode = "light" | "dark";

export interface GuardCheck {
  id: string;
  slot: PaletteSlot;
  mode: Mode;
  /** What this pairing is, in her language. */
  label: string;
  ratio: number;
  required: number;
  pass: boolean;
}

export interface GuardSuggestion {
  slot: PaletteSlot;
  hex: string;
  /** Plain-language: what failed and what the suggestion is. */
  message: string;
}

export interface SemanticProximityFlag {
  slot: PaletteSlot;
  message: string;
}

export interface GuardResult {
  ok: boolean;
  checks: GuardCheck[];
  failures: GuardCheck[];
  suggestions: GuardSuggestion[];
  proximityFlags: SemanticProximityFlag[];
}

const AA_TEXT = 4.5;
const AA_UI = 3;

interface CheckSpec {
  id: string;
  slot: PaletteSlot;
  mode: Mode;
  label: string;
  failText: string;
  required: number;
  fg: (p: ResolvedForChecks) => Oklch;
  bg: (p: ResolvedForChecks) => Oklch;
}

interface ResolvedForChecks {
  primary: Oklch;
  accent: Oklch;
  tint: Oklch;
  lightBg: Oklch;
  darkBg: Oklch;
  darkPrimary: Oklch;
  darkAccent: Oklch;
}

function resolveForChecks(palette: OrgPalette): ResolvedForChecks | null {
  const resolved = resolvePalette(palette);
  if (!resolved) return null;
  const { primary, accent, tint } = resolved;
  return {
    primary,
    accent,
    tint,
    lightBg: { l: Math.max(tint.l, 0.975), c: Math.min(tint.c, 0.03), h: tint.h },
    darkBg: { l: 0.155, c: Math.min(tint.c, 0.012), h: tint.h },
    darkPrimary: darkModePrimary(primary),
    darkAccent: darkModeAccent(accent),
  };
}

const INK: Oklch = { l: 0.185, c: 0.012, h: 75 };
const PAPER: Oklch = { l: 0.93, c: 0.006, h: 75 };

const CHECKS: CheckSpec[] = [
  {
    id: "primary-button-light",
    slot: "primary",
    mode: "light",
    label: "Button text on your first colour",
    failText: "Text on buttons in this colour",
    required: AA_TEXT,
    fg: (p) => onColor(p.primary, p.tint.h),
    bg: (p) => p.primary,
  },
  {
    id: "primary-text-light",
    slot: "primary",
    mode: "light",
    label: "Your first colour as text and links",
    failText: "Links and highlights in this colour",
    required: AA_TEXT,
    fg: (p) => p.primary,
    bg: (p) => p.lightBg,
  },
  {
    id: "primary-button-dark",
    slot: "primary",
    mode: "dark",
    label: "Buttons in dark mode",
    failText: "Buttons in dark mode",
    required: AA_UI,
    fg: (p) => p.darkPrimary,
    bg: (p) => p.darkBg,
  },
  {
    id: "accent-ui-light",
    slot: "accent",
    mode: "light",
    label: "Your second colour on the page",
    failText: "Chips and highlights in this colour",
    required: AA_UI,
    fg: (p) => p.accent,
    bg: (p) => p.lightBg,
  },
  {
    id: "accent-ui-dark",
    slot: "accent",
    mode: "dark",
    label: "Your second colour in dark mode",
    failText: "Chips and highlights in dark mode",
    required: AA_UI,
    fg: (p) => p.darkAccent,
    bg: (p) => p.darkBg,
  },
  {
    id: "tint-text-light",
    slot: "tint",
    mode: "light",
    label: "Everyday text on your background colour",
    failText: "Everyday text on this background",
    required: AA_TEXT,
    fg: () => INK,
    bg: (p) => p.lightBg,
  },
  {
    id: "tint-text-dark",
    slot: "tint",
    mode: "dark",
    label: "Everyday text in dark mode",
    failText: "Everyday text in dark mode",
    required: AA_TEXT,
    fg: () => PAPER,
    bg: (p) => p.darkBg,
  },
];

function runChecks(palette: OrgPalette): GuardCheck[] | null {
  const resolved = resolveForChecks(palette);
  if (!resolved) return null;
  return CHECKS.map((spec) => {
    const ratio = contrastRatio(spec.fg(resolved), spec.bg(resolved));
    return {
      id: spec.id,
      slot: spec.slot,
      mode: spec.mode,
      label: spec.label,
      // Floor, never round up: a 2.98 must read as 2.9, not 3 — the guard
      // must not overstate a ratio it is refusing.
      ratio: Math.floor(ratio * 10) / 10,
      required: spec.required,
      pass: ratio >= spec.required,
    };
  });
}

/**
 * Nearest passing shade: same hue and chroma, lightness nudged in OKLCH until
 * every check for that slot passes. Searches outward from the picked
 * lightness so the suggestion stays as close to her colour as possible.
 */
function nearestPassingShade(
  palette: OrgPalette,
  slot: PaletteSlot,
): Oklch | null {
  const pickedRaw =
    slot === "primary"
      ? palette.primary
      : slot === "accent"
        ? palette.accent
        : palette.tint;
  if (!pickedRaw) return null;
  const picked = parseToOklch(pickedRaw);
  if (!picked) return null;

  for (let delta = 0.01; delta <= 0.85; delta += 0.01) {
    for (const direction of [-1, 1]) {
      const l = picked.l + direction * delta;
      if (l < 0.05 || l > 0.99) continue;
      const candidate: Oklch = { l, c: picked.c, h: picked.h };
      const trial: OrgPalette = {
        primary: slot === "primary" ? toHex(candidate) : palette.primary,
        accent: slot === "accent" ? toHex(candidate) : palette.accent,
        tint: slot === "tint" ? toHex(candidate) : palette.tint,
      };
      const checks = runChecks(trial);
      if (checks && checks.filter((c) => c.slot === slot).every((c) => c.pass)) {
        return candidate;
      }
    }
  }
  return null;
}

/** Fixed semantic hues: profit green, loss/danger red, warn amber. */
const SEMANTIC_PROXIMITY = [
  { hue: 150, name: "the green Sous uses for profit" },
  { hue: 27, name: "the red Sous uses for losses and alerts" },
  { hue: 75, name: "the amber Sous uses for warnings" },
];

function hueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function proximityFlags(palette: OrgPalette): SemanticProximityFlag[] {
  const flags: SemanticProximityFlag[] = [];
  const slots: [PaletteSlot, string | null | undefined][] = [
    ["primary", palette.primary],
    ["accent", palette.accent],
  ];
  for (const [slot, raw] of slots) {
    if (!raw) continue;
    const color = parseToOklch(raw);
    if (!color || color.c < 0.04) continue;
    for (const semantic of SEMANTIC_PROXIMITY) {
      if (hueDistance(color.h, semantic.hue) < 20) {
        flags.push({
          slot,
          message: `This is close to ${semantic.name} — it still works, but those signals will always show the fixed colour, never yours.`,
        });
      }
    }
  }
  return flags;
}

export function runContrastGuard(palette: OrgPalette): GuardResult | null {
  const checks = runChecks(palette);
  if (!checks) return null;
  const failures = checks.filter((c) => !c.pass);

  const failedSlots = [...new Set(failures.map((f) => f.slot))];
  const suggestions: GuardSuggestion[] = [];
  for (const slot of failedSlots) {
    const shade = nearestPassingShade(palette, slot);
    if (!shade) continue;
    const worst = failures
      .filter((f) => f.slot === slot)
      .sort((x, y) => x.ratio - y.ratio)[0];
    const spec = CHECKS.find((c) => c.id === worst.id);
    const direction =
      shade.l < (parseToOklch(slot === "primary" ? palette.primary : slot === "accent" ? palette.accent! : palette.tint!)?.l ?? 0.5)
        ? "deeper"
        : "lighter";
    suggestions.push({
      slot,
      hex: toHex(shade),
      message: `${spec?.failText ?? "This colour"} would be hard to read — ${worst.ratio}:1 where ${worst.required}:1 is needed. Here's the closest ${direction} shade that works.`,
    });
  }

  return {
    ok: failures.length === 0,
    checks,
    failures,
    suggestions,
    proximityFlags: proximityFlags(palette),
  };
}

export { deriveTint };
