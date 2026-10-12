# Domain / platform event contracts

Canonical shapes for outbox → bus. Amounts in **EUR cents**. Timezone for period bounds: **Europe/Paris**.  
Aligned with `docs/base.md` §4 Event payloads + spec Clarifications.

## Deltas from `docs/base.md` §4 (intentional)

Money field names (`employerShareCents` / `employeeShareCents`) are **aligned** with current brief §4 — not a delta.

| Brief §4 | POC contract | Why |
| --- | --- | --- |
| Cancel/Stop combined sketch with `effectiveTo` | Separate `EnrolmentCancelled` (`effectiveTo`) + `PremiumInstructionStop` (`periodFrom`/`periodTo`, `kind`) | Clearer payroll apply |
| Enrolled without member id | `insurerMemberId` on Enrolled | Demo/GET evidence |
| `kind` absent on premium sketch | `kind: Issued \| Stop` on premium events | Payroll upsert key |
| Terminated sketch `{ employeeId }` | Ingress adds `type`, `eventId`, `occurredAt`, `companyId` via platform-events | Idempotency + tenancy |
| IN: Hired \| Terminated \| Updated | **Terminated only** in POC | §7C skip Hired auto-enrol / Updated |

**Emit `EnrolmentCancelled`:** on admin CancelEnrolment **and** on EmployeeTerminated when cover ends (Pending or Active) — matches brief “EnrolmentCancelled / PremiumInstructionStop” end path. `PremiumInstructionStop` only if Issued premiums existed (or Pending never issued → cancel/compensate only).

## Outbound (Insurance → bus)

### EmployeeEnrolledInInsurance

```json
{
  "eventId": "uuid",
  "occurredAt": "ISO-8601",
  "companyId": "string",
  "employeeId": "string",
  "enrolmentId": "uuid",
  "planId": "string",
  "carrier": "alan|axa",
  "effectiveFrom": "YYYY-MM-DD",
  "insurerMemberId": "string"
}
```

### PremiumInstructionIssued

```json
{
  "eventId": "uuid",
  "occurredAt": "ISO-8601",
  "companyId": "string",
  "employeeId": "string",
  "enrolmentId": "uuid",
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "employerShareCents": 0,
  "employeeShareCents": 0,
  "currency": "EUR",
  "kind": "Issued"
}
```

### EnrolmentCancelled

```json
{
  "eventId": "uuid",
  "occurredAt": "ISO-8601",
  "companyId": "string",
  "employeeId": "string",
  "enrolmentId": "uuid",
  "effectiveTo": "YYYY-MM-DD"
}
```

### PremiumInstructionStop

```json
{
  "eventId": "uuid",
  "occurredAt": "ISO-8601",
  "companyId": "string",
  "employeeId": "string",
  "enrolmentId": "uuid",
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "currency": "EUR",
  "kind": "Stop"
}
```

## Inbound (platform → Insurance)

### EmployeeTerminated

Posted to `POST /v1/dev/platform-events` with `X-Role: system.worker`.

```json
{
  "type": "EmployeeTerminated",
  "eventId": "uuid",
  "occurredAt": "ISO-8601",
  "companyId": "string",
  "employeeId": "string"
}
```

Duplicate `eventId` → 200 no-op.

**Not in POC:** `EmployeeHired` auto-enrol, `EmployeeUpdated` (§7C).

## Carrier webhook (test pack)

`POST /v1/webhooks/carriers/{carrier}`  
Header: `X-Carrier-Signature: stub-secret`

```json
{
  "insurerEventId": "string",
  "enrolmentId": "uuid",
  "insurerMemberId": "string",
  "result": "confirmed|rejected"
}
```

At least one of `enrolmentId` / `insurerMemberId` required.  
Duplicate `insurerEventId` → no-op.  
`result=confirmed` → PendingExternal → Active (idempotent; already Active same member → 200 no-op).  
`result=rejected` → PendingExternal → Failed; if not PendingExternal → **200 no-op** (FR-015c).
