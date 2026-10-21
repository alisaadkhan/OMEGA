# MUSHIN web app

The React 18 + Vite single-page app: the public site, customer sign-in and dashboard, and the staff console
(`#/admin`). It talks only to the MUSHIN API (`/api`) and to Supabase Auth with the publishable key.

```bash
npm install            # this folder has its own lockfile
npm run dev            # Vite dev server on :5173 (proxies /api to the API on :4000)
npm run build          # production build into dist/
```

Run the whole stack (API, worker, web) from the repository root with `npm run dev`. Pages, states and copy are
specified in `docs/design/FRONTEND_REQUIREMENTS.md` and `docs/design/FIGMA_UI_SPEC.md`; visual tokens live in
`src/styles/theme.css`.
