# MutuelleFit static demo

Vite SPA that **reuses** `web/src` and intercepts `fetch('/v1/...')` with an in-memory mock (enrol → Pending → Active, payroll lines, impulses, cancel / dispense / terminate / reset).

## Commands

From repo root:

```bash
npm install --prefix demo/static
npm run demo:dev
npm run demo:build
```

| Script | Port / output |
|--------|----------------|
| `demo:dev` | http://localhost:5812 |
| `demo:build` | `demo/static/dist` |
| `demo:preview` | http://localhost:5812 |

Default Vite `base` is `/insurance-vertical/` for GitHub Pages project sites. For a user site or relative hosting:

```bash
VITE_BASE=./ npm run demo:build
```

## What is real vs mock

| Piece | Static demo |
|-------|-------------|
| UI (`web/src`) | Real React app |
| API / Postgres / worker | Mocked in `src/mock-api.ts` |
| Alan / AXA ACL files | Not written to disk |
| Idempotency / FSM | Approximated in memory |

For the full §7E curl path against a live stack, see [`../README.md`](../README.md).
