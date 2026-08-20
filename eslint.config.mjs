import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored agent-skill scripts, not application code.
    ".claude/**",
    "convex/_generated/**",
    // Bklit UI chart sources, vendored via the shadcn registry. Third-party
    // style; patched only for NEVER SHIP violations (transition-all etc.),
    // which convex/enforcement.test.ts scans for so re-installs can't
    // silently regress. Sous-authored chart code lives in
    // components/charts-sous/ and IS linted.
    "components/charts/**",
  ]),
  // The tenancy boundary: Convex functions may only be built via
  // convex/lib/functions.ts. Raw builder imports fail the build.
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["./_generated/server", "../_generated/server"].map(
            (name) => ({
              name,
              importNames: [
                "query",
                "mutation",
                "internalQuery",
                "internalMutation",
                "action",
                "internalAction",
                "httpAction",
              ],
              message:
                "Use the builders in convex/lib/functions.ts — tenancy is enforced there and nowhere else (CONTEXT.md — Access).",
            }),
          ),
        },
      ],
    },
  },
]);

export default eslintConfig;
