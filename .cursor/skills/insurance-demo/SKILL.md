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
Canonical script: `docs/base.md` §7E + talk track §9. Runnable mirror: `demo/README.md` + `specs/001-mutuelle-enrolment-cotisations/quickstart.md`.

## Preconditions

- Seed loaded: companies A (alan) / B (axa), employees, plan Santé Base (`employerSharePct` ≥ 50), dispense reasons, admins  
- API + worker running: `npm run dev` + `npm run worker` (or Compose)  
- Auth headers: `X-Role: company.admin`, `X-Company-Id: <companyId>`  
- Idempotency header on enrol: `Idempotency-Key`  
- Terminate ingress: `X-Role: system.worker` → `POST /v1/dev/platform-events`

## 9-step script (~5–7 min)

1. **Show seed** — 2 companies, employees, plan (carrier differs).  
2. **Enrol Alan** — `POST /v1/companies/company-a/enrolments` → **202** PendingExternal.  
3. **ACL log** — `demo/last-alan-call.json` (createMember request/response).  
4. **Active** — `GET /v1/enrolments/{id}` → Active + insurerMemberId.  
5. **Premium event** — `PremiumInstructionIssued` with **employerShareCents + employeeShareCents** (EUR).  
6. **Payroll stub** — `GET /v1/companies/company-a/payroll-lines` → patronale + salariale.  
7. **Enrol AXA** — same command on Company B; optional open `fixtures/axa-setup-sheet.json` → different gateway log, **same** event shape.  
8. **Idempotency** — replay enrol with same `Idempotency-Key` → **202** same enrolmentId, no second member.  
9. **Terminate** — `POST /v1/dev/platform-events` + `fixtures/employee-terminated.json` + `X-Role: system.worker` → Ended + Stop + stub lines inactive.

Optional beat: dispense on another employee → Dispensed, no premium.

### Terminate curl (step 9)

```bash
curl -sS -H "X-Role: system.worker" -H "Content-Type: application/json" \
  -X POST "http://localhost:3000/v1/dev/platform-events" \
  -d @fixtures/employee-terminated.json
```

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
3. Cotisation path has ANI *shape* (cents shares → stub lines)  
4. Outbox, idempotency, Pending are first-class  
5. Extending to a real carrier is an ACL swap, not a rewrite  

## Demo assets to maintain

| Path | Purpose |
| --- | --- |
| `seed/*.json` | companies, employees, plans, reasons, admins |
| `demo/README.md` | curl script for the 9 steps |
| `demo/last-alan-call.json` / `last-axa-call.json` | ACL evidence |
| `fixtures/employee-terminated.json` | terminate path (`eventId` required) |
| `fixtures/axa-setup-sheet.json` | optional OC rates story |
| `GET /v1/companies/:id/payroll-lines` | bulletin impact (Postgres `payroll_lines`) |
| `specs/.../quickstart.md` | paste-ready curls + checklist |

## Anti-patterns in a demo

- Polished UI instead of proving outbox/ACL  
- Calling real insurer APIs  
- Skipping Company B / second carrier  
- Silent Active without showing Pending  
- Forgetting idempotency or terminate  
- Terminating without `system.worker` / platform-events path  
