# Organizations and Memberships

## Purpose

- Support multi-tenant league management where each organization can run its own active league lifecycle.
- Enforce per-league player eligibility and per-organization admin authorization.

## Core API

- Organization membership roles: `OWNER` and `ADMIN`.
- League membership status: `ACTIVE` and `REMOVED`.
- GraphQL `User.role` resolves from organization membership role (`OWNER`/`ADMIN`) and defaults to `PLAYER`.
- Member-facing `league`, `rules`, and `sessionsWeek` accept optional `leagueId`; when omitted, the API resolves the caller's effective active league.
- League participation (`registerForSession`, `signupAsSub`) requires `LeagueMembership.status = ACTIVE`.

## Key Files

- prisma/schema.prisma: `Organization`, `OrganizationMembership`, `LeagueMembership` models and enums.
- prisma/migrations/202603150001_org_scoped_memberships/migration.sql: Data migration/backfill and partial unique index for one active league per organization.
- prisma/migrations/202603160001_convert_ids_to_uuid/migration.sql: Casts all PK/FK id columns from `text` to Postgres `uuid`.
- src/app/auth.ts: Org-admin and league-access guards.
- src/app/context.ts: Request-scoped authz memoization container for org/league guard lookups.
- src/app/graphql/schema.ts: League-scoped query arguments and org-scoped admin resolver checks.

## Data Flow

- Leagues belong to organizations via `League.organizationId`.
- Admin operations resolve target league/session/occurrence and require org membership role `OWNER|ADMIN`.
- Member-facing reads allow either active league membership or org admin/owner membership.
- Effective league resolution prefers active league memberships, then active leagues of org-admin memberships; multiple candidates require explicit `leagueId`.
- Register/sub mutations require active league membership and do not grant bypass for org admins.
- Slot assignment creation/update auto-upserts `LeagueMembership` to `ACTIVE`.
- Admin player creation is league-scoped and auto-upserts `LeagueMembership` to `ACTIVE`.
- Manual admin registration/sub status mutations require active league membership.
