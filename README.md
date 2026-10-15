# Insurance Vertical (PayFit POC)

Multi-company **mutuelle enrolment → cotisations on the bulletin** — a thin DDD Insurance vertical for a PayFit-shaped platform.

## Quick start

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run migrate && npm run seed
npm run dev       # API :3810
npm run worker    # Pending activate + outbox → payroll stub
npm run web:dev   # UI :5810 (proxies /v1 → :3810)
```

**Admin UI:** http://localhost:5810  
**Static demo (no API/DB):** `npm run demo:dev` → http://localhost:5812 · build: `npm run demo:build` → [`demo/static/`](demo/static/)  
**API docs:** http://localhost:3810/docs · routes: [`docs/routes.md`](docs/routes.md) · demo: [`demo/README.md`](demo/README.md) · brief: [`docs/base.md`](docs/base.md)

**Ports (unique to this repo):** UI `5810` · API `3810` · Postgres `5433` (Compose host) · see [`hub.yaml`](hub.yaml)

**Bus note:** PayFit prod bus ≈ SQS/EKS/TF; this POC uses a transactional outbox published to an in-process bus (`docs/base.md` §7C/§8).

## Tests

```bash
npm test
```

## Spec Kit

- Constitution: `.specify/memory/constitution.md`
- Feature: [`specs/001-mutuelle-enrolment-cotisations/`](specs/001-mutuelle-enrolment-cotisations/)
- Assumptions: [`docs/rfc-poc-assumptions.md`](docs/rfc-poc-assumptions.md)

## Repo

https://github.com/michaelwybraniec/insurance-vertical
