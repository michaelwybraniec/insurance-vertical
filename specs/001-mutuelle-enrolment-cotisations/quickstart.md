# Quickstart validation: Mutuelle Enrolment POC

Proves the feature against **`docs/base.md` §7E** (nine steps) and talk track §9.  
Contracts: [openapi.yaml](./contracts/openapi.yaml), [events.md](./contracts/events.md).  
Data: [data-model.md](./data-model.md).

## Prerequisites

- Node 22+, Docker (for Postgres) or local Postgres 16
- Repo on branch `001-mutuelle-enrolment-cotisations`
- Seed files present under `seed/` (see `docs/base.md` §7B)
- Env: `DATABASE_URL`, `CARRIER_WEBHOOK_SECRET=stub-secret`

## Setup (after implementation)

```bash
# start db (Compose once available)
docker compose up -d db

npm install
npm run migrate
npm run seed
npm run dev       # API :3000
npm run worker    # drains outbox + Pending jobs
```

Headers:

```bash
export H_A=(-H "X-Role: company.admin" -H "X-Company-Id: company-a" -H "Content-Type: application/json")
export H_B=(-H "X-Role: company.admin" -H "X-Company-Id: company-b" -H "Content-Type: application/json")
export H_SYS=(-H "X-Role: system.worker" -H "Content-Type: application/json")
```

## §7E demo checklist

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Inspect `seed/*.json` | Co A=`alan`, Co B=`axa`, plan ≥50% employer |
| 2 | Enrol Company A (curl below) | **202** `PendingExternal` |
| 3 | Read `demo/last-alan-call.json` | createMember request/response |
| 4 | `GET /v1/enrolments/{id}` | **Active** + `insurerMemberId` |
| 5 | Inspect outbox/event or logs | `PremiumInstructionIssued` with **cents** + Paris month |
| 6 | `GET /v1/companies/company-a/payroll-lines` | two lines (patronale + salariale) |
| 7 | Enrol Company B; optional open `fixtures/axa-setup-sheet.json` | Different ACL log (`last-axa-call.json`); same event shape |
| 8 | Replay enrol same `Idempotency-Key` | **202** same `enrolmentId`; no second member |
| 9 | Terminate via platform-events (curl below) | **Ended** + Stop; payroll lines inactive |

### Paste-ready curls

```bash
# Step 2 — Enrol Company A / Alan
curl -sS "${H_A[@]}" \
  -H "Idempotency-Key: demo-enrol-a-1" \
  -X POST "http://localhost:3000/v1/companies/company-a/enrolments" \
  -d '{"employeeId":"emp-a1","planId":"sante-base","coverage":"collective","effectiveFrom":"2026-04-01"}'

# Step 8 — Replay (same key → same enrolmentId)
curl -sS "${H_A[@]}" \
  -H "Idempotency-Key: demo-enrol-a-1" \
  -X POST "http://localhost:3000/v1/companies/company-a/enrolments" \
  -d '{"employeeId":"emp-a1","planId":"sante-base","coverage":"collective","effectiveFrom":"2026-04-01"}'

# Step 9 — Terminate (docs/base.md §7C/§7E; FR-021a)
curl -sS "${H_SYS[@]}" \
  -X POST "http://localhost:3000/v1/dev/platform-events" \
  -d @fixtures/employee-terminated.json
```

### Extra gates (spec)

```bash
# 403 cross-tenant
curl -s -o /dev/null -w "%{http_code}\n" "${H_A[@]}" \
  -X POST "http://localhost:3000/v1/companies/company-b/enrolments" \
  -H "Idempotency-Key: x" \
  -d '{"employeeId":"emp-b1","planId":"sante-base","coverage":"collective","effectiveFrom":"2026-04-01"}'
# expect 403

# missing idempotency → 400
# dispense while Active → 409
# webhook without signature → 401
# duplicate platform eventId → no-op
```

## Automated validation

```bash
npm test                 # FSM units + idempotency + 403
npm run test:integration # outbox same-TX, worker activate, payroll upsert (if scripted)
```

## Success — §12 / SC-007 engineer checklist (T066)

Tick in the PR that closes the POC slice:

- [ ] **Boundaries** — Insurance ≠ Payroll ≠ Employee (payroll stub never writes Enrolment)
- [ ] **Multi-company tenancy** — cross-company admin → 403 (T031/T049/T055)
- [ ] **ANI shape** — employerShareCents ≥ 50% of base + employeeShareCents → stub lines (T016/T030)
- [ ] **Reliability** — outbox same-TX, Idempotency-Key, Pending honesty, Failed@3 + `dead_letter_counters` (T036/T037/T042)
- [ ] **ACL swap** — Company A Alan vs Company B AXA; same domain events, different ACL logs (T032)

All five must hold for a ≤7 minute demo (`docs/base.md` §9 / §7E).
