// @vitest-environment node
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * ACCEPTANCE: the build fails if a Convex function is exported without going
 * through the withOrg builders (convex/lib/functions.ts), and if a table is
 * added without orgId. The ESLint no-restricted-imports rule catches the
 * import at lint time; this test catches anything that slips past it.
 */

const CONVEX_DIR = join(__dirname);

function convexSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "_generated" || entry === "lib") continue;
      files.push(...convexSourceFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (entry === "schema.ts" || entry === "auth.config.ts") continue;
    files.push(full);
  }
  return files;
}

describe("tenancy enforcement", () => {
  test("no Convex function file imports raw builders from _generated/server", () => {
    const offenders: string[] = [];
    for (const file of convexSourceFiles(CONVEX_DIR)) {
      const source = readFileSync(file, "utf8");
      if (/from\s+["']\.{1,2}\/(?:.*\/)?_generated\/server["']/.test(source)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `These files bypass convex/lib/functions.ts — the one place tenancy is enforced: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  test("publicMutation is used exactly twice, and both are named here", () => {
    // An unauthenticated WRITE is the highest-risk shape in the codebase:
    // no org, no role, no session, reachable by anyone who can guess a URL.
    // Adding one should be a deliberate act rather than something that
    // arrives in a diff — so this fails the build until someone comes and
    // edits this list. There are two:
    //
    //   invoices.recordView — takes a token and nothing else, writes one
    //     timestamp, and is idempotent. Nothing a caller sends is stored.
    //   feedback.submit — takes a token AND caller-supplied ratings, flags and
    //     words, which is a far larger surface. It is bounded instead by
    //     checking every input against the order it names (the item must be a
    //     line on that order, the axis must be one that item declares, the
    //     value must be an integer in −2..+2) and by writing AT MOST ONCE per
    //     order, ever, so a forwarded link cannot flood an item's profile.
    //
    // A third arriving here needs the same paragraph written about it.
    const callers = convexSourceFiles(CONVEX_DIR).filter((file) =>
      /\bpublicMutation\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(callers.map((f) => f.split("/").pop()).sort()).toEqual([
      "feedback.ts",
      "invoices.ts",
    ]);

    for (const file of ["invoices.ts", "feedback.ts"]) {
      const source = readFileSync(join(CONVEX_DIR, file), "utf8");
      expect(source.match(/\bpublicMutation\s*\(/g)).toHaveLength(1);
    }
  });

  test("every publicQuery is named here too", () => {
    // A weaker guard than the one above, deliberately: a public READ cannot
    // corrupt anything, so this is about what LEAKS rather than what breaks.
    // Each of these hands a stranger holding an unguessable token a payload
    // built for exactly that stranger, and the risk is a field creeping into
    // one of those payloads later. There are three:
    //
    //   invoices.byToken — the shared invoice. Its customer, its lines, its
    //     balance; never a cost, never a margin.
    //   feedback.byToken — the order a rating is about, so the form can name
    //     the items. Quantities and names, no money.
    //   messages.campaignByToken — her name, her logo and the flyer. NEVER
    //     the recipient list: a campaign link goes in an Instagram story, and
    //     who else received it is nobody's business but hers.
    //
    // A fourth arriving here needs the same paragraph written about it, and
    // a test asserting what its payload does NOT contain.
    const callers = convexSourceFiles(CONVEX_DIR).filter((file) =>
      /\bpublicQuery\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(callers.map((f) => f.split("/").pop()).sort()).toEqual([
      "feedback.ts",
      "invoices.ts",
      "messages.ts",
    ]);
  });

  test("only convex/invoices.ts allocates an invoice number", () => {
    // The number series is the one thing in Sous with a legal shadow, and its
    // safety under concurrency rests on a single read-modify-write of
    // orgs.invoiceSequence inside one mutation. A second allocation site
    // anywhere would be a second racer against the same counter — and
    // convex-test serialises transactions, so no unit test would ever catch
    // the duplicate it produced in production. This is structural because the
    // bug it prevents is invisible to the suite.
    // The allocation idiom itself, not every mention: provisioning legitimately
    // seeds the counter at 0 and getProfile legitimately reads it back.
    const offenders = convexSourceFiles(CONVEX_DIR).filter(
      (file) =>
        !file.endsWith("invoices.ts") &&
        /invoiceSequence\s*\+\s*1/.test(readFileSync(file, "utf8")),
    );
    expect(
      offenders,
      `these files write orgs.invoiceSequence: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  test("ACCEPTANCE: the invoice preview has zero Convex imports", () => {
    const invoiceDir = join(CONVEX_DIR, "..", "components", "invoice");
    const files = readdirSync(invoiceDir).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(invoiceDir, file), "utf8");
      expect(
        /from\s+["'](convex|@\/convex)/.test(source),
        `${file} imports Convex — the preview must stay a pure presentational component so 3.1 can wire real orders in unchanged.`,
      ).toBe(false);
    }
  });

  test("NEVER SHIP: the vendored chart files contain no transition-all", () => {
    // components/charts/ is exempt from ESLint (third-party style), so the
    // DESIGN.md §6 ban is enforced here instead — a Bklit re-install that
    // reintroduces `transition-all` fails the build, not the design gate.
    const chartsDir = join(CONVEX_DIR, "..", "components", "charts");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx?|css)$/.test(entry)) continue;
        const source = readFileSync(full, "utf8");
        if (/transition-all|transition:\s*all/.test(source)) offenders.push(entry);
      }
    };
    walk(chartsDir);
    expect(offenders, `transition-all found in: ${offenders.join(", ")}`).toEqual([]);
  });

  test("every table in the schema carries orgId", () => {
    const source = readFileSync(join(CONVEX_DIR, "schema.ts"), "utf8");
    const tables = [...source.matchAll(/(\w+):\s*defineTable\(\{([\s\S]*?)\}\)/g)];
    expect(tables.length).toBeGreaterThan(0);
    for (const [, tableName, body] of tables) {
      expect(
        /\borgId:\s*v\.string\(\)/.test(body),
        `Table "${tableName}" has no orgId — every document belongs to a kitchen (CONTEXT.md — Access).`,
      ).toBe(true);
    }
  });

  test("ACCEPTANCE: the pantry level stays derived, never a field on the ingredient", () => {
    // "Current quantity derives from the ledger; never stored as a mutable
    // field." Two batches logged at the same moment against the same flour
    // would both read the stored level, both write their own answer, and one
    // deduction would vanish silently and permanently. convex-test SERIALISES
    // transactions, so no unit test in this repo can ever reproduce that —
    // which is exactly why the guard is structural. It is the same argument
    // the invoiceSequence and paidCents guards above make.
    const source = readFileSync(join(CONVEX_DIR, "schema.ts"), "utf8");
    const ingredients = source.match(/ingredients:\s*defineTable\(\{([\s\S]*?)\}\)/);
    expect(ingredients).not.toBeNull();
    const offending = [...ingredients![1].matchAll(/^\s*(\w+):/gm)]
      .map((m) => m[1])
      .filter((field) =>
        /^(currentStockQtyMilli|stockQtyMilli|onHandMilli|quantityMilli|levelMilli)$/.test(
          field,
        ),
      );
    expect(
      offending,
      `ingredients must not store a stock level: ${offending.join(", ")}`,
    ).toEqual([]);

    // And nothing anywhere may patch one back into existence under another
    // name. Every write to the pantry is an INSERT into stockMovements.
    //
    // Setting one to `undefined` is exempt, and only that: it REMOVES the
    // field, which is what admin.stripStoredStockLevels exists to do once per
    // deployment. Assigning any value is the thing being banned.
    const patchers = convexSourceFiles(CONVEX_DIR).filter((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/\.patch\([^)]*,\s*\{([^}]*)\}/g)].some((patch) =>
        [
          ...patch[1].matchAll(
            /(?:currentStockQtyMilli|StockQtyMilli|onHandMilli)\s*:\s*([\w.]+)/g,
          ),
        ].some((assignment) => assignment[1] !== "undefined"),
      );
    });
    expect(
      patchers,
      `these files patch a stock level instead of appending a movement: ${patchers.join(", ")}`,
    ).toEqual([]);
  });

  test("ACCEPTANCE: a production log never recurses into a sub-recipe's ingredients", () => {
    // CONTEXT.md — Pantry: a sub-recipe line deducts from the SUB's finished
    // stock, never from its raw ingredients. Recursion would move flour and
    // butter with no production log behind them — no cost snapshot, no yield
    // variance, no overhang — and the buttercream's real cost would become
    // unanswerable. The honest path is production.logWithSub, which logs a
    // real batch of the sub.
    //
    // Structural because the failure is silent: recursion produces plausible
    // deductions that simply describe food nobody recorded making.
    const source = readFileSync(join(CONVEX_DIR, "production.ts"), "utf8");
    expect(
      /componentType !== "ingredient"\) continue;/.test(source),
      "production.ts no longer skips sub-recipe lines when deducting the pantry.",
    ).toBe(true);
    expect(
      /export const logWithSub/.test(source),
      "the 'log a buttercream batch too?' path is gone — nothing deducts the sub's leaves honestly.",
    ).toBe(true);
  });

  test("ACCEPTANCE: payment status stays derived, never a field on the order", () => {
    // "Payment is a table, not a state" (CONTEXT.md — Orders). The moment a
    // paid/balance field appears on `orders`, two concurrent payments become
    // a read-modify-write and one of them is silently lost: both read 0,
    // both write 40, and the order sits at $40 with $80 in the till. This
    // guard is structural because the bug it prevents is invisible.
    const source = readFileSync(join(CONVEX_DIR, "schema.ts"), "utf8");
    const orders = source.match(/orders:\s*defineTable\(\{([\s\S]*?)\}\)/);
    expect(orders).not.toBeNull();
    const offending = [...orders![1].matchAll(/^\s*(\w+):/gm)]
      .map((m) => m[1])
      .filter((field) =>
        /^(paidCents|paymentStatus|balanceCents|amountPaid|owedCents|settled)$/.test(
          field,
        ),
      );
    expect(
      offending,
      `orders must not store payment state: ${offending.join(", ")}`,
    ).toEqual([]);
  });

  test("ACCEPTANCE: only the boundary and /admin can reach impersonationSessions", () => {
    // This table IS a permission. `resolveOrg` refuses every call whose JWT
    // org claims disagree with the route, and an open row here is the single
    // documented exception — the only way to read a kitchen you are not a
    // member of.
    //
    // Structural because the failure is a silent widening: a future feature
    // that reads or writes this table from a third file would be granting
    // itself org access outside the one place tenancy is reviewed, and
    // nothing else in the codebase would notice. `convex/lib/` is skipped by
    // convexSourceFiles, so the boundary itself is already exempt; admin.ts
    // is the console that opens and closes sessions.
    const allowed = new Set(["admin.ts"]);
    const offenders = convexSourceFiles(CONVEX_DIR)
      .filter((file) => !allowed.has(basename(file)))
      .filter((file) => /impersonationSessions/.test(readFileSync(file, "utf8")))
      .map((file) => basename(file));
    expect(
      offenders,
      `impersonationSessions is a permission, not a table to read from: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
