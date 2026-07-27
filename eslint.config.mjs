import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These components synchronise with an *external* system (the platform's
    // own HTTP API) on mount and when their filters change — exactly the case
    // `useEffect` exists for. The rule targets derived state, which these are
    // not, so it is relaxed for this narrow set of data-fetching views.
    files: [
      "src/components/studio/monitor-view.tsx",
      "src/components/studio/sdk-view.tsx",
      "src/components/studio/versions-view.tsx",
      "src/components/studio/designer/designer.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    // Generated SDK source is emitted as template strings, not authored code.
    files: ["src/lib/core/sdk/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".data/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
