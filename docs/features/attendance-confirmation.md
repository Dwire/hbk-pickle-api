# Attendance Confirmation

## Purpose

- Track in-person attendance confirmation by admins per `occurrenceId + userId`.
- Keep attendance confirmation independent from registration and sub signup status lifecycles.

## Core API

- `adminOccurrenceRoster(occurrenceId)` now returns:
  - `attendanceConfirmations`
  - `confirmedCount`
  - `unconfirmedCount`
- `adminSetAttendanceConfirmation(occurrenceId, userId, isConfirmed)`
- `adminSetAttendanceConfirmations(occurrenceId, inputs)`

## Key Files

- prisma/schema.prisma: `OccurrenceAttendanceConfirmation` model and relations.
- prisma/migrations/202603310001_occurrence_attendance_confirmation/migration.sql: SQL migration for attendance confirmation table/indexes/FKs.
- src/features/admin/adminManagementService.ts: Roster confirmation shaping and single/bulk confirmation writes.
- src/app/graphql/schema.ts: GraphQL types, inputs, and admin mutations.

## Data Flow

- Canonical storage uses one row per `(occurrenceId, userId)` confirmation pair.
- Confirm action upserts row with `confirmedAt` and `confirmedByUserId`.
- Unconfirm action deletes row (idempotent); missing row means unconfirmed.
- Bulk mutation dedupes duplicate user inputs with last-write-wins behavior.
- Target users must already be in occurrence roster (`SessionRegistration` or `SubSignup`, any status).
