set dotenv-load := true
set shell := ["mise", "exec", "--", "/bin/zsh", "-cu"]

# Install dependencies with pnpm.

install:
	pnpm install

# Run TypeScript typechecking (no emit).

typecheck:
	pnpm typecheck

# Run ESLint across the repo.

lint:
	pnpm lint

# Format project files with Prettier.

format:
	pnpm format

# Start the dev server (ts-node/tsx) with auto-reload.

dev:
	pnpm dev

# Build the production bundle.

build:
	pnpm build

# Run scheduler tick for notifications/registration warnings.

scheduler-tick:
	pnpm scheduler:tick

# Run BullMQ notifications worker process.

worker-notifications:
	pnpm worker:notifications

# Run BullMQ sub-selection worker process.

worker-sub-selection:
	pnpm worker:sub-selection

# Run Prisma migrations in dev mode.

migrate-dev:
	pnpm prisma migrate dev

# Push Prisma schema to the database (no migrations).
# Parameters: none.

db-push:
	pnpm prisma db push

# Generate Prisma client.

prisma-generate:
	pnpm prisma generate

# Seed database with demo league, users, sessions, and assignments.
# Parameters: none.

seed: typecheck
	pnpm exec tsx src/scripts/seed.ts

# Reset database (schema push) and reseed demo data.
# Parameters: none.

reset-seed: db-push seed
