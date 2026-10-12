# Data Model: Mutuelle Enrolment POC

**Spec**: [spec.md](./spec.md) | **Brief entities**: `docs/base.md` §4 Key stores / Event payloads

## Enums

| Name | Values |
| --- | --- |
| `EnrolmentStatus` | `PendingExternal`, `Active`, `Failed`, `Dispensed`, `Ended` |
| `Carrier` | `alan`, `axa` |
| `Coverage` | `collective` (POC only) |
| `PremiumInstructionKind` | `Issued`, `Stop` |
| `Role` | `company.admin`, `employee.self`, `system.worker`, `system.payroll_consumer` |

## Seed / reference (not mastered by Insurance writes)

### Company
| Field | Type | Notes |
| --- | --- | --- |
| id | string | **Locked demo:** `company-a`, `company-b` |
| name | string | |
| carrier | Carrier | `company-a`=`alan`, `company-b`=`axa`; immutable while Pending/Active |
| insuranceEnabled | boolean | enrol/dispense → 409 if false; seed `true` |
| planId | string | **Locked:** `sante-base` |

### Employee
| Field | Type | Notes |
| --- | --- | --- |
| id | string | **Locked demo:** `emp-a1` (A), `emp-b1` (B) |
| companyId | string | |
| name | string | |
| active | boolean | HR-terminated → enrol 409; seed `true` |

### Plan
| Field | Type | Notes |
| --- | --- | --- |
| id | string | **Locked:** `sante-base` |
| name | string | Santé Base |
| monthlyPremiumCents | int | EUR cents |
| employerSharePct | int | ≥ 50 |
| proration | string | `full_month` |

### DispenseReason
| Field | Type | Notes |
| --- | --- | --- |
| code | string | e.g. `HAS_OWN_COVER` |
| label | string | |

### AdminBinding
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| role | Role | `company.admin` |
| companyId | string | |

## Aggregates / write model

### Enrolment
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| companyId | string | |
| employeeId | string | |
| planId | string | |
| coverage | Coverage | `collective` |
| status | EnrolmentStatus | FSM |
| effectiveFrom | date | accepted as given |
| effectiveTo | date? | set on Ended |
| insurerMemberId | string? | set on Active |
| carrier | Carrier | **snapshot** from company at enrol (supports US4 evidence; not a live join) |
| dispenseReasonCode | string? | if Dispensed |
| attemptCount | int | worker retries; fail at 3 |
| lastError | string? | |
| createdAt / updatedAt | timestamptz | |

**Uniqueness**: partial unique index — at most one row per `(companyId, employeeId)` with status in (`PendingExternal`,`Active`).

**Read model:** `lastPremium` on GET detail is **derived at read time** from the latest Issued premium instruction (outbox/event store) for that enrolment — not a denormalized column required in v1. `pendingAgeSeconds` derived from `createdAt`/`updatedAt` when status is PendingExternal.

**FSM** (see `docs/base.md` §7):

```
Enrol → PendingExternal ──OK──► Active ──terminate/cancel──► Ended
              │                      │
              ├── reject → Failed    └── (Stop if premiums existed)
              ├── timeout → retry; after 3 → Failed
              └── terminate/cancel → Ended (compensate if member in-flight)

Dispense → Dispensed
```

### IdempotencyKey
| Field | Type | Notes |
| --- | --- | --- |
| companyId | string | |
| route | string | e.g. `POST /v1/companies/:id/enrolments` |
| key | string | |
| enrolmentId | uuid | |
| responseBody | jsonb | replay payload (202 body) |
| createdAt | timestamptz | no TTL in POC |

**Uniqueness:** primary/unique on `(companyId, route, key)`.

### OutboxMessage
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| eventType | string | see contracts/events.md |
| payload | jsonb | |
| createdAt | timestamptz | |
| publishedAt | timestamptz? | null until drained |

### ProcessedEvent
| Field | Type | Notes |
| --- | --- | --- |
| source | string | `webhook` \| `platform` |
| eventId | string | insurerEventId or platform eventId |
| processedAt | timestamptz | |

**Uniqueness:** primary/unique on `(source, eventId)`.

### AuditEntry
| Field | Type | Notes |
| --- | --- | --- |
| id | bigserial | |
| companyId | string | |
| enrolmentId | uuid? | |
| action | string | enrol/dispense/cancel/activate/terminate/fail |
| correlationId | string | |
| detail | jsonb | |
| createdAt | timestamptz | |

### DeadLetterCounter
POC shape for `docs/base.md` §4 Observability / edge “dead-letter counter” (FR-008a). Not a broker DLQ.

| Field | Type | Notes |
| --- | --- | --- |
| name | string | PK — e.g. `activate_enrolment` |
| count | int | monotonic; +1 per exhaustion → Failed |
| lastEnrolmentId | uuid? | last enrolment that exhausted |
| updatedAt | timestamptz | |

On exhaustion worker MUST: set enrolment Failed + audit `action=fail` + increment this counter (T037 asserts `count` increased).

## Payroll stub (separate store)

### PayrollLine
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | |
| companyId | string | |
| employeeId | string | |
| enrolmentId | uuid | |
| periodFrom / periodTo | date | Paris month |
| kind | `patronale` \| `salariale` | |
| amountCents | int | |
| currency | `EUR` | |
| sourceEventId | string | idempotency |
| active | boolean | false after Stop |

**Idempotency**: prefer upsert on `sourceEventId`; fallback key `enrolmentId + periodFrom + periodTo + kind` (FR-018a). Stop deactivates lines for enrolment+period.

## Relationships

- Company 1—* Employee (seed)
- Company 1—1 Plan (POC)
- Company 1—* Enrolment
- Enrolment 0—* OutboxMessage (via TX)
- Enrolment 0—* PayrollLine (via events only)
