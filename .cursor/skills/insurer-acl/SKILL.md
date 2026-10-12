---
name: insurer-acl
description: >-
  Guides InsurerGateway anti-corruption layer design with AlanStub and AxaStub
  adapters, webhook/inbox idempotency, and carrier-swappable affiliation. Use
  when implementing or changing insurer integration, stubs, webhooks, setup
  sheets, createMember/cancelMember, or company.carrier routing.
---

# Insurer ACL (Alan / AXA)

Carriers are **adapters**, not domains. Company A can use `alan`, Company B `axa` — same `EnrolEmployee` command, same domain events out.

## Port

```ts
interface InsurerGateway {
  createMember(input: CreateMemberInput): Promise<{ memberId: string; rateParams?: RateParams }>
  cancelMember(input: CancelMemberInput): Promise<void>
}
```

- Domain speaks PayFit language (`companyId`, `employeeId`, `enrolmentId`, plan).
- Gateway maps to carrier-shaped requests **inside** the adapter only.
- Never leak Alan/AXA types into Enrolment aggregate or application commands.

## Adapters (POC)

| Adapter | Behaviour | Demo artifact |
| --- | --- | --- |
| **AlanStub** | API-style affiliate + optional webhook confirm | Log `demo/last-alan-call.json` |
| **AxaStub** | OC-style affiliate; may return setup-sheet-like rates | Log `demo/last-axa-call.json`; read `fixtures/axa-setup-sheet.json` |

Routing: `company.carrier` → factory picks stub. Worker calls gateway after PendingExternal.

## Worker flow

1. Load Pending enrolment / outbox job  
2. `gateway = resolve(company.carrier)`  
3. `createMember(...)` → `memberId`  
4. TX: Enrolment → Active + outbox `EmployeeEnrolledInInsurance` + `PremiumInstructionIssued`  
5. On terminate/cancel: `cancelMember` + Ended + `PremiumInstructionStop`  
6. Terminate while Pending: cancel local + compensate stub member  

## Webhooks / inbox

- Prefer sync stub activate for week-1, **or** `POST /v1/webhooks/carriers/:carrier` with fixture JSON.
- Dedupe on `insurerEventId` (processed_events / inbox) — duplicate → no-op.
- Timeout: stay Pending + retry; never silent Active.

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
