<!--
Sync Impact Report
- Version change: (none) → 1.0.0
- Modified principles: N/A (initial ratification from docs/base.md)
- Added sections: Core Principles (I–VIII), Domain & POC Constraints, Development Workflow, Governance
- Removed sections: template placeholders
- Follow-up TODOs: none
-->

# Insurance Vertical Constitution

## Core Principles

### I. Bounded Context Ownership

Insurance owns Enrolment, dispense, plan choice, cotisation *instructions*,
and insurer sync state. Insurance MUST NOT own Employee master data, payslip
math, or DSN/URSSAF declarations. Payroll owns bulletin lines and social
declarations; Employee owns person, contract, and termination. Insurance MUST
NEVER write Payroll tables; Payroll MUST NEVER write Enrolment. Only ids and
money instructions cross the bus.

**Rationale:** PayFit platform shape is domain verticals + events. Dual ownership
creates JetLang-style dual truth and leave-drift.

### II. Carrier Anti-Corruption Layer

Carriers (Alan, AXA, future OCs) are adapters behind `InsurerGateway`
(`createMember` / `cancelMember`). Domain aggregates MUST contain zero Alan/AXA
types. Company configuration (`carrier = alan | axa`) selects the adapter.
Same `EnrolEmployee` command MUST emit the same domain event shapes regardless
of carrier. POC ships `AlanStub` and `AxaStub` to prove swappability.

**Rationale:** Extending to a real partner MUST be an ACL swap, not a domain rewrite.

### III. Multi-Tenant Isolation by companyId

Every aggregate, command, query, and event MUST be scoped by `companyId`.
`company.admin` MUST be bound to exactly one company. Server MUST reject
cross-company access with HTTP 403 when header `X-Company-Id` does not match
URL/body `companyId`. Seed and demos MUST use at least two companies
(Company A = Alan, Company B = AXA).

**Rationale:** PayFit serves thousands of SMB clients; isolation is a first-class
product invariant, not an afterthought.

### IV. Transactional Outbox and Idempotency

Enrolment writes that publish side effects MUST persist aggregate state and
outbox rows in the **same database transaction**. Command retries with the same
`Idempotency-Key` MUST return the same enrolment and MUST NOT create a second
insurer member. Duplicate carrier webhooks MUST be deduplicated by
`insurerEventId` (inbox / processed_events) and no-op. At-least-once delivery
is assumed; handlers MUST be idempotent.

**Rationale:** Network blips and double-clicks MUST NOT create dual affiliation
or dual cotisations.

### V. Honest Enrolment Lifecycle

Enrolment FSM statuses are: `PendingExternal`, `Active`, `Failed`, `Dispensed`,
`Ended`. After `EnrolEmployee`, API MUST return 202 with `PendingExternal` and
MUST NOT report Active until the carrier path confirms. Insurer timeout MUST
keep Pending with retry — never silent Active. `DispenseEmployee` yields
Dispensed with audit reason and MUST NOT produce Active cover or a non-zero
premium instruction. `EmployeeTerminated` MUST end cover, cancel/compensate
carrier membership, and emit premium Stop so Payroll stub removes lines.
Terminate-while-Pending MUST cancel locally and compensate the stub member.
ChangeCoverage mid-life is out of POC v1.

**Rationale:** Admins must not be lied to while the carrier is still processing;
leave-drift is the core operational failure mode.

### VI. ANI Cotisation Shape (FR)

`PremiumInstructionIssued` MUST carry `employerShare` and `employeeShare`
(Money) plus period bounds and currency. Employer share of base contribution
MUST be ≥ 50% (enforced via plan seed `employerSharePct`). Payroll stub
materialises two Santé lines (patronale + salariale) from instructions.
Full DSN/URSSAF calculation is OUT OF SCOPE — Insurance feeds facts; Payroll
owns declarations. POC is FR-only; country adapters come later without rewriting
Enrolment lifecycle. Proration assumption for POC: `full_month` documented in
plan seed / RFC — no proration engine in v1.

**Rationale:** Mutuelle is table-stakes for French SMB payroll; the POC proves
paie-native cotisation instructions without replacing Payroll compliance engines.

### VII. Seed and Stub Over Scope Creep

Prove domain + events + multi-company + two carriers. If a capability is not
Enrolment, outbox, gateway swap, or premium event, it MUST be seeded as JSON,
fixture, or stub display — not built as a product surface. HTTP-only (curl/Bruno)
is an acceptable week-1 experience; polished React is optional. Real Alan/AXA
HTTP, SQS/K8s/Terraform, SSO, notifications, reconcile cron, read-model
projectors, and marketplace UI are OUT OF POC unless explicitly promoted later.

**Explicit non-goals:** claims, healthcare data vault, medical underwriting,
full dispense legal matrix / CCN engine, DSN XML, multi-country, replacing
Alan/AXA products, AXA commercial referral funnel.

**Rationale:** Mission credibility comes from a thin vertical slice in week 1–2,
not a fake insure-tech suite.

### VIII. Testable Domain First

Enrolment aggregate rules MUST be pure TypeScript with unit tests for happy
paths and illegal transitions before wiring infrastructure. Required test pack
includes: FSM units, Idempotency-Key behaviour, multi-tenant 403 isolation,
and terminate/dispense outcomes. Integration paths (worker + stubs + payroll
stub) MUST be demoable via the documented 9-step script.

**Rationale:** Architecture review and freelance mission conversations need
executable proof, not diagrams alone.

## Domain & POC Constraints

**Ship shape:** Insurance `api` + `worker` (+ optional thin admin UI), own
Postgres DB (aggregates + outbox + processed_events), events in/out.

**Stack (POC):** TypeScript; Node (Nest or lightweight); Postgres; in-process
queue or LocalStack SQS; Docker Compose optional after local path works.

**Identity (POC):** Header stub — `X-Role`, `X-Company-Id`, optional
`X-Employee-Id`. Roles in scope: `company.admin`, `employee.self` (stretch),
`system.worker`, `system.payroll_consumer`. No SSO / PayFit permission matrix UI.

**Domain API style:** Command/query HTTP under `/v1`, not table CRUD. Key routes:
enrol, dispense, cancel, list/get enrolments, optional `GET /v1/me/cover`,
carrier webhooks, and a dev platform-events endpoint for `EmployeeTerminated`.

**Success criteria:** PayFit engineers can affirm (1) correct boundaries,
(2) real multi-company tenancy, (3) ANI-shaped cotisation path to bulletin stub,
(4) first-class outbox/idempotency/Pending, (5) real carrier = ACL swap.

**Primary brief:** `docs/base.md` (sections 1–14). Domain agent skills:
`insurance-domain`, `insurer-acl`, `insurance-demo`.

## Development Workflow

1. Spec Kit SDD: constitution → specify → clarify (as needed) → plan → tasks →
   analyze/checklist → implement → converge.
2. Implementation order from brief: seed → Enrolment+tests → API enrol/get +
   authZ → outbox → worker+stubs → idempotency + 403 → terminate → demo curls.
3. Every PR affecting domain or reliability MUST cite which constitution
   principle(s) it upholds.
4. Demo script (5–7 min / 9 steps) is a release gate for the POC slice — see
   `docs/base.md` §7E and §9 and skill `insurance-demo`.
5. Prefer amending `docs/base.md` + constitution together when product scope changes.

## Governance

This constitution supersedes informal practice for the Insurance vertical POC.
Amendments MUST update this file, bump `CONSTITUTION_VERSION` (MAJOR for
incompatible principle changes, MINOR for new principles/sections, PATCH for
clarifications), set `Last Amended` to the change date, and note impact in a
Sync Impact Report comment (removed before commit when appropriate).

Compliance: reviews and Spec Kit analyze/converge steps MUST check bounded
contexts, tenancy, outbox/idempotency, FSM honesty, ANI share shape, and
non-goals. Runtime guidance also lives in `.cursor/skills/insurance-*`.
Unresolved conflicts with `docs/base.md` MUST be clarified via Spec Kit
clarify before implementation proceeds.

**Version**: 1.0.0 | **Ratified**: 2026-10-12 | **Last Amended**: 2026-10-12
