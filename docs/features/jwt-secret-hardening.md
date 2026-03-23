# JWT Secret Hardening

## Purpose

- Prevent weak JWT signing secrets in production environments.
- Provide a repeatable local command to generate strong production secrets.

## Core API

- Startup validation enforces production-only `AUTH_JWT_SECRET` rules.
- `just auth-generate-jwt-secret <bytes>` prints a cryptographically strong secret.

## Key Files

- src/shared/config.ts: Production validation for JWT secret strength and blocked placeholders.
- justfile: `auth-generate-jwt-secret` recipe for secure secret generation.
- .env.fly: Production env template placeholder for generated JWT secret value.

## Data Flow

- Runtime loads env vars via `dotenv` and parses with `zod`.
- When `NODE_ENV=production`, config parsing rejects secrets under 32 characters and known weak placeholders.
- Operators generate a strong secret with `just auth-generate-jwt-secret 48` and set it as `AUTH_JWT_SECRET` before deploy.
