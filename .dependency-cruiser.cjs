/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-module-internals",
      comment: "A module may only import another module through its index.ts (spec §4.4).",
      severity: "error",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api/src/modules/[^/]+/",
        pathNot: ["^apps/api/src/modules/$1/", "^apps/api/src/modules/[^/]+/index\\.ts$", "^apps/api/src/modules/[^/]+/test-fixtures\\.ts$"],
      },
    },
    {
      name: "test-fixtures-only-in-tests",
      comment: "A module's test-fixtures.ts may be shared with other modules' tests, never with running code.",
      severity: "error",
      from: { pathNot: ["\\.test\\.ts$", "test-fixtures\\.ts$"] },
      to: { path: "^apps/api/src/modules/[^/]+/test-fixtures\\.ts$" },
    },
    {
      name: "no-module-internals-from-outside",
      comment: "Code outside the modules folder uses modules only through index.ts.",
      severity: "error",
      from: { pathNot: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/modules/[^/]+/", pathNot: "^apps/api/src/modules/[^/]+/index\\.ts$" },
    },
    {
      name: "raw-db-client-is-private",
      comment: "Only packages/db may use the raw postgres client (spec §4.2).",
      severity: "error",
      from: { pathNot: "^packages/db/src/" },
      to: { path: "^packages/db/src/client\\.ts$" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "(^|/)node_modules/" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
