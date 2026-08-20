import "server-only";
import { launchBrowser } from "./browser";

/**
 * The invoice, printed.
 *
 * Extracted so the download route and the email route cannot drift: the
 * attachment a customer receives and the file she checks beforehand have to be
 * the same bytes, and the only way to guarantee that is one function.
 *
 * It renders nothing itself. It points a real browser at /i/[token]/print —
 * the same component, the same stylesheet, the same fonts — and prints the
 * page.
 */
export async function renderInvoicePdf(
  token: string,
  origin: string,
): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    // A4 at 96dpi. Set explicitly so the md: breakpoint resolves the same way
    // it would on her desktop — the unit-price column is hidden below it, and
    // a PDF that silently dropped a column would not be the same document.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

    const target = new URL(`/i/${encodeURIComponent(token)}/print`, origin);
    await page.goto(target.toString(), { waitUntil: "networkidle0" });
    // The page states when it is the finished document, rather than us
    // guessing from a timer.
    await page.waitForSelector("[data-invoice-ready]", { timeout: 15_000 });
    // Webfonts specifically: networkidle0 can land before the last face has
    // been applied, and a PDF typeset in the fallback is not pixel-identical
    // to anything.
    await page.evaluate(() => document.fonts.ready);

    return await page.pdf({
      format: "a4",
      // The card background and the "How to pay" panel are backgrounds; a
      // print that dropped them would be a different document.
      printBackground: true,
      // None: the print page supplies its own padding, so the margin is the
      // component's rather than the printer's, and both surfaces agree.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: false,
    });
  } finally {
    // In a finally: a thrown render must not leave a Chromium process behind
    // to accumulate until the host runs out of memory.
    await browser.close();
  }
}
