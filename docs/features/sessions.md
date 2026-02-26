# Sessions Feature

## Purpose

- Manage recurring session templates and weekly occurrences.

## Core API

- List session occurrences for a date range (with registration window details).
- Admin create session templates and weekly occurrences.
- Admin assign players to recurring session slots.

## Key Files

- src/features/sessions/sessionService.ts: Session templates, occurrence listing, and occurrence creation.
- src/app/graphql/schema.ts: Session queries and admin mutations (templates + occurrences).
- src/shared/constants.ts: Registration window timing.

## Data Flow

- Occurrences are the dated instances used for registration and sub availability.
- Registration windows are derived from occurrence start time.
- Session templates are tied to the default league and referenced by assignments.
