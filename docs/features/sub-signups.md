# Sub Signup Feature

## Purpose

- Allow players to offer as substitutes for weekly occurrences outside their assigned slot.

## Core API

- Signup as sub for a session occurrence.
- Cancel sub signup for an occurrence.

## Key Files

- src/features/subs/subSignupService.ts: Occurrence-based sub signup logic.
- src/app/graphql/schema.ts: Sub signup mutations (occurrence-scoped).

## Data Flow

- Upsert sub signup record per occurrence with ACTIVE or CANCELED.
