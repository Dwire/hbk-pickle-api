# Rules Feature

## Purpose

- Persist league rules for static display in the app, scoped by league context.

## Core API

- List rules for the authenticated user's current league (`ACTIVE` assignment first, latest assignment fallback) or the `ACTIVE` league when unauthenticated/unassigned.
- Admin upsert rule by order.
- Admin upsert rule by `leagueId` + optional `ruleId` + `order`.
- Admin template copy from one league to another, optionally replacing existing target rules.

## Key Files

- src/features/rules/ruleService.ts: Rule CRUD logic.
- src/app/graphql/schema.ts: Rules query and admin mutation.

## Data Flow

- Seed data creates default league rules for the demo league.
- Rules query resolves a target league before listing rules.
- Admin upserts rules with order per league.
- Admin template copy reads source rules by order and writes/upserts onto the target league.
