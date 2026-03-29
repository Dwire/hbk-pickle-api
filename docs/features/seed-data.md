# Seed Data

## Purpose

- Provide deterministic seed data by wiping all app tables, recreating canonical organizations, and rebuilding Demo Org league activity from scratch.

## Core API

- Seed script performs a full app-data wipe (`TRUNCATE ... CASCADE`) before creating fresh seed data.
- Seed aborts destructive wipe when `NODE_ENV` is `production` or `staging`.
- Production/staging wipe can be intentionally overridden only when both `SEED_ALLOW_PROD_WIPE=true` and `SEED_WIPE_CONFIRM=WIPE_PRODUCTION_DB` are provided.
- Seed script recreates two canonical organizations (`hbk-pickle`, `demo-org`) and upserts `Demo User`.
- Optional private owner users can be supplied via `SEED_PRIVATE_USERS_JSON` with shape `[{ phoneNumber, displayName, ownerOrganizationSlugs }]`.
- If `SEED_PRIVATE_USERS_JSON` is missing/blank (or `[]`), seed continues and logs a warning that owner users were skipped.
- Seed creates Demo Org leagues (two archived + one active) with fixed durations of 8, 10, and 12 weeks using UTC instants derived from Eastern rules.
- Seed also creates one active HBK demo league with the same weekly session templates and occurrence schedule as the active Demo Org league, but without users.
- League rules, sessions, occurrences, slot assignments, and league memberships are re-created for Demo Org on each run.
- Session templates include exactly three sessions per configured weekday.

## Key Files

- src/scripts/seed.ts: Seed script for destructive wipe guardrails, canonical org/user creation, ownership assignment, and Demo Org reseeding.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed wipes all app tables before any create/upsert actions.
- Seed upserts optional private owner users from `SEED_PRIVATE_USERS_JSON`.
- Seed assigns ownership from each owner user’s `ownerOrganizationSlugs`.
- Seeded owner users are deterministically assigned to Thursday/Friday session slots in seeded Demo Org leagues.
- Seed generates deterministic real-name seeded users in the allowed phone range and marks them `isOnApp = true`.
- Slot assignments are created per session and mirrored into `LeagueMembership(status=ACTIVE)`.
- Owner users are included in the Demo Org assignment pools across all seeded Demo leagues.
- `Demo User` (`+15555556789`) is seeded as a player by replacing one non-owner Thursday/Friday slot assignment in the active Demo Org league and adding `LeagueMembership(status=ACTIVE)`, with no `OrganizationMembership` owner/admin role.
- HBK demo league is scaffolded with rules, sessions, and occurrences only (no assignments, league memberships, registrations, or sub signups).
