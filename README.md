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
- Scheduler ticks enqueue Bull sub-selection jobs from registration close through occurrence end; sub-selection worker recomputes selection and sends push notifications only for selection state changes
- Scheduler ticks skip enqueueing duplicate in-flight sub-selection job ids so repeated ticks remain stable
- sessionsWeek sub signup status returns only ACTIVE sub signups for the current user
- sessionsWeek subCount reflects ACTIVE sub signups only (canceled/selected/replaced excluded)
- Sub ordering uses signup queue time (`signedUpAt`); cancel + re-sub places the user at the end of the sub list
- sessionsWeek attendingCount reflects ATTENDING registrations only (canceled/declined excluded)
- sessionsWeek returns `registeredUsers` and `subUsers` participant objects (`id`, `displayName`, `profileImageUrl`) for ATTENDING registrations and non-CANCELED sub signups
- Admin portal APIs for league/session management
- Rules page content management
- Notification scheduling and delivery
- Debuggable backend runtime via `just run-debug` / `just run-debug-brk` (Node inspector + auto-reload)
- Combined job monitor via `just jobs-watch` (both workers + repeating scheduler tick in one terminal)
- Local seed data generation for three 3-week leagues (2 past inactive + 1 current active), 3 sessions per day on Monday/Wednesday/Thursday/Friday, 5-slot assignments per session, and randomized historical registrations/sub signups (preserves protected user)

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
- justfile: Developer commands (install, run, debug, build, workers)
- prisma/schema.prisma: Database schema (recurring sessions + occurrences)
- src/app/server.ts: App entry
- src/app/graphql/schema.ts: GraphQL schema
- src/shared/config.ts: Typed environment config
- src/shared/logger.ts: Pino logger wrapper
- src/scripts/seed.ts: Seed script for local demo data
- src/jobs/subSelectionWorker.ts: Bull worker for selection recalculation and sub selection notifications

## Documentation

- docs/features: One doc per feature module with responsibilities and data flow (see utc-time.md for UTC contract, dev-debugging.md for local debugger workflow, and jobs-watch.md for local worker+ticker orchestration)

## Local Development (Postman)

- Install toolchain versions via mise and ensure it is activated so pnpm is on PATH.
- Ensure Postgres and Redis are running.
- Create the local database.
- Sync schema without migrations (no shadow DB permissions).
- Start the API.

### Local Debugging

- `just run-debug`: Starts the API with auto-reload and Node inspector on `127.0.0.1:9229`.
- `just run-debug 9230 4001`: Starts a second debug instance on inspector `9230` and app port `4001`.
- `just run-debug-brk`: Starts in inspector break mode and pauses immediately so your IDE can attach before app code runs.
- VS Code attach profiles are in `.vscode/launch.json` (`Attach API (just run-debug)` and `Attach API (custom port)`).
- Running two debug processes at once requires different inspector and app ports per process.

### Postman GraphQL Endpoint

- URL: http://localhost:4000/graphql
- Method: POST
- Body: GraphQL

Mutations (auth requires Twilio in production; stubbed locally).

### Local Jobs Monitoring

- `just jobs-watch`: Starts notification worker, sub-selection worker, and reruns `scheduler-tick` every 30 seconds in a single terminal.
- `just jobs-watch 10`: Same flow but ticks every 10 seconds.
- `jobs-watch` exits as soon as any worker/ticker child process exits, returns that child status, and stops the remaining child processes.
- On Ctrl+C/TERM, `jobs-watch` performs a safe cleanup of child processes without unbound-variable failures.
- `jobs-watch` reuses existing `just` commands so it runs through the same `mise` toolchain and dotenv setup as other recipes.
- Use `just typecheck` separately when you want a full static type pass.
