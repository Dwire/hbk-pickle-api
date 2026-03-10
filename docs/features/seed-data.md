# Seed Data

## Purpose

- Provide deterministic local seed data for leagues, users, sessions, occurrences, and assignments.

## Core API

- Seed script clears existing data, preserves a protected user, and creates a two-week league for the current and following week using UTC instants derived from Eastern rules.
- Sessions, occurrences, and slot assignments are re-created on each run.

## Key Files

- src/scripts/seed.ts: Seed script that creates the league, users, sessions, occurrences, and slot assignments.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed wipes all records, excluding the protected user ID, and recreates leagues/sessions/occurrences/assignments.
- Occurrences target the current Eastern week (Monday start) plus the following week and are stored as UTC instants.
- The protected user is always assigned to a session.
