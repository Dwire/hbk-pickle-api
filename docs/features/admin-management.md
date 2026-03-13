# Admin Management Feature

## Purpose

- Provide admin-only CRUD mutations for leagues, session templates, session occurrences, and slot assignments.

## Core API

- `adminCreateLeague` / `adminUpdateLeague` / `adminDeleteLeague`
- `adminCreateSession` / `adminUpdateSession` / `adminDeleteSession`
- `adminCreateSessionOccurrence` / `adminCreateSessionOccurrences` / `adminUpdateSessionOccurrence` / `adminDeleteSessionOccurrence`
- `adminCreateSlotAssignment` / `adminCreateSlotAssignments` / `adminUpdateSlotAssignment` / `adminDeleteSlotAssignment`
- All admin mutations require the authenticated user role to be `ADMIN`.

## Key Files

- src/features/admin/adminManagementService.ts: Admin CRUD business logic and delete semantics.
- src/app/graphql/schema.ts: Admin GraphQL input/types and mutation resolvers.
- src/app/auth.ts: `requireAdmin` auth guard.
- src/shared/phone.ts: E.164 phone normalization used for auth and admin assignment.
- prisma/schema.prisma: League/session lifecycle enums and placeholder-user tracking field.

## Data Flow

- League lifecycle uses `LeagueStatus` (`DRAFT`, `UPCOMING`, `ACTIVE`, `ARCHIVED`) and enforces one `ACTIVE` league at a time.
- Session lifecycle uses `SessionStatus` (`ACTIVE`, `ARCHIVED`).
- League delete hard-cascades dependent sessions, occurrences, assignments, registrations, sub signups, notifications, and rules.
- Session delete archives when historical participation exists; otherwise hard-deletes related empty data.
- Occurrence delete auto-cancels when participation exists; otherwise hard-deletes.
- Slot assignment accepts phone numbers, normalizes to E.164, and upserts placeholder users (`isOnApp = false`) when needed.
