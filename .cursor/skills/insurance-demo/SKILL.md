---
name: insurance-demo
description: >-
  Runs and maintains the 5–7 minute PayFit Insurance POC demo: multi-company
  Alan vs AXA enrol, premium→payroll stub, idempotency, and terminate. Use when
  preparing demos, writing demo scripts, curl/Bruno collections, seed data, or
  verifying success criteria for the mutuelle vertical slice.
---

# Insurance POC Demo

Goal: prove **domain + events + multi-company + two carriers**. UI is optional; JSON + curls are enough.

## Preconditions

- Seed loaded: companies A (alan) / B (axa), employees, plan Santé Base (`employerSharePct` ≥ 50), dispense reasons, admins  
- API + worker running (Compose or local)  
- Auth headers: `X-Role: company.admin`, `X-Company-Id: <companyId>`  
- Idempotency header on enrol: `Idempotency-Key`

## 9-step script (~5–7 min)

1. **Show seed** — 2 companies, employees, plan (carrier differs).  
2. **Enrol Alan** — `POST /v1/companies/{A}/enrolments` → **202** Pending JSON.  
3. **ACL log** — `demo/last-alan-call.json` (createMember request/response).  
4. **Active** — `GET /v1/enrolments/{id}` → Active + insurerMemberId.  
5. **Premium event** — `PremiumInstructionIssued` with employerShare + employeeShare.  
6. **Payroll stub** — Santé lines (patronale + salariale) in stub store / JSON.  
7. **Enrol AXA** — same command on Company B → different gateway log, **same** event shape.  
8. **Idempotency** — replay enrol with same `Idempotency-Key` → same enrolmentId, no second member.  
9. **Terminate** — POST platform terminated fixture → Ended + Stop instruction + stub lines removed.

Optional beat: dispense on another employee → Dispensed, no premium.

## Talk track (short)

1. Diagram: Insurance vertical; Payroll consumes; Alan/AXA behind gateway (30s)  
2. Tenant isolation A vs B (30s)  
3. Enrol Alan → Pending → Active → shares → bulletin lines (90s)  
4. Enrol AXA → same events, different ACL (60s)  
5. Idempotency replay (45s)  
6. Terminate stop (45s)  
7. Close: real carriers = ACL swap; claims stay out (30s)

## Success criteria (must be true)

1. Boundaries correct (Insurance ≠ Payroll ≠ Employee)  
2. Multi-company tenancy real (403 cross-company)  
3. Cotisation path has ANI *shape* (shares → stub lines)  
4. Outbox, idempotency, Pending are first-class  
5. Extending to a real carrier is an ACL swap, not a rewrite  

## Demo assets to maintain

| Path | Purpose |
| --- | --- |
| `seed/*.json` | companies, employees, plans, reasons, admins |
| `demo/README.md` | curl script for the 9 steps |
| `demo/last-alan-call.json` / `last-axa-call.json` | ACL evidence |
| `fixtures/employee-terminated.json` | terminate path |
| `fixtures/axa-setup-sheet.json` | optional OC rates story |
| `data/payroll-lines.json` | bulletin impact |

## Anti-patterns in a demo

- Polished UI instead of proving outbox/ACL  
- Calling real insurer APIs  
- Skipping Company B / second carrier  
- Silent Active without showing Pending  
- Forgetting idempotency or terminate  
