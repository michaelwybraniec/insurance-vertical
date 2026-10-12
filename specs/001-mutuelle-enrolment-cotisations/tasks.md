---
description: "Task list for mutuelle enrolment → cotisations POC"
---

# Tasks: Mutuelle Enrolment → Cotisations on Bulletin

**Input**: Design documents from `/specs/001-mutuelle-enrolment-cotisations/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md  
**Brief order**: `docs/base.md` §7A/D  
**Tests**: Included (constitution VIII + spec test pack / SC gates)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete blockers)
- **[Story]**: `US1`…`US8` here = **spec delivery** User Stories 1–8. Canonical product ids = `docs/base.md` §4 **brief US1–US7** (+ Cancel = Domain API).

| Delivery tag | Brief (`docs/base.md`) |
| ------------ | ---------------------- |
| [US1] | brief **US1** Enrol |
| [US2] | brief **US4** Dual carriers |
| [US3] | brief **US5** Idempotency |
| [US4] | brief **US3** Terminate |
| [US5] | Domain API **Cancel** (not a brief US) |
| [US6] | brief **US2** Dispense |
| [US7] | brief **US6** Status |
| [US8] | brief **US7** My cover (stretch) |

## Path Conventions

Single package at repo root: `src/`, `tests/`, `seed/`, `fixtures/`, `demo/` per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize TypeScript/Fastify project skeleton

- [ ] T001 Create directory tree from plan.md (`src/domain`, `src/application`, `src/adapters`, `src/worker`, `tests/unit`, `tests/integration`, `tests/contract`, `seed/`, `fixtures/`, `demo/`, `migrations/`)
- [ ] T002 Initialize npm TypeScript project with Fastify, `pg`, Zod, Vitest, tsx, dotenv; scripts `dev`, `worker`, `migrate`, `seed`, `test`, `test:integration` in `package.json` and `tsconfig.json`
- [ ] T003 [P] Add ESLint + Prettier config in `eslint.config.js` and `.prettierrc`
- [ ] T004 [P] Add `.env.example` with `DATABASE_URL`, `CARRIER_WEBHOOK_SECRET=stub-secret`, `PORT=3000`
- [ ] T005 [P] Write seed JSON files per `docs/base.md` §7B + `data-model.md` with **locked demo ids**: `companies.json` (`company-a` alan, `company-b` axa, insuranceEnabled=true, planId=`sante-base`), `employees.json` (`emp-a1`@company-a, `emp-b1`@company-b, active=true), `plans.json` (`sante-base`, monthlyPremiumCents, employerSharePct≥50, proration `full_month`), `dispense-reasons.json` (`HAS_OWN_COVER`), `admins.json` (company.admin per company) — must match quickstart/demo curls
- [ ] T006 [P] Write fixtures `fixtures/employee-terminated.json` (required `eventId`, `companyId: company-a`, `employeeId: emp-a1` per FR-021b / quickstart), `fixtures/axa-setup-sheet.json` (premium/pct inputs), `fixtures/axa-webhook-active.json` (insurerEventId + enrolmentId/insurerMemberId + result)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infra before any user story  
**⚠️ CRITICAL**: No user story work until this phase completes

- [ ] T007 Add Postgres migrations for `enrolments`, `outbox`, `processed_events`, `idempotency_keys`, `audit_log`, `payroll_lines`, `dead_letter_counters` per `data-model.md` in `migrations/`
- [ ] T008 [P] Implement DB pool + migrate runner in `src/adapters/persistence/db.ts`
- [ ] T009 [P] Implement seed loader `npm run seed` in `src/adapters/persistence/seed.ts` loading `seed/*.json` (fail boot if any plan `employerSharePct` < 50)
- [ ] T010 [P] Implement stub auth preHandler (`X-Role`: company.admin|employee.self|system.worker|system.payroll_consumer, `X-Company-Id`, optional `X-Employee-Id`) with 403 on company mismatch in `src/adapters/http/auth.ts` (payroll stub may run in-process without HTTP role; comment FR-003)
- [ ] T011 [P] Implement `X-Correlation-Id` middleware (generate if absent) + structured logger; **propagate** correlationId into worker job context/logs (FR-027) in `src/adapters/http/correlation.ts` and `src/adapters/logging.ts`
- [ ] T012 Create domain money helpers (EUR cents, Paris month bounds; half-up employerShareCents + remainder employeeShareCents per `docs/base.md` §4) in `src/domain/money.ts` and `src/domain/period.ts`
- [ ] T013 Create application ports `InsurerGateway`, repositories, clock in `src/application/ports/insurer-gateway.ts`, `src/application/ports/repositories.ts`, `src/application/ports/clock.ts`
- [ ] T014 Bootstrap Fastify app shell registering plugins in `src/adapters/http/app.ts` and `src/main.ts`
- [ ] T015 Bootstrap worker entrypoint shell in `src/worker/index.ts`
- [ ] T016 [P] Unit-test money/period helpers in `tests/unit/money.test.ts` and `tests/unit/period.test.ts`

**Checkpoint**: Foundation ready — story implementation can begin

---

## Phase 3: User Story 1 — Enrol → Active → premium → payroll (Priority: P1) 🎯 MVP

**Goal**: Company A admin enrols employee; Pending→Active; premium cents; payroll Santé lines  
**Independent Test**: quickstart.md steps 1–6 for company-a / Alan

### Tests

- [ ] T017 [P] [US1] Write failing FSM unit tests (enrol→PendingExternal, activate→Active, reject→Failed, cancel/terminate→Ended, illegal transitions) in `tests/unit/enrolment.test.ts`
- [ ] T018 [P] [US1] Write failing contract assertions for POST enrol 202 shape against `contracts/openapi.yaml` in `tests/contract/enrolments.post.test.ts`

### Implementation

- [ ] T019 [US1] Implement Enrolment aggregate (statuses PendingExternal|Active|Failed|Dispensed|Ended; uniqueness ≤1 Pending/Active per company+employee) in `src/domain/enrolment.ts`
- [ ] T020 [US1] Implement enrolment + outbox repositories (same TX: insert PendingExternal + outbox row on enrol) in `src/adapters/persistence/enrolment-repo.ts` and `src/adapters/persistence/outbox-repo.ts` (idempotency store = T039)
- [ ] T021 [US1] Implement EnrolEmployee command handler (coverage=collective only; 404 unknown employee/plan; 409 if insurance disabled / HR inactive / existing Pending|Active; missing Idempotency-Key → 400; 202 PendingExternal) in `src/application/commands/enrol-employee.ts`
- [ ] T022 [US1] Implement AlanStub `createMember`/`cancelMember` logging to `demo/last-alan-call.json` in `src/adapters/insurers/alan-stub.ts`
- [ ] T023 [US1] Implement gateway factory resolving company.carrier (`alan`→AlanStub) in `src/adapters/insurers/gateway-factory.ts`
- [ ] T024 [US1] Implement worker job: load PendingExternal → gateway.createMember → Active + outbox EmployeeEnrolledInInsurance + PremiumInstructionIssued (cents, Paris month, half-up share formula); sync stub OK for §7E in `src/worker/activate-enrolment.ts`
- [ ] T025 [US1] Implement outbox publisher → in-process bus in `src/adapters/bus/in-process-bus.ts` and `src/worker/outbox-publisher.ts`
- [ ] T026 [US1] Implement Payroll stub consumer (idempotent upsert by eventId; two lines patronale/salariale into `payroll_lines`) in `src/adapters/payroll/payroll-stub.ts`
- [ ] T027 [US1] Register `POST /v1/companies/:companyId/enrolments` + `GET /v1/enrolments/:id` (enough for happy-path status) in `src/adapters/http/routes/enrolments.ts` (list/`includeEnded` polish = T056)
- [ ] T028 [US1] Register `GET /v1/companies/:companyId/payroll-lines` (company.admin scoped; FR-018b / `docs/base.md` §7C) in `src/adapters/http/routes/payroll-lines.ts`
- [ ] T029 [US1] Implement audit append helper + **wire enrol and activate** in US1; later stories wire dispense/cancel/terminate/fail in `src/adapters/persistence/audit-repo.ts`
- [ ] T030 [US1] Make T017–T018 pass; add integration test enrol→Active→payroll **and** duplicate PremiumInstructionIssued does not duplicate payroll lines (FR-018a) in `tests/integration/enrol-happy-path.test.ts`
- [ ] T031 [US1] Add cross-company enrol 403 integration test (Company A admin → Company B) in `tests/integration/tenancy.test.ts` per `docs/base.md` §4 edge table + §7A/D
- [ ] T068 [US1] Enrol validation tests: `coverage`≠collective → 400/422; insuranceEnabled=false → 409; unknown employee/plan → 404; HR inactive → 409 (FR-005a/b/c, FR-011c) in `tests/integration/enrol-validation.test.ts`

**Checkpoint**: MVP demo path for Company A works

---

## Phase 4: User Story 2 — Dual carriers Alan + AXA (Priority: P1)

**Goal**: Company B on AXA; different ACL logs; same domain event shapes  
**Independent Test**: quickstart step 7

### Tests

- [ ] T032 [P] [US2] Integration test Company B AXA path writes `demo/last-axa-call.json`, same PremiumInstruction shape as Alan, and sheet rates drive `employerShareCents`/`employeeShareCents` when fixture present (FR-016d) in `tests/integration/dual-carrier.test.ts`

### Implementation

- [ ] T033 [US2] Implement AxaStub reading `fixtures/axa-setup-sheet.json` when present; return `{ memberId, rateParams? }` for FR-016d in `src/adapters/insurers/axa-stub.ts`
- [ ] T034 [US2] Wire gateway factory `axa` → AxaStub; ensure domain events omit carrier-specific types; carrier only from seed (FR-017b) in `src/adapters/insurers/gateway-factory.ts`
- [ ] T035 [US2] Document dual-carrier curl in `demo/README.md` (steps for A then B per `docs/base.md` §7E)

**Checkpoint**: US4 brief acceptance — one product, two adapters

---

## Phase 5: User Story 3 — Idempotency & safe retries (Priority: P1)

**Goal**: Idempotency-Key replay; duplicate webhook no-op; retries then Failed  
**Independent Test**: quickstart step 8 + webhook duplicate test

### Tests

- [ ] T036 [P] [US3] Unit/integration tests for Idempotency-Key replay (**202** + same body) and missing key 400 in `tests/integration/idempotency.test.ts`
- [ ] T037 [P] [US3] Tests for webhook signature 401, unknown enrolment/member → 404 (FR-015b), duplicate insurerEventId no-op, `result=rejected` → Failed, retry then exhaustion → Failed + **`dead_letter_counters.count` incremented** (FR-008a) in `tests/integration/reliability.test.ts`
- [ ] T038 [P] [US3] Test re-enrol after **Failed** creates new enrolmentId (FR-011b); Ended/Dispensed cases = T067 after Phase 8 in `tests/integration/reenrol.test.ts`

### Implementation

- [ ] T039 [US3] Implement `idempotency_keys` repo + wire EnrolEmployee replay: same key → **202** + same body; scope `(companyId, route, key)` (FR-017a/FR-025) in `src/adapters/persistence/idempotency-repo.ts` and enrol handler
- [ ] T040 [US3] Implement `processed_events` inbox for webhooks + platform events in `src/adapters/persistence/processed-events-repo.ts`
- [ ] T041 [US3] Implement POST `/v1/webhooks/carriers/:carrier` with `X-Carrier-Signature`, enrolment lookup (`insurerMemberId` and/or `enrolmentId`), `confirmed`→activate (or 200 no-op if Active), `rejected`→Failed when Pending (FR-015c); required for test pack (sync stub still OK for §7E) in `src/adapters/http/routes/webhooks.ts`
- [ ] T042 [US3] Extend worker retries in `src/worker/activate-enrolment.ts`: timeout/transport → stay PendingExternal + increment `attemptCount`; after **3** → Failed + audit `fail` + increment `dead_letter_counters` row `activate_enrolment`; never silent Active (FR-008a)

**Checkpoint**: US5 reliability demoable

---

## Phase 6: User Story 4 — Terminate stops cover (Priority: P1)

**Goal**: EmployeeTerminated → Ended + cancel carrier + Stop + payroll inactive  
**Independent Test**: quickstart step 9

### Tests

- [ ] T043 [P] [US4] Integration test terminate Active, terminate Pending (compensate), and concurrent terminate-vs-activate (terminate wins — FR-015d) in `tests/integration/terminate.test.ts`
- [ ] T044 [P] [US4] Test duplicate platform eventId no-op in `tests/integration/platform-events.test.ts`

### Implementation

- [ ] T045 [US4] Implement terminate handler (Active/Pending → Ended; carrier cancel/compensate; outbox `EnrolmentCancelled`; `PremiumInstructionStop` only if Issued existed; audit append; race-safe vs activate — FR-021/FR-015d) in `src/application/handlers/employee-terminated.ts`
- [ ] T046 [US4] Implement POST `/v1/dev/platform-events` requiring `X-Role: system.worker` in `src/adapters/http/routes/platform-events.ts`
- [ ] T047 [US4] Payroll stub applies Stop idempotently in `src/adapters/payroll/payroll-stub.ts`
- [ ] T048 [US4] Add terminate curl to `demo/README.md` using `fixtures/employee-terminated.json`

**Checkpoint**: Leave-drift demo complete; §7E full script runnable

---

## Phase 7: User Story 5 — Admin cancel (Priority: P2)

**Goal**: Cancel Pending/Active → Ended + carrier compensate + Stop if needed; cross-company 403  
**Independent Test**: Cancel own-company Active; 403 on other company

### Tests

- [ ] T049 [P] [US5] Integration tests cancel Active/Pending + 403 cross-tenant + 409 on Dispensed/Failed/Ended in `tests/integration/cancel.test.ts`

### Implementation

- [ ] T050 [US5] Implement CancelEnrolment command (Ended + carrier compensate; same-TX outbox `EnrolmentCancelled`; `PremiumInstructionStop` if Issued existed; audit; 409 if Dispensed/Failed/Ended — FR-009/009a) in `src/application/commands/cancel-enrolment.ts`
- [ ] T051 [US5] Register POST `/v1/enrolments/:id/cancellations` in `src/adapters/http/routes/enrolments.ts`

---

## Phase 8: User Story 6 — Dispense (Priority: P2)

**Goal**: Dispense with reason → Dispensed; no premium; 409 if Pending/Active  
**Independent Test**: Dispense employee without Active cover; audit reason present

### Tests

- [ ] T052 [P] [US6] Unit/integration tests dispense happy path, invalid reason, 409 when Pending/Active, 409 when insurance disabled in `tests/integration/dispense.test.ts`

### Implementation

- [ ] T053 [US6] Implement DispenseEmployee command (validate reason catalog; Dispensed + audit; **no** PremiumInstruction; 409 if Pending/Active or insurance disabled — FR-010/010a) in `src/application/commands/dispense-employee.ts`
- [ ] T054 [US6] Register POST `/v1/companies/:companyId/dispenses` in `src/adapters/http/routes/dispenses.ts`
- [ ] T067 [US6] Test re-enrol after **Ended** (post-terminate/cancel) and **Dispensed** creates new enrolmentId (FR-011b remainder; needs T045/T050/T053) in `tests/integration/reenrol.test.ts`

---

## Phase 9: User Story 7 — Honest status visibility (Priority: P2)

**Goal**: GET detail shows Pending/Active/Failed/Dispensed/Ended + member + last premium  
**Independent Test**: GET after enrol Pending; after activate Active with premium summary

### Tests

- [ ] T055 [P] [US7] Contract/integration tests for GET enrolment + list `includeEnded` + cross-tenant GET 403 + `pendingAgeSeconds` when Pending + `GET .../audit` last-N company-scoped (FR-027/027a) in `tests/contract/enrolments.get.test.ts` (audit cases may live in same file or `tests/integration/audit.get.test.ts`)

### Implementation

- [ ] T056 [US7] Implement enrolment detail/list queries (default include Failed/Dispensed, exclude Ended; `includeEnded=true`) in `src/adapters/persistence/enrolment-repo.ts` and `src/adapters/http/routes/enrolments.ts`
- [ ] T057 [US7] Implement GET `/v1/companies/:companyId/audit?limit=` (company.admin scoped) in `src/adapters/http/routes/audit.ts`
- [ ] T058 [US7] Expose Pending age (`pendingAgeSeconds`) on PendingExternal views in `src/adapters/http/routes/enrolments.ts`

---

## Phase 10: User Story 8 — My cover stretch (Priority: P3)

**Goal**: employee.self read-only cover  
**Independent Test**: GET `/v1/me/cover` with X-Employee-Id; enrol denied for employee.self

### Tests

- [ ] T059 [P] [US8] Tests for my-cover 200 and enrol 403 as employee.self in `tests/integration/my-cover.test.ts`

### Implementation

- [ ] T060 [US8] Implement GET `/v1/me/cover` (`employee.self` + `X-Employee-Id`; plan/status/dates only; no cotisation admin detail) in `src/adapters/http/routes/me.ts`

---

## Phase 11: Polish & Cross-Cutting

**Purpose**: Demo packaging, docs, Compose

- [ ] T061 [P] Complete `demo/README.md` with full §7E curl script and headers
- [ ] T062 [P] Write short RFC assumptions in `docs/rfc-poc-assumptions.md` (FR, ANI, full_month, Paris, cents; audit = `audit_log` table per data-model, not file-only)
- [ ] T063 [P] Add `docker-compose.yml` for `api`, `worker`, `db` and document in root `README.md` (include note: PayFit prod bus ≈ SQS/EKS/TF; POC = in-process after outbox per `docs/base.md` §7C/§8)
- [ ] T064 [P] Mirror route summary in `docs/routes.md` linking `contracts/openapi.yaml`
- [ ] T065 Run full Vitest suite + manual §7E checklist from `specs/001-mutuelle-enrolment-cotisations/quickstart.md`
- [ ] T066 Complete §12 / SC-007 engineer checklist in `specs/001-mutuelle-enrolment-cotisations/quickstart.md` (five boxes; PR notes which commit proves each)

---

## Dependencies & Story Order

```text
Phase 1 Setup → Phase 2 Foundational
    → US1 (MVP enrol path)
    → US2 (dual carrier)    // needs US1 worker/gateway
    → US3 (idempotency)     // needs US1 enrol
    → US4 (terminate)       // needs US1 Active + payroll
    → US5 (cancel)          // needs US1
    → US6 (dispense)        // needs foundation + seed reasons
    → US7 (GET status)      // can start after US1 GET exists; polish after activate
    → US8 (stretch)
    → Polish
```

**MVP scope**: Phases 1–3 (Setup + Foundational + US1)  
**Demo-complete (§7E)**: through Phase 6 (US4 terminate)  
**Full POC**: through Phase 11

## Parallel Opportunities

- After T006: seed/fixtures already [P]
- After Foundational: T017/T018 tests [P]; later story tests [P] within phase
- US5 / US6 can proceed in parallel after US1 if two implementers (different command files)
- Polish T061–T064 [P]

## Parallel example (US1)

```bash
# After T019 domain exists:
# Dev A: T020 persistence
# Dev B: T022 AlanStub
# Then integrate T021/T024
```

## Implementation Strategy

1. Ship US1 vertical slice first (constitution VIII).  
2. Add US2–US4 for full §7E demo.  
3. Layer US5–US7 for completeness; US8 optional.  
4. Compose + RFC last (`docs/base.md` §7C).

## base.md alignment notes (post-analyze)

| Brief (`docs/base.md`) | Spec / tasks |
| ---------------------- | ------------ |
| Edge: timeout stay Pending + retry; Failed after 3 | T042 / FR-008a (+ audit on fail); base.md §4 amended |
| FSM: reject → Failed | T041 / FR-015c |
| Money = employerShareCents / employeeShareCents | contracts + base.md §4 payloads + FR-016 |
| Edge: wrong company → 403 | T031 (+ T055 GET 403) |
| Edge: duplicate webhook inbox | T037 / T040; **SC-003b** (test pack) |
| Concurrent terminate vs activate | T043 / T045 / FR-015d |
| No carrier-change API (seed A=alan, B=axa) | T005 / T034 / FR-017b |
| Re-enrol after Failed | T038 / FR-011b |
| Re-enrol after Ended/Dispensed | T067 / FR-011b |
| Dead-letter counter | `dead_letter_counters` + T007/T037/T042 |
| Audit + payroll_lines in DB | T007 / T029 / T062 / plan Storage |
| Prod bus ≈ SQS; POC in-process | T063 README note |
| Brief US1–US7 canonical; Cancel = API | Mapping table at top of this file + `spec.md` Stories |
| No p95/SLA (demo-scale) | `docs/base.md` §8; plan Performance Goals |
| Half-up cents + enrol replay 202 | T012/T024; T036 |
