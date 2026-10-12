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

Source of truth: `docs/base.md`. Prefer seed/fixtures over building out-of-scope systems.

## Bounded contexts

| Context | Owns | Must not own |
| --- | --- | --- |
| **Insurance** | Enrolment, dispense, plan choice, cotisation *instructions*, insurer sync state | Employee master, payslip math, DSN |
| **Employee** | Person, contract, termination | Whether mutuelle is Active |
| **Payroll** | Bulletin lines, social declarations | Insurer member APIs |
| **Carrier** | Cover fulfilment, member ids, rate params | PayFit domain language |

**Rule:** Insurance never writes Payroll tables; Payroll never writes Enrolment. Only ids + money instructions cross the bus.

## Enrolment FSM

```
EnrolEmployee → PendingExternal → (insurer OK) Active → (terminate/cancel) Ended
PendingExternal → Failed / stay Pending + retry on timeout (never silent Active)
DispenseEmployee → Dispensed (no Active cover; audit reason)
```

Illegal transitions must be rejected in the aggregate with tests.

## Hard invariants

1. **Multi-tenant:** every command/query scoped by `companyId`. Admin header company must match body/URL → else **403**.
2. **ANI shape:** `PremiumInstructionIssued` always carries `employerShare` + `employeeShare`; employer share ≥ 50% of base (use plan seed `employerSharePct`).
3. **Dispense:** status Dispensed; **no** Active cover; **no** (or zero) premium instruction + audit reason.
4. **Reliability:** enrol TX writes Enrolment + outbox in the **same transaction**; `Idempotency-Key` returns same enrolment; duplicate webhook/`insurerEventId` → no-op.
5. **Pending honesty:** UI/API may show Pending; never pretend Active before carrier confirm.
6. **Pure domain:** aggregates have **no** Alan/AXA types — only `InsurerGateway` at the edge.

## Domain API (POC)

Command/query HTTP under `/v1` — not table CRUD:

- `POST /v1/companies/:companyId/enrolments` (+ `Idempotency-Key`) → **202** + Pending
- `POST /v1/companies/:companyId/dispenses`
- `POST /v1/enrolments/:id/cancellations`
- `GET` list / by id; optional `GET /v1/me/cover`
- `POST /v1/webhooks/carriers/:carrier`

AuthZ stub: headers `X-Role` + `X-Company-Id` (+ `X-Employee-Id` for self).

## Events (minimal)

Outbound: `EmployeeEnrolledInInsurance`, `PremiumInstructionIssued`, `EnrolmentCancelled` / `PremiumInstructionStop`.  
Inbound platform: `EmployeeTerminated` (Hired auto-enrol is out of POC).

## Explicit non-goals

Claims · medical/quoting · full carrier marketplace UI · DSN/URSSAF engine · real Alan/AXA product · SSO · multi-country · proration engine · reconcile cron · polished design system.

## Implementation order

seed → Enrolment+tests → API enrol/get + authZ → outbox → worker+stubs → idempotency + 403 → terminate handler → demo curls.

## When reviewing code

Flag any of: domain importing carrier DTOs; Payroll writing Enrolment; missing outbox in same TX; cross-company access without 403; Active without ACL confirm; missing employer/employee share on premium events.
