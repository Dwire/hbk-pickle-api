# Rules Feature

## Purpose

- Persist league rules for static display in explicit league context.

## Core API

- `rules(leagueId)` for member-facing reads with league access checks.
- `adminUpsertLeagueRule` by `leagueId` + optional `ruleId` + `order`.
- `adminCopyLeagueRulesFromTemplate` for copying ordered rules between leagues.

## Key Files

- src/features/rules/ruleService.ts: Rule list/upsert logic for explicit league IDs.
- src/app/graphql/schema.ts: Rules query and admin mutations with org-scoped auth checks.

## Data Flow

- Rules query receives `leagueId` directly and lists rules ordered by `order`.
- Resolver-level access checks enforce member/admin visibility for the target league.
- Admin rule mutations require org admin/owner access to the target league.
