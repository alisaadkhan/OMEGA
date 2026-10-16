// Production build. The repo-root .env (also read by the API and worker) sets NODE_ENV, and Vite takes NODE_ENV from
// env files before it reads vite.config.ts; a build would then ship development React, which needs eval and breaks the
// Content-Security-Policy (audit SEC-14). Setting it here, before Vite starts, always gives a production build.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
