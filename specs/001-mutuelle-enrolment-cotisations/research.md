# Research: Mutuelle Enrolment POC

**Feature**: `001-mutuelle-enrolment-cotisations`  
**Date**: 2026-10-12  
**Sources**: `docs/base.md` §7–8, `spec.md` Clarifications, constitution v1.0.4

## Decision: HTTP framework — Fastify (lightweight), not Nest

- **Rationale**: Brief allows “Nest or lightweight”. POC week-1 value is domain + outbox + stubs; Fastify is enough for `/v1` commands, header auth, and Zod validation without Nest module ceremony.
- **Alternatives considered**: Nest (heavier DI, slower spike); Express (weaker TS story); Hono (fine, less common in PayFit-like Node shops).

## Decision: Persistence — PostgreSQL + SQL migrations

- **Rationale**: Brief requires Postgres for aggregate + outbox + processed_events. Use `pg` with versioned SQL migrations (node-pg-migrate or Drizzle migrate). Keep domain persistence behind repository ports.
- **Alternatives considered**: SQLite (weaker concurrent TX demo story); Prisma-only (OK later, more codegen for thin POC).

## Decision: Bus — in-process after transactional outbox

- **Rationale**: Brief §7C / §8: in-process queue OR LocalStack SQS; POC chooses in-process publisher draining `outbox` table. Documents “PayFit = SQS/EKS” in README only.
- **Alternatives considered**: LocalStack SQS (extra ops for week-1); direct sync call without outbox (violates constitution IV).

## Decision: Carrier activation — sync stub in worker (webhook in test pack)

- **Rationale**: Spec Clarifications: sync sufficient for §7E; webhook endpoint + signature + idempotency required in tests.
- **Alternatives considered**: Webhook-only activate (slower demo); real HTTP to Alan/AXA (out of scope).

## Decision: Experience — HTTP/curl first

- **Rationale**: Constitution VII + brief §7C/§7E. Bruno collection optional; React stretch after path works.
- **Alternatives considered**: Minimal React admin in week-1 (risks delaying domain proof).

## Decision: Money — integer EUR cents; periods in Europe/Paris

- **Rationale**: Spec Clarifications (beyond-checklist). Avoid float euros in events/payroll lines.
- **Alternatives considered**: Decimal strings (harder equality); UTC month (wrong for FR bulletin storytelling).

## Decision: Testing — Vitest + real Postgres for integration

- **Rationale**: Fast unit tests for FSM; integration against Postgres proves outbox same-TX and 403/idempotency.
- **Alternatives considered**: Jest (heavier); mocked DB only (misses outbox bugs).

## Decision: API + worker processes

- **Rationale**: Brief ship shape. Same codebase, two entrypoints (`src/main.ts`, `src/worker/index.ts`); Compose runs both later.
- **Alternatives considered**: Single process doing HTTP+poll (acceptable early, split before Compose demo).

## Decision: Seed load on boot

- **Rationale**: `docs/base.md` §7B five JSON files; load into DB/memory at startup (`npm run seed` or auto on boot in dev).
- **Alternatives considered**: Only fixtures in tests (weaker live demo).

## Decision: Payroll stub store — Postgres `payroll_lines`

- **Rationale**: Current `docs/base.md` §7C requires Postgres `payroll_lines` + demo GET. Same DB instance OK; Payroll must not write Enrolment.
- **Alternatives considered**: File JSON (rejected by amended brief).

## Decision: Audit store — Postgres `audit_log`

- **Rationale**: Brief §7C amended from file log to `audit_log` rows + GET last N.
- **Alternatives considered**: `data/audit.log` append-only file.

## Decision: AXA setup-sheet rates precede plan seed

- **Rationale**: Spec FR-016d / clarify — when `fixtures/axa-setup-sheet.json` present, AxaStub `rateParams` supply premium/`employerSharePct` inputs to half-up cents formula; else plan seed.
- **Alternatives considered**: Always plan seed (weaker OC “fiche” story).

## Resolved “unknowns”

No remaining NEEDS CLARIFICATION in Technical Context — all brief alternatives resolved above. Spec Clarifications session is authoritative for product rules (uniqueness, retries→Failed, platform-events, cents, Paris TZ, etc.).
