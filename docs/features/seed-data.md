# Seed Data

## Purpose

- Provide deterministic local seed data for leagues, users, sessions, occurrences, and assignments.

## Core API

- Seed script creates a two-week league, 30 users, recurring session templates, occurrences, and slot assignments.

## Key Files

- src/scripts/seed.ts: Seed script that creates the league, users, sessions, occurrences, and slot assignments.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed resets any prior seed league/users by identifier, then inserts a fresh league.
- Sessions are created for three weekdays with two templates per day.
- Occurrences are created for two weeks, and assignments stay consistent across weeks.
