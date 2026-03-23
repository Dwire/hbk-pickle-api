# Fly.io Deployment

## Purpose

- Define the production deployment shape for HBK Pickle API on Fly.io.
- Keep API traffic, background workers, and scheduler execution in one Fly app with separate process groups.

## Deployment Shape

- `api`: Serves GraphQL traffic and Fly HTTP health checks.
- `notifications`: BullMQ worker that sends queued push notifications.
- `sub_selection`: BullMQ worker that recalculates sub selections and queues notification jobs.
- `scheduler`: Long-running scheduler loop that executes registration/notification/sub-selection ticks.
- Fly release runs Prisma migrations before new machines roll out.

## Files and Responsibilities

- `fly.toml`: Fly app/process/service/deploy configuration.
- `Dockerfile`: Multi-stage production image build with Prisma generate and TypeScript build.
- `.dockerignore`: Build context minimization for Docker/Fly builds.
- `src/app/server.ts`: HTTP health endpoint for Fly checks.
- `src/jobs/schedulers/runRegistrationTick.ts`: Shared single-tick scheduler orchestration.
- `src/jobs/schedulers/registrationTick.ts`: One-shot scheduler entrypoint.
- `src/jobs/schedulers/registrationTicker.ts`: Continuous scheduler loop entrypoint.
- `justfile`: Fly setup, deploy, scale, status, and logs workflows.

## Operational Workflow

- First-time setup:
  - Initialize Fly app metadata and config.
  - Provision managed Postgres and Redis.
  - Attach Postgres to inject `DATABASE_URL`.
  - Generate a production JWT secret with `just auth-generate-jwt-secret 48`.
  - Set `AUTH_JWT_SECRET` in `.env.fly` using the generated value.
  - Import environment secrets from `.env.fly`.
  - Deploy and scale all process groups.
- Ongoing deploys:
  - Deploy changes with the same `fly.toml` process topology.
  - Check process health/status and logs per process group.
- Runtime safety:
  - API startup fails in `NODE_ENV=production` if `AUTH_JWT_SECRET` is shorter than 32 characters or uses a blocked weak placeholder.
- Rollback basics:
  - Use Fly release history to identify the last known-good release.
  - Revert to that release when needed, then verify API health and worker stability.
