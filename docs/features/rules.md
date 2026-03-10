# Rules Feature

## Purpose

- Persist league rules for static display in the app.

## Core API

- List rules.
- Admin upsert rule by order.

## Key Files

- src/features/rules/ruleService.ts: Rule CRUD logic.
- src/app/graphql/schema.ts: Rules query and admin mutation.

## Data Flow

- Seed data creates default league rules for the demo league.
- Admin upserts rules with order per league.
