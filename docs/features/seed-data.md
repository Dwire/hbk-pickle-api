# Seed Data

## Purpose

- Provide deterministic local seed data for leagues, rules, users, sessions, occurrences, and assignments.

## Core API

- Seed script clears existing data, preserves a protected user, and creates a two-week league for the current and following week using UTC instants derived from Eastern rules.
- League rules, sessions, occurrences, and slot assignments are re-created on each run.
- Session templates include exactly three Thursday sessions (Early, Late, Night) on every seed run.

## Key Files

- src/scripts/seed.ts: Seed script that creates the league, rules, users, sessions, occurrences, and slot assignments.
- justfile: `seed` command for running the seed script.

## Data Flow

- Seed wipes all records, excluding the protected user ID, and recreates leagues/rules/sessions/occurrences/assignments.
- Occurrences target the current Eastern week (Monday start) plus the following week and are stored as UTC instants.
- Seed validates that the current-week Thursday (Eastern) has three generated occurrences, which aligns with 03/12 for the current seed window.
- The protected user is always assigned to a session.
