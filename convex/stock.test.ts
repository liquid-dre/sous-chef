import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The pantry ledger, through the real mutations.
 *
 * Acceptance carried here:
 * - a stocktake never mutates a prior movement;
 * - a partial count anchors only what she actually counted;
 * - the derived level matches the ledger sum under concurrent writes, which
 *   this suite can only prove STRUCTURALLY — see the note on that test.
 */

const OWNER = {
  subject: "user_owner",
  org_id: "org_kitchen_a",
  org_slug: "kitchen-a",
  org_role: "org:admin",
};
const STAFF = { ...OWNER, subject: "user_staff", org_role: "org:member" };
const OTHER = {
  subject: "user_b",
  org_id: "org_kitchen_b",
  org_slug: "kitchen-b",
  org_role: "org:admin",
};
const SLUG = { orgSlug: "kitchen-a" };
const TODAY = "2026-08-05"; // a Wednesday
const KG = 1_000_000;

async function kitchen() {
  const t = convexTest(schema);
  vi.stubEnv("SOUS_SUPER_USER_IDS", "user_super");
  const asSuper = t.withIdentity({ subject: "user_super" });
  await asSuper.mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_a",
    slug: "kitchen-a",
    name: "Kitchen A",
  });
  await asSuper.mutation(api.admin.provisionOrg, {
    orgId: "org_kitchen_b",
    slug: "kitchen-b",
    name: "Kitchen B",
  });
  return t;
}

async function ingredient(
  t: ReturnType<typeof convexTest>,
  name: string,
  opts: { trackStock?: boolean; orgId?: string } = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("ingredients", {
      orgId: opts.orgId ?? "org_kitchen_a",
      name,
      baseUnit: "g" as const,
      standardCostCentsPerThousand: 185,
      standardCostSetAt: Date.now(),
      trackStock: opts.trackStock ?? true,
      alertsMuted: false,
    }),
  );
}

/** Stock arrives the only way it can: as a movement. */
async function movement(
  t: ReturnType<typeof convexTest>,
  ingredientId: Id<"ingredients">,
  deltaMilli: number,
  occurredAt: number,
  orgId = "org_kitchen_a",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("stockMovements", {
      orgId,
      ingredientId,
      deltaMilli,
      reason: "purchase" as const,
      occurredAt,
    }),
  );
}

async function levelOf(
  t: ReturnType<typeof convexTest>,
  ingredientId: Id<"ingredients">,
): Promise<number | null> {
  const { rows } = await t
    .withIdentity(OWNER)
    .query(api.ingredients.list, { ...SLUG, today: TODAY });
  return rows.find((r) => r.id === ingredientId)?.levelMilli ?? null;
}

beforeEach(() => vi.unstubAllEnvs());

describe("taking a stocktake", () => {
  test("ACCEPTANCE: a stocktake never mutates a prior movement", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await movement(t, flour, 5 * KG, 1_000);
    await movement(t, flour, -1 * KG, 2_000);

    const before = await t.run(async (ctx) =>
      ctx.db.query("stockMovements").collect(),
    );

    await t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 3_500_000 }],
    });

    const after = await t.run(async (ctx) =>
      ctx.db.query("stockMovements").collect(),
    );
    // Exactly one row appended, and every prior row byte-identical. What she
    // believed last Tuesday stays on the books — a ledger that rewrites
    // itself cannot be used to work out what went wrong.
    expect(after).toHaveLength(before.length + 1);
    const priorIds = new Set(before.map((m) => m._id));
    for (const row of after.filter((m) => priorIds.has(m._id))) {
      expect(row).toEqual(before.find((m) => m._id === row._id));
    }
  });

  test("the variance is stored, and it is what she saw", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await movement(t, flour, 5 * KG, 1_000);
    await movement(t, flour, -1 * KG, 2_000); // arithmetic says 4 kg

    await t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 3_500_000 }],
    });

    const take = await t.run(async (ctx) => ctx.db.query("stocktakes").first());
    expect(take!.lines[0].previousQtyMilli).toBe(4 * KG);
    expect(take!.lines[0].countedQtyMilli).toBe(3_500_000);
    expect(take!.lines[0].varianceMilli).toBe(-500_000);
    expect(take!.takenOn).toBe(TODAY);
    expect(take!.takenBy).toBe("user_owner");
  });

  test("ACCEPTANCE: the count becomes the level, and back-dating cannot move it", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await movement(t, flour, 5 * KG, 1_000);
    await t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 2 * KG }],
    });
    expect(await levelOf(t, flour)).toBe(2 * KG);

    // Friday, she enters Tuesday's receipt. It is recorded in full for cost
    // drift, and it does not touch a number she measured with her own eyes.
    await movement(t, flour, 3 * KG, 500);
    expect(await levelOf(t, flour)).toBe(2 * KG);

    // A movement AFTER the count does move it.
    await movement(t, flour, 1 * KG, Date.now() + 60_000);
    expect(await levelOf(t, flour)).toBe(3 * KG);
  });

  test("ACCEPTANCE: a partial count anchors only what she touched", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    const sugar = await ingredient(t, "Sugar");
    await movement(t, flour, 5 * KG, 1_000);
    await movement(t, sugar, 5 * KG, 1_000);

    await t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 2 * KG }],
    });

    const { rows } = await t
      .withIdentity(OWNER)
      .query(api.ingredients.list, { ...SLUG, today: TODAY });
    const flourRow = rows.find((r) => r.id === flour)!;
    const sugarRow = rows.find((r) => r.id === sugar)!;

    expect(flourRow.countedAt).not.toBeNull();
    // Sugar she never walked over to. It keeps its older anchor — none at
    // all — and says so, which is the only thing that makes freshness carry
    // information.
    expect(sugarRow.countedAt).toBeNull();
    expect(sugarRow.levelMilli).toBe(5 * KG);
  });

  test("a second count re-anchors, and the first one stays in the history", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: "2026-07-29",
      lines: [{ ingredientId: flour, countedQtyMilli: 2 * KG }],
    });
    await asOwner.mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 900_000 }],
    });
    expect(await levelOf(t, flour)).toBe(900_000);
    const takes = await asOwner.query(api.stock.takes, SLUG);
    expect(takes).toHaveLength(2);
    expect(takes[0].takenOn).toBe(TODAY); // newest first
  });

  test("counting nothing, counting twice, and counting a negative are all refused", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    const asOwner = t.withIdentity(OWNER);
    await expect(
      asOwner.mutation(api.stock.recordStocktake, { ...SLUG, takenOn: TODAY, lines: [] }),
    ).rejects.toThrow(/at least one/);
    await expect(
      asOwner.mutation(api.stock.recordStocktake, {
        ...SLUG,
        takenOn: TODAY,
        lines: [
          { ingredientId: flour, countedQtyMilli: 1 },
          { ingredientId: flour, countedQtyMilli: 2 },
        ],
      }),
    ).rejects.toThrow(/counted twice/);
    await expect(
      asOwner.mutation(api.stock.recordStocktake, {
        ...SLUG,
        takenOn: TODAY,
        lines: [{ ingredientId: flour, countedQtyMilli: -1 }],
      }),
    ).rejects.toThrow(/can't be negative/);
  });

  test("a don't-track-stock ingredient cannot be counted", async () => {
    // Salt and foil are costed and never counted (CONTEXT.md — Pantry).
    // Counting one would start a level that nothing ever deducts from.
    const t = await kitchen();
    const salt = await ingredient(t, "Salt", { trackStock: false });
    await expect(
      t.withIdentity(OWNER).mutation(api.stock.recordStocktake, {
        ...SLUG,
        takenOn: TODAY,
        lines: [{ ingredientId: salt, countedQtyMilli: 1 * KG }],
      }),
    ).rejects.toThrow(/running amount/);
  });
});

describe("waste and adjustments", () => {
  test("waste is signed negative whatever the caller sends, and needs a reason", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    const asOwner = t.withIdentity(OWNER);
    await movement(t, flour, 5 * KG, 1_000);

    await asOwner.mutation(api.stock.recordWaste, {
      ...SLUG,
      ingredientId: flour,
      qtyMilli: 2 * KG,
      note: "Weevils.",
    });
    expect(await levelOf(t, flour)).toBe(3 * KG);
    const waste = await t.run(async (ctx) =>
      ctx.db
        .query("stockMovements")
        .filter((q) => q.eq(q.field("reason"), "waste"))
        .first(),
    );
    expect(waste!.deltaMilli).toBe(-2 * KG);
    expect(waste!.note).toBe("Weevils.");

    // An unexplained −2 kg is indistinguishable from a typo six months on.
    await expect(
      asOwner.mutation(api.stock.recordWaste, {
        ...SLUG,
        ingredientId: flour,
        qtyMilli: 1,
        note: "   ",
      }),
    ).rejects.toThrow(/What happened/);
  });

  test("an adjustment moves the level but does NOT anchor freshness", async () => {
    // It corrects the number without anybody having verified the whole
    // amount, so it must not make a stale estimate read as freshly counted.
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await t.withIdentity(OWNER).mutation(api.stock.recordAdjustment, {
      ...SLUG,
      ingredientId: flour,
      deltaMilli: 750_000,
      note: "Bag found behind the sugar.",
    });
    expect(await levelOf(t, flour)).toBe(750_000);
    const row = await t.run(async (ctx) => ctx.db.get(flour));
    expect(row!.stockAsOf).toBeUndefined();
  });

  test("an adjustment of nothing is refused", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await expect(
      t.withIdentity(OWNER).mutation(api.stock.recordAdjustment, {
        ...SLUG,
        ingredientId: flour,
        deltaMilli: 0,
        note: "x",
      }),
    ).rejects.toThrow(/isn't one/);
  });
});

describe("the ledger explains the number", () => {
  test("running totals reconcile to the level, and superseded rows are marked", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    const asOwner = t.withIdentity(OWNER);
    await movement(t, flour, 5 * KG, 1_000);
    await asOwner.mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 4 * KG }],
    });
    await movement(t, flour, 3 * KG, 500); // back-dated

    const ledger = await asOwner.query(api.stock.ledgerFor, {
      ...SLUG,
      ingredientId: flour,
    });
    expect(ledger.levelMilli).toBe(4 * KG);
    expect(ledger.countedQtyMilli).toBe(4 * KG);
    // Newest first. The two pre-count rows are marked, not hidden: she
    // entered that receipt and the ledger has to be able to explain itself.
    const superseded = ledger.rows.filter((r) => r.superseded);
    expect(superseded).toHaveLength(2);
    expect(superseded.every((r) => r.reason === "purchase")).toBe(true);

    // The count's own row sits at the same instant as the anchor, so the sum
    // excludes it — but it is the turning point, not something the count
    // overrode, and it must not read as struck through.
    const anchorRow = ledger.rows.find((r) => r.isAnchor)!;
    expect(anchorRow.reason).toBe("stocktake");
    expect(anchorRow.superseded).toBe(false);
    expect(anchorRow.runningMilli).toBe(4 * KG);
    // Every row after the anchor reconciles to the level.
    expect(ledger.rows[0].runningMilli).toBe(ledger.levelMilli);
  });
});

describe("access", () => {
  test("staff reach none of it", async () => {
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    const asStaff = t.withIdentity(STAFF);
    await expect(
      asStaff.query(api.ingredients.list, { ...SLUG, today: TODAY }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.mutation(api.stock.recordStocktake, {
        ...SLUG,
        takenOn: TODAY,
        lines: [{ ingredientId: flour, countedQtyMilli: 1 }],
      }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      asStaff.query(api.stock.ledgerFor, { ...SLUG, ingredientId: flour }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  test("another kitchen's pantry is a NOT_FOUND, not a forbidden", async () => {
    // A wrong org must be indistinguishable from a nonexistent one.
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await expect(
      t.withIdentity(OTHER).query(api.stock.ledgerFor, {
        orgSlug: "kitchen-b",
        ingredientId: flour,
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      t.withIdentity(OTHER).mutation(api.stock.recordWaste, {
        orgSlug: "kitchen-b",
        ingredientId: flour,
        qtyMilli: 1,
        note: "nope",
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});

describe("confidence, end to end", () => {
  async function withStocktakeDay(day: number) {
    const t = await kitchen();
    await t.withIdentity(OWNER).mutation(api.orgs.updateProfile, {
      ...SLUG,
      stocktakeDay: day,
    });
    return t;
  }

  test("a kitchen that has never counted says so, and still shows its numbers", async () => {
    const t = await withStocktakeDay(3);
    const flour = await ingredient(t, "Flour");
    await movement(t, flour, 5 * KG, 1_000);
    const { rows, confidence } = await t
      .withIdentity(OWNER)
      .query(api.ingredients.list, { ...SLUG, today: TODAY });
    expect(confidence.state).toBe("neverCounted");
    // DESIGN.md §4 bans a number whose staleness is UNKNOWN, not one whose
    // staleness is stated. The level still renders.
    expect(rows.find((r) => r.id === flour)!.levelMilli).toBe(5 * KG);
  });

  test("counted today is fresh; two Wednesdays later it is dormant", async () => {
    const t = await withStocktakeDay(3); // Wednesday
    const flour = await ingredient(t, "Flour");
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.stock.recordStocktake, {
      ...SLUG,
      takenOn: TODAY,
      lines: [{ ingredientId: flour, countedQtyMilli: 1 * KG }],
    });

    const at = async (today: string) =>
      (await asOwner.query(api.ingredients.list, { ...SLUG, today })).confidence;
    expect((await at(TODAY)).state).toBe("fresh");
    expect((await at("2026-08-13")).state).toBe("stale");
    const dormant = await at("2026-08-20");
    expect(dormant.state).toBe("dormant");
    expect(dormant.missedCounts).toBe(2);
  });

  test("stocktake day is announced on the day, and not before", async () => {
    const t = await withStocktakeDay(3);
    const asOwner = t.withIdentity(OWNER);
    const dueOn = async (today: string) =>
      (await asOwner.query(api.ingredients.list, { ...SLUG, today })).confidence
        .dueToday;
    expect(await dueOn("2026-08-05")).toBe(true); // Wednesday
    expect(await dueOn("2026-08-06")).toBe(false);
  });
});

describe("concurrency", () => {
  test("ACCEPTANCE: the derived level is the ledger sum, whatever the order", async () => {
    // HONESTY NOTE, and it is the point of the test rather than a caveat:
    // convex-test SERIALISES transactions, so this cannot exercise a real
    // interleave and would pass against a stored counter too. What it does
    // prove is that the level is a pure function of a set of INSERTS — the
    // same rows in either order give the same answer — so there is no
    // read-modify-write left to lose. The structural guard in
    // enforcement.test.ts is what actually holds that line.
    const t = await kitchen();
    const flour = await ingredient(t, "Flour");
    await movement(t, flour, 5 * KG, 1_000);

    await Promise.all([
      t.withIdentity(OWNER).mutation(api.stock.recordWaste, {
        ...SLUG,
        ingredientId: flour,
        qtyMilli: 1 * KG,
        note: "Spilled.",
      }),
      t.withIdentity(OWNER).mutation(api.stock.recordWaste, {
        ...SLUG,
        ingredientId: flour,
        qtyMilli: 2 * KG,
        note: "Weevils.",
      }),
    ]);

    // Neither deduction is lost. With a stored counter, both writers would
    // have read 5 kg and one would have overwritten the other.
    expect(await levelOf(t, flour)).toBe(2 * KG);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("stockMovements").collect(),
    );
    expect(rows.reduce((sum, m) => sum + m.deltaMilli, 0)).toBe(2 * KG);
  });
});
