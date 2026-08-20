// @vitest-environment node
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The specimen's shell replica must not drift from the shell.
 *
 * `app/design-system/admin/page.tsx` reproduces three class strings from
 * components/shell/app-shell.tsx so the impersonation banner's offsets can be
 * measured in a browser. It has to be a replica rather than the real
 * `AppShell` because AppShell mounts `AlertsBadge` and `OrgSwitcher`, both of
 * which query Convex — and /design-system is a public route with no session,
 * so mounting it there throws. (That is why app/design-system/shell fails to
 * load, independently of this.)
 *
 * A replica is only worth having if it cannot go quietly stale. These are the
 * three lines that carry the geometry: the sidebar's height and stick point,
 * the fixed mobile bar's offset, and main's padding. If any of them changes in
 * the shell, this fails and the specimen has to be brought back into step.
 */

const GEOMETRY = [
  // The sidebar is exactly the banner's height short of the viewport, and
  // sticks below it rather than under it.
  'className="sticky top-[var(--banner-h)] hidden h-[calc(100dvh-var(--banner-h))] w-60 shrink-0 flex-col border-r bg-card md:flex"',
  // The fixed mobile bar sits BELOW the strip. Without the offset the strip
  // is simply covered on every phone.
  'className="fixed inset-x-0 top-[var(--banner-h)] z-40 flex h-14 items-center justify-between border-b bg-card px-4 md:hidden"',
  // main clears the fixed bar and takes NO banner offset — the strip is in
  // normal flow and has already pushed this element down.
  'className="min-w-0 flex-1 px-4 pt-18 pb-32 md:px-6 md:pt-8 md:pb-8"',
];

describe("the impersonation banner's geometry", () => {
  const shell = readFileSync(join(__dirname, "app-shell.tsx"), "utf8");
  const specimen = readFileSync(
    join(__dirname, "..", "..", "app", "design-system", "admin", "page.tsx"),
    "utf8",
  );

  for (const line of GEOMETRY) {
    test(`shell and specimen agree on ${line.slice(11, 46)}…`, () => {
      expect(
        shell.includes(line),
        "components/shell/app-shell.tsx changed — update GEOMETRY and the specimen replica together.",
      ).toBe(true);
      expect(
        specimen.includes(line),
        "the specimen replica has drifted from the shell it claims to reproduce.",
      ).toBe(true);
    });
  }

  test("the strip's own height matches --banner-h", () => {
    // THE bug this file exists for. --banner-h offsets the fixed mobile bar
    // and the sticky sidebar against the strip; if the strip is taller than
    // the variable claims, the bar sits on top of it. Measured at 380px, the
    // first draft wrapped to 93px while the variable said 40px.
    //
    // h-14 (3.5rem) on a strip that cannot wrap — overflow-hidden and a
    // truncated label — is what makes the number true rather than hopeful.
    const strip = readFileSync(
      join(__dirname, "impersonation-banner.tsx"),
      "utf8",
    );
    expect(
      /className="flex h-14 items-center justify-between gap-3 overflow-hidden/.test(
        strip,
      ),
      "the banner must stay a fixed h-14 that cannot wrap, or --banner-h becomes a lie.",
    ).toBe(true);
    expect(
      /flex-wrap/.test(strip),
      "the banner must not wrap: a second line makes it taller than --banner-h.",
    ).toBe(false);
  });

  test("the shell only sets --banner-h when there is a banner", () => {
    // 0px when absent is what keeps every offset above a no-op for the 99% of
    // sessions that are nobody's but their own.
    expect(
      /"--banner-h": banner \? "3\.5rem" : "0px"/.test(shell),
    ).toBe(true);
  });
});
