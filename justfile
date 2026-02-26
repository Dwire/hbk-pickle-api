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

# Run Prisma migrations in dev mode.

migrate-dev:
	pnpm prisma migrate dev

# Generate Prisma client.

prisma-generate:
	pnpm prisma generate
