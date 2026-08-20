import "server-only";
import puppeteer, { type Browser } from "puppeteer-core";

/**
 * A headless Chromium, wherever Sous happens to be running.
 *
 * Chromium rather than a PDF library because the invoice is HTML, Tailwind,
 * `oklch()` colours and four self-hosted webfonts. A library with its own
 * layout engine would mean a second invoice component maintained by hand, and
 * "the PDF is pixel-identical to what she screenshots" would be a promise
 * nothing could keep. Rendering the real page in a real browser makes it a
 * structural fact instead.
 *
 * It also means the fonts come free: the print page loads them through Next's
 * normal pipeline, so there are no .ttf files to ship and keep in sync.
 */

/** macOS/Linux install locations, tried in order after CHROME_PATH. */
const LOCAL_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function localExecutable(): Promise<string | null> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const { access } = await import("node:fs/promises");
  for (const candidate of LOCAL_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

export async function launchBrowser(): Promise<Browser> {
  const local = await localExecutable();
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }

  // Serverless: the bundled Linux build. Imported lazily so a machine with a
  // real Chrome never pays to load it.
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
