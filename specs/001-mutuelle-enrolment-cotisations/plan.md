# Implementation Plan: Mutuelle Enrolment → Cotisations on Bulletin

**Branch**: `001-mutuelle-enrolment-cotisations` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-mutuelle-enrolment-cotisations/spec.md`  
**Brief**: [`docs/base.md`](../../docs/base.md) §7–11 (architecture, seed/mock matrix, stack, demo, week plan)  
**Governance**: [constitution v1.0.4](../../.specify/memory/constitution.md)

## Summary

Deliver a thin TypeScript Insurance vertical: command/query HTTP API + worker, Postgres (`enrolments`, `outbox`, `processed_events`, `idempotency_keys`, `audit_log`, `payroll_lines`, `dead_letter_counters`), pure Enrolment FSM, `InsurerGateway` with `AlanStub`/`AxaStub`, in-process outbox publisher to a Payroll stub that materialises Santé lines in EUR cents. **Stack choice:** Fastify as the brief’s “lightweight” Node option (not Nest). Week-1 validation is HTTP/curl against the §7E demo gate — no React required. Design cites `docs/base.md` for diagrams and seed file lists.

**§11 mapping:** Days 1–2 ≈ Phases 1–3 (setup + US1); Day 3–4 ≈ dual carrier + outbox/worker polish + terminate (through Phase 6 = demo-complete); Day 5 ≈ idempotency/dispense/demo/RFC. Week-2 items (proration engine, reconcile, real queue, thin UI) stay out unless promoted.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS  

**Primary Dependencies**: Fastify (HTTP API), `pg` + migrations (node-pg-migrate or Drizzle), Zod (validation), Vitest (tests), tsx (dev runner). Optional later: Docker Compose.  

**Storage**: PostgreSQL 16 — `enrolments`, `outbox`, `processed_events`, `idempotency_keys`, `audit_log`, **`payroll_lines`**, **`dead_letter_counters`** (FR-008a). Seed tables or JSON load for companies/employees/plans/reasons/admins (`company.carrier` seed-only — no runtime change API).  

**Testing**: Vitest — domain FSM unit tests first; API integration tests with testcontainers or local Postgres; contract checks against OpenAPI.  

**Target Platform**: macOS/Linux local + Docker Compose (`api`, `worker`, `db`)  

**Project Type**: Backend web-service (API + worker); HTTP-only experience for v1 demo  

**Performance Goals**: Demo-scale only per `docs/base.md` §8 — **no p95/SLA**. Worker confirms Pending→Active within a few seconds with sync stubs so §7E stays interactive.  

**Constraints**: Constitution I–VIII; transactional outbox; EUR cents; `Europe/Paris` periods; no Nest unless needed later; no real Alan/AXA; no React in week-1 critical path  

**Scale/Scope**: POC slice matching `docs/base.md` §6 POC row and §12 success criteria; FR only  

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Plan compliance |
| --- | --- | --- |
| I Bounded contexts | Pass | Separate `payroll` consumer package/module; no shared write to enrolment from payroll |
| II Carrier ACL | Pass | `InsurerGateway` interface + AlanStub/AxaStub only; domain free of carrier types |
| III Multi-tenant | Pass | Fastify preHandler checks `X-Company-Id` vs route; 403 tests |
| IV Outbox + idempotency | Pass | Same TX enrol+outbox; `idempotency_keys`; `processed_events` for webhooks/platform |
| V Honest FSM | Pass | 202 PendingExternal; sync stub activate; timeout stays Pending then Failed after 3; webhook reject→Failed |
| VI ANI shape | Pass | employerShareCents/employeeShareCents; half-up; employerSharePct ≥ 50 from seed/sheet |
| VII Seed/stub over scope | Pass | HTTP-only; JSON seed; stub carriers; skip React/SQS/K8s |
| VIII Testable domain first | Pass | Pure TS Enrolment + Vitest before wiring HTTP |

**Post-Phase 1 re-check**: Pass — data-model and contracts keep Payroll and Insurance stores separate; gateway port in contracts; no constitution violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-mutuelle-enrolment-cotisations/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   └── events.md
└── tasks.md                 # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
package.json
tsconfig.json
docker-compose.yml            # api, worker, db (after local path works)
migrations/                   # SQL migrations (T001/T007)
seed/
├── companies.json            # company-a / company-b
├── employees.json            # emp-a1 / emp-b1
├── plans.json                # sante-base
├── dispense-reasons.json
└── admins.json
fixtures/
├── employee-terminated.json
├── axa-setup-sheet.json
└── axa-webhook-active.json
demo/
├── README.md                 # curl script §7E
└── last-*-call.json          # gitignored runtime
src/
├── domain/
│   ├── enrolment.ts          # aggregate + FSM
│   ├── money.ts
│   └── types.ts
├── application/
│   ├── commands/
│   ├── handlers/
│   └── ports/
│       ├── insurer-gateway.ts
│       ├── clock.ts
│       └── repositories.ts
├── adapters/
│   ├── http/                 # Fastify routes + auth stub
│   ├── persistence/          # Postgres repos + outbox
│   ├── insurers/
│   │   ├── alan-stub.ts
│   │   └── axa-stub.ts
│   ├── bus/                  # in-process publisher
│   └── payroll/              # stub consumer
├── worker/
│   └── index.ts              # pending jobs + outbox drain
└── main.ts                   # api bootstrap
tests/
├── unit/
├── integration/
└── contract/
docs/
├── base.md
├── routes.md                 # optional mirror of OpenAPI
└── rfc-poc-assumptions.md    # short RFC (§10)
```

**Structure Decision**: Single TypeScript package at **repo root** `insurance-vertical/` (intentional delta from brief §7D `poc-insurance/` folder name — same ship shape). Hexagonal folders (`domain` / `application` / `adapters` / `worker`). Fastify = brief “lightweight”. UI deferred; demo via `demo/README.md` curls.

## Complexity Tracking

> No constitution violations requiring justification.
