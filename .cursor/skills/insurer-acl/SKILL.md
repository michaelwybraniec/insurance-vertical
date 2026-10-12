---
name: insurer-acl
description: >-
  Guides InsurerGateway anti-corruption layer design with AlanStub and AxaStub
  adapters, webhook/inbox idempotency, and carrier-swappable affiliation. Use
  when implementing or changing insurer integration, stubs, webhooks, setup
  sheets, createMember/cancelMember, or company.carrier routing.
---

# Insurer ACL (Alan / AXA)

Carriers are **adapters**, not domains. Company A = `alan`, Company B = `axa` — same `EnrolEmployee`, same domain events out. Source: `docs/base.md` §4 Carriers + constitution II.

## Port

```ts
interface InsurerGateway {
  createMember(input: CreateMemberInput): Promise<{
    memberId: string
    rateParams?: { monthlyPremiumCents: number; employerSharePct: number }
  }>
  cancelMember(input: CancelMemberInput): Promise<void>
}
```

- Domain speaks PayFit language (`companyId`, `employeeId`, `enrolmentId`, plan).
- Gateway maps to carrier-shaped requests **inside** the adapter only.
- Never leak Alan/AXA types into Enrolment aggregate or application commands.
- `company.carrier` is **seed-only** in POC (no admin pick-carrier API while Pending/Active).

## Adapters (POC)

| Adapter | Behaviour | Demo artifact |
| --- | --- | --- |
| **AlanStub** | API-style affiliate + optional webhook confirm | Log `demo/last-alan-call.json` |
| **AxaStub** | OC-style affiliate; may return setup-sheet-like rates | Log `demo/last-axa-call.json`; read `fixtures/axa-setup-sheet.json` |

**AXA rates:** when setup-sheet fixture present, `rateParams` supply premium/`employerSharePct` inputs to the share formula; else plan seed. Still emit `employerShareCents`/`employeeShareCents` (half-up).

Routing: `company.carrier` → factory picks stub. Worker calls gateway after PendingExternal.

## Worker flow

1. Load Pending enrolment / outbox job  
2. `gateway = resolve(company.carrier)`  
3. `createMember(...)` → `memberId` (+ optional `rateParams`)  
4. TX: Enrolment → Active + outbox `EmployeeEnrolledInInsurance` + `PremiumInstructionIssued`  
5. On **cancel**: `cancelMember` + Ended + outbox `EnrolmentCancelled` + `PremiumInstructionStop` if Issued existed  
6. On **terminate**: same end-of-cover outs (`EnrolmentCancelled` + Stop if Issued); Pending → compensate stub member  
7. **Terminate wins** vs concurrent activate — never leave Active for a terminated employee  

## Webhooks / inbox

- Sync stub activate OK for §7E; HTTP webhook **required in test pack**.
- Header: `X-Carrier-Signature: stub-secret` — missing/wrong → **401**.
- Payload must include `enrolmentId` and/or `insurerMemberId` — unknown → **404**.
- Dedupe on `insurerEventId` (processed_events) — duplicate → no-op.
- `result=confirmed` → Pending→Active (already Active same member → 200 no-op).
- `result=rejected` → Pending→**Failed** (not Pending → 200 no-op).
- Timeout/transport: stay Pending + retry; after **3** attempts → **Failed** + dead-letter counter + audit; never silent Active.
- `attemptCount` increments only on createMember timeout/transport (not webhook reject).

## What not to build

- Real Alan/AXA HTTP or partner sandboxes  
- Public webhook infra / mTLS  
- Carrier marketplace or AXA commercial referral funnel  
- Fiche-de-paramétrage pipeline beyond one fixture file  

## Checklist before merging ACL changes

- [ ] Domain still has zero carrier imports  
- [ ] Both stubs satisfy the same gateway methods  
- [ ] Company A vs B demo shows **different** ACL logs, **same** event shape  
- [ ] Cancel/compensate path exists for Pending + Active  
- [ ] Idempotent webhook / duplicate delivery handled  
- [ ] Signature + reject→Failed + Failed@3 covered by tests  
- [ ] AXA sheet rates (when present) drive cents formula inputs  
