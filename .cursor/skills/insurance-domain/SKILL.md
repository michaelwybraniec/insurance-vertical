---
name: insurance-domain
description: >-
  Enforces PayFit Insurance vertical DDD boundaries, Enrolment FSM, ANI
  cotisation rules, multi-tenant companyId scoping, outbox/idempotency, and
  explicit non-goals. Use when designing, specifying, implementing, or reviewing
  enrolment, dispense, premium instructions, terminate flows, or Insurance API
  code in this POC.
---

# Insurance Domain Guardrails

Source of truth: `docs/base.md` (+ locked Clarifications in `specs/001-mutuelle-enrolment-cotisations/spec.md`). Prefer seed/fixtures over building out-of-scope systems.

## Bounded contexts

| Context | Owns | Must not own |
| --- | --- | --- |
| **Insurance** | Enrolment, dispense, plan choice, cotisation *instructions*, insurer sync state | Employee master, payslip math, DSN |
| **Employee** | Person, contract, termination | Whether mutuelle is Active |
| **Payroll** | Bulletin lines, social declarations | Insurer member APIs |
| **Carrier** | Cover fulfilment, member ids, rate params | PayFit domain language |

**Rule:** Insurance never writes Payroll tables; Payroll never writes Enrolment. Only ids + money instructions (EUR cents) cross the bus.

## Enrolment FSM

```
EnrolEmployee → PendingExternal ──insurer OK──► Active ──terminate/cancel──► Ended
                      │
                      └── reject → Failed
                      └── timeout → stay Pending + retry; after 3 attempts → Failed
                                     (never silent Active)

DispenseEmployee → Dispensed (no Active; no premium instruction; audit reason)
```

Illegal transitions → reject (409) without corrupting state. Tests required.

## Hard invariants

1. **Multi-tenant:** every command/query scoped by `companyId`. Admin header company must match body/URL → else **403**.
2. **Uniqueness:** ≤1 `PendingExternal`|`Active` per `(companyId, employeeId)`; Ended/Dispensed/Failed allow re-enrol (new id).
3. **Enablement / coverage:** insurance disabled → 409 on enrol/dispense; POC `coverage` = `collective` only.
4. **ANI shape:** `PremiumInstructionIssued` carries `employerShareCents` + `employeeShareCents` (EUR); half-up employer from `employerSharePct` (≥50); employee = remainder; period = Paris calendar month of `effectiveFrom`.
5. **Dispense:** Dispensed; **no** Active; **do not emit** premium instruction; audit reason.
6. **Reliability:** enrol TX writes Enrolment + outbox same transaction; `Idempotency-Key` → **202** same body; duplicate `insurerEventId` / platform `eventId` → no-op.
7. **Pending honesty:** never Active before carrier confirm; Failed after 3 createMember transport/timeout attempts.
8. **Pure domain:** aggregates have **no** Alan/AXA types — only `InsurerGateway` at the edge.
9. **Terminate wins** over concurrent activate (never leave Active for terminated employee).

## Domain API (POC)

Command/query HTTP under `/v1` — not table CRUD (`docs/base.md` §4 + §7C helpers):

- `POST /v1/companies/:companyId/enrolments` (+ `Idempotency-Key`) → **202** + PendingExternal
- `POST /v1/companies/:companyId/dispenses`
- `POST /v1/enrolments/:id/cancellations` → Ended (Domain API; not a brief US id)
- `GET` list / by id (`includeEnded`); Pending age on PendingExternal
- `GET /v1/me/cover` (stretch `employee.self`)
- `POST /v1/webhooks/carriers/:carrier` (`X-Carrier-Signature`)
- `POST /v1/dev/platform-events` (`X-Role: system.worker`) — Terminated only
- Demo: `GET …/audit`, `GET …/payroll-lines`

AuthZ stub: `X-Role` + `X-Company-Id` (+ `X-Employee-Id` for self); optional `X-Correlation-Id`.

## Events (minimal)

Outbound: `EmployeeEnrolledInInsurance`, `PremiumInstructionIssued`, `EnrolmentCancelled`, `PremiumInstructionStop`.  
End cover (cancel **or** terminate) → `EnrolmentCancelled`; Stop only if Issued existed.  
Inbound platform: **Terminated only** (Hired/Updated out of POC).  
Shapes: `contracts/events.md` (cents; intentional deltas from brief §4 noted there).

## Explicit non-goals

Claims · medical/quoting · full carrier marketplace UI · DSN/URSSAF engine · real Alan/AXA product · SSO · multi-country · proration engine · reconcile cron · ChangeCoverage · polished design system.

## Implementation order

seed → Enrolment+tests → API enrol/get + authZ → outbox → worker+stubs → idempotency + 403 → terminate handler → demo curls (`docs/base.md` §7A/D).

## When reviewing code

Flag any of: domain importing carrier DTOs; Payroll writing Enrolment; missing outbox in same TX; cross-company access without 403; Active without ACL confirm; missing `*Cents` shares; silent Active on timeout; dispense emitting premium; missing Failed@3.
