import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // convex-test runs functions in an edge-like runtime; the enforcement
    // test opts back into node with a @vitest-environment pragma.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: [
      "convex/**/*.test.ts",
      "lib/**/*.test.ts",
      "test/**/*.test.ts",
      "components/**/*.test.ts",
    ],
  },
});
