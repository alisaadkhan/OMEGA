import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: unit tests still run; integration tests fail with a clear message.
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "frontend/src/app/api/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "int",
          environment: "node",
          include: ["apps/*/src/**/*.int.test.ts", "packages/*/src/**/*.int.test.ts"],
          globalSetup: ["packages/db/test/global-setup.ts"],
          fileParallelism: false,
          // The test database is remote (Supabase, ap-south-1): tests are bound by network round trips, not CPU.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
