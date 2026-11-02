import { defineConfig } from "vitest/config";

// loadEnvFile never overwrites a variable that is already set, so the local Meilisearch file (npm run meili:env) is
// read first and wins over .env; values exported in the shell win over both.
for (const file of [".env.meilisearch", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file: unit tests still run; integration tests fail with a clear message.
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "frontend/src/app/api/**/*.test.ts", "frontend/src/app/lib/**/*.test.ts", "frontend/*.test.ts", "scripts/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "int",
          environment: "node",
          include: ["apps/*/src/**/*.int.test.ts", "packages/*/src/**/*.int.test.ts", "scripts/**/*.int.test.ts"],
          globalSetup: ["packages/db/test/global-setup.ts"],
          fileParallelism: false,
          // Database integration tests require the local disposable TEST_DATABASE_URL guard.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
