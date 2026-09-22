import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    files: ["frontend/features/{admin,member,ceo}/*.tsx"],
    // Existing screens use full navigation across account/role boundaries.
    // Keep these suggestions visible without changing authentication UX in a cleanup.
    rules: { "@next/next/no-html-link-for-pages": "warn" },
  },
  {
    files: [
      "frontend/features/admin/{AdminApp,NetworkPanel}.tsx",
      "frontend/features/admin/use-admin-data.ts",
      "frontend/features/teams/TeamSelectionScreen.tsx",
      "frontend/features/member/TaskCard.tsx",
    ],
    // React Compiler is not enabled. Track its migration suggestions separately
    // from rules-of-hooks, which remain errors. No warnings are suppressed.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
