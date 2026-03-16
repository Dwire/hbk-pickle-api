# User Organizations Feature

## Purpose

- Return all organizations the authenticated user belongs to for org switching in admin and client surfaces.

## Core API

- Query `organizations` returns `[Organization!]!` with `id`, `name`, and `slug`.

## Key Files

- src/features/users/userService.ts: Loads organization memberships for the caller and maps organization summaries.
- src/app/graphql/schema.ts: Declares `Organization` and wires `Query.organizations` to the user service.

## Data Flow

- Resolver requires auth via JWT (`requireAuth`) and resolves the caller `userId`.
- Service reads `OrganizationMembership` rows for `userId`, joins `Organization`, orders by organization name ascending, and returns organization summaries.
