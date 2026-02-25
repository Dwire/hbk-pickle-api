# HBK Pickle API

Backend service for the HBK Pickle check-in app. Provides GraphQL APIs for session registration, sub signups, admin league management, and notifications.

## Architecture Summary

- Node.js + TypeScript, GraphQL-first API
- PostgreSQL via Prisma for core data
- Redis for caching and BullMQ for background jobs
- Twilio Verify for phone-based authentication
- Firebase Cloud Messaging for push notifications
- Frontend polling (no websockets initially)

## Features Summary

- Phone signup/login and profile basics
- Weekly sessions listing with registration and sub signup rules
- Registration windows and automatic sub cutoffs
- Admin portal APIs for league/session management
- Rules page content management
- Notification scheduling and delivery

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
- prisma/schema.prisma: Database schema
- src/app/server.ts: App entry
- src/app/graphql/schema.ts: GraphQL schema
- src/shared/config.ts: Typed environment config
- src/shared/logger.ts: Pino logger wrapper

## Documentation

- docs/features: One doc per feature module with responsibilities and data flow
