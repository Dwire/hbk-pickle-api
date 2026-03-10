# Auth Feature

## Purpose

- Phone-based authentication and session tokens.

## Core API

- Request phone verification via Twilio Verify.
- Verify SMS code and issue JWT token.
- Development bypass for phone numbers with the configured prefix (no Twilio calls).

## Key Files

- src/features/auth/authService.ts: Twilio Verify integration and JWT issuance.
- src/app/graphql/schema.ts: GraphQL mutations for auth.
- src/shared/config.ts: Auth and Twilio configuration.

## Data Flow

- Client requests verification -> Twilio Verify sends code.
- Client submits code -> service validates -> user upsert -> JWT issued.
- Development bypass: phone numbers starting with AUTH_DEV_BYPASS_PHONE_PREFIX skip Twilio verification and still issue JWTs (development only).
- Request context decodes bearer tokens to supply userId for authenticated resolvers.
