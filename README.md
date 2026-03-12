# HBK Pickle API

Backend service for the HBK Pickle check-in app. Provides GraphQL APIs for session occurrence registration, sub signups, admin league management, and notifications.

## Architecture Summary

- Node.js + TypeScript, GraphQL-first API
- PostgreSQL via Prisma for core data
- Redis for caching and BullMQ for background jobs
- Twilio Verify for phone-based authentication
- Firebase Cloud Messaging for push notifications
- Frontend polling (no websockets initially)

## Features Summary

- Phone signup/login and profile basics
- Auth requests log Twilio Verify send/check outcomes for debugging
- Auth context derives user identity from bearer JWTs for resolvers
- Authenticated users can update their display name via GraphQL
- Weekly (Eastern) session occurrences listing with assignment-aware registration rules, assignment-agnostic sub signup rules, and user status summaries derived from UTC instants
- Profile stats query for current-league participation, sub signup counts, and attendance/missed summaries
- Session display state (PAST/LIVE/UPCOMING) derived server-side using Eastern wall-clock projections of UTC instants; live window opens 10am ET day before
- Registration windows open 10am ET day before and close at 7pm ET day before; sub signups remain open until the session ends (Eastern rules applied to UTC instants)
- sessionsWeek sub signup status returns only ACTIVE sub signups for the current user
- sessionsWeek subCount reflects ACTIVE sub signups only (canceled/selected/replaced excluded)
- sessionsWeek attendingCount reflects ATTENDING registrations only (canceled/declined excluded)
- sessionsWeek returns `registeredUsers` and `subUsers` participant objects (`id`, `displayName`, `profileImageUrl`) for ATTENDING registrations and non-CANCELED sub signups
- Admin portal APIs for league/session management
- Rules page content management
- Notification scheduling and delivery
- Local seed data generation for leagues, rules, users, sessions, occurrences, and assignments (preserves protected user; includes 3 Thursday sessions and validates current-week Thursday occurrences)

## Folder Structure

- src/app: HTTP server bootstrap and middleware
- src/features: Feature modules (auth, users, sessions, registrations, subs, rules, notifications)
- src/integrations: Twilio, Firebase, Redis, BullMQ clients
- src/jobs: Schedulers and workers
- src/shared: Logger, config, utils, constants
- prisma: Schema and migrations
- docs/features: Feature documentation

## Key Files

- README.md: Project overview (this file)
- justfile: Developer commands
- prisma/schema.prisma: Database schema (recurring sessions + occurrences)
- src/app/server.ts: App entry
- src/app/graphql/schema.ts: GraphQL schema
- src/shared/config.ts: Typed environment config
- src/shared/logger.ts: Pino logger wrapper
- src/scripts/seed.ts: Seed script for local demo data

## Documentation

- docs/features: One doc per feature module with responsibilities and data flow (see utc-time.md for UTC contract)

## Local Development (Postman)

- Install toolchain versions via mise and ensure it is activated so pnpm is on PATH.
- Ensure Postgres and Redis are running.
- Create the local database.
- Sync schema without migrations (no shadow DB permissions).
- Start the API.

### Postman GraphQL Endpoint

- URL: http://localhost:4000/graphql
- Method: POST
- Body: GraphQL

Mutations (auth requires Twilio in production; stubbed locally).
