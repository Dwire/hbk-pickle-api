# Seed Data

## Purpose

- Provide deterministic local seed data for leagues, rules, users, sessions, occurrences, and assignments.

## Core API

- Seed script clears existing data, preserves a protected user, and creates three leagues (two archived + one active) with UTC instants derived from Eastern rules.
- League rules, sessions, occurrences, and slot assignments are re-created on each run.
- Session templates include exactly three sessions per configured weekday.

## Key Files

- src/scripts/seed.ts: Seed script that creates the league, rules, users, sessions, occurrences, and slot assignments.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed wipes all records, excluding the protected user ID, and recreates leagues/rules/sessions/occurrences/assignments.
- Seed marks generated users as `isOnApp = true` while preserving placeholder-user behavior for admin phone assignments.
- Occurrences are generated for each league's seeded date range and stored as UTC instants.
- The protected user is always assigned to a session.
