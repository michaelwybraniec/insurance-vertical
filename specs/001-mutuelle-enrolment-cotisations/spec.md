# Feature Specification: Mutuelle Enrolment → Cotisations on Bulletin

**Feature Branch**: `001-mutuelle-enrolment-cotisations`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Full POC from docs/base.md (§1–14) — multi-company payroll-native Insurance vertical: enrol/dispense employees on collective mutuelle, swappable carrier adapters (Alan-style + AXA-style), structured employer/employee cotisation instructions consumed by Payroll stub, terminate lifecycle, outbox/idempotency, FR ANI shape. Do not skip content from the brief."

**Source brief**: `docs/base.md` (entire document; traceability in Assumptions)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enrol employee on collective mutuelle (Priority: P1)

As a company admin, I enrol an employee on our collective health plan so affiliation and cotisations stay in sync with payroll without double entry.

**Why this priority**: Core value path — Pending → Active → premium shares → bulletin lines for one company.

**Independent Test**: With Company A seeded (Alan-style carrier), enrol one employee; observe Pending then Active; verify employer share ≥ 50% and employee share; verify Payroll stub shows two Santé lines; verify only Company A data is visible.

**Acceptance Scenarios**:

1. **Given** Company A has Insurance enabled and plan “Santé Base”, **When** an admin for Company A enrols employee Ada with an idempotency key, **Then** the system immediately reports status PendingExternal and returns an enrolment identifier.
2. **Given** an enrolment is PendingExternal, **When** the carrier affiliation succeeds, **Then** status becomes Active and an insurer member reference is recorded.
3. **Given** enrolment becomes Active, **When** cotisation instructions are issued for the period, **Then** instructions include employerShare and employeeShare with employer share ≥ 50% of base, plus period bounds.
4. **Given** PremiumInstructionIssued was published, **When** Payroll stub consumes it, **Then** two Santé lines exist for that employee/period (employer part + employee part).
5. **Given** Company A admin is authenticated for Company A only, **When** they list cover, **Then** they see Ada’s Active enrolment and cannot see Company B employees.

---

### User Story 2 - Dual carrier adapters, one product (Priority: P1)

As PayFit (platform), I configure Company A on Alan-style carrier and Company B on AXA-style carrier without two products, so carriers remain adapters behind one Insurance vertical.

**Why this priority**: Proves domain stability and partner-readiness; required for the mission demo.

**Independent Test**: Enrol on Company A then Company B with the same enrol intent; carrier interaction logs differ; domain outcomes (enrolled + premium instruction shape) match.

**Acceptance Scenarios**:

1. **Given** Company A carrier = Alan-style and Company B carrier = AXA-style, **When** admins enrol an employee on each using the same enrol command, **Then** each company uses its configured carrier path.
2. **Given** both enrolments complete, **When** domain outcomes are compared, **Then** event/outcome shapes for enrolment and premium instructions are the same; only carrier interaction details differ.
3. **Given** AXA-style path may supply setup-sheet-like rate params, **When** Company B enrolment activates, **Then** cotisation amounts still appear as employerShare/employeeShare instructions consumable by Payroll stub.

---

### User Story 3 - Safe retries and double-submit (Priority: P1)

As a company admin, I need double-submit and retries to be safe so network blips do not create two members or two cotisations.

**Why this priority**: Reliability is a success criterion and demo gate.

**Independent Test**: Replay enrol with the same Idempotency-Key; replay a duplicate carrier confirmation; assert single enrolment and single member.

**Acceptance Scenarios**:

1. **Given** an enrol already succeeded with Idempotency-Key K, **When** the same admin resubmits enrol with K, **Then** the system returns the same enrolment identity and does not create a second carrier member.
2. **Given** a carrier confirmation was already processed under insurerEventId E, **When** the same confirmation arrives again, **Then** the system no-ops without changing enrolment or issuing duplicate premiums.
3. **Given** the carrier times out, **When** the admin checks status, **Then** status remains PendingExternal (honest Pending) and a retry path exists — never silent Active.

---

### User Story 4 - Terminate stops cover and cotisations (Priority: P1)

As a company admin, I want leavers to drop off cover automatically so we do not keep paying or withholding after EmployeeTerminated.

**Why this priority**: Leave-drift is a primary operational pain; required demo step.

**Independent Test**: Active enrolment → publish terminated for that employee → Ended + Stop instruction + Payroll stub lines removed; also Pending → terminate compensates carrier.

**Acceptance Scenarios**:

1. **Given** an Active enrolment, **When** EmployeeTerminated is received for that employee, **Then** enrolment becomes Ended, carrier membership is cancelled, and a premium Stop instruction is issued.
2. **Given** Payroll stub had Santé lines for that enrolment/period, **When** Stop is consumed, **Then** those lines are removed or marked stopped.
3. **Given** enrolment is still PendingExternal, **When** EmployeeTerminated arrives, **Then** local enrolment is cancelled and any in-flight carrier member is compensated/cancelled.

---

### User Story 5 - Record legal dispense (Priority: P2)

As a company admin, I record a dispense (legal exemption) instead of affiliation so we stay compliant when the employee must not join the collective contract.

**Why this priority**: Required FR ANI story; second after the happy affiliation path.

**Independent Test**: Dispense with valid reason code → Dispensed; no Active cover; no non-zero premium instruction; audit retained.

**Acceptance Scenarios**:

1. **Given** a valid dispense reason code from the seeded catalog, **When** admin records dispense for an employee, **Then** status is Dispensed and audit includes the reason.
2. **Given** a Dispensed employee, **When** premium generation runs for that employee, **Then** no Active cover exists and no non-zero premium instruction is issued.
3. **Given** an invalid reason code, **When** dispense is submitted, **Then** the system rejects the command without creating Dispensed status.

---

### User Story 6 - Honest enrolment status visibility (Priority: P2)

As a company admin, I want to see enrolment status (Pending / Active / Failed / Dispensed / Ended) so I am not lied to while the carrier is processing.

**Why this priority**: Trust and operability; pairs with P1 enrol.

**Independent Test**: After enrol, immediate read shows PendingExternal; after activation, Active with timeline/detail including member id and last premium instruction.

**Acceptance Scenarios**:

1. **Given** enrol just accepted, **When** admin fetches enrolment detail, **Then** status is PendingExternal.
2. **Given** carrier confirmed, **When** admin fetches detail, **Then** status is Active and detail includes insurer member reference and last premium instruction summary when issued.
3. **Given** carrier rejected affiliation, **When** admin fetches detail, **Then** status is Failed (not Active).

---

### User Story 7 - Employee my cover read-only (Priority: P3) _(stretch)_

As an employee, I want to see my cover read-only so I know I am affiliated.

**Why this priority**: Stretch in brief; optional for POC v1.

**Independent Test**: Authenticated as employee.self for own id; GET cover returns plan name, status, effective dates; no enrol/cancel capabilities.

**Acceptance Scenarios**:

1. **Given** employee has Active cover, **When** they request my cover, **Then** they see plan name, status, and effective dates only.
2. **Given** employee.self role, **When** they attempt enrol or cancel, **Then** the system denies the action.

---

### Edge Cases

- Double-click / duplicate Idempotency-Key enrol → same enrolment, no second member.
- Insurer timeout → stay PendingExternal with retry; UI/API remain honest.
- Duplicate carrier webhook / insurerEventId → inbox no-op.
- Terminate while PendingExternal → cancel local + compensate carrier member.
- Dispense instead of enrol → Dispensed; no Active; no non-zero premium; audit reason kept.
- Wrong company scope → 403; Company A admin cannot enrol or view Company B.
- Already Active / conflicting invariant → 409-style business conflict; no corrupt state.
- Employee already Dispensed → enrol/dispense conflicts handled without silent overwrite.
- Mid-period change / ChangeCoverage → out of POC v1 (documented assumption: full_month proration).
- EmployeeHired auto-enrol → out of POC v1; only Terminated inbound lifecycle is required.
- AXA-style setup-sheet rates present → still expressed as employer/employee shares to Payroll.
- Concurrent terminate and activate → end state must not leave Active cover for a terminated employee (idempotent handlers).

## Requirements *(mandatory)*

### Functional Requirements

**Tenancy, roles, and access**

- **FR-001**: System MUST serve multiple client companies isolated by `companyId`.
- **FR-002**: System MUST enforce `company.admin` scope to a single company; mismatched company context MUST be denied (403).
- **FR-003**: System MUST support roles: `company.admin`, `system.worker`, `system.payroll_consumer`; MAY support `employee.self` for stretch my-cover.
- **FR-004**: POC identity MAY be stubbed via explicit role/company/(employee) context; full SSO is out of scope.

**Enrolment lifecycle**

- **FR-005**: System MUST accept EnrolEmployee intent for a company, employee, plan, coverage, and effective date, requiring an Idempotency-Key.
- **FR-006**: On accept, system MUST create enrolment in PendingExternal and acknowledge asynchronously (accepted, not yet Active).
- **FR-007**: System MUST transition PendingExternal → Active only after successful carrier affiliation; MUST record external member reference.
- **FR-008**: System MUST support Failed when carrier rejects; MUST NOT silently mark Active on timeout.
- **FR-009**: System MUST support CancelEnrolment by company admin leading toward Ended with carrier cancel when applicable.
- **FR-010**: System MUST support DispenseEmployee with a validated reason code → Dispensed + audit; MUST NOT create Active cover or non-zero premium instructions.
- **FR-011**: Illegal lifecycle transitions MUST be rejected without corrupting state.

**Carriers as adapters**

- **FR-012**: System MUST route carrier operations through a single gateway abstraction selectable per company (`alan` | `axa` in POC).
- **FR-013**: System MUST provide two distinct carrier behaviors in POC (API-style affiliate vs OC-style affiliate with optional setup-sheet-like rate params) without splitting into two products.
- **FR-014**: Domain enrolment language MUST remain carrier-agnostic (no carrier-specific types in the core enrolment model).
- **FR-015**: System MUST support carrier confirmation path (sync stub activation and/or webhook confirmation) with idempotent processing of insurer event ids.

**Cotisations and Payroll boundary**

- **FR-016**: On Active affiliation, system MUST issue PremiumInstructionIssued including employerShare, employeeShare, currency, and period bounds.
- **FR-017**: Employer share of base contribution MUST be ≥ 50% (ANI shape), driven by plan configuration.
- **FR-018**: Payroll consumer MUST materialise two Santé lines (patronale + salariale) from premium instructions and MUST NOT write enrolment records.
- **FR-019**: Insurance MUST NOT write Payroll tables; only ids and money instructions cross the integration boundary.
- **FR-020**: On end of cover, system MUST issue premium Stop so Payroll consumer removes or stops lines.

**Platform events**

- **FR-021**: System MUST react to EmployeeTerminated (inbound) by ending cover, cancelling/compensating carrier membership, and stopping premiums (including Pending compensation).
- **FR-022**: EmployeeHired auto-enrol is OUT OF SCOPE for this feature; Terminated is required.
- **FR-023**: EmployeeUpdated handling beyond terminate is OUT OF SCOPE for v1 unless needed for identity stability (document if touched).

**Reliability**

- **FR-024**: Enrolment acceptance and outbound domain publication MUST be durably coupled (same unit of work / transactional outbox pattern) so events are not lost after commit.
- **FR-025**: Same Idempotency-Key MUST return the same enrolment outcome without duplicate carrier members or duplicate premiums.
- **FR-026**: Duplicate insurerEventId deliveries MUST no-op.
- **FR-027**: System SHOULD expose correlation identifiers and Pending age signals for operability (structured observability).

**Queries / experience**

- **FR-028**: Company admin MUST list enrolments/cover for their company and fetch enrolment detail including status timeline essentials (status, member ref, last premium summary).
- **FR-029**: Week-1 experience MAY be HTTP/script driven; polished admin UI is optional. If UI exists, it MUST support company home, enrol, dispense, and detail at minimum.
- **FR-030**: Stretch: employee.self MAY read own cover only.

**Catalog / seed data (POC)**

- **FR-031**: System MUST load seeded companies (A Alan-style, B AXA-style), employees, plan Santé Base with employerSharePct ≥ 50, dispense reason codes, and admin bindings for demos.
- **FR-032**: Proration for POC MUST be documented as full_month; no proration engine in v1.

**Explicit exclusions (MUST NOT)**

- **FR-033**: System MUST NOT implement claims, medical underwriting, quoting engine, or healthcare data vault.
- **FR-034**: System MUST NOT implement full DSN/URSSAF calculation or multi-carrier marketplace UI.
- **FR-035**: System MUST NOT become a second Employee master database.
- **FR-036**: System MUST NOT require real Alan/AXA production APIs for POC success (stubs suffice).
- **FR-037**: ChangeCoverage mid-life, reconcile cron, and multi-country are OUT OF SCOPE for this feature.

### Key Entities

- **Company**: PayFit client tenant; has `companyId`, carrier choice, Insurance enabled flag, associated plan.
- **Employee**: Person under a company (seeded reference); not mastered by Insurance; may be active/terminated.
- **Plan (Santé Base)**: Collective mutuelle product reference with premium and employerSharePct (≥ 50) / employee remainder.
- **Enrolment**: Aggregate lifecycle for one employee on a plan — statuses PendingExternal, Active, Failed, Dispensed, Ended; effective dating; insurer member reference; audit for dispense reason.
- **PremiumInstruction**: Employer/employee money shares for a period (Issued or Stop); consumed by Payroll, never a payslip engine.
- **CarrierMembership (external)**: External member id and optional rate params behind the gateway; not a domain entity type leak.
- **OutboxMessage / ProcessedEvent**: Reliability records for publish and inbound idempotency.
- **PayrollSantéLine**: Stub bulletin lines (patronale + salariale) per employee/period.
- **AdminBinding**: Role + company scope for stub identity.
- **DispenseReason**: Catalog code validating legal exemption recording.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a single demo session (≤ 7 minutes), reviewers can see Company A (Alan-style) enrol → Pending → Active → premium shares → Payroll stub Santé lines.
- **SC-002**: The same session shows Company B (AXA-style) enrol with different carrier interaction evidence but the same domain outcome shapes.
- **SC-003**: Replaying enrol with the same Idempotency-Key yields one enrolment identity and does not create a second carrier member (verified in demo).
- **SC-004**: Publishing EmployeeTerminated for an Active enrolment yields Ended cover, Stop instruction, and removal/stop of stub Santé lines.
- **SC-005**: Cross-company access attempt by Company A admin against Company B resources is denied in 100% of tested attempts.
- **SC-006**: Every issued premium instruction in the happy path has employer share ≥ 50% of base and a corresponding employee share.
- **SC-007**: PayFit engineer review checklist passes: (1) Insurance ≠ Payroll ≠ Employee boundaries, (2) multi-company tenancy real, (3) ANI-shaped cotisation path, (4) outbox/idempotency/Pending first-class, (5) real carrier would be adapter swap not rewrite.
- **SC-008**: Dispense path produces Dispensed with audit and zero non-zero premium instructions for that employee.
- **SC-009**: After enrol acceptance, observers never see Active before carrier success in the standard path (Pending honesty).

## Assumptions

- Source material is the entire `docs/base.md` (§1 Context through §14 One-pager). This spec translates that brief into Spec Kit feature form without dropping user stories US1–US7, edge paths, success criteria, or non-goals.
- **Traceability**: Problem/context → §1–3; solution & stories → §4; regulatory → §5; scale → §6; architecture/demo/build matrix → §7; stack hints for later plan → §8; demo script → §9; deliverables → §10; week plan → §11; success → §12; non-goals → §13; cheat sheet → §14. Constitution `v1.0.0` governs implementation.
- Dispense produces **no** premium instruction (not a zero-money instruction), matching the stricter reading of “no (or zero)”.
- Week-1 primary experience is **HTTP/script (curl/Bruno)**; React admin is optional stretch after the vertical path works.
- Carrier activation in POC may complete synchronously inside the stub worker; webhook endpoint remains specified for confirm/reject mapping and duplicate-delivery tests.
- Only **EmployeeTerminated** inbound platform lifecycle is required; Hired/Updated auto-enrol are out of scope.
- Proration assumption is **full_month**; documented in RFC/plan seed, not engineered.
- FR geography is **France only** for this feature.
- Identity is header/stub based for POC; real PayFit Identity later.
- Event bus may be in-process for POC; production-like SQS/K8s is documentation-only.
- “Money” shares are currency-labelled amounts suitable for bulletin lines; exact euro decimals come from plan seed.
- OpenAPI/route list, event catalog, short RFC, and Compose packaging are deliverables of the implementation phase guided by this spec + `docs/base.md` §10 — not separate features.
- Related doc `system-design-insurance-module.md` is referenced by the brief but not present yet; this spec + `docs/base.md` are authoritative until that file is added.

## Demo Acceptance Script *(from brief §7E / §9)*

The feature is demo-ready when this script can be executed end-to-end:

1. Show seed (2 companies, employees, plan).
2. Enrol Company A (Alan-style) → accepted Pending.
3. Show carrier interaction evidence for Alan-style.
4. Fetch enrolment → Active.
5. Show PremiumInstructionIssued with shares.
6. Show Payroll stub Santé lines.
7. Enrol Company B (AXA-style) → different carrier evidence, same outcome shape.
8. Replay enrol with same Idempotency-Key → same enrolment id.
9. Publish EmployeeTerminated fixture → Ended + Stop + lines removed.
