# Auth Feature

## Purpose

- Phone-based authentication and session tokens.

## Core API

- Request phone verification via Twilio Verify.
- Verify SMS code and issue JWT token.
- Normalize phone numbers to E.164 before verification and persistence.

## Key Files

- src/features/auth/authService.ts: Twilio Verify integration and JWT issuance.
- src/app/graphql/schema.ts: GraphQL mutations for auth.
- src/shared/config.ts: Auth and Twilio configuration.

## Data Flow

- Client requests verification -> phone is normalized to E.164 -> Twilio Verify sends code.
- Client submits code -> phone is normalized to E.164 -> service validates -> user upsert -> JWT issued.
- Successful verification marks the user as `isOnApp = true`.
- Request context decodes bearer tokens to supply userId and stores request-scoped authz memoization used by org/league guard checks.
