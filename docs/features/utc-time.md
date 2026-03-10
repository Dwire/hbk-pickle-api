# UTC Time Handling

## Purpose

- Ensure all API inputs/outputs are UTC-only while keeping Eastern business rules.

## Core Rules

- GraphQL DateTime inputs must be ISO-8601 with `Z` or `+00:00` and are parsed as UTC instants.
- GraphQL DateTime outputs are serialized as UTC ISO strings.
- Stored timestamps represent true UTC instants.
- Eastern business rules (registration windows, week ranges, display state) are derived from UTC instants via shared utilities.

## Key Files

- src/shared/time.ts: UTC/Eastern conversions and range helpers.
- src/app/graphql/schema.ts: UTC-only DateTime scalar validation.
- src/features/sessions/sessionService.ts: Business-rule application using UTC instants.
- src/jobs/schedulers/registrationScheduler.ts: Notification timing derived from UTC instants.
- src/scripts/seed.ts: Seeded timestamps created as true UTC instants.
