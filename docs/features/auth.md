# Auth Feature

## Purpose

- Phone-based authentication and session tokens.

## Core API

- Request phone verification via Twilio Verify.
- Verify SMS code and issue JWT token.
- Normalize phone numbers to E.164 before verification and persistence.
- Validate `AUTH_JWT_SECRET` at boot and block weak/short values in production.

## Key Files

- src/features/auth/authService.ts: Twilio Verify integration and JWT issuance.
- src/app/graphql/schema.ts: GraphQL mutations for auth.
- src/shared/config.ts: Auth/Twilio configuration and production JWT secret guardrails.
- justfile: `auth-generate-jwt-secret` command for production-safe secret generation.

## Data Flow

- Client requests verification -> phone is normalized to E.164 -> Twilio Verify sends code.
- Client submits code -> phone is normalized to E.164 -> service validates -> user upsert -> JWT issued.
- Successful verification marks the user as `isOnApp = true`.
- Request context decodes bearer tokens to supply userId and stores request-scoped authz memoization used by org/league guard checks.
- Startup config validation rejects production JWT secrets shorter than 32 characters and blocks weak placeholders such as `dev-secret`.
