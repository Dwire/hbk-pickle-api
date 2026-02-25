# Sessions Feature

## Purpose

- Manage weekly sessions and registration windows.

## Core API

- List sessions for a date range.
- Admin create sessions and assign players to session slots.

## Key Files

- src/features/sessions/sessionService.ts: Session listing and creation.
- src/app/graphql/schema.ts: Session queries and admin mutations.
- src/shared/constants.ts: Registration window timing.

## Data Flow

- Session listing calculates registration open/close based on start time.
- Admin creates sessions tied to the default league.
