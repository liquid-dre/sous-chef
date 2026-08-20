import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * puppeteer-core resolves Chromium through Node's own module and filesystem
   * APIs, so bundling it breaks the executable lookup at runtime. Next
   * already auto-externalises @sparticuz/chromium; puppeteer-core is not on
   * that list and has to be named.
   */
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
};

export default nextConfig;
