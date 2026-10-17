# Rentapi frontend
Vite + React + React Router. `npm install && npm run dev` (API proxied from `/api` to `API_TARGET`, default http://localhost:8000).

- `src/api/` fetch client + one service per backend resource (contract: `docs/API.md`)
- `src/hooks/useApi.js` data loading with loading/error/reload
- `src/context/` theme (light default) and auth (token + current user)
- `src/layouts/` page shells, `src/pages/` routes (`dashboard/` is behind `RequireAuth`)
- `src/components/` reusable UI, `src/lib/format.js` number/money/date helpers

There is no mock data: with no backend running, pages show an error state with Retry.
