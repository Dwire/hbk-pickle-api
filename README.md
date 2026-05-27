# HBK Pickle API

Backend service for the HBK Pickle check-in app. Provides GraphQL APIs for session occurrence registration, sub signups, admin league management, and notifications.

## Architecture Summary

- Node.js + TypeScript, GraphQL-first API
- PostgreSQL via Prisma for core data
- Redis for caching and BullMQ for background jobs
- Cloudflare Images for profile photo uploads and CDN delivery
- Twilio Verify for phone-based authentication
- Firebase Cloud Messaging for push notifications
- Frontend polling (no websockets initially)

## Features Summary

- Phone signup/login and profile basics with E.164 normalization
- Auth requests log Twilio Verify send/check outcomes for debugging
- Optional App Review OTP bypass supports one env-whitelisted E.164 phone + static code, gated by explicit enable flag
- Auth context derives user identity from bearer JWTs for resolvers
- Production startup validation rejects weak/short JWT secrets and blocks placeholders like `dev-secret`
- Authenticated users can update their display name via GraphQL
- Authenticated users can upload/replace/delete profile photos via Cloudflare direct-upload intents and completion mutations
- Profile photo direct-upload intents call Cloudflare with multipart form payloads (required media type for `/images/v2/direct_upload`)
- Profile photo direct-upload intents assign Cloudflare image ids in the `hobo-player-profile-<unique>` format
- Org admin/owner users can remove player profile photos with org-scoped authorization
- Authenticated users can permanently delete their account with FK-safe transactional cleanup and sole org owner/admin safeguards
- Organization tenancy with per-org league lifecycle (`League.organizationId`)
- Organization-scoped admin roles via `OrganizationMembership.role` (`OWNER`, `ADMIN`)
- Authenticated `organizations` query lists the organizations where the caller has membership
- Authenticated `playerOrganizations` query lists organizations where the caller has ACTIVE league membership on ACTIVE, UPCOMING, or ARCHIVED leagues
- `verifyPhoneCode` returns `AuthPayload.eligibleOrganizations` using the same eligibility logic and ordering as `playerOrganizations`
- Authenticated `completeOnboarding` mutation sets `isOnApp = true` idempotently when onboarding is finished
- League participation membership via `LeagueMembership.status` (`ACTIVE`, `REMOVED`)
- Resolver-level org/league auth guards with request-scoped league/org resolution memoization
- GraphQL `User.role` derived from organization membership context (`OWNER`/`ADMIN`) with `PLAYER` fallback
- Admin CRUD APIs for leagues, session templates, session occurrences, slot assignments, and league memberships
- Admin read APIs for org-scoped league lists, league detail/rules, occurrence rosters, and player search/filter pagination
- Admin league detail nested query returns league rules, sessions, assignments, and occurrence summaries in one request with archived/canceled/date filters
- Admin league detail occurrence rows include `attendingCount` (ATTENDING), `subCount` (ACTIVE + SELECTED), and `openSpots` (`max(capacity - effectiveRegisteredOccupiedSlots, 0)` with registered-partial auto-pairing)
- Admin player management mutations where `adminCreatePlayer` requires `leagueId` and atomically ensures `LeagueMembership.ACTIVE`
- `adminUpdatePlayer` supports org-scoped role updates (`PLAYER`/`ADMIN`) with owner-protection constraints
- Admin player create/update no longer accept `isOnApp`; onboarding completion owns that flag
- Admin direct status control mutations for registrations and sub signups, gated by `LeagueMembership.ACTIVE`
- Admin attendance confirmation mutations (`adminSetAttendanceConfirmation`, `adminSetAttendanceConfirmations`) for occurrence roster users (attendees + subs, any status)
- `adminOccurrenceRoster` includes canonical attendance confirmation state (`attendanceConfirmations`, `confirmedCount`, `unconfirmedCount`) independent from registration/sub status
- `adminOccurrenceRoster.attendees` and `.subs` return stable non-null roster entry ids aligned with `SessionRosterEntry.id`
- Admin league rules mutations for league-scoped upsert and template-copy workflows
- Phone-based slot assignment that creates placeholder users (`isOnApp = false`) until onboarding completion and auto-activates league membership
- League lifecycle via `LeagueStatus` (`DRAFT`, `UPCOMING`, `ACTIVE`, `ARCHIVED`) with one `ACTIVE` league enforced per organization
- Session lifecycle via `SessionStatus` (`ACTIVE`, `ARCHIVED`)
- Weekly (Eastern) session occurrences listing by required `organizationId` and optional `leagueId`, with active-league-in-organization fallback when omitted and Monday preview rows visible from Sunday 8am ET
- Session occurrences have lifecycle status (`ACTIVE`/`CANCELED`, default `ACTIVE`) and `sessionsWeek` exposes `occurrenceStatus` while still returning canceled occurrences
- Admin occurrence create/update validates that `startsAt`/`endsAt` remain within the parent league `startDate`/`endDate` bounds
- Admin occurrence delete auto-cancels when participation history exists; otherwise hard-deletes
- Admin session delete archives when participation history exists; otherwise hard-deletes
- Admin league delete hard-cascades related sessions/occurrences/assignments/memberships/registrations/sub signups/attendance confirmations/notifications/rules
- Profile stats query for current-league participation, sub signup counts, and attendance/missed summaries
- Profile stats exclude registration/subsignup rows tied to canceled occurrences
- Session display state (PAST/LIVE/UPCOMING) derived server-side using Eastern wall-clock projections of UTC instants; live window opens 10am ET day before
- Registration windows open 10am ET day before and close at 7pm ET day before; sub signups remain open until the session ends (Eastern rules applied to UTC instants)
- Register/sub mutations require `LeagueMembership.ACTIVE` and reject attempts for canceled occurrences
- `sessionOccurrenceDetail` capability flags (`canRegister`, `canSub`) require `LeagueMembership.ACTIVE` to match mutation enforcement
- `sessionOccurrenceDetail.attendees/subs` rows include optional `splitPartner` (`id`, `displayName`, `profileImageUrl`) for backend-authored deterministic non-overlap split display metadata aligned with effective occupancy pairing (30-minute minimum per paired segment)
- Scheduler ticks enqueue Bull sub-selection jobs from registration close through occurrence end; sub-selection worker recomputes selection and sends push notifications only for selection state changes
- Scheduler tick runs demo-org active-league autofill during open registration windows: query scope is bounded to next-day Eastern occurrences, zero-attendee occurrences auto-register assigned users to a randomized 50%-80% capacity target, and failures log diagnostic context while adding at most one sub per tick with an 8-sub (`ACTIVE` + `SELECTED`) cap
- Scheduler tick also cleans up expired, unused profile-photo upload intents and attempts provider-side orphan deletion
- Reminder scheduler queues registration-close/session-start notifications only at or after warning time, batches attendee/device lookups, dedupes once per `(userId, occurrenceId, kind)`, and retries enqueueing existing `PENDING` reminders that were never dispatched
- Scheduler tick and sub-selection worker process `ACTIVE` occurrences only
- Scheduler ticks skip enqueueing duplicate in-flight sub-selection job ids so repeated ticks remain stable
- sessionsWeek sub signup status returns ACTIVE or SELECTED sub signups for the current user
- sessionsWeek subCount reflects ACTIVE + SELECTED sub signups (canceled/replaced excluded)
- Sub ordering uses signup queue time (`signedUpAt`); cancel + re-sub places the user at the end of the sub list
- Partial attendance/sub preferences use 15-minute blocks (`START`/`END` + minutes)
- Sub selection auto-pairs non-overlapping registered partial attendees when each paired segment is at least 30 minutes, preserves selected subs when compatible capacity remains, and applies mode-aware queue behavior (`FULL_ONLY`, `FLEX`, `PARTIAL_ONLY`)
- sessionsWeek attendingCount reflects ATTENDING registrations only (canceled/declined excluded)
- sessionsWeek returns `registeredUsers` and `subUsers` participant objects (`id`, `displayName`, `profileImageUrl`) for ATTENDING registrations and ACTIVE/SELECTED sub signups
- Member `league`, `rules`, and `sessionsWeek` queries require `organizationId`, support optional `leagueId`, and enforce that explicit league ids belong to the provided organization
- Notification scheduling and delivery
- Debuggable backend runtime via `just run-debug` / `just run-debug-brk` (Node inspector + auto-reload)
- Combined job monitor via `just jobs-watch` (both workers + repeating scheduler tick in one terminal)
- Fly.io production deployment with dedicated process groups for API, workers, and scheduler plus pre-deploy Prisma migrations
- Local seed data generation with full app-data wipe (guarded outside prod/staging unless explicit override envs are set), canonical orgs (`hbk-pickle`, `demo-org`), optional private owner users from `SEED_PRIVATE_USERS_JSON` (slotted into Thursday/Friday/Saturday sessions when present), deterministic generated seeded users, `Demo User` as a Thursday/Friday/Saturday player-only seed that replaces an active Demo Org slot with fallback across late-week sessions to preserve session capacity, and per-player transactional replacement writes that include slot assignment upsert plus `LeagueMembership(status=ACTIVE)` upsert, Demo Org leagues (2 archived + 1 active, 8/10/12 weeks), and one userless active HBK demo league on the same session/occurrence schedule

## Folder Structure

- src/app: HTTP server bootstrap and middleware
- src/features: Feature modules (admin, auth, users, sessions, registrations, subs, rules, notifications)
- src/integrations: Twilio, Firebase, Redis, BullMQ clients
- src/integrations/cloudflare: Cloudflare Images client + delivery URL helpers
- src/jobs: Schedulers and workers
- src/shared: Logger, config, phone normalization, time helpers, constants
- prisma: Schema and migrations
- docs/features: Feature documentation
- deployment: `Dockerfile`, `.dockerignore`, and `fly.toml`

## Key Files

- README.md: Project overview (this file)
- justfile: Developer commands (install, run, checks, debug, build, workers)
- prisma/schema.prisma: Database schema (organizations, memberships, leagues/sessions/occurrences)
- src/app/server.ts: App entry
- src/app/graphql/schema.ts: GraphQL schema
- src/app/auth.ts: Auth + org/league access guards
- src/features/admin/adminManagementService.ts: Admin CRUD orchestration, delete semantics, and occurrence attendance confirmation reads/writes
- src/features/profilePhoto/profilePhotoService.ts: Profile photo upload intent, completion, replacement/delete, and stale-intent cleanup orchestration
- src/features/sessions/splitPartnerResolver.ts: Deterministic split-partner pairing metadata resolver for occurrence-detail roster rows
- src/features/subs/subSelectionEngine.ts: Deterministic sub-selection engine (registered partial pairing + queue assignment rules)
- src/shared/config.ts: Typed environment config
- src/shared/attendanceCoverage.ts: Shared 15-minute segment math and effective registered occupancy calculations
- src/shared/phone.ts: E.164 phone normalization utility
- src/shared/logger.ts: Pino logger wrapper
- src/scripts/seed.ts: Full-wipe seed script for canonical orgs, optional private owner seed users (`SEED_PRIVATE_USERS_JSON`), and Demo Org league/user generation
- src/jobs/subSelectionWorker.ts: Bull worker for selection recalculation and sub selection notifications
- src/jobs/schedulers/demoOrgAutofillService.ts: Demo-org scoped registration/sub autofill orchestration during open registration windows
- src/jobs/schedulers/registrationTicker.ts: Long-running scheduler loop entrypoint for production background execution
- src/jobs/schedulers/runRegistrationTick.ts: Shared single-tick scheduler orchestration
- src/integrations/cloudflare/cloudflareImagesClient.ts: Cloudflare direct-upload/create/details/delete API wrapper
- src/integrations/cloudflare/profileImageUrl.ts: Delivery URL builder for configured avatar variant
- Dockerfile: Multi-stage production image build for Fly deploys
- fly.toml: Fly process groups, HTTP service, health checks, and release migration command

## Documentation

- docs/features: One doc per feature module with responsibilities and data flow (see organizations-memberships.md for tenancy/auth model, attendance-confirmation.md for admin in-person check-in confirmation flow, profile-photos.md for Cloudflare upload flows, account-deletion.md for self-serve hard delete semantics, sub-selection.md for backend pairing/queue behavior, utc-time.md for UTC contract, dev-debugging.md for local debugger workflow, jobs-watch.md for local worker+ticker orchestration, demo-org-autofill.md for scheduler-time demo population behavior, and fly-deployment.md for production deployment/runbook guidance)

## API Contract Notes

- 2026-03-24 (breaking): `league`, `rules`, and `sessionsWeek` now require `organizationId`. Optional `leagueId` remains supported, but when provided it must belong to the specified organization. New signatures: `league(organizationId: ID!, leagueId: ID)`, `rules(organizationId: ID!, leagueId: ID)`, `sessionsWeek(organizationId: ID!, leagueId: ID)`.
- 2026-03-25: Added `playerOrganizations: [Organization!]!` for player eligibility, derived from ACTIVE league memberships on ACTIVE, UPCOMING, or ARCHIVED leagues. Existing `organizations` semantics are unchanged and remain organization-membership based.
- 2026-03-26 (breaking): `verifyPhoneCode` now returns `eligibleOrganizations` on `AuthPayload`; added `completeOnboarding: User!`; removed `isOnApp` from `AdminCreatePlayerInput` and `AdminUpdatePlayerInput`. OTP verification no longer sets `isOnApp`.
- 2026-03-31: Added admin attendance confirmation APIs on occurrence rosters: `AdminOccurrenceRoster.attendanceConfirmations`, `confirmedCount`, `unconfirmedCount`, plus mutations `adminSetAttendanceConfirmation` and `adminSetAttendanceConfirmations`.

## Local Development (Postman)

- Install toolchain versions via mise and ensure it is activated so pnpm is on PATH.
- Ensure Postgres and Redis are running.
- Create the local database.
- Sync schema without migrations (no shadow DB permissions).
- `just migrate-dev` is a legacy alias that now runs `just db-push` because `prisma migrate dev` is not supported in this repo.
- If your DB user cannot create shadow DBs, apply SQL migrations with `just db-apply-org-membership-migration`, `just db-convert-ids-to-uuid`, `just db-apply-reminder-once-migration`, and `just db-apply-occurrence-attendance-confirmation-migration`, then run `just db-push`.
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

### Auth Review OTP Environment

- `AUTH_REVIEW_OTP_ENABLED`: Enables single-account review OTP bypass when set to `true` (default `false`).
- `AUTH_REVIEW_OTP_PHONE_NUMBER`: Exact whitelisted E.164 phone number used by App Review.
- `AUTH_REVIEW_OTP_CODE`: Static verification code accepted only for `AUTH_REVIEW_OTP_PHONE_NUMBER`.
- When bypass is enabled, both `AUTH_REVIEW_OTP_PHONE_NUMBER` and `AUTH_REVIEW_OTP_CODE` are required or startup fails.
- Bypass does not auto-create users; the whitelisted phone number must already exist in the DB.
- After App Review approval, disable bypass and rotate the code before the next review cycle.

### App Store Connect Review Notes Template

- Test phone number: `<AUTH_REVIEW_OTP_PHONE_NUMBER>`.
- Verification code: `<AUTH_REVIEW_OTP_CODE>`.
- Login flow: open app, enter test phone number, request code, enter verification code, continue to app home.
- Account provisioning: test account is pre-provisioned in backend and kept active for review.

### Profile Photo Environment

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id used for Images API calls.
- `CLOUDFLARE_IMAGES_API_TOKEN`: Token with Cloudflare Images write/delete permissions.
- `CLOUDFLARE_IMAGES_DELIVERY_HASH`: Optional until first image upload; when unset, `profileImageUrl` resolves to `null` and delivery URLs are not built.
- `CLOUDFLARE_IMAGES_AVATAR_VARIANT`: Named variant for avatar rendering (default: `avatar`).
- `CLOUDFLARE_IMAGES_UPLOAD_EXPIRY_SECONDS`: Direct-upload intent expiry in seconds (default: `900`, max `86400`).

### Fly.io Deployment

- Install and authenticate Fly CLI (`fly auth login` or `fly auth signup`).
- Initialize app setup without deploying: `just fly-launch <app> <org> iad`.
- Replace the placeholder app name in `fly.toml`: `just fly-set-app-name <app>`.
- Create and attach managed Postgres:
  - `just fly-create-postgres <pg-name> <org> iad development`
  - `just fly-attach-postgres <pg-app-name> <app>`
- Create Redis and capture private URL: `just fly-create-redis` (set this as `REDIS_URL` in `.env.fly`).
- Create `.env.fly` with required production values (`DATABASE_URL`, `REDIS_URL`, Twilio, Firebase, JWT secret, Cloudflare values, `NODE_ENV=production`, `PORT=8080`).
- Generate a production JWT secret with `just auth-generate-jwt-secret 48` and set it as `AUTH_JWT_SECRET` in `.env.fly`.
- Optional scheduler override: `SCHEDULER_TICK_SECONDS` (default `60`).
- Stage/import secrets: `just fly-secrets-import .env.fly`.
- Deploy: `just fly-deploy`.
- Scale all production process groups to one machine in `iad`: `just fly-scale-prod <app> iad`.
- Validate and monitor:
  - `just fly-status <app>`
  - `just fly-logs <app>` (optionally `just fly-logs <app> iad` for region filter)
  - `just fly-machine-logs <app> <machine-id>` for machine-specific logs
- For Postico/GUI DB access, run `just fly-mpg-proxy <cluster-id>` and connect to `127.0.0.1:16380`.
- Fly process groups:
  - `api`: GraphQL server + `/healthz` endpoint for Fly checks
  - `notifications`: Push notification worker
  - `sub_selection`: Sub-selection worker
  - `scheduler`: Continuous scheduler loop
- Rollback basics: use Fly release history to identify and revert to a known-good release, then re-check `/healthz` and worker logs.

### Local Jobs Monitoring

- `just jobs-watch`: Starts notification worker, sub-selection worker, and reruns `scheduler-tick` every 30 seconds in a single terminal (`scheduler-tick` includes demo-org autofill).
- `just jobs-watch 10`: Same flow but ticks every 10 seconds.
- `jobs-watch` exits as soon as any worker/ticker child process exits, returns that child status, and stops the remaining child processes.
- On Ctrl+C/TERM, `jobs-watch` performs a safe cleanup of child processes without unbound-variable failures.
- `jobs-watch` reuses existing `just` commands so it runs through the same `mise` toolchain and dotenv setup as other recipes.
- Use `just check` to run typecheck + lint together.
