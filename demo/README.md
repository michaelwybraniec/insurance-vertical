# Demo — Mutuelle Enrolment POC

## Static demo (GitHub Pages)

In-browser mock of the admin UI — **no** API, Postgres, or worker. Same screens as `web/`; state lives in memory.

```bash
npm run demo:dev      # http://localhost:5812
npm run demo:build    # → demo/static/dist (base /insurance-vertical/)
npm run demo:preview  # serve the build locally
```

Override Pages base if needed: `VITE_BASE=./ npm run demo:build`

Details: [`static/README.md`](static/README.md). CI deploys `demo/static/dist` on push to `main` (workflow `demo-pages.yml`).

---

## Live curl script (§7E)

Full §7E path (`docs/base.md`). API on `:3810`, worker draining Pending + outbox.

## Headers

```bash
export H_A=(-H "X-Role: company.admin" -H "X-Company-Id: company-a" -H "Content-Type: application/json")
export H_B=(-H "X-Role: company.admin" -H "X-Company-Id: company-b" -H "Content-Type: application/json")
export H_SYS=(-H "X-Role: system.worker" -H "Content-Type: application/json")
```

## Setup

```bash
docker compose up -d db
npm install
npm run migrate && npm run seed
npm run dev       # API :3810
npm run worker    # terminal 2
npm run web:dev   # thin admin UI → http://localhost:5810
```

UI matches `docs/base.md` §4 Interface: company switcher, enrol, dispense, detail, bulletin preview.

## §7E curls (Company A Alan → Company B AXA → idempotency → terminate)

```bash
# 2 — Enrol Company A / Alan
curl -sS "${H_A[@]}" \
  -H "Idempotency-Key: demo-enrol-a-1" \
  -X POST "http://localhost:3810/v1/companies/company-a/enrolments" \
  -d '{"employeeId":"emp-a1","planId":"sante-base","coverage":"collective","effectiveFrom":"2026-04-01"}'
# → 202 PendingExternal; inspect demo/last-alan-call.json after worker

# 4 — GET enrolment (replace ID)
curl -sS "${H_A[@]}" "http://localhost:3810/v1/enrolments/<enrolmentId>"

# 6 — Payroll lines
curl -sS "${H_A[@]}" "http://localhost:3810/v1/companies/company-a/payroll-lines"

# 7 — Enrol Company B / AXA (sheet rates in fixtures/axa-setup-sheet.json)
curl -sS "${H_B[@]}" \
  -H "Idempotency-Key: demo-enrol-b-1" \
  -X POST "http://localhost:3810/v1/companies/company-b/enrolments" \
  -d '{"employeeId":"emp-b1","planId":"sante-base","coverage":"collective","effectiveFrom":"2026-04-01"}'
# → demo/last-axa-call.json; same PremiumInstruction shape, different ACL log

# 8 — Idempotency replay
curl -sS "${H_A[@]}" \
  -H "Idempotency-Key: demo-enrol-a-1" \
  -X POST "http://localhost:3810/v1/companies/company-a/enrolments" \
  -d '{"employeeId":"emp-a1","planId":"sante-base","coverage":"collective","effectiveFrom":"2026-04-01"}'

# 9 — Terminate
curl -sS "${H_SYS[@]}" \
  -X POST "http://localhost:3810/v1/dev/platform-events" \
  -d @fixtures/employee-terminated.json
```

## Extra

```bash
# Audit
curl -sS "${H_A[@]}" "http://localhost:3810/v1/companies/company-a/audit?limit=20"

# Cancel
curl -sS "${H_A[@]}" -X POST "http://localhost:3810/v1/enrolments/<id>/cancellations"

# Dispense (no Active cover)
curl -sS "${H_A[@]}" -X POST "http://localhost:3810/v1/companies/company-a/dispenses" \
  -d '{"employeeId":"emp-a1","reasonCode":"HAS_OWN_COVER"}'
```
