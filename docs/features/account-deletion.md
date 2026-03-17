# Account Deletion Feature

## Purpose

- Provide a self-serve authenticated account deletion flow that hard-deletes a user and their directly associated data.
- Protect organization administration by blocking deletion when the caller is the sole `OWNER`/`ADMIN` for an organization.

## Core API

- `deleteMyAccount: Boolean!`

## Key Files

- src/features/users/userService.ts: Owner/admin preflight guard, FK-safe transactional deletion order, and post-delete sub-selection requeueing.
- src/app/graphql/schema.ts: Mutation declaration and authenticated resolver wiring.
- src/integrations/bull/queue.ts: Sub-selection queue used for post-delete recalculation jobs.

## Data Flow

- Resolver requires auth and delegates to `UserService.deleteMyAccount`.
- Service verifies caller exists before deletion.
- Service preflights org-admin safety by checking all orgs where caller is `OWNER`/`ADMIN`, and aborts if any would lose their last admin-capable membership.
- Service gathers affected occurrence ids from caller registrations and sub signups.
- Service deletes in one transaction using explicit `ON DELETE RESTRICT`-safe order: notifications, devices, registrations, sub signups, slot assignments, league memberships, organization memberships, then user.
- After commit, service queues `sub-selection-{occurrenceId}` jobs for affected active, not-ended occurrences, skipping jobs that already exist.
