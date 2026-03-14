# Admin Management Feature

## Purpose

- Provide admin-only read/write APIs for leagues, session templates, session occurrences, slot assignments, players, rosters, and manual attendance/sub controls.

## Core API

- `adminLeagues` / `adminLeagueDetail` / `adminLeagueRules`
- `adminLeagueDetail` now resolves nested `rules` and filtered `sessions(input)` in one query path.
- `AdminSessionTemplate` detail now includes `assignmentCount`, `occurrenceCount`, `assignments`, and filtered `occurrences(input)`.
- `adminPlayers` / `adminOccurrenceRoster`
- `adminCreateLeague` / `adminUpdateLeague` / `adminDeleteLeague`
- `adminCreateSession` / `adminUpdateSession` / `adminDeleteSession`
- `adminCreateSessionOccurrence` / `adminCreateSessionOccurrences` / `adminUpdateSessionOccurrence` / `adminDeleteSessionOccurrence`
- `adminCreateSlotAssignment` / `adminCreateSlotAssignments` / `adminUpdateSlotAssignment` / `adminDeleteSlotAssignment`
- `adminCreatePlayer` / `adminUpdatePlayer`
- `adminSetRegistration` / `adminSetSubSignup`
- `adminUpsertLeagueRule` / `adminCopyLeagueRulesFromTemplate`
- All admin mutations require the authenticated user role to be `ADMIN`.
- All admin read queries above require the authenticated user role to be `ADMIN`.

## Key Files

- src/features/admin/adminManagementService.ts: Admin CRUD business logic and delete semantics.
- src/app/graphql/schema.ts: Admin GraphQL input/types and mutation resolvers.
- src/app/auth.ts: `requireAdmin` auth guard.
- src/shared/phone.ts: E.164 phone normalization used for auth and admin assignment.
- prisma/schema.prisma: League/session lifecycle enums and admin detail query indexes.

## Data Flow

- League lifecycle uses `LeagueStatus` (`DRAFT`, `UPCOMING`, `ACTIVE`, `ARCHIVED`) and enforces one `ACTIVE` league at a time.
- Session lifecycle uses `SessionStatus` (`ACTIVE`, `ARCHIVED`).
- Admin league and player list queries support pagination (`limit`/`offset`), with player filters for `search`, `role`, and `isOnApp`.
- `adminLeagueDetail` keeps the root contract stable while nested resolvers lazily load rules/sessions/assignments/occurrences.
- Admin session detail applies `AdminLeagueDetailInput` filters (`includeArchivedSessions`, `includeCanceledOccurrences`, `occurrenceStart`, `occurrenceEnd`, `maxOccurrencesPerSession`).
- Session detail occurrence rows expose `attendingCount` (`ATTENDING` registrations), `subCount` (`ACTIVE` + `SELECTED` sub signups), and `openSpots` (`max(capacity - attendingCount, 0)`).
- Session detail uses batched league-level loading to avoid N+1 and applies a DB window-function cap for `maxOccurrencesPerSession`.
- League delete hard-cascades dependent sessions, occurrences, assignments, registrations, sub signups, notifications, and rules.
- Session delete archives when historical participation exists; otherwise hard-deletes related empty data.
- Occurrence create/update validates that every occurrence stays within its parent league date bounds.
- Occurrence delete auto-cancels when participation exists; otherwise hard-deletes.
- Slot assignment accepts phone numbers, normalizes to E.164, and upserts placeholder users (`isOnApp = false`) when needed.
- Admin direct registration/sub status mutations upsert rows for explicit roster control.
