# Sub Signup Feature

## Purpose

- Allow players to offer as substitutes for sessions outside their assigned slot.

## Core API

- Signup as sub for a session.
- Cancel sub signup.

## Key Files

- src/features/subs/subSignupService.ts: Sub signup logic.
- src/app/graphql/schema.ts: Sub signup mutations.

## Data Flow

- Upsert sub signup record with ACTIVE or CANCELED.
