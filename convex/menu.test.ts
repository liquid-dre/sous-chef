import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Menu builder acceptance:
 * - a three-level nest costs correctly end to end through the database;
 * - cyclic recipes are rejected at save, naming the cycle;
 * - a limit without a reason cannot be saved.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};
const STAFF = { ...OWNER, subject: "user_staff", org_role: "org:member" };
const SLUG = { orgSlug: "kitchen-a" };

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  await t
    .withIdentity({ subject: "user_super" })
    .mutation(api.admin.provisionOrg, {
      orgId: "org_kitchen_a",
      slug: "kitchen-a",
      name: "Kitchen A",
    });
  // $8.00 per production hour.
  await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
    ...SLUG,
    overheadRateCentsPerHour: 800,
  });
  return t;
}

async function ingredient(
  t: ReturnType<typeof convexTest>,
  name: string,
  centsPerThousand: number,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: "org_kitchen_a",
      name,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: centsPerThousand,
      standardCostSetAt: Date.now(),
      trackStock: true,
      alertsMuted: false,
    }),
  );
}

beforeEach(() => vi.unstubAllEnvs());

describe("saving a menu item", () => {
  test("ACCEPTANCE: a three-level nest costs correctly through the database", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const butter = await ingredient(t, "Butter", 420);
    const flour = await ingredient(t, "Flour", 185);

    // Buttercream: 1 kg butter → 10 units, 20 min.
    const { menuItemId: buttercream } = await asOwner.mutation(
      api.menuItems.save,
      {
        ...SLUG,
        name: "Buttercream",
        notSoldDirectly: true,
        baseBatchYield: 10,
        unitWeightMilligrams: 100_000,
        batchProductionMinutes: 20,
        perUnitExtras: [],
        lines: [
          { componentType: "ingredient", componentId: butter, qtyMilli: 1_000_000, unit: "g" },
        ],
      },
    );

    // Brownie: 2 units of buttercream + 500 g flour → 12 units, 60 min.
    const { menuItemId: brownie } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Brownie",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      shelfLifeHours: 72,
      priceCents: 300,
      targetGrossMarginPercent: 65,
      perUnitExtras: [{ label: "Box", costCents: 20 }],
      lines: [
        { componentType: "menuItem", componentId: buttercream, qtyMilli: 2_000, unit: "unit" },
        { componentType: "ingredient", componentId: flour, qtyMilli: 500_000, unit: "g" },
      ],
    });

    const { rows } = await asOwner.query(api.menuItems.list, SLUG);
    const row = rows.find((r) => r.id === brownie)!;

    // Layer 1: buttercream (42c/unit × 2) + flour (92.5c) = 176.5c per batch.
    const variable = 176.5 / 12 + 20;
    expect(row.variableCentsPerUnit).toBeCloseTo(variable, 6);
    // Layer 3: 60 min + 20 min × (2 ÷ 10) = 64 min at $8/hour.
    expect(row.totalCentsPerUnit).toBeCloseTo(
      variable + (800 * 64) / 60 / 12,
      6,
    );
    expect(row.grossMarginPercent).toBe(
      Math.round(((300 - variable) / 300) * 100),
    );
    expect(row.netMarginPercent).toBeLessThan(row.grossMarginPercent!);

    // The sub-recipe is listed but carries no margin of its own.
    const sub = rows.find((r) => r.id === buttercream)!;
    expect(sub.notSoldDirectly).toBe(true);
    expect(sub.grossMarginPercent).toBeNull();
    expect(sub.variableCentsPerUnit).toBeCloseTo(42, 6);
  });

  test("editing replaces the recipe rather than accumulating lines", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const flour = await ingredient(t, "Flour", 185);
    const sugar = await ingredient(t, "Sugar", 150);

    const base = {
      ...SLUG,
      name: "Shortbread",
      notSoldDirectly: false,
      baseBatchYield: 10,
      unitWeightMilligrams: 50_000,
      batchProductionMinutes: 30,
      shelfLifeHours: 168,
      perUnitExtras: [],
    };
    const { menuItemId } = await asOwner.mutation(api.menuItems.save, {
      ...base,
      lines: [
        { componentType: "ingredient", componentId: flour, qtyMilli: 500_000, unit: "g" },
      ],
    });
    await asOwner.mutation(api.menuItems.save, {
      ...base,
      menuItemId,
      lines: [
        { componentType: "ingredient", componentId: sugar, qtyMilli: 200_000, unit: "g" },
      ],
    });

    const lines = await t.run(async (ctx) =>
      ctx.db.query("recipeLines").collect(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].componentId).toBe(sugar);
  });

  test("staff cannot build the menu", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(STAFF).mutation(api.menuItems.save, {
        ...SLUG,
        name: "Hijack",
        notSoldDirectly: true,
        baseBatchYield: 1,
        unitWeightMilligrams: 1_000,
        batchProductionMinutes: 0,
        perUnitExtras: [],
        lines: [],
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});

describe("cycles", () => {
  test("ACCEPTANCE: a cyclic recipe is rejected at save, naming the cycle", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);

    const { menuItemId: buttercream } = await asOwner.mutation(
      api.menuItems.save,
      {
        ...SLUG,
        name: "Buttercream",
        notSoldDirectly: true,
        baseBatchYield: 10,
        unitWeightMilligrams: 100_000,
        batchProductionMinutes: 20,
        perUnitExtras: [],
        lines: [],
      },
    );
    const { menuItemId: brownie } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Brownie",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      shelfLifeHours: 72,
      perUnitExtras: [],
      lines: [
        { componentType: "menuItem", componentId: buttercream, qtyMilli: 2_000, unit: "unit" },
      ],
    });

    // Now try to put the brownie inside the buttercream.
    await expect(
      asOwner.mutation(api.menuItems.save, {
        ...SLUG,
        menuItemId: buttercream,
        name: "Buttercream",
        notSoldDirectly: true,
        baseBatchYield: 10,
        unitWeightMilligrams: 100_000,
        batchProductionMinutes: 20,
        perUnitExtras: [],
        lines: [
          { componentType: "menuItem", componentId: brownie, qtyMilli: 1_000, unit: "unit" },
        ],
      }),
    ).rejects.toMatchObject({
      data: {
        code: "RECIPE_CYCLE",
        message: "This recipe would contain itself: Buttercream → Brownie → Buttercream.",
      },
    });

    // And the rejected recipe never landed — the rollback holds.
    const stillClean = await t.run(async (ctx) =>
      ctx.db
        .query("recipeLines")
        .filter((q) => q.eq(q.field("menuItemId"), buttercream))
        .collect(),
    );
    expect(stillClean).toHaveLength(0);
  });

  test("the builder is told what would loop before she picks it", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { menuItemId: buttercream } = await asOwner.mutation(
      api.menuItems.save,
      {
        ...SLUG,
        name: "Buttercream",
        notSoldDirectly: true,
        baseBatchYield: 10,
        unitWeightMilligrams: 100_000,
        batchProductionMinutes: 20,
        perUnitExtras: [],
        lines: [],
      },
    );
    const { menuItemId: brownie } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Brownie",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      shelfLifeHours: 72,
      perUnitExtras: [],
      lines: [
        { componentType: "menuItem", componentId: buttercream, qtyMilli: 2_000, unit: "unit" },
      ],
    });

    const forButtercream = await asOwner.query(api.menuItems.getForBuilder, {
      ...SLUG,
      menuItemId: buttercream as Id<"menuItems">,
    });
    expect(forButtercream.wouldLoop.sort()).toEqual([brownie, buttercream].sort());
    expect(forButtercream.usedBy).toEqual([
      { id: brownie, name: "Brownie", unitsConsumed: 2 },
    ]);
  });
});

describe("limits and their reasons", () => {
  const base = {
    ...SLUG,
    name: "Wedding tier",
    notSoldDirectly: false,
    baseBatchYield: 1,
    unitWeightMilligrams: 2_000_000,
    batchProductionMinutes: 240,
    shelfLifeHours: 48,
    perUnitExtras: [],
    lines: [],
  };

  test("ACCEPTANCE: a limit without a reason is refused", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(OWNER).mutation(api.menuItems.save, {
        ...base,
        maxPriceCents: 400,
      }),
    ).rejects.toThrow(/why the limit is there/);
  });

  test("the same limit saves once it has a reason", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(OWNER).mutation(api.menuItems.save, {
        ...base,
        maxPriceCents: 400,
        constraintNote: "Church stall won't pay more.",
      }),
    ).resolves.toMatchObject({ menuItemId: expect.anything() });
  });

  test("a price outside the limit still saves — Sous flags, it never blocks", async () => {
    const t = await kitchen();
    await expect(
      t.withIdentity(OWNER).mutation(api.menuItems.save, {
        ...base,
        maxPriceCents: 400,
        priceCents: 450,
        constraintNote: "Church stall won't pay more.",
      }),
    ).resolves.toMatchObject({ menuItemId: expect.anything() });
  });

  test("anything sold needs a shelf life; a sub-recipe does not", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    await expect(
      asOwner.mutation(api.menuItems.save, {
        ...base,
        shelfLifeHours: undefined,
      }),
    ).rejects.toThrow(/needs a shelf life/);
    await expect(
      asOwner.mutation(api.menuItems.save, {
        ...base,
        name: "Base dough",
        notSoldDirectly: true,
        shelfLifeHours: undefined,
      }),
    ).resolves.toMatchObject({ menuItemId: expect.anything() });
  });
});

describe("deleting", () => {
  test("a sub-recipe in use cannot be deleted out from under its parent", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const { menuItemId: sub } = await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Buttercream",
      notSoldDirectly: true,
      baseBatchYield: 10,
      unitWeightMilligrams: 100_000,
      batchProductionMinutes: 20,
      perUnitExtras: [],
      lines: [],
    });
    await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      name: "Brownie",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      shelfLifeHours: 72,
      perUnitExtras: [],
      lines: [
        { componentType: "menuItem", componentId: sub, qtyMilli: 2_000, unit: "unit" },
      ],
    });
    await expect(
      asOwner.mutation(api.menuItems.remove, { ...SLUG, menuItemId: sub }),
    ).rejects.toThrow(/used in Brownie/);
  });
});

describe("setting the optimiser aside", () => {
  /** A sellable item with a price and a target, so the panel has something to
   * assert before she silences it. */
  async function sellable(t: ReturnType<typeof convexTest>) {
    const flour = await ingredient(t, "Flour", 185);
    const { menuItemId } = await t.withIdentity(OWNER).mutation(api.menuItems.save, {
      ...SLUG,
      name: "Brownies",
      notSoldDirectly: false,
      baseBatchYield: 12,
      unitWeightMilligrams: 85_000,
      batchProductionMinutes: 60,
      perUnitExtras: [{ label: "Box", costCents: 20 }],
      priceCents: 300,
      targetGrossMarginPercent: 65,
      shelfLifeHours: 72,
      lines: [
        { componentType: "ingredient" as const, componentId: flour, qtyMilli: 500_000, unit: "g" as const },
      ],
    });
    return menuItemId as Id<"menuItems">;
  }

  test("ACCEPTANCE: setting it aside persists, and records the margin she chose", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const menuItemId = await sellable(t);

    const before = await asOwner.query(api.menuItems.getForBuilder, { ...SLUG, menuItemId });
    expect(before.item!.optimiserSetAsideAt).toBeNull();

    await asOwner.mutation(api.menuItems.setAsideOptimiser, {
      ...SLUG,
      menuItemId,
      marginPercent: 40,
    });

    const after = await asOwner.query(api.menuItems.getForBuilder, { ...SLUG, menuItemId });
    expect(after.item!.optimiserSetAsideAt).toBeTypeOf("number");
    // The record, not just the silence — this is what answers "why 40%?".
    expect(after.item!.optimiserSetAsideMarginPercent).toBe(40);
    // Her target is untouched: setting the panel aside is not giving up on it.
    expect(after.item!.targetGrossMarginPercent).toBe(65);
  });

  test("picking it back up clears both fields", async () => {
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const menuItemId = await sellable(t);

    await asOwner.mutation(api.menuItems.setAsideOptimiser, { ...SLUG, menuItemId, marginPercent: 40 });
    await asOwner.mutation(api.menuItems.setAsideOptimiser, { ...SLUG, menuItemId, marginPercent: null });

    const after = await asOwner.query(api.menuItems.getForBuilder, { ...SLUG, menuItemId });
    expect(after.item!.optimiserSetAsideAt).toBeNull();
    expect(after.item!.optimiserSetAsideMarginPercent).toBeNull();
  });

  test("saving the item again does not resurrect the panel", async () => {
    // She sets it aside, then edits the recipe. A fingerprint scheme would
    // bring the suggestion straight back; "until she says otherwise" must not.
    const t = await kitchen();
    const asOwner = t.withIdentity(OWNER);
    const menuItemId = await sellable(t);
    await asOwner.mutation(api.menuItems.setAsideOptimiser, { ...SLUG, menuItemId, marginPercent: 40 });

    await asOwner.mutation(api.menuItems.save, {
      ...SLUG,
      menuItemId,
      name: "Brownies",
      notSoldDirectly: false,
      baseBatchYield: 15,
      unitWeightMilligrams: 68_000,
      batchProductionMinutes: 60,
      perUnitExtras: [{ label: "Box", costCents: 20 }],
      priceCents: 350,
      targetGrossMarginPercent: 65,
      shelfLifeHours: 72,
      lines: [],
    });

    const after = await asOwner.query(api.menuItems.getForBuilder, { ...SLUG, menuItemId });
    expect(after.item!.optimiserSetAsideMarginPercent).toBe(40);
  });

  test("staff cannot set it aside — costs and margins are owner-only", async () => {
    const t = await kitchen();
    const menuItemId = await sellable(t);
    await expect(
      t.withIdentity(STAFF).mutation(api.menuItems.setAsideOptimiser, {
        ...SLUG,
        menuItemId,
        marginPercent: 40,
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});
