# Specification Quality Checklist: Mutuelle Enrolment → Cotisations on Bulletin

**Purpose**: Validate specification completeness and quality before proceeding to planning / implement  
**Created**: 2026-10-12  
**Updated**: 2026-10-12  
**Feature**: [spec.md](../spec.md)  
**Brief**: [`docs/base.md`](../../../docs/base.md)

## Content Quality

- [x] No *stack* implementation details as product scope (languages/frameworks live in plan)
- [x] Domain API from brief §4 is in scope (not a pure non-technical brief)
- [x] Focused on user value and business needs
- [x] All mandatory Spec Kit sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria avoid stack choices (Fastify/Nest deferred to plan)
- [x] All acceptance scenarios are defined (incl. Failed@3 on reliability story)
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Brief alignment (`docs/base.md`)

- [x] Brief US1–US7 covered (Cancel = Domain API footnote)
- [x] §4 failure/edge table covered (timeout/retry/Failed@3, idempotency, webhook, terminate-Pending, dispense, 403)
- [x] Dual carriers Alan + AXA behind one gateway (§4)
- [x] ANI employer ≥ 50% + payroll stub boundary (§5)
- [x] Demo gate cites §7E / §9; webhook duplicate = SC-003b test pack
- [x] §13 non-goals reflected as FR MUST NOT / Assumptions
- [x] Seed/mock matrix §7B–C respected (HTTP-first, Terminated-only, sync stub + webhook tests)
- [x] Normative event shapes → `contracts/events.md` (base §4 + locked deltas)
- [x] Locked demo seed ids match quickstart (`company-a`/`b`, `emp-a1`/`b1`, `sante-base`)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] Stack/layout details live in plan/tasks
- [x] OpenAPI audit/payroll schemas match data-model field names
- [x] Cancel + terminate both emit `EnrolmentCancelled` (Stop if Issued)

## Notes

- 2026-10-12: Checklist re-validated after perfection pass (events deltas, audit schema, seed ids, SC-003/003b, FR-021).
