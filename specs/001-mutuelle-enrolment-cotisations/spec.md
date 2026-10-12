# Feature Specification: Mutuelle Enrolment → Cotisations on Bulletin

**Feature Branch**: `001-mutuelle-enrolment-cotisations`

**Created**: 2026-10-12

**Updated**: 2026-10-12

**Status**: Spec complete (ready to implement)

**Input**: Full POC brief — multi-company payroll-native Insurance vertical (enrol/dispense, Alan+AXA adapters, premium instructions → Payroll stub, terminate, outbox/idempotency, FR ANI shape).

## Source Authority

| Role | Document |
| --- | --- |
| Product & architecture brief (canonical detail) | [`docs/base.md`](../../docs/base.md) §1–14 |
| Governance | [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) v1.0.4 |
| Domain agent skills | `/insurance-domain`, `/insurer-acl`, `/insurance-demo` |

**Optimization rule:** This spec states *testable* outcomes and priorities. Narrative context, diagrams, route tables, event payload shapes, seed file lists, stack choices, week plan, and deliverable templates live in `docs/base.md` — cite the section; do not re-copy unless the requirement must stand alone for acceptance.

### Brief → Spec map

| `docs/base.md` | Use here |
| --- | --- |
| §1–3 Context / problem / pitch | Background only (not re-specified) |
| §4 Solution, US1–7, edges, roles, API, events, data flow | User stories, FRs, entities (this file) |
| §5 Regulatory / ANI | FR cotisation + SC employer ≥50% |
| §6 Scale | POC bounds in Assumptions; pilot+ out of scope |
| §7 Architecture, build/seed/mock matrix, FSM, sequences | Planning inputs (cite); demo gate cites §7E |
| §8 Stack | `/speckit-plan` only |
| §9 Demo script | Success criteria + pointer to §9 / §7E |
| §10 Deliverables | Planning/impl checklist pointer |
| §11 Week plan | `/speckit-tasks` input |
| §12 Success criteria | SC-* below |
| §13 Non-goals | FR MUST NOT + Assumptions |
| §14 One-pager | Cheat sheet for reviews (cite) |

## Clarifications

### Session 2026-10-12

- Q: How many in-flight or active enrolments may one employee have at the same company at once? → A: At most one PendingExternal or Active per employee+company; Ended/Dispensed allow a new enrol (user chose A; brief only partial via §4 409 “already active / terminated”)
- Q: How should the premium instruction period be derived for an enrolment? → A: Whole calendar month containing `effectiveFrom` (e.g. 2026-04-01→2026-04-30) — **partial brief**: §4 example `period: 2026-04`, UI period column, §7C `proration: full_month`
- Q: Must the POC demo gate require an HTTP carrier webhook, or is sync stub activation enough? → A: Sync stub activation sufficient for §7E demo gate; webhook endpoint optional but required in test pack for duplicate `insurerEventId` — **partial brief**: §7C “Either stub activates sync, or add webhook”
- Q: Which currency and money unit does the POC use for shares? → A: EUR only; integer **cents** canonical (supersedes any earlier “decimal euros” wording; no multi-currency) — **brief §4 payloads** + clarify Money unit
- Q: May Failed enrolments be replaced by a new EnrolEmployee for the same employee+company? → A: Yes — Failed is not Pending/Active, so re-enrol allowed (new id) — **not in brief**; Spec Kit default consistent with uniqueness rule A
- Q: What values may `coverage` take on EnrolEmployee? → A: POC accepts only `collective` (single Santé Base plan) — **partial brief**: field present in §4 command, no enum defined
- Q: May DispenseEmployee run while PendingExternal or Active exists for that employee+company? → A: No — 409; dispense only when no in-flight/active enrolment (enrol **or** dispense) — **partial brief**: §5 “Enrol or Dispense”
- Q: What is Idempotency-Key scope and lifetime? → A: Scope `(companyId, HTTP route, Idempotency-Key)`; no TTL in POC (store until manually cleared / forever for demo); required on enrol only — **partial brief**: enrol header only §4; TTL absent → Spec Kit POC default
- Q: How are employerShare/employeeShare Money amounts computed from the plan? → A: `employerShareCents = round(monthlyPremiumCents * employerSharePct/100)` (half-up), `employeeShareCents = monthlyPremiumCents - employerShareCents`, EUR — **partial brief**: §4 example + §7B plan seed fields; field names locked to *Cents
- Q: What if company Insurance is not enabled? → A: EnrolEmployee and DispenseEmployee MUST 409 — **partial brief**: happy path “Insurance enabled” §4
- Q: How far do timeout retries and DLQ go in the POC? → A: Worker retries PendingExternal up to 3 attempts then **Failed** + dead-letter log/counter (no broker DLQ; do not stay Pending after exhaustion) — **brief §4 edge + constitution V amended** to match
- Q: How is webhook “carrier sig” enforced? → A: Stub shared-secret header (e.g. `X-Carrier-Signature: stub-secret`) validated in tests; reject 401 if missing/wrong when webhook endpoint is hit — **partial brief**: §4 “carrier sig”
- Q: What terminal status does admin CancelEnrolment produce? → A: `Ended` (same as terminate/cancel FSM); emit cancel + Stop events as applicable — **full/partial brief**: §7 FSM Active→Ended via terminate/cancel; event name `EnrolmentCancelled` in §4 payloads
- Q: How does the POC ingest EmployeeTerminated for the demo? → A: MUST expose `POST /v1/dev/platform-events` accepting the terminated fixture — **partial/full brief**: §7C / §7E step 9
- Q: What audit surface is in POC scope? → A: Append rows to Postgres `audit_log` (JSON payload) + GET last N as JSON (no full audit UI) — **full brief**: §7C Audit UI row (amended) + §4 stores
- Q: When AXA setup-sheet rates exist, what drives premium Money? → A: Prefer setup-sheet rates when present; else plan seed; still emit EUR `employerShareCents`/`employeeShareCents` via share formula — **partial brief**: §4 ACL + §7C fiche fixture
- Q: effectiveFrom / unknown employee or plan / list history? → A: Unknown employee/plan (or employee not in company) → 404; `effectiveFrom` accepted as provided for POC (no past/future window); list cover defaults to excluding Ended unless `?includeEnded=true` — was deferred, now locked as POC defaults
- Q: Which timezone defines the premium calendar month? → A: `Europe/Paris` — **partial brief**: FR-only POC §5/§13; TZ absent → Spec Kit default for FR
- Q: What if Idempotency-Key is missing or blank on enrol? → A: **400** — **partial brief**: key required on enrol §4
- Q: How does Payroll stub handle duplicate Issued/Stop deliveries? → A: Idempotent upsert by instruction `eventId` (fallback enrolmentId+period+kind); duplicate Stop is no-op — **partial brief**: at-least-once outbox/bus §4
- Q: How does platform-events ingress handle duplicate Terminated? → A: Idempotent by platform `eventId` (required on fixture); duplicate → no-op — **partial brief**: reliability / processed_events pattern §4
- Q: Can company.carrier change while an enrolment is PendingExternal or Active? → A: No for POC — carrier is seed-configured and immutable while in-flight/active; no admin “pick carrier” API in v1 — **partial brief**: experience row vs company.carrier seed; POC chooses seed-only
- Q: What minor unit is Money? → A: Integer **EUR cents** in events and payroll lines; plan seed may use euros but conversion to cents is canonical — **partial brief**: Money type §4; exact unit absent → Spec Kit default
- Q: Who may call platform-events and audit GET? → A: `POST /v1/dev/platform-events` requires `X-Role: system.worker` (or equivalent system role); audit GET requires `company.admin` scoped to `X-Company-Id` (filter that company) — **not in brief**; Spec Kit security default for stub identity
- Q: How does a carrier webhook locate the enrolment? → A: Payload MUST include `insurerMemberId` and/or `enrolmentId`; unknown → 404; then confirm/reject command — **partial brief**: webhook maps to confirm/reject §4
- Q: Re-enrol in same calendar month after Ended? → A: Allowed; Payroll upsertes lines for new enrolmentId+period (prior Ended history retained) — consistent with uniqueness + payroll idempotency rules
- Q: Canonical Money field names on PremiumInstructionIssued? → A: `employerShareCents` / `employeeShareCents` (integer EUR cents); brief §4 payloads amended to match contracts — **was partial naming fork; closed**
- Q: Concurrent terminate vs activate? → A: **Terminate wins** — must not leave Active for a terminated employee; compensate member if create raced; idempotent Stop — **not in brief**; Spec Kit reliability default
- Q: Cancel on Dispensed / Failed / already Ended? → A: **409** illegal transition — **partial brief**: FSM illegal transitions rejected
- Q: Webhook when already Active (confirmed) or not Pending (rejected)? → A: Already Active + same member → **200 idempotent no-op**; reject when not Pending → **200 no-op** (at-least-once safe) — **Spec Kit default**
- Q: What increments worker attemptCount? → A: Timeout/transport failure on `createMember` only; webhook `rejected` → Failed without consuming a retry attempt — **Spec Kit default**
- Q: Round mode for odd cents? → A: Half-up on `employerShareCents`; employee gets remainder — **brief §4 payloads amended** (was Spec Kit default)
- Q: Default list includes Failed/Dispensed? → A: **Yes**; exclude Ended only unless `includeEnded=true` — **partial brief**: US6 shows Failed/Dispensed; FR-028a
- Q: Correlation id transport? → A: Header `X-Correlation-Id` (generate if absent); propagate to worker + stub logs — **partial brief**: observability correlationId §4
- Q: Idempotent enrol replay HTTP status? → A: **202** + same body as first accept — **partial brief**: 202 on enrol §4
- Q: Seed `employerSharePct` below 50? → A: Seed/boot MUST fail validation — **partial brief**: ≥50 invariant §5/§7B
- Q: Is there a POC latency/p95 SLA? → A: **No** — demo-scale only; §7E/§9 correctness over load numbers — **brief §8 amended** (was inventing p95 in plan)

**Clarify decision rule (this project):** (1) If fully in `docs/base.md`, use that. (2) If partially in brief, use the recommendation implied by that partial text. (3) If absent, use Spec Kit recommended default. Record source on each Q→A line.

## User Scenarios & Testing *(mandatory)*

**Canonical story IDs** = `docs/base.md` §4 **US1–US7**. Spec Kit sections below are **delivery order** (Priority); each title ends with the brief US id. Cancel is Domain API–scoped (not a brief US) — see brief footnote.

| Brief US (`docs/base.md`) | Delivery section below | Priority |
| ------------------------- | ---------------------- | -------- |
| **US1** Enrol | User Story 1 | P1 |
| **US4** Dual carriers | User Story 2 | P1 |
| **US5** Idempotency | User Story 3 | P1 |
| **US3** Terminate | User Story 4 | P1 |
| *(API)* CancelEnrolment | User Story 5 | P2 |
| **US2** Dispense | User Story 6 | P2 |
| **US6** Status visibility | User Story 7 | P2 |
| **US7** My cover (stretch) | User Story 8 | P3 |

### User Story 1 - Enrol employee on collective mutuelle (Priority: P1) — brief US1

As a company admin, I enrol an employee on our collective health plan so affiliation and cotisations stay in sync with payroll without double entry.

**Why this priority**: Core value path — Pending → Active → premium shares → bulletin lines.

**Independent Test**: Company A (Alan-style); enrol one employee; Pending then Active; employer share ≥ 50% + employee share; Payroll stub two Santé lines; Company A isolation. Detail: `docs/base.md` §4 happy path steps 1–7.

**Acceptance Scenarios**:

1. **Given** Company A has Insurance enabled and plan “Santé Base”, **When** admin enrols Ada with an idempotency key, **Then** status is PendingExternal and an enrolment id is returned (async accept).
2. **Given** PendingExternal, **When** carrier affiliation succeeds, **Then** status is Active and an insurer member reference is recorded.
3. **Given** Active, **When** cotisation instructions are issued, **Then** they include employerShareCents, employeeShareCents (employer ≥ 50% of base), period bounds, and currency EUR.
4. **Given** PremiumInstructionIssued, **When** Payroll stub consumes it, **Then** two Santé lines exist for that employee/period (patronale + salariale).
5. **Given** Company A admin, **When** they list cover, **Then** they see Ada Active and never Company B employees.

---

### User Story 2 - Dual carrier adapters, one product (Priority: P1) — brief US4

As PayFit (platform), Company A uses Alan-style and Company B uses AXA-style without two products — carriers are adapters behind one Insurance vertical.

**Why this priority**: Partner-ready architecture; required demo contrast. See `docs/base.md` §4 Carriers / ACL diagram.

**Independent Test**: Same enrol intent on A then B; carrier evidence differs; domain enrolment + premium outcome shapes match.

**Acceptance Scenarios**:

1. **Given** A=`alan`, B=`axa`, **When** each admin enrols an employee, **Then** each company uses its configured carrier path.
2. **Given** both complete, **When** outcomes are compared, **Then** enrolment/premium shapes match; only carrier interaction details differ.
3. **Given** AXA-style optional setup-sheet-like rates (`docs/base.md` §7C), **When** B activates, **Then** Payroll still receives employerShareCents/employeeShareCents instructions (sheet rates preferred when present).

---

### User Story 3 - Safe retries and double-submit (Priority: P1) — brief US5

As a company admin, double-submit and retries must not create two members or two cotisations.

**Why this priority**: Reliability success criterion (`docs/base.md` §12 #4; §4 failure table).

**Independent Test**: Replay Idempotency-Key; replay duplicate carrier confirmation; assert single enrolment/member.

**Acceptance Scenarios**:

1. **Given** enrol succeeded with key K, **When** resubmitted with K, **Then** **202** + same enrolment id; no second carrier member.
2. **Given** insurerEventId E processed, **When** E arrives again, **Then** no-op (no status flip, no duplicate premium) — **test pack** (sync stub OK for §7E).
3. **Given** carrier timeout, **When** admin reads status before exhaustion, **Then** still PendingExternal with retry — never silent Active.
4. **Given** three createMember timeout/transport failures, **When** worker finishes attempts, **Then** status **Failed** + dead-letter counter/log incremented; never Active (FR-008a / `docs/base.md` §4 edge).

---

### User Story 4 - Terminate stops cover and cotisations (Priority: P1) — brief US3

As a company admin, leavers drop off cover automatically after EmployeeTerminated so we do not keep paying/withholding.

**Why this priority**: Leave-drift is a primary pain (`docs/base.md` §3). Terminate path: §4 data flow.

**Independent Test**: Active → Terminated → Ended + Stop + stub lines removed; Pending → terminate compensates carrier.

**Acceptance Scenarios**:

1. **Given** Active enrolment, **When** EmployeeTerminated is received, **Then** Ended + carrier cancel + premium Stop.
2. **Given** stub Santé lines exist, **When** Stop is consumed, **Then** lines removed or marked stopped.
3. **Given** PendingExternal, **When** Terminated arrives, **Then** local cancel + carrier compensate/cancel.

---

### User Story 5 - Cancel enrolment (admin-initiated) (Priority: P2) — Domain API (not a brief US id)

As a company admin, I can cancel an in-progress or active affiliation for my company so cover and cotisations stop without waiting for termination.

**Why this priority**: Domain API includes cancellations (`docs/base.md` §4 Domain API + Cancel footnote); complements terminate.

**Independent Test**: Cancel Pending or Active for own company → Ended + carrier cancel when a member exists + Stop if premiums were issued; other company → 403.

**Acceptance Scenarios**:

1. **Given** Active enrolment on Company A, **When** Company A admin cancels, **Then** status is Ended, carrier membership cancelled, premium Stop if instructions existed.
2. **Given** PendingExternal with in-flight member, **When** admin cancels, **Then** status Ended + compensate carrier.
3. **Given** Company A admin, **When** they cancel a Company B enrolment, **Then** denied (403).

---

### User Story 6 - Record legal dispense (Priority: P2) — brief US2

As a company admin, I record a dispense (legal exemption) instead of affiliation when the employee must not join the collective contract.

**Why this priority**: ANI affiliation + dispenses (`docs/base.md` §5).

**Independent Test**: Valid reason → Dispensed; no Active; **no** premium instruction; audit kept.

**Acceptance Scenarios**:

1. **Given** valid seeded reason code, **When** admin dispenses, **Then** Dispensed + audit reason.
2. **Given** Dispensed, **When** premium generation would run, **Then** no Active cover and no premium instruction.
3. **Given** invalid reason code, **When** dispense submitted, **Then** rejected; no Dispensed record.

---

### User Story 7 - Honest enrolment status visibility (Priority: P2) — brief US6

As a company admin, I see Pending / Active / Failed / Dispensed / Ended so I am not lied to while the carrier processes.

**Why this priority**: Operability; FSM in `docs/base.md` §7 Enrolment FSM.

**Independent Test**: Immediate read after enrol = PendingExternal; after success = Active with member ref + last premium summary when issued.

**Acceptance Scenarios**:

1. **Given** enrol just accepted, **When** detail fetched, **Then** PendingExternal.
2. **Given** carrier confirmed, **When** detail fetched, **Then** Active + member ref + last premium summary if issued.
3. **Given** carrier rejected, **When** detail fetched, **Then** Failed (not Active).

---

### User Story 8 - Employee my cover read-only (Priority: P3) — brief US7 stretch

As an employee, I see my cover read-only so I know I am affiliated.

**Why this priority**: Stretch in brief; optional for POC v1.

**Independent Test**: `employee.self` GET cover → plan, status, dates; no commands.

**Acceptance Scenarios**:

1. **Given** Active cover, **When** employee requests my cover, **Then** plan name, status, effective dates only.
2. **Given** `employee.self`, **When** enrol/cancel attempted, **Then** denied.

---

### Edge Cases

Canonical table: `docs/base.md` §4 **Failure / edge paths**. Spec MUST cover at least:

- Double-click / same Idempotency-Key → same enrolment, no second member.
- Insurer timeout → PendingExternal + retry (`docs/base.md` §4); after 3 attempts → Failed (FR-008a); never silent Active.
- Duplicate webhook / insurerEventId → inbox no-op.
- Terminate while Pending → cancel local + compensate carrier.
- Dispense → Dispensed; no Active; no premium instruction; audit reason.
- Dispense while PendingExternal/Active exists → 409 (enrol or dispense).
- Enrol/dispense when company Insurance disabled → 409.
- `coverage` other than `collective` → validation error.
- Insurer retries exhausted → **Failed** + dead-letter counter/log; never silent Active; never stay Pending after exhaustion.
- Webhook without valid stub signature → 401.
- Missing/blank Idempotency-Key on enrol → 400.
- Duplicate PremiumInstruction Issued/Stop to payroll → no duplicate lines.
- Duplicate platform Terminated `eventId` → no-op.
- Attempt to change company.carrier while Pending/Active exists → rejected / not offered in POC.
- Wrong company scope → 403.
- Already PendingExternal or Active for same employee+company → 409; no second in-flight enrolment.
- Re-enrol after Ended or Dispensed → allowed (new enrolment id); prior record remains history.
- Enrol when employee is HR-terminated → 409 (interprets `docs/base.md` §4 “terminated” as employee status).
- Already Dispensed with no Ended path chosen → dispense/enrol conflict: no silent overwrite; if Dispensed is terminal for that record, new enrol creates a new enrolment after Dispensed (per uniqueness rule above).
- ChangeCoverage / mid-period engine → out of scope (`full_month` assumption, §7C).
- EmployeeHired auto-enrol → out of scope; Terminated required only.
- Concurrent terminate vs activate → **terminate wins**; must not leave Active for a terminated employee; compensate if create raced.
- Cancel on Dispensed / Failed / already Ended → 409.
- Webhook confirmed when already Active (same member) → 200 no-op; rejected when not Pending → 200 no-op.
- Seed plan with employerSharePct below 50 → boot/seed validation failure.
- Idempotent enrol replay → 202 + same body.

## Requirements *(mandatory)*

Normative detail for routes, payloads, and seed filenames: cite `docs/base.md` §4 (Domain API, Event payloads, Data flow) and §7B–C. Requirements below are acceptance-facing.

### Functional Requirements

**Tenancy, roles, and access** — also `docs/base.md` §4 Roles

- **FR-001**: System MUST isolate all commands/queries/events by `companyId`.
- **FR-002**: `company.admin` MUST be single-company scoped; mismatch → 403.
- **FR-003**: Roles in scope: `company.admin`, `system.worker`, `system.payroll_consumer`; MAY `employee.self` (stretch).
- **FR-004**: POC identity MAY be stub headers (`X-Role`, `X-Company-Id`, optional `X-Employee-Id`); SSO out of scope.

**Enrolment lifecycle** — FSM `docs/base.md` §7

- **FR-005**: MUST accept EnrolEmployee (company, employee, plan, coverage, effective date) with Idempotency-Key.
- **FR-005a**: POC `coverage` MUST be `collective` only; other values → 400/422 validation error.
- **FR-005b**: EnrolEmployee and DispenseEmployee MUST conflict (409) when the company’s Insurance is not enabled.
- **FR-005c**: Unknown `employeeId` / `planId`, or employee not belonging to `companyId`, MUST return 404.
- **FR-005d**: POC accepts `effectiveFrom` as provided (no additional past/future window validation).
- **FR-006**: On accept MUST create PendingExternal and acknowledge asynchronously (not Active).
- **FR-007**: PendingExternal → Active only after carrier success; MUST store external member reference.
- **FR-008**: MUST support Failed on carrier reject (including webhook `result=rejected` per `docs/base.md` FSM reject→Failed); MUST NOT Active on timeout.
- **FR-008a**: On insurer timeout/failure to confirm, worker MUST **stay PendingExternal** and retry (aligns `docs/base.md` §4 edge “Stay Pending; retry”); after **3** attempts MUST transition to **Failed**, append audit `action=fail`, and increment Postgres `dead_letter_counters` row `name=activate_enrolment` (POC: no broker DLQ; see `data-model.md`). MUST NOT stay Pending after exhaustion; MUST NEVER silent Active. `attemptCount` increments only on timeout/transport failure of `createMember`; webhook `rejected` → Failed without consuming a retry attempt.
- **FR-009**: MUST support admin CancelEnrolment → status **Ended** + carrier cancel/compensate as applicable; MUST outbox `EnrolmentCancelled`; MUST outbox `PremiumInstructionStop` if Issued premiums existed (`docs/base.md` §4).
- **FR-009a**: CancelEnrolment on Dispensed, Failed, or already Ended MUST return **409** (illegal transition).
- **FR-010**: MUST support DispenseEmployee with validated reason → Dispensed + audit; MUST NOT Active; MUST NOT emit premium instruction.
- **FR-010a**: DispenseEmployee MUST conflict (409) if a PendingExternal or Active enrolment already exists for that employee+company (enrol **or** dispense, not both in-flight).
- **FR-011**: Illegal transitions MUST be rejected without corrupting state.
- **FR-011a**: At most one enrolment in PendingExternal or Active per (`companyId`, `employeeId`) at a time; a second EnrolEmployee MUST conflict (409) unless it is an Idempotency-Key replay.
- **FR-011b**: Enrolments in Ended, Dispensed, or Failed do NOT block a new EnrolEmployee for the same employee+company (new enrolment id; history retained).
- **FR-011c**: EnrolEmployee MUST conflict (409) when the employee is HR-terminated (inactive), aligning with `docs/base.md` §4 enrol error examples.

**Carriers as adapters** — `docs/base.md` §4 Carriers; skill `/insurer-acl`

- **FR-012**: MUST route via one gateway abstraction; company selects `alan` | `axa` in POC.
- **FR-013**: MUST ship two distinct stub behaviors (API-style vs OC-style + optional setup-sheet rates) without two products.
- **FR-014**: Core enrolment model MUST stay carrier-agnostic (no carrier types in domain).
- **FR-015**: MUST support confirmation with idempotent `insurerEventId` handling. Sync stub activation is sufficient for the §7E demo gate; an HTTP webhook endpoint is optional for the demo but MUST exist in the test pack (or equivalent harness) to prove duplicate webhook no-op and reject→Failed.
- **FR-015a**: When the webhook endpoint is invoked, MUST validate a stub shared-secret header (`X-Carrier-Signature`); missing/wrong → 401.
- **FR-015b**: Webhook payload MUST identify the enrolment via `insurerMemberId` and/or `enrolmentId`; if none match → 404.
- **FR-015c**: Webhook `result=confirmed` MAY complete Pending→Active (same outcomes as worker activate); `result=rejected` MUST transition to **Failed** when PendingExternal (not Ended, not Active). Already Active with same member + confirmed → 200 no-op; rejected when not PendingExternal → 200 no-op.
- **FR-015d**: Concurrent EmployeeTerminated vs activate MUST prefer terminate: never leave Active for a terminated employee; compensate carrier if create raced; Stop idempotent.

**Cotisations and Payroll boundary** — `docs/base.md` §4–5

- **FR-016**: On Active, MUST issue PremiumInstructionIssued: `employerShareCents`, `employeeShareCents`, `currency: "EUR"`, period bounds.
- **FR-016a**: Premium period MUST be the whole calendar month containing `effectiveFrom` in timezone **`Europe/Paris`** (`periodFrom` = first day, `periodTo` = last day of that month); POC labels may show `YYYY-MM` as in `docs/base.md` §4.
- **FR-016b**: Currency MUST be EUR for POC; canonical Money unit MUST be integer **cents**; no multi-currency.
- **FR-016c**: Money shares MUST be computed in cents as `employerShareCents = round(monthlyPremiumCents * employerSharePct / 100)` (half-up) and `employeeShareCents = monthlyPremiumCents - employerShareCents`, with `employerSharePct ≥ 50`.
- **FR-016d**: For AXA-style carrier, when setup-sheet fixture rates are present they MUST supply the premium/`employerSharePct` inputs to FR-016c; otherwise use plan seed.
- **FR-017**: Employer share of base MUST be ≥ 50% (plan configuration).
- **FR-017a**: Idempotency-Key is required on EnrolEmployee only for POC; scope is `(companyId, route, key)` with no TTL requirement in POC storage; missing or blank key → **400**.
- **FR-017b**: `company.carrier` MUST NOT change for a company while any enrolment for that company is PendingExternal or Active; POC configures carrier via seed only (no admin pick-carrier API).
- **FR-018**: Payroll consumer MUST write two Santé lines from instructions and MUST NOT write Enrolment.
- **FR-018a**: Payroll stub MUST apply Issued/Stop idempotently (dedupe by instruction `eventId`; fallback enrolmentId+period+kind); duplicate delivery MUST NOT duplicate lines.
- **FR-018b**: MUST expose demo query `GET /v1/companies/:companyId/payroll-lines` (company.admin scoped) to inspect stub Santé lines (`docs/base.md` §7C).
- **FR-019**: Insurance MUST NOT write Payroll tables; only ids + money instructions (cents) cross the bus.
- **FR-020**: On end of cover, MUST issue premium Stop; consumer removes/stops lines (idempotent).

**Platform events**

- **FR-021**: MUST handle EmployeeTerminated → end cover (Ended), cancel/compensate carrier, emit `EnrolmentCancelled`, and `PremiumInstructionStop` if Issued premiums existed (including Pending → Ended + compensate; no Stop if never Issued).
- **FR-021a**: MUST expose `POST /v1/dev/platform-events` (dev/demo ingress) to publish platform fixtures such as EmployeeTerminated for §7E; caller MUST present `X-Role: system.worker` (stub identity).
- **FR-021b**: Platform-events MUST require `eventId` and MUST no-op duplicates (processed_events / inbox).
- **FR-022**: EmployeeHired auto-enrol OUT OF SCOPE; Terminated required (`docs/base.md` §7C).
- **FR-023**: EmployeeUpdated beyond terminate OUT OF SCOPE for v1.

**Reliability** — constitution IV; `docs/base.md` §4 building blocks

- **FR-024**: Enrolment accept + outbound publication MUST be durably coupled (transactional outbox).
- **FR-025**: Same Idempotency-Key → same enrolment (**202** + same body); no duplicate member/premiums.
- **FR-026**: Duplicate insurerEventId → no-op.
- **FR-027**: MUST accept/generate `X-Correlation-Id` on HTTP; MUST propagate to worker jobs and carrier stub logs; MUST expose Pending age (or equivalent) for PendingExternal enrolments; structured logs required for demo evidence.
- **FR-027a**: MUST append `audit_log` rows (`detail` jsonb + `correlationId` + optional `enrolmentId`, `createdAt`) for enrol/dispense/cancel/activate/terminate/fail and expose GET last N as JSON matching that shape (`docs/base.md` §7C; no full audit UI); GET MUST require `company.admin` and return only that `X-Company-Id`’s entries.

**Queries / experience** — `docs/base.md` §4 Interface

- **FR-028**: Admin MUST list company cover and fetch enrolment detail (status, member ref, last premium summary).
- **FR-028a**: Default list MUST include PendingExternal, Active, Failed, Dispensed and MUST exclude Ended; MUST support `includeEnded=true` (or equivalent) to include Ended history.
- **FR-029**: Week-1 MAY be HTTP/script only; if UI exists, minimum screens per §4 Interface table.
- **FR-030**: Stretch: `employee.self` read-only my cover.

**Catalog / seed** — `docs/base.md` §7B (authoritative file list)

- **FR-031**: MUST load seeded companies A/B (alan/axa), employees, Santé Base (`employerSharePct` ≥ 50), dispense reasons, admin bindings; seed/boot MUST fail if any plan has `employerSharePct` below 50.
- **FR-032**: Proration documented as `full_month`; no engine in v1 (§7C).

**Explicit exclusions** — `docs/base.md` §13

- **FR-033**: MUST NOT implement claims, medical underwriting, quoting, or healthcare data vault.
- **FR-034**: MUST NOT implement DSN/URSSAF engine or carrier marketplace UI.
- **FR-035**: MUST NOT become a second Employee master database.
- **FR-036**: MUST NOT require real Alan/AXA production APIs for POC success.
- **FR-037**: ChangeCoverage, reconcile cron, multi-country OUT OF SCOPE for this feature.

### Key Entities

Definitions summarized; normative event field shapes → [`contracts/events.md`](./contracts/events.md) (base §4 + locked deltas).

- **Company** — tenant; carrier choice; Insurance enabled; plan association.
- **Employee** — seeded reference under company; not mastered by Insurance.
- **Plan (Santé Base)** — premium + employerSharePct (≥ 50).
- **Enrolment** — PendingExternal | Active | Failed | Dispensed | Ended; effective dating; member ref; dispense audit. Uniqueness: ≤1 PendingExternal|Active per company+employee; Ended/Dispensed/Failed are historical and re-enrolable.
- **PremiumInstruction** — Issued or Stop; employer/employee shares + period.
- **CarrierMembership (external)** — member id / optional rate params behind gateway only.
- **OutboxMessage / ProcessedEvent** — publish durability + inbound idempotency.
- **PayrollSantéLine** — stub patronale + salariale lines.
- **AdminBinding / DispenseReason** — stub identity and reason catalog.

## Success Criteria *(mandatory)*

Aligns with `docs/base.md` §12. Demo timing/script: §9 and §7E (do not fork a second script).

### Measurable Outcomes

- **SC-001**: ≤ 7 minutes: Company A enrol → Pending → Active → shares → Payroll stub Santé lines (§9 steps 3 + §7E).
- **SC-002**: Same session: Company B AXA-style enrol; different carrier evidence; same domain outcome shapes.
- **SC-003**: Idempotency-Key replay → one enrolment id; no second carrier member (**§7E step 8 / demo gate**).
- **SC-003b**: Duplicate webhook `insurerEventId` → no-op (**test pack**; §9 mentions webhook — not required in live §7E if sync stub used).
- **SC-004**: EmployeeTerminated on Active → Ended + Stop + stub lines removed/stopped.
- **SC-005**: 100% of cross-company admin attempts against the other company are denied.
- **SC-006**: Every happy-path premium instruction has employer share ≥ 50% of base + employee share.
- **SC-007**: Reviewers affirm all five §12 engineer checks (boundaries, tenancy, ANI shape, reliability, ACL swap).
- **SC-008**: Dispense → Dispensed + audit + no premium instruction.
- **SC-009**: Standard path never shows Active before carrier success (Pending honesty).
- **SC-010**: Admin cancel on own-company Active/Pending ends cover without cross-tenant leakage (User Story 5).

## Assumptions

- **Canonical brief**: entire `docs/base.md`. When this spec and the brief diverge, amend both; constitution wins on governance conflicts.
- **Dispense**: no premium instruction (stricter reading of §4 “no (or zero)”).
- **Experience**: HTTP/script first (§7C / §7E); React optional later.
- **Carrier confirm**: sync stub enough for §7E demo; webhook in test pack for duplicate `insurerEventId` (Clarifications).
- **Inbound lifecycle**: Terminated only; Hired/Updated auto-enrol out (§7C).
- **Premium period**: whole calendar month of `effectiveFrom`; `full_month` proration; no engine (Clarifications + §7C).
- **Geography / money**: FR only; **EUR cents**; Paris timezone for periods; AXA sheet overrides seed inputs when present.
- **Identity / bus**: stub headers; in-process bus OK; SQS/K8s = README story only (§8, §7C).
- **Missing related doc**: `system-design-insurance-module.md` is not in-repo; `docs/base.md` + this spec are authoritative until it exists.
- **ROI / JetLang narrative** (§3, §1): mission context for talks — not separate acceptance tests.
- **Clarify rule**: full brief → use it; partial brief → implied recommendation; absent → Spec Kit default (see Clarifications session).
- **Coverage / enablement**: `coverage=collective` only; company must have Insurance enabled.
- **Dispense vs enrol**: mutually exclusive while Pending/Active exists.
- **Shares**: EUR via FR-016c; AXA setup-sheet overrides plan seed inputs when present (FR-016d).
- **Retries**: up to 3 worker attempts then **Failed** + dead-letter counter; webhook stub signature required when endpoint used.
- **Demo ingress**: `POST /v1/dev/platform-events` for Terminated fixture; Postgres `audit_log` append + GET last N.
- **Performance**: demo-scale only; no p95/SLA (`docs/base.md` §8).
- **Story ids**: brief US1–US7 are canonical; Cancel is Domain API–only (`docs/base.md` §4 footnote).
- **AXA rates**: setup-sheet overrides plan seed inputs when present; share formula unchanged.
- **Lookup / list defaults**: 404 unknown employee/plan; accept effectiveFrom as given; list excludes Ended unless includeEnded.
- **Cross-cutting**: Paris TZ; EUR cents; enrol idempotency key mandatory; payroll + platform-event idempotency; carrier seed-immutable while in-flight/active; webhook enrolment lookup; stub role gates on platform-events/audit.

## Planning Inputs *(for `/speckit-plan` and `/speckit-tasks`)*

Do not re-specify here; consume from brief:

| Need | Source |
| --- | --- |
| Ultimate architecture / five blocks / sequences | `docs/base.md` §7 |
| Must-code order | §7A + §7D checklist |
| Seed files | §7B |
| Mock vs skip list | §7C |
| Stack defaults | §8 |
| Deliverables (OpenAPI/routes, event catalog, RFC, Compose, tests) | §10 |
| Day/week sequencing | §11 |
| Demo assets paths | §7E, skill `/insurance-demo` |

## Demo Gate

Execute **`docs/base.md` §7E** (nine steps) with talk track **§9**. Feature is demo-ready only when that script passes; keep `demo/README.md` as the runnable mirror, not a divergent checklist.
