# User Organizations Feature

## Purpose

- Return organization lists for two user contexts:
  - Organization membership (`organizations`) for org switching and admin-aware surfaces.
  - Player eligibility (`playerOrganizations`) derived from league memberships for player onboarding/gating flows.

## Core API

- Query `organizations` returns `[Organization!]!` with `id`, `name`, and `slug`.
- Query `playerOrganizations` returns `[Organization!]!` with `id`, `name`, and `slug`.
- `AuthPayload.eligibleOrganizations` (from `verifyPhoneCode`) returns the same list and ordering as `playerOrganizations`.
- `playerOrganizations` includes organizations where the caller has `LeagueMembership.status=ACTIVE` on leagues with status `ACTIVE`, `UPCOMING`, or `ARCHIVED`.

## Key Files

- src/features/users/userService.ts: Loads organization summaries from organization memberships and league-based eligibility.
- src/app/graphql/schema.ts: Declares `Organization` and wires `Query.organizations` and `Query.playerOrganizations`.

## Data Flow

- Resolver requires auth via JWT (`requireAuth`) and resolves the caller `userId`.
- `organizations`: service reads `OrganizationMembership` rows for `userId`, joins `Organization`, orders by organization name ascending, and returns organization summaries.
- `playerOrganizations`: service reads organizations via leagues where caller has `LeagueMembership.status=ACTIVE` and league status in `ACTIVE|UPCOMING|ARCHIVED`; results are naturally deduped by organization and ordered by organization name ascending.
- `verifyPhoneCode` uses the same `listPlayerOrganizations` service call to populate `eligibleOrganizations`, ensuring exact eligibility and ordering parity.
