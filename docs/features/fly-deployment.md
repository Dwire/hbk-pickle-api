# Fly.io Deployment

## Purpose

- Define the production deployment shape for HBK Pickle API on Fly.io.
- Keep API traffic and background jobs in one Fly app with separate API and jobs process groups.

## Deployment Shape

- `api`: Serves GraphQL traffic and Fly HTTP health checks.
- `jobs`: Runs the BullMQ notification worker, BullMQ sub-selection worker, and long-running scheduler loop in one machine.
- API HTTP machines use Fly idle autostop (`auto_stop_machines = "stop"`, `min_machines_running = 0`) to reduce zero-traffic compute cost.
- Fly release runs Prisma migrations before new machines roll out.

## Files and Responsibilities

- `fly.toml`: Fly app/process/service/deploy configuration.
- `Dockerfile`: Multi-stage production image build with Prisma generate and TypeScript build.
- `.dockerignore`: Build context minimization for Docker/Fly builds.
- `src/app/server.ts`: HTTP health endpoint for Fly checks.
- `src/jobs/schedulers/runRegistrationTick.ts`: Shared single-tick scheduler orchestration.
- `src/jobs/schedulers/registrationTick.ts`: One-shot scheduler entrypoint.
- `src/jobs/schedulers/registrationTicker.ts`: Continuous scheduler loop entrypoint.
- `src/jobs/jobsProcess.ts`: Combined production jobs entrypoint for workers and scheduler loop.
- `justfile`: Fly setup, deploy, scale, status, and logs workflows.

## Operational Workflow

- First-time setup:
  - Initialize Fly app metadata and config.
  - Provision managed Postgres and Redis.
  - Attach Postgres to inject `DATABASE_URL`.
  - Generate a production JWT secret with `just auth-generate-jwt-secret 48`.
  - Set `AUTH_JWT_SECRET` in `.env.fly` using the generated value.
  - Import environment secrets from `.env.fly`.
  - Deploy and scale `api` and `jobs` process groups.
- Ongoing deploys:
  - Deploy changes with the same `fly.toml` process topology.
  - Check process health/status and logs per process group.
- Database tooling:
  - Use `just fly-mpg-proxy <cluster-id>` for a stable local MPG tunnel (`127.0.0.1:16380`) when connecting GUI database clients.
- Runtime safety:
  - API startup fails in `NODE_ENV=production` if `AUTH_JWT_SECRET` is shorter than 32 characters or uses a blocked weak placeholder.
- Rollback basics:
  - Use Fly release history to identify the last known-good release.
  - Revert to that release when needed, then verify API health and worker stability.
