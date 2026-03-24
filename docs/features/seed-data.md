# Seed Data

## Purpose

- Provide deterministic seed data for two organizations, protected owners, Demo Org leagues, and seeded player activity.

## Core API

- Seed script keeps two canonical organizations (`hbk-pickle`, `demo-org`), migrates/removes legacy `hbk-rec-league`, and upserts two protected users.
- Seed performs targeted cleanup by deleting Demo Org leagues and deleting users in the seeded phone range (`+15550000001`..`+15550000099`) with their related records.
- Seed creates Demo Org leagues only (two archived + one active) with fixed durations of 8, 10, and 12 weeks using UTC instants derived from Eastern rules.
- League rules, sessions, occurrences, slot assignments, and league memberships are re-created for Demo Org on each run.
- Session templates include exactly three sessions per configured weekday.

## Key Files

- src/scripts/seed.ts: Seed script for org canonicalization, targeted cleanup, protected-user ownership, and Demo Org reseeding.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed ensures both protected users are present and grants each `OWNER` membership in both organizations.
- Seed deletes all Demo Org league graph records in dependency-safe order before recreating Demo Org leagues.
- Seed deletes seeded users by phone-pattern match and removes related notifications, registrations, sub signups, assignments, memberships, and devices.
- Seed generates deterministic real-name seeded users in the allowed phone range and marks them `isOnApp = true`.
- Slot assignments are created per session and mirrored into `LeagueMembership(status=ACTIVE)`.
- Protected users are included in Demo Org assignment pools.
