# Seed Data

## Purpose

- Provide deterministic local seed data for organizations, leagues, rules, users, sessions, occurrences, assignments, and memberships.

## Core API

- Seed script clears existing data, preserves a protected user, and creates one default organization plus three leagues (two archived + one active) with UTC instants derived from Eastern rules.
- League rules, sessions, occurrences, slot assignments, and league memberships are re-created on each run.
- Session templates include exactly three sessions per configured weekday.

## Key Files

- src/scripts/seed.ts: Seed script that creates organization/league data and participation history.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed wipes records in dependency-safe order, excluding the protected user ID.
- Seed creates/upserts the default organization and grants the protected user `OWNER` membership for that organization.
- Seed marks generated users as `isOnApp = true` while preserving placeholder-user behavior for admin phone assignments.
- Occurrences are generated for each league's seeded date range and stored as UTC instants.
- Slot assignments are created per session and mirrored into `LeagueMembership(status=ACTIVE)`.
- The protected user is always assigned to a session.
