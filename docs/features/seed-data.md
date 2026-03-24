# Seed Data

## Purpose

- Provide deterministic seed data by wiping all app tables, recreating canonical organizations, and rebuilding Demo Org league activity from scratch.

## Core API

- Seed script performs a full app-data wipe (`TRUNCATE ... CASCADE`) before creating fresh seed data.
- Seed aborts destructive wipe when `NODE_ENV` is `production` or `staging`.
- Seed script recreates two canonical organizations (`hbk-pickle`, `demo-org`) and upserts four named users.
- Seed creates Demo Org leagues (two archived + one active) with fixed durations of 8, 10, and 12 weeks using UTC instants derived from Eastern rules.
- Seed also creates one active HBK demo league with the same weekly session templates and occurrence schedule as the active Demo Org league, but without users.
- League rules, sessions, occurrences, slot assignments, and league memberships are re-created for Demo Org on each run.
- Session templates include exactly three sessions per configured weekday.

## Key Files

- src/scripts/seed.ts: Seed script for destructive wipe guardrails, canonical org/user creation, ownership assignment, and Demo Org reseeding.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed wipes all app tables before any create/upsert actions.
- Seed upserts named users:
  - `Kyle Venn` (`+18607121554`)
  - `Assaf Packin` (`+19176816829`)
  - `Gregory Dwyer` (`+14017931073`)
  - `Elma Crabbe` (`+12019068870`)
- Seed assigns ownership:
  - Kyle + Assaf: `OWNER` in Demo Org only.
  - Gregory + Elma: `OWNER` in both organizations.
- Seed generates deterministic real-name seeded users in the allowed phone range and marks them `isOnApp = true`.
- Slot assignments are created per session and mirrored into `LeagueMembership(status=ACTIVE)`.
- Named users are included in the Demo Org assignment pools across all seeded Demo leagues.
- HBK demo league is scaffolded with rules, sessions, and occurrences only (no assignments, league memberships, registrations, or sub signups).
