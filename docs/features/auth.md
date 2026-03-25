# Auth Feature

## Purpose

- Phone-based authentication and session tokens.

## Core API

- Request phone verification via Twilio Verify.
- Verify SMS code and issue JWT token.
- Normalize phone numbers to E.164 before verification and persistence.
- Validate `AUTH_JWT_SECRET` at boot and block weak/short values in production.
- Optional App Review OTP bypass for one exact whitelisted E.164 phone number and one static code.
- Review OTP bypass is disabled by default and only activates when `AUTH_REVIEW_OTP_ENABLED=true`.
- Review OTP bypass requires an existing `User` row for the whitelisted phone number (no auto-create path).

## Key Files

- src/features/auth/authService.ts: Twilio Verify integration and JWT issuance.
- src/app/graphql/schema.ts: GraphQL mutations for auth.
- src/shared/config.ts: Auth/Twilio configuration and production JWT secret guardrails.
- justfile: `auth-generate-jwt-secret` command for production-safe secret generation.
- .env.example: Review OTP environment variable contract.

## Data Flow

- Client requests verification -> phone is normalized to E.164 -> Twilio Verify sends code.
- Client submits code -> phone is normalized to E.164 -> service validates -> user upsert -> JWT issued.
- Successful verification marks the user as `isOnApp = true`.
- Request context decodes bearer tokens to supply userId and stores request-scoped authz memoization used by org/league guard checks.
- Startup config validation rejects production JWT secrets shorter than 32 characters and blocks weak placeholders such as `dev-secret`.
- Review OTP path:
  - If enabled and phone matches the configured whitelist, the request mutation returns success without sending Twilio SMS.
  - Verify mutation compares code against `AUTH_REVIEW_OTP_CODE`.
  - On exact match, service requires an already-provisioned user for the whitelisted phone, then marks `isOnApp = true` and issues JWT.
  - On mismatch, verification fails with `Invalid verification code`.

## Operations Notes

- Configure review OTP only for App Review windows, then disable it immediately after approval.
- Rotate `AUTH_REVIEW_OTP_CODE` after each review cycle.
- App Store Connect Notes template:
  - Test account phone number: `<AUTH_REVIEW_OTP_PHONE_NUMBER>`
  - Verification code: `<AUTH_REVIEW_OTP_CODE>`
  - Login steps: open app -> enter test phone number -> continue -> enter verification code -> proceed through onboarding/home flow
  - Note that the account is pre-provisioned in backend and must remain active during review.
