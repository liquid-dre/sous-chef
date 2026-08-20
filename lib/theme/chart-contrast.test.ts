// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  contrastRatio,
  deriveThemeVars,
  parseToOklch,
  type Oklch,
  type OrgPalette,
} from "./derive";
import { runContrastGuard } from "./contrast";

/**
 * ACCEPTANCE (chart slice): series colours stay legible against the chart
 * background for a sane palette, a red-brand palette, and a deliberately
 * awful one — and the semantic chart colours never move at all, because
 * they are not part of the derivation. The chart background is bound to
 * --card in globals.css, so the derived card colours are what we test
 * against.
 */

/** Palettes the picker's contrast guard would allow through. */
const PASSING_PALETTES: Record<string, OrgPalette> = {
  default: { primary: "#2E6158", accent: "#B56E3C", tint: "#F7F3EA" },
  redBrand: { primary: "#B3261E", accent: "#8C6A2F", tint: "#F8F2EE" },
};

/** Neon on cream: unsalvageable by derivation — the system's defence is the
 * picker refusing it while she chooses (DESIGN.md §2), so no chart ever
 * wears it. Asserted below. */
const AWFUL_PALETTE: OrgPalette = {
  primary: "#FAFF00",
  accent: "#00FFC8",
  tint: "#FFFDF2",
};

/** UI-component floor (WCAG 1.4.11) for graphical objects. */
const FLOOR = 3;

/** Series that must clear the floor in each mode. chart-5 is a deliberate
 * soft fill (light tint used for bars/areas behind stronger marks), so the
 * legibility floor applies to the four line/mark series. */
const SERIES = ["--chart-1", "--chart-2", "--chart-3", "--chart-4"] as const;

function pick(vars: Record<string, string>, key: string): Oklch {
  const parsed = parseToOklch(vars[key]);
  if (!parsed) throw new Error(`${key} did not parse: ${vars[key]}`);
  return parsed;
}

describe("chart series contrast", () => {
  for (const [name, palette] of Object.entries(PASSING_PALETTES)) {
    test(`${name}: series clear ${FLOOR}:1 on the chart background, both modes`, () => {
      const vars = deriveThemeVars(palette);
      expect(vars).not.toBeNull();
      const lightBg = pick(vars!, "--l-card");
      const darkBg = pick(vars!, "--d-card");
      for (let i = 1; i <= SERIES.length; i++) {
        const light = pick(vars!, `--l-chart-${i}`);
        const dark = pick(vars!, `--d-chart-${i}`);
        expect(
          contrastRatio(light, lightBg),
          `light chart-${i} on card (${name})`,
        ).toBeGreaterThanOrEqual(FLOOR);
        expect(
          contrastRatio(dark, darkBg),
          `dark chart-${i} on card (${name})`,
        ).toBeGreaterThanOrEqual(FLOOR);
      }
    });
  }

  test("the heat scale's intense end is distinct from its quiet end", () => {
    for (const palette of Object.values(PASSING_PALETTES)) {
      const vars = deriveThemeVars(palette)!;
      const low = pick(vars, "--l-chart-scale-1");
      const high = pick(vars, "--l-chart-scale-5");
      expect(contrastRatio(low, high)).toBeGreaterThanOrEqual(2.5);
    }
  });

  test("ACCEPTANCE: the awful palette is refused by the guard — and dark mode still holds if previewed", () => {
    // The picker never lets this palette commit (no "save anyway" exists) —
    // that, not derivation heroics, is why charts never render 1.07:1 neon.
    const guard = runContrastGuard(AWFUL_PALETTE);
    expect(guard).not.toBeNull();
    expect(guard!.ok).toBe(false);
    expect(guard!.failures.length).toBeGreaterThan(0);
    // While she is previewing it live (the picker applies candidates), the
    // dark-mode series still land in the derivation's readable band.
    const vars = deriveThemeVars(AWFUL_PALETTE)!;
    const darkBg = pick(vars, "--d-card");
    for (let i = 1; i <= SERIES.length; i++) {
      expect(
        contrastRatio(pick(vars, `--d-chart-${i}`), darkBg),
        `dark chart-${i} on card (awful)`,
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe("semantic chart colours are outside the derivation", () => {
  test("deriveThemeVars never emits profit/loss/warn/target vars", () => {
    for (const palette of [...Object.values(PASSING_PALETTES), AWFUL_PALETTE]) {
      const vars = deriveThemeVars(palette)!;
      const semanticKeys = Object.keys(vars).filter((k) =>
        /profit|loss|warn|danger|target|projection/i.test(k),
      );
      // The red-brand acceptance: nothing an org picks can reach these —
      // they live as static values in globals.css only.
      expect(semanticKeys).toEqual([]);
    }
  });
});
