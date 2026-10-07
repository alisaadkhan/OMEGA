import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["frontend/**", "**/node_modules/**", "**/dist/**", "docs/**", "reference_files/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs", globals: { module: "writable" } } },
  { files: ["scripts/**", "packages/db/src/migrate-cli.ts"], rules: { "no-console": "off" } },
]);
