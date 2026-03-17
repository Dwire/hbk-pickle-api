# Admin Management Feature

## Purpose

- Provide organization-scoped admin read/write APIs for leagues, session templates, session occurrences, slot assignments, players, memberships, rosters, and manual attendance/sub controls.

## Core API

- `adminLeagues(organizationId, ...)`, `adminLeagueDetail(leagueId)`, `adminLeagueRules(leagueId)`
- `adminPlayers(organizationId, ...)`, `adminOccurrenceRoster(occurrenceId)`
- `adminCreateLeague` / `adminUpdateLeague` / `adminDeleteLeague`
- `adminCreateSession` / `adminUpdateSession` / `adminDeleteSession`
- `adminCreateSessionOccurrence` / `adminCreateSessionOccurrences` / `adminUpdateSessionOccurrence` / `adminDeleteSessionOccurrence`
- `adminCreateSlotAssignment` / `adminCreateSlotAssignments` / `adminUpdateSlotAssignment` / `adminDeleteSlotAssignment`
- `adminCreatePlayer` / `adminUpdatePlayer`
- `adminSetLeagueMembership`
- `adminSetRegistration` / `adminSetSubSignup`
- `adminUpsertLeagueRule` / `adminCopyLeagueRulesFromTemplate`

## Key Files

- src/features/admin/adminManagementService.ts: Admin CRUD business logic, membership upserts, and delete semantics.
- src/app/graphql/schema.ts: Admin GraphQL input/types and resolver-level org/league auth checks.
- src/app/auth.ts: Org/league scoped auth guards.
- src/shared/phone.ts: E.164 phone normalization used for auth and admin assignment.
- prisma/schema.prisma: Organization + league membership data model.

## Data Flow

- Admin permissions are derived from `OrganizationMembership.role` (`OWNER`/`ADMIN`), not `User.role`.
- League lifecycle enforces one `ACTIVE` league per organization (DB partial unique index + service archive behavior).
- Admin league and player list queries are organization-scoped and support pagination (`limit`/`offset`) with `search` and `isOnApp` filters.
- Admin session detail applies `AdminLeagueDetailInput` filters (`includeArchivedSessions`, `includeCanceledOccurrences`, `occurrenceStart`, `occurrenceEnd`, `maxOccurrencesPerSession`).
- Session detail occurrence rows expose `attendingCount` (`ATTENDING` registrations), `subCount` (`ACTIVE` + `SELECTED` sub signups), and `openSpots` (`max(capacity - attendingCount, 0)`).
- Slot assignment accepts phone numbers, normalizes to E.164, upserts users, and auto-upserts `LeagueMembership` to `ACTIVE`.
- `adminCreatePlayer` is league-scoped (`leagueId` required), upserts/creates the user by phone, and upserts `LeagueMembership` to `ACTIVE` in the same transaction.
- `adminUpdatePlayer` can update org-scoped role intent via `input.role`:
  - `ADMIN`: upsert `OrganizationMembership` with role `ADMIN`
  - `PLAYER`: remove non-owner org membership
  - `OWNER`: rejected for assignment, and existing owners cannot be changed via this mutation
- `adminSetLeagueMembership` toggles `LeagueMembership.status` (`ACTIVE`/`REMOVED`) for manual eligibility control.
- `adminSetRegistration` and `adminSetSubSignup` require `LeagueMembership.status = ACTIVE` for the occurrence's league.
- League delete hard-cascades dependent sessions, occurrences, assignments, memberships, registrations, sub signups, notifications, and rules.
