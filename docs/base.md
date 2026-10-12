# POC — Payroll-native Insurance vertical (PayFit)

**Working title:** Multi-company mutuelle enrolment → cotisations on the bulletin  
**Company fit:** PayFit — payroll + HRIS for SMBs (FR / ES / UK); DDD + event-driven platform; JetLang coexistence  
**Mission fit:** Senior freelance SE — Insurance / benefits greenfield module  
**POC posture:** Thin **DDD vertical slice** — Insurance owns enrolment + cotisation _instructions_; Payroll stub consumes; **carriers = ACLs** (`AlanStub` + `AxaStub`)  
**Related:** [`README.md`](../README.md) · Spec Kit feature [`specs/001-mutuelle-enrolment-cotisations/spec.md`](../specs/001-mutuelle-enrolment-cotisations/spec.md) · _(optional later)_ `system-design-insurance-module.md`

---

## 1. Context

PayFit already owns **Company**, **Employee**, and **Payroll**. French private employers must offer a **collective complémentaire santé (mutuelle)** and put cotisations on the **fiche de paie** (ANI since 2016: employer ≥ 50% of base contribution; employee share withheld on salary; affiliation usually mandatory with legal dispenses).

Today that often means:

- Double entry between HRIS/payroll and the insurer (e.g. Alan-class tools)
- Manual cotisation rates on bulletins
- Drift when someone joins, leaves, or changes formula mid-month

PayFit already partners for mutuelle sync in production (e.g. [PayFit × Alan](https://payfit.com/fr/alan-integration)). **AXA** appears as a commercial / ecosystem partner and, in product terms, as a classic **organisme complémentaire** (mutuelle/prévoyance) many SMBs already use — not the same deep “click-sync” product as Alan, but a real carrier shape (affiliation + cotisations + often **fiches de paramétrage** / setup sheets for paie).

A platform **Insurance vertical** generalises both: one bounded context for many client companies; **Alan vs AXA = adapters**, not two domains — aligned with PayFit’s move off JetLang toward domain services + events.

This POC is the smallest product that makes that vision **demoable, testable, and architecturally credible** for a freelance mission / design conversation.

---

## 2. Description

### What it is

A **multi-tenant Insurance domain** that:

1. Serves **N PayFit client companies** (`companyId`).
2. Lets an admin **enrol** (or record a **dispense**) an employee on a collective health plan.
3. Talks to carriers via **`InsurerGateway` ACL** — POC ships **two stubs**: `AlanStub` (API-style affiliate) and `AxaStub` (classic OC-style affiliate + optional setup-sheet rates).
4. Emits **structured cotisation instructions** (part patronale / part salariale) for a payroll period.
5. Has a **Payroll stub** that “prints” Santé lines on a fake bulletin.
6. Reacts to **EmployeeTerminated** (stop cover + stop cotisations).
7. Survives **retries / double-clicks / duplicate webhooks** (idempotency + outbox).

### What it is not

- Not a claims / medical / quoting engine
- Not a full multi-carrier _marketplace_ UI (only **two ACL stubs** to prove swappability)
- Not a full DSN / URSSAF calculator (Payroll owns bulletin + declarations)
- Not a second Employee master database
- Not “AI picks your mutuelle” as the core demo
- Not rebuilding AXA’s commercial partnership page — AXA here = **carrier adapter**

### One-sentence pitch

> For many PayFit client companies, turn employee lifecycle into compliant mutuelle affiliation and payroll-ready cotisations — as a DDD vertical with events, outbox, and swappable carrier ACLs (Alan-style API and AXA-style OC).

---

## 3. Real problem

### Operational reality today (typical SMB)

| Pain                   | What happens                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| **Legal obligation**   | ANI: must offer collective mutuelle; cotisations on bulletin       |
| **Fragmented tools**   | PayFit for paie; insurer portal for affiliation; Excel for rates   |
| **Double saisie**      | Hire in PayFit → re-enter at insurer → re-enter cotisation in paie |
| **Join / leave drift** | Employee left PayFit but still billed at insurer (or reverse)      |
| **Split funding**      | Employer ≥ 50% / employee rest — easy to get wrong on the slip     |
| **Mid-month changes**  | Proration / next period — unclear ownership                        |
| **Dispenses**          | Some employees can refuse; must be tracked, not ignored            |
| **Scale**              | PayFit has thousands of companies — one-off scripts don’t scale    |

### Business problem for PayFit

- Mutuelle is **table-stakes** for French SMB payroll, not a side perk.
- Differentiation = **paie-native** benefits (bulletin + headcount sync), not another standalone insure-tech UI.
- Architecture must fit **domain verticals + events**, not JetLang-style dual truth.
- Freelance / squad mission needs a slice that proves **ownership, contracts, and reliability** in weeks.

### Problem statement (one line)

> SMBs need mutuelle affiliation and cotisations to stay correct on every bulletin when people join, change, or leave — without dual entry and without Insurance owning Payroll.

---

## 4. Real solution

### Product solution

```
Employee hired / updated / terminated (platform events)
        ↓
Insurance vertical (Enrolment aggregate)
        ↓
Insurer ACL (stub → real partner later)
        ↓
Status Pending → Active (or Dispensed / Failed / Ended)
        ↓
PremiumInstructionIssued { employerShareCents, employeeShareCents, period }
        ↓
Payroll stub → Santé lines on bulletin
        ↓
Audit + idempotent retries
```

### DDD vertical (this is the design)

| Piece                        | Owns                                                                            | Does not own                       |
| ---------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| **Insurance**                | Enrolment, dispense, plan choice, cotisation _instructions_, insurer sync state | Employee master, payslip math, DSN |
| **Employee**                 | Person, contract, termination                                                   | Whether mutuelle Active            |
| **Payroll**                  | Bulletin lines, social declarations                                             | Insurer member APIs                |
| **Carrier (Alan / AXA / …)** | Cover fulfilment, member ids, rate params                                       | PayFit domain language             |

**Vertical ship shape:** `insurance` api + worker (+ thin admin UI) · own DB · events in/out.

### Carriers in the POC: Alan vs AXA

|                      | **Alan** (stub)                                                                     | **AXA** (stub)                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Real-world role      | Digital mutuelle with [PayFit product sync](https://payfit.com/fr/alan-integration) | Classic OC; SMB contracts; commercial PayFit ecosystem partner                                                    |
| ACL behaviour in POC | `createMember` / `cancelMember` via fake REST + webhook confirm                     | Same gateway methods; may also return **setup-sheet-like** cotisation params (mimics fiche de paramétrage → paie) |
| Why both?            | Proves **domain stable, carrier swappable** — not “Alan-only plugin”                |

```
Insurance domain (Enrolment, PremiumInstruction)
        │
        ▼
 InsurerGateway  (interface)
        ├── AlanStub   → API-style affiliate + webhook
        └── AxaStub    → OC-style affiliate + optional param sheet rates
        │
        ▼
 PremiumInstruction* → Payroll stub (same events either way)
```

Company A can be configured with `carrier = alan`; Company B with `carrier = axa`. Same enrol command; different ACL behind the gate.

### Solution building blocks

| Layer                | Responsibility                                             | POC implementation                                 |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| **Experience**       | Admin enrol / dispense / list cover · **see** company carrier (seed-configured) | Minimal React or HTTP collection (Bruno/curl OK)   |
| **Domain**           | Enrolment FSM, invariants, Money shares                    | Pure TypeScript aggregates — **no** Alan/AXA types |
| **Application**      | Commands + platform event handlers                         | Nest-like or plain handlers                        |
| **Outbox / bus**     | Reliable publish                                           | SQL outbox + in-process queue or SQS local         |
| **Insurer ACL**      | Create/cancel member (+ optional rate params)              | `AlanStub` + `AxaStub` + fake webhooks             |
| **Payroll consumer** | Apply Santé lines                                          | Stub service logging/instructions table            |
| **Identity (stub)**  | Admin scoped to `companyId`                                | Simple API key / header company scope              |
| **Observability**    | correlationId, Pending age, DLQ                            | Structured logs + counters                         |

### End-to-end happy path

1. Seed **Company A**, **Company B**, employees each.
2. Admin (Company A): `EnrolEmployee` on plan “Santé Base”.
3. API returns **PendingExternal**; outbox scheduled.
4. Worker calls **company’s carrier ACL** (`AlanStub` or `AxaStub`) → member created → enrolment **Active**.
5. Emit `EmployeeEnrolledInInsurance` + `PremiumInstructionIssued`  
   `{ employerShareCents, employeeShareCents, currency: "EUR", periodFrom, periodTo }`  
   (example: plan 60% employer → cents split ≥50% employer; UI may label period `2026-04`).
6. Payroll stub stores two Santé lines for that employee/period (**same** whether Alan or AXA).
7. Admin UI / GET cover shows Active for Company A only (tenant isolation).
8. Repeat enrol on Company B (AXA) — show different ACL logs, **same domain events**.
9. Publish `EmployeeTerminated` → cover **Ended** → `PremiumInstruction` Stop → stub removes lines.

### Failure / edge paths (required in demo)

| Case                      | Expected behaviour                                                    |
| ------------------------- | --------------------------------------------------------------------- |
| Double-click enrol        | Same `Idempotency-Key` → same enrolment, no second insurer member     |
| Insurer timeout           | Stay Pending; retry; UI still honest; after **3** attempts → **Failed** + dead-letter counter (POC) |
| Duplicate webhook         | `insurerEventId` inbox → no-op                                        |
| Terminate while Pending   | Cancel local + compensate stub member                                 |
| Dispense instead of enrol | Status Dispensed; **no** premium instruction (or zero) + audit reason |
| Wrong company scope       | 403 — cannot enrol Company B’s employee as Company A admin            |

### User stories (POC scope)

**Actors:** Company admin (HR) · Employee (read-only later) · System (platform events) · Carrier (Alan/AXA stub) · Payroll stub

| ID                  | Story                                                                                                                                                                                        | Acceptance (demo)                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US1**             | **As a** company admin, **I want to** enrol an employee on our collective mutuelle plan, **so that** affiliation and cotisations stay in sync with paie without double entry.                | Enrol → Pending → Active; premium instruction with employerShareCents ≥ 50% of base + employeeShareCents; Payroll stub shows two Santé lines; scoped to my `companyId`. |
| **US2**             | **As a** company admin, **I want to** record a **dispense** (legal exemption) instead of affiliation, **so that** we stay compliant when the employee must not join the collective contract. | Dispense + reason code → status Dispensed; **no** Active cover; **no** (or zero) premium instruction; audit kept.                                     |
| **US3**             | **As a** company admin, **I want** leavers to drop off cover automatically, **so that** we don’t keep paying / withholding after `EmployeeTerminated`.                                       | Terminated event → Ended; carrier cancel/compensate; `PremiumInstruction` Stop; stub lines removed.                                                   |
| **US4**             | **As** PayFit (platform), **I want** Company A on **Alan** and Company B on **AXA** without two products, **so that** carriers are adapters behind one Insurance vertical.                   | Same `EnrolEmployee` command; `InsurerGateway` routes to AlanStub vs AxaStub; **same** domain events out.                                             |
| **US5**             | **As a** company admin, **I want** double-submit / retries to be safe, **so that** network blips don’t create two members or two cotisations.                                                | Same Idempotency-Key → same enrolment; duplicate webhook → no-op.                                                                                     |
| **US6**             | **As a** company admin, **I want to** see enrolment status (Pending / Active / Failed / Dispensed), **so that** I’m not lied to while the carrier is still processing.                       | API/UI returns honest FSM status after enrol.                                                                                                         |
| **US7** _(stretch)_ | **As an** employee, **I want to** see “my cover” read-only, **so that** I know I’m affiliated.                                                                                               | `GET cover` for self; no commands. Optional in POC.                                                                                                   |

**Also in Domain API (not a numbered US above):** admin `CancelEnrolment` (`POST /v1/enrolments/:id/cancellations`) → Ended + carrier compensate + Stop if needed. Spec Kit may schedule it as its own delivery story; **brief US ids US1–US7 stay canonical** for product talk-track.

**Out of user-story scope for POC:** file a claim · pick among marketplace insurers · edit DSN · change URSSAF rules.

### Data flow

**Stores (who writes)**

| Store                        | Writer           | Data                                                        |
| ---------------------------- | ---------------- | ----------------------------------------------------------- |
| Insurance write DB           | API / worker     | `Enrolment`, catalog/plan ref, `outbox`, `processed_events`, `audit_log` |
| Insurance read model _(opt)_ | Projector        | Cover list for admin UI                                     |
| Carrier (stub)               | Worker via ACL   | External `memberId` (fake)                                  |
| Bus                          | Outbox publisher | Domain events                                               |
| Payroll stub DB              | Payroll consumer | Santé lines per employee/period (patronale + salariale)     |

**End-to-end data path**

```
[Admin UI / HTTP]
   │  command EnrolEmployee { companyId, employeeId, planId, coverage, effectiveFrom, idempotencyKey }
   │  header Idempotency-Key
   ▼
[Insurance API]  authZ: admin ∈ companyId
   │  TX ──► enrolment (PendingExternal) + outbox row
   │  ◄──── 202 + enrolmentId + status
   ▼
[Worker]
   │  load Pending jobs / outbox
   │  InsurerGateway(company.carrier) → AlanStub | AxaStub
   │       createMember(employee…) → memberId
   │  TX ──► enrolment (Active, insurerMemberId) + outbox:
   │           EmployeeEnrolledInInsurance
   │           PremiumInstructionIssued { employerShareCents, employeeShareCents, period, currency… }
   ▼
[Publisher]  outbox → bus
   │
   ├─► [Payroll stub]  upsert Santé lines for period
   └─► [Notify opt]    “you’re covered”

Terminate path:
[Employee domain] EmployeeTerminated { employeeId }
   → bus → [Insurance worker] idempotent
   → enrolment Ended + carrier cancel + PremiumInstruction Stop
   → bus → [Payroll stub] remove/stop lines
```

**Event payloads (minimal)**

```ts
EmployeeEnrolledInInsurance {
  eventId, occurredAt, companyId, employeeId, enrolmentId, planId, carrier, effectiveFrom
}

PremiumInstructionIssued {
  eventId, occurredAt, companyId, employeeId, enrolmentId,
  periodFrom, periodTo,
  employerShareCents,   // integer EUR cents (Money); half-up from pct
  employeeShareCents,   // integer EUR cents (Money); remainder so sum = premium
  currency              // "EUR"
}

EnrolmentCancelled / PremiumInstructionStop { eventId, occurredAt, companyId, employeeId, enrolmentId, effectiveTo }
```

**Rule:** Insurance never writes Payroll tables; Payroll never writes Enrolment. Only **ids + money instructions** cross the bus.

### Interface (what the user sees)

POC UI is **thin** — enough to exercise the vertical, not a full PayFit design system.

**Surfaces**

| Screen                      | Who      | What you can do                                                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| **Company Insurance home**  | Admin    | See carrier (Alan/AXA), plan, list enrolments + statuses                                               |
| **Enrol employee**          | Admin    | Pick employee + plan + effective date → submit (Idempotency-Key)                                       |
| **Record dispense**         | Admin    | Pick employee + reason code → Dispensed                                                                |
| **Enrolment detail**        | Admin    | Status timeline (Pending / Active / Failed / Ended), insurer member id, last premium instruction       |
| **My cover** _(stretch)_    | Employee | Read-only: plan name, status, effective dates — no enrol/cancel                                        |
| **No UI (API/events only)** | System   | `EmployeeTerminated` in; Payroll stub consumes premium events (log or simple “bulletin preview” table) |

**Wireframe (admin)**

```
┌─────────────────────────────────────────────┐
│ PayFit · Insurance          [Company A ▾]   │
│ Carrier: Alan    Plan: Santé Base           │
├─────────────────────────────────────────────┤
│ Employees cover                             │
│ Name        Status     Period      Actions  │
│ Ada         Active     2026-04     View     │
│ Bob         Pending    —           View     │
│ Cara        Dispensed  —           View     │
│                                             │
│ [ + Enrol employee ]  [ + Record dispense ] │
└─────────────────────────────────────────────┘
```

**Implementation choice for POC:** minimal **React** admin **or** HTTP-only (Bruno/curl) for week 1 — UI is not the proof; domain + events are.

### Roles (authZ)

We do **define roles** — stub Identity in POC, real PayFit Identity later.

| Role                         | Scope              | Can do                                                    | Cannot do                                               |
| ---------------------------- | ------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| **company.admin**            | One `companyId`    | Enrol, dispense, cancel, list cover for that company      | Other companies’ data; Payroll DSN; carrier back-office |
| **employee.self**            | Own `employeeId`   | `GET` my cover (stretch)                                  | Enrol self / others; see cotisation admin detail        |
| **system.worker**            | Platform           | Consume Employee events; call carrier ACL; publish outbox | Admin UI                                                |
| **system.payroll_consumer**  | Platform           | Consume Premium\* events; write stub bulletin lines       | Change Enrolment                                        |
| **payfit.support** _(later)_ | Cross-company read | Ops/debug                                                 | Not in POC                                              |

**Enforcement (POC):**  
Stub identity via headers `X-Role` + `X-Company-Id` (and `X-Employee-Id` for self). Optional `Authorization` bearer ignored in POC.  
Server checks: admin commands require `company.admin` **and** body `companyId ===` header company. Wrong company → **403**.

**Not building in POC:** full SSO, PayFit permission matrix UI, insurer portal logins.

### Domain API (yes — we have one)

**Yes.** The Insurance vertical exposes its own **HTTP domain API**. That is how the admin UI (and later PayFit) talks to Insurance.  
It is **not** the insurer’s API and **not** Payroll’s API.

| Surface                  | Direction                     | Purpose                             |
| ------------------------ | ----------------------------- | ----------------------------------- |
| **Insurance domain API** | Inbound (React / PayFit → us) | Commands + queries on Enrolment     |
| **InsurerGateway**       | Outbound (us → Alan/AXA)      | ACL only — not public               |
| **Domain events**        | Outbound on bus               | Tell Payroll / others what happened |
| **Platform events**      | Inbound on bus                | Employee hired/terminated           |

**Style:** command/query HTTP (REST), not table CRUD. Body = business intent; server enforces invariants + authZ.

**POC routes (`/v1`)**

| Method | Path                                  | Role            | Command / query                       |
| ------ | ------------------------------------- | --------------- | ------------------------------------- |
| `POST` | `/v1/companies/:companyId/enrolments` | `company.admin` | `EnrolEmployee` (+ `Idempotency-Key`) |
| `POST` | `/v1/companies/:companyId/dispenses`  | `company.admin` | `DispenseEmployee`                    |
| `POST` | `/v1/enrolments/:id/cancellations`    | `company.admin` | `CancelEnrolment`                     |
| `GET`  | `/v1/companies/:companyId/enrolments` | `company.admin` | List cover (read model)               |
| `GET`  | `/v1/enrolments/:id`                  | `company.admin` | Enrolment detail + status             |
| `GET`  | `/v1/me/cover`                        | `employee.self` | My cover _(stretch)_                  |
| `POST` | `/v1/webhooks/carriers/:carrier`      | carrier sig     | Map webhook → confirm/reject command  |

**Responses:** `202` + `{ enrolmentId, status: PendingExternal }` on enrol; later `GET` shows `Active`. Errors: `403` wrong company, `409` invariant (e.g. already active / terminated).

**OpenAPI:** document these routes in the POC deliverables — typed contract for UI and reviewers.  
**Full picture:** see **§7 Ultimate architecture**.

---

## 5. Regulatory / business value (FR)

| Rule (simplified)                         | How POC reflects it                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Collective mutuelle obligatory (ANI 2016) | Company must have Insurance enabled + a plan                           |
| Employer ≥ 50% of base cotisation         | Instruction always carries **employerShareCents / employeeShareCents** |
| Cotisation on fiche de paie               | Payroll stub materialises Santé lines from events                      |
| Affiliation often mandatory + dispenses   | Enrol **or** Dispense command with reason code                         |
| Mid-period changes                        | Effective dating + stated proration assumption                         |
| DSN / social declarations                 | **Out of POC** — Payroll consumes instructions; we don’t fake full DSN |

**Pitch to PayFit:**

> We don’t replace Payroll compliance engines — we feed them correct, event-sourced cotisation facts from a clean Insurance bounded context.

### ROI hypotheses to validate

| Hypothesis               | Measurable signal                                                |
| ------------------------ | ---------------------------------------------------------------- |
| Less double entry        | Enrol once → insurer stub + payroll stub both updated            |
| Fewer leave-drift errors | Terminate always stops Active cover + Stop instruction           |
| Safer money path         | No silent premium overwrite; Change/Stop events + audit          |
| Multi-client ready       | 2+ companies isolated by `companyId`                             |
| Partner-ready            | Swap `AlanStub` / `AxaStub` for real APIs without domain rewrite |
| Mission-ready            | Vertical slice runnable in week 1–2 of freelance                 |

---

## 6. How this scales

### Product scale path

| Stage          | Scope                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **POC**        | 2–3 companies · FR · 1 plan · **AlanStub + AxaStub** · enrol/dispense/terminate · premium→payroll stub · outbox/idempotency |
| **Pilot**      | Real Alan and/or AXA sandbox · real PayFit event contracts · proration · dispense matrix v1                                 |
| **Product v1** | Production carrier(s) · admin + employee “my cover” · bulletin integration · audit/export                                   |
| **Platform**   | More OCs · fiches de paramétrage pipeline · ES/UK · prévoyance sibling · JetLang cutover                                    |

### Technical scale levers

1. **Multi-tenant by `companyId`** — every aggregate and query scoped
2. **Event contracts** — versioned payloads; Payroll/Notifications as consumers
3. **Outbox + inbox** — at-least-once safe
4. **Stateless api/worker** — horizontal replicas on K8s
5. **ACL per carrier** — `InsurerGateway` interface
6. **Reconcile job** — Insurance ↔ insurer members ↔ last premium instructions
7. **Country adapters** — FR first; UK/ES later without rewriting Enrolment lifecycle

### What “scalability” means here (say this)

Not millions of enrol clicks/second.  
**Scale = thousands of companies × employees × monthly payroll runs**, with correct cotisations and no drift when HR events storm (imports, leavers).

---

## 7. System architecture (charts)

_Complements **User stories**, **Interface**, **Roles**, **Domain API**, **Data flow** in §4._

### Ultimate architecture (read this way)

Forget the big box maze. There are only **5 parts**.

#### 1) Big picture (one line)

```
HR admin  -->  OUR APP (Insurance)  -->  Payroll (cotisations on payslip)
                      |
                      +--> Alan or AXA (insurer)
                      ^
                      |
              Employee hired/left (PayFit already has this)
```

**In words:** HR uses our app to enrol people. We talk to the insurer. We tell Payroll what to put on the bulletin. When PayFit says someone left, we stop cover.

#### 2) The five building blocks

```
[1] SCREENS          React admin (and optional "my cover" for employee)

[2] DOMAIN API       HTTP /v1  — enrol, dispense, list, webhooks
                     checks role + companyId

[3] BRAIN + DB       Enrolment rules (Pending/Active/Ended)
                     Postgres + outbox (so events are not lost)

[4] WORKER           Background jobs: call insurer, publish events

[5] OUTSIDE WORLD    Alan/AXA stubs | Event bus | Payroll stub
                     + PayFit Employee/Company events
```

```
  [1] Screens
        |
        v
  [2] Domain API ---------> [5] webhooks from Alan/AXA
        |
        v
  [3] Brain + DB
        |
        +-----> [4] Worker -----> [5] Alan / AXA
        |
        +-----> [4] Publisher --> [5] Bus --> Payroll
```

#### 3) What happens when HR enrols someone (left to right)

```
Step  What                         Where
----  ---------------------------  ----------------------
 1    Admin clicks Enrol           [1] Screen
 2    POST /enrolments             [2] Domain API
 3    Save status = Pending        [3] DB (+ outbox row)
 4    Return "Pending" to UI       [2] -> [1]
 5    Worker calls insurer         [4] -> Alan or AXA
 6    Status = Active              [3] DB
 7    Emit premium instruction     [4] -> Bus
 8    Payroll writes Sante lines   Payroll stub
```

#### 4) Roles on that picture

| Who              | Talks to      | Does                                        |
| ---------------- | ------------- | ------------------------------------------- |
| `company.admin`  | Domain API    | Enrol / dispense / list for **one** company |
| `employee.self`  | Domain API    | See my cover only (optional)                |
| Worker           | Alan/AXA + DB | Sync insurer, publish events                |
| Payroll consumer | Bus           | Put cotisations on bulletin                 |
| PayFit Employee  | Bus -> Worker | Hired / Terminated                          |

#### 5) What we ship vs what already exists

| We build (Insurance vertical)      | Already exists / stubbed          |
| ---------------------------------- | --------------------------------- |
| Screens + Domain API + DB + Worker | Employee / Company / Identity     |
| Outbox + events we publish         | Event bus (or in-process in POC)  |
| AlanStub + AxaStub                 | Real Alan/AXA later               |
| —                                  | Payroll stub (real Payroll later) |

### Build vs mock vs seed (don’t waste time)

Prove the **domain + events + multi-company + two carriers**. Everything else can be JSON, seed, or fake.

#### A) Must code — task + next steps

| Element                                 | What the task is               | What we actually do next                                                                                                                                  |
| --------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enrolment aggregate + FSM**           | Own the business rules in code | Create `Enrolment` with statuses Pending/Active/Ended/Dispensed; methods `enrol`, `activate`, `cancel`, `dispense`; reject illegal transitions with tests |
| **Domain API: enrol + list + get**      | HTTP entry for admin           | Add `POST /v1/companies/:id/enrolments`, `GET` list + by id; map body → command; return 202 + status JSON                                                 |
| **Outbox (same TX)**                    | Don’t lose events after save   | In enrol TX: insert enrolment + outbox row; add tiny publisher loop that reads unsent rows and “publishes”                                                |
| **Worker**                              | Finish enrol after API returns | Job: load Pending → call gateway → set Active → write Enrolled + Premium\* to outbox                                                                      |
| **InsurerGateway + AlanStub + AxaStub** | Prove carriers are adapters    | Interface `createMember` / `cancelMember`; two classes returning fake `memberId`; company.carrier picks which; log request/response JSON                  |
| **Idempotency-Key**                     | Safe double-click              | Store key → enrolmentId; second POST returns same body; unit test                                                                                         |
| **Multi-tenant `companyId`**            | Isolation                      | Middleware: header company must match URL/body; test 403 for Company A admin on Company B                                                                 |

**Order to implement:** seed load → aggregate+tests → API enrol/get → outbox → worker+stubs → idempotency → 403 test → terminate handler.

#### B) Seed as JSON — task + next steps

| Element              | What the task is     | What we actually do next                                                                                                      |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Companies A/B**    | Fake PayFit clients  | Write `seed/companies.json` (`id`, `name`, `carrier: alan\|axa`); load into memory/DB on boot                                 |
| **Employees**        | Fake headcount       | Write `seed/employees.json` (`id`, `companyId`, `name`, `active`); **no** employee CRUD UI                                    |
| **Plan Santé Base**  | Fake catalog + rates | Write `seed/plans.json` with monthly premium + `employerSharePct` (≥50) / employee rest; worker uses it for Premium\* amounts |
| **Dispense reasons** | Fake legal codes     | Write `seed/dispense-reasons.json` (e.g. `HAS_OWN_COVER`); validate code on dispense API                                      |
| **Admins**           | Fake identity        | Write `seed/admins.json` (`role`, `companyId`); map to `X-Role` / `X-Company-Id` for curl demos                               |

**Next step now:** create `seed/` folder with those 5 files + `npm run seed` (or load on server start).

#### C) Mock / display JSON — task + next steps

| Element                      | What the task is (prove without building) | What we actually do next                                                                                                                |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Polished React UI**        | Don’t spend days on screens               | Use Bruno/curl scripts in `demo/`; optional single HTML later                                                                           |
| **Employee “my cover” UI**   | Stretch only                              | Skip UI; if needed add `GET /v1/me/cover` returning JSON from enrolment                                                                 |
| **Real Alan / AXA HTTP**     | Don’t integrate real partners yet         | Keep stubs; save last stub call to `demo/last-alan-call.json` / `last-axa-call.json` for the talk                                       |
| **AXA fiche de paramétrage** | Show OC “rates file” idea                 | Hand-write `fixtures/axa-setup-sheet.json`; AxaStub reads rates from it; open file in demo                                              |
| **Real webhook infra**       | Don’t run public endpoints                | Either stub activates sync, **or** add `POST /v1/webhooks/carriers/:carrier` and send `fixtures/axa-webhook-active.json` once with curl |
| **SQS / K8s / Terraform**    | Infra story only                          | In-process queue after outbox; README note “PayFit = SQS/EKS/TF”; no AWS account for POC                                                |
| **Payroll product**          | Show bulletin impact                      | On Premium\* event, write `payroll_lines` in Postgres (POC choice); expose `GET /v1/companies/:id/payroll-lines` for demo               |
| **DSN / URSSAF**             | Out of scope                              | One slide/sentence in README — not code                                                                                                 |
| **Identity / SSO**           | AuthZ without Cognito                     | Header middleware only; document example curl with headers                                                                              |
| **Notifications**            | Nice-to-have                              | `console.log` or skip                                                                                                                   |
| **Read-model projector**     | Separate RM tables                        | Skip — `GET` list queries enrolments table                                                                                              |
| **Reconcile cron**           | Drift repair                              | Skip code; bullet in RFC “week 2”; optional one-off script later                                                                        |
| **Proration engine**         | Mid-month money                           | Hardcode `proration: full_month` in plan seed; document assumption                                                                      |
| **EmployeeHired auto-enrol** | Platform event in                         | Skip auto-enrol; implement only **Terminated** via `POST /v1/dev/platform-events` + `fixtures/employee-terminated.json`                 |
| **Change coverage**          | Mid-life plan change                      | Skip endpoint in v1                                                                                                                     |
| **OpenAPI portal**           | Pretty docs                               | Write `docs/routes.md` + `contracts/openapi.yaml` (both in Spec Kit deliverables)                                                        |
| **Audit UI**                 | Who changed what                          | Append rows to Postgres `audit_log` (JSON payload); GET last N as JSON (no full audit UI)                                               |
| **Docker Compose**           | Packaging                                 | After API works locally; then add `docker-compose.yml` (api, worker, db)                                                                |

#### D) Concrete next-steps checklist (this week)

1. Create repo folder `poc-insurance/` + TS Node project.
2. Add `seed/*.json` (companies, employees, plans, reasons, admins).
3. Implement Enrolment + 5 unit tests (happy + illegal transitions).
4. Implement `POST enrol` + `GET` + header authZ.
5. Add outbox table + publisher (console or in-process bus).
6. Implement worker + AlanStub + AxaStub (log JSON files).
7. Payroll stub writer → `payroll_lines` table + GET demo route.
8. Idempotency + cross-company 403 tests.
9. `fixtures/employee-terminated.json` + handler.
10. `demo/README.md` with curl script for the 9-step demo.

#### E) Demo without a fancy frontend

```
1. Show seed JSON (2 companies, employees, plan)
2. curl POST enrol (Company A / Alan) → 202 Pending JSON
3. Show worker log: AlanStub request/response JSON
4. curl GET enrolment → Active JSON
5. Show emitted PremiumInstructionIssued JSON
6. Show payroll stub Santé lines JSON
7. Same enrol Company B / AXA → gateway log differs, event shape same
8. curl POST again same Idempotency-Key → same enrolmentId
9. POST fixtures/employee-terminated.json → Ended + Stop instruction JSON
```

**Rule of thumb:** if it isn’t Enrolment, outbox, gateway swap, or premium event — **seed it or print JSON**.

### Context map (zoom)

```
┌──────────┐  Hired|Terminated|Updated   ┌─────────────────────┐
│ Employee │ ──────────────────────────► │ INSURANCE VERTICAL  │
└──────────┘                             │  Domain API + UI    │
┌──────────┐  InsuranceEnabled           │  Enrolment ★        │
│ Company  │ ──────────────────────────► │  Catalog · Premium  │
└──────────┘                             │  Worker · Outbox    │
┌──────────┐  authZ                      └──────────┬──────────┘
│ Identity │ ──────────────────────────►            │
└──────────┘                     Enrolled|Cancelled|Premium*
                                 (employerShareCents + employeeShareCents)
                                            │
                    ┌───────────────────────┼────────────────┐
                    ▼                       ▼                ▼
              ┌──────────┐           ┌──────────┐     ┌─────────────────────┐
              │ Payroll  │           │  Notify  │     │ InsurerGateway      │
              │ (stub)   │           │  (opt)   │     │  ├── AlanStub       │
              └──────────┘           └──────────┘     │  └── AxaStub        │
                                                      └─────────────────────┘
```

### Enrolment FSM

```
                 EnrolEmployee
                      │
                      ▼
               PendingExternal ──insurer OK──► Active ──terminate/cancel──► Ended
                      │                         │
                      └── reject / timeout*      └── ChangeCoverage → new effective slice
                            → Failed / retry

DispenseEmployee ──► Dispensed (no Active cover; audit reason)
```

\*timeout stays Pending with retry (not silent Active); after 3 failed attempts → Failed + dead-letter counter.

### Sequence (enrol)

```
Admin → API: EnrolEmployee (+ Idempotency-Key)
API  → DB TX: Enrolment=Pending + outbox
API  → Admin: 202 Pending
Worker → Insurer stub: createMember
Worker → DB: Active + outbox Enrolled + PremiumInstructionIssued
Publisher → Bus → Payroll stub: write Santé lines (patronale + salariale)
```

---

## 8. Suggested stack (POC)

| Layer             | Choice                                           |
| ----------------- | ------------------------------------------------ |
| Language          | TypeScript                                       |
| API / worker      | Node (Nest or lightweight)                       |
| DB                | Postgres (aggregate + outbox + processed_events + `audit_log` + `payroll_lines` + `dead_letter_counters`) |
| Bus               | In-process queue **or** LocalStack SQS           |
| UI                | Minimal React **or** HTTP-only for first demo    |
| Deploy (optional) | Docker Compose: `api`, `worker`, `db`            |

**Performance (POC):** demo-scale only (2–3 companies, handful of employees). **No p95/SLA target** in the brief — correctness and the §7E/§9 script matter, not load numbers.

Keep AWS/K8s/Terraform as “how we’d run it at PayFit” in the README — not required to prove the domain.

---

## 9. Demo script (5–7 minutes)

1. **Diagram** (30s): Insurance vertical; Payroll consumes; Alan/AXA behind `InsurerGateway`.
2. **Tenant isolation** (30s): Company A (Alan) vs Company B (AXA).
3. **Enrol Alan** (90s): Pending → Active → premium shares → payroll stub lines.
4. **Enrol AXA** (60s): same domain events; different ACL logs / optional setup-sheet rates.
5. **Idempotency** (45s): replay command / webhook → no duplicate.
6. **Terminate** (45s): cover ended + Stop instruction.
7. **Close** (30s): “Mission = real carrier ACLs; domain stays put; claims stay out.”

---

## 10. Deliverables

| Artifact                             | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| Runnable slice (Compose)             | Prove the path                                      |
| README with context map + event list | Design conversation                                 |
| OpenAPI or route list                | Command/query surface                               |
| Event catalog (markdown)             | `EmployeeEnrolled…`, `PremiumInstruction*` payloads |
| Short RFC (1–2 pages)                | Assumptions (FR, ANI split, proration rule)         |
| Test pack                            | FSM units + idempotency + multi-tenant isolation    |

---

## 11. Week plan (mission-shaped)

| When        | Outcome                                                  |
| ----------- | -------------------------------------------------------- |
| **Day 1–2** | Domain model + DB + Enrol Pending/Active                 |
| **Day 3**   | Outbox + worker + insurer stub                           |
| **Day 4**   | PremiumInstruction → payroll stub + terminate            |
| **Day 5**   | Idempotency, dispense, demo script, RFC                  |
| **Week 2**  | Proration rule, reconcile job, real queue, thin admin UI |

---

## 12. Success criteria

POC is a success if PayFit engineers can say:

1. Boundaries are correct (Insurance ≠ Payroll ≠ Employee).
2. Multi-company tenancy is real.
3. Cotisation path matches ANI _shape_ (employer/employee shares → bulletin).
4. Reliability patterns are first-class (outbox, idempotency, Pending).
5. Extending to a real carrier is an ACL swap, not a rewrite.

---

## 13. Explicit non-goals

- Claims, healthcare data vault, medical underwriting
- Full dispense legal matrix / CCN engine
- DSN XML generation
- Multi-country in POC (FR only; adapters later)
- Replacing Alan or AXA products — **pattern-compatible** carrier ACLs
- Building AXA’s commercial referral funnel — out of scope

---

## 14. One-pager cheat

```
VERTICAL   Insurance (UI + Domain API + DB + worker)
API        /v1 enrolments · dispenses · cover · webhooks  (see §4 Domain API)
ARCH       Ultimate diagram §7 — actors → vertical → carriers + Payroll + platform
IN         EmployeeHired | Terminated | Updated
OUT        Enrolled | Cancelled | PremiumInstruction*(employerShareCents, employeeShareCents, period)
CARRIERS   InsurerGateway → AlanStub | AxaStub (same domain, different ACL)
CORE       Enrolment FSM Pending→Active→Ended (+ Dispensed)
RELIABLE   outbox · inbox · Idempotency-Key · reconcile later
ROLES      company.admin · employee.self · system.worker · payroll_consumer
VALUE      ANI mutuelle → correct Santé lines for N companies
NOT        claims · DSN engine · shared HR DB · carrier marketplace UI
DEMO       Co A=Alan · Co B=AXA · enrol · payroll stub · terminate · idempotent
```

---

_Use this POC to support the 90‑min system design talk or as a week-1 spike on the freelance mission — same architecture as `system-design-insurance-module.md`._
