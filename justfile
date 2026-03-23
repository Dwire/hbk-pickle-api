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

# Run all static checks (typecheck + lint).
# Parameters: none.

check: typecheck lint

# Format project files with Prettier.

format:
	pnpm format

# Generate a cryptographically strong JWT secret for production.
# Parameters: `bytes` (default: 48, minimum: 32).

auth-generate-jwt-secret bytes="48":
	node -e 'const crypto = require("node:crypto"); const minimumBytes = 32; const rawBytes = Number(process.argv[1]); if (!Number.isInteger(rawBytes) || rawBytes < minimumBytes) { process.stderr.write(`bytes must be an integer >= ${minimumBytes}\n`); process.exit(1); } process.stdout.write(`${crypto.randomBytes(rawBytes).toString("base64url")}\n`);' {{bytes}}

# Start the dev server (ts-node/tsx) with auto-reload.

dev:
	pnpm dev

# Start the dev server (alias for `just dev`).
# Parameters: none.

run: dev

# Start the dev server with Node inspector enabled for IDE attach.
# Parameters: `debug_port` (default: 9229), `app_port` (default: 4000).

run-debug debug_port="9229" app_port="4000":
	PORT={{app_port}} pnpm exec nodemon --watch src --ext ts --exec "pnpm exec tsx --inspect=127.0.0.1:{{debug_port}} src/app/server.ts"

# Start the dev server with Node inspector break mode (pauses on startup).
# Parameters: `debug_port` (default: 9229), `app_port` (default: 4000).

run-debug-brk debug_port="9229" app_port="4000":
	PORT={{app_port}} pnpm exec nodemon --watch src --ext ts --exec "pnpm exec tsx --inspect-brk=127.0.0.1:{{debug_port}} src/app/server.ts"

# Build the production bundle.

build:
	pnpm build

# Run scheduler tick for notifications/registration warnings.

scheduler-tick:
	pnpm scheduler:tick

# Run scheduler ticks continuously with configurable interval.
# Parameters: none (uses `SCHEDULER_TICK_SECONDS`, default 60).

scheduler-loop:
	pnpm scheduler:loop

# Run BullMQ notifications worker process.

worker-notifications:
	pnpm worker:notifications

# Run BullMQ sub-selection worker process.

worker-sub-selection:
	pnpm worker:sub-selection

# Run both workers and repeatedly execute scheduler ticks in one terminal.
# Parameters: `tick_seconds` (default: 30).

jobs-watch tick_seconds="30":
	#!/usr/bin/env bash
	set -euo pipefail

	tick_seconds="{{tick_seconds}}"
	notification_pid=""
	sub_selection_pid=""
	ticker_pid=""
	exited_process=""

	run_with_prefix() {
		local prefix="$1"
		shift
		"$@" 2>&1 | sed -u "s/^/[${prefix}] /"
	}

	cleanup() {
		for pid in "${notification_pid:-}" "${sub_selection_pid:-}" "${ticker_pid:-}"; do
			if [[ -z "${pid}" ]]; then
				continue
			fi

			if kill -0 "${pid}" 2>/dev/null; then
				kill "${pid}" 2>/dev/null || true
			fi

			wait "${pid}" 2>/dev/null || true
		done
	}

	handle_interrupt() {
		exit 130
	}

	handle_terminate() {
		exit 143
	}

	wait_for_first_exit() {
		while true; do
			if [[ -n "${notification_pid:-}" ]] && ! kill -0 "${notification_pid}" 2>/dev/null; then
				exited_process="worker-notifications"
				if wait "${notification_pid}" 2>/dev/null; then
					return 0
				else
					return $?
				fi
			fi

			if [[ -n "${sub_selection_pid:-}" ]] && ! kill -0 "${sub_selection_pid}" 2>/dev/null; then
				exited_process="worker-sub-selection"
				if wait "${sub_selection_pid}" 2>/dev/null; then
					return 0
				else
					return $?
				fi
			fi

			if [[ -n "${ticker_pid:-}" ]] && ! kill -0 "${ticker_pid}" 2>/dev/null; then
				exited_process="scheduler-tick-loop"
				if wait "${ticker_pid}" 2>/dev/null; then
					return 0
				else
					return $?
				fi
			fi

			sleep 1
		done
	}

	trap cleanup EXIT
	trap handle_interrupt INT
	trap handle_terminate TERM

	run_with_prefix "worker-notifications" just worker-notifications &
	notification_pid=$!

	run_with_prefix "worker-sub-selection" just worker-sub-selection &
	sub_selection_pid=$!

	(
		while true; do
			printf '[scheduler-tick] Running tick at %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
			just scheduler-tick 2>&1 | sed -u 's/^/[scheduler-tick] /'
			sleep "$tick_seconds"
		done
	) &
	ticker_pid=$!

	if wait_for_first_exit; then
		exit_code=0
	else
		exit_code=$?
	fi
	printf '[jobs-watch] Exiting after %s stopped (status=%s)\n' "${exited_process}" "${exit_code}"
	exit "${exit_code}"

# Run Prisma migrations in dev mode.

migrate-dev:
	pnpm prisma migrate dev

# Push Prisma schema to the database (no migrations).
# Parameters: none.

db-push:
	pnpm prisma db push

# Execute a SQL file directly against the configured database (no shadow DB required).
# Parameters: `file` (required path to SQL file).

db-execute file:
	pnpm prisma db execute --schema prisma/schema.prisma --file {{file}}

# Apply the org/membership migration directly (no shadow DB required).
# Parameters: none.

db-apply-org-membership-migration:
	just db-execute prisma/migrations/202603150001_org_scoped_memberships/migration.sql

# Clean up partially applied org/membership migration artifacts before retrying.
# Parameters: none.

db-cleanup-org-membership-migration:
	just db-execute prisma/migrations/202603150001_org_scoped_memberships/retry-cleanup.sql

# Convert all primary/foreign key id columns from text to Postgres uuid.
# Parameters: none.

db-convert-ids-to-uuid:
	just db-execute prisma/migrations/202603160001_convert_ids_to_uuid/migration.sql

# Add once-only reminder notification index and remove duplicate reminder rows.
# Parameters: none.

db-apply-reminder-once-migration:
	just db-execute prisma/migrations/202603160002_notification_reminder_once/migration.sql

# Generate Prisma client.

prisma-generate:
	pnpm prisma generate

# Open Prisma Studio for local database inspection.
# Parameters: none.

prisma-studio:
	pnpm prisma studio

# Show Prisma migration status against the configured database.
# Parameters: none.

migrate-status:
	pnpm prisma migrate status

# Seed database with demo league, users, sessions, and assignments.
# Parameters: none.

seed: typecheck
	pnpm exec tsx src/scripts/seed.ts

# Reset database (schema push) and reseed demo data.
# Parameters: none.

reset-seed: db-push seed

# Initialize Fly app config and app resource metadata without deploying.
# Parameters: `app` (required Fly app name), `org` (required Fly org slug), `region` (default: iad).

fly-launch app org region="iad":
	fly launch --name {{app}} --org {{org}} --region {{region}} --no-deploy --copy-config

# Replace the placeholder Fly app name in `fly.toml`.
# Parameters: `app` (required Fly app name).

fly-set-app-name app:
	#!/usr/bin/env bash
	set -euo pipefail

	placeholder_app_name="replace-with-your-fly-app-name"
	if [[ ! -f fly.toml ]]; then
		printf 'fly.toml not found in project root.\n' >&2
		exit 1
	fi
	if ! grep -q "^app = \"${placeholder_app_name}\"$" fly.toml; then
		printf 'Refusing to replace app name because fly.toml no longer has the placeholder value.\n' >&2
		exit 1
	fi

	sed -E -i.bak "s/^app = \"${placeholder_app_name}\"$/app = \"{{app}}\"/" fly.toml
	rm -f fly.toml.bak
	printf 'Updated fly.toml app name to %s\n' "{{app}}"

# Create Fly managed Postgres cluster.
# Parameters: `name` (required cluster app name), `org` (required Fly org slug), `region` (default: iad), `plan` (default: development).

fly-create-postgres name org region="iad" plan="development":
	#!/usr/bin/env bash
	set -euo pipefail

	if fly mpg create --name {{name}} --org {{org}} --region {{region}} --plan {{plan}}; then
		exit 0
	fi

	if fly postgres create --name {{name}} --org {{org}} --region {{region}} --plan {{plan}}; then
		exit 0
	fi

	fly managed-postgres create --name {{name}} --org {{org}} --region {{region}} --plan {{plan}}

# Attach Postgres cluster to app and inject `DATABASE_URL` secret.
# Parameters: `pg_app` (required Postgres app name), `app` (required consumer app name).

fly-attach-postgres pg_app app:
	#!/usr/bin/env bash
	set -euo pipefail

	if fly mpg attach {{pg_app}} --app {{app}}; then
		exit 0
	fi

	if fly postgres attach {{pg_app}} --app {{app}}; then
		exit 0
	fi

	fly managed-postgres attach --postgres-app {{pg_app}} --app {{app}}

# Create Upstash Redis on Fly and print the private URL to set as `REDIS_URL`.
# Parameters: none.

fly-create-redis:
	#!/usr/bin/env bash
	set -euo pipefail

	fly redis create
	printf '\nCopy the private redis:// URL above into your .env.fly as REDIS_URL, then run just fly-secrets-import.\n'

# Stage secrets from dotenv-style env file for next deploy.
# Parameters: `env_file` (default: .env.fly).

fly-secrets-import env_file=".env.fly":
	fly secrets import --stage < {{env_file}}

# Deploy current revision to Fly.
# Parameters: none.

fly-deploy:
	fly deploy

# Scale process groups for production baseline (1 machine each).
# Parameters: `app` (required app name), `region` (default: iad).

fly-scale-prod app region="iad":
	fly scale count 1 --app {{app}} --region {{region}} --process-group api
	fly scale count 1 --app {{app}} --region {{region}} --process-group notifications
	fly scale count 1 --app {{app}} --region {{region}} --process-group sub_selection
	fly scale count 1 --app {{app}} --region {{region}} --process-group scheduler

# Show app status and current machine/process health.
# Parameters: `app` (required app name).

fly-status app:
	fly status --app {{app}}

# Run a local proxy tunnel to a managed Postgres cluster for GUI tools (Postico, TablePlus, etc.).
# Parameters: `cluster_id` (required managed Postgres cluster id), `local_port` (default: 16380), `bind_addr` (default: 127.0.0.1).

fly-mpg-proxy cluster_id local_port="16380" bind_addr="127.0.0.1":
	fly mpg proxy {{cluster_id}} --local-port {{local_port}} --bind-addr {{bind_addr}}

# Stream app logs for a specific Fly process group.
# Parameters: `app` (required app name), `process` (default: api).

fly-logs app process="api":
	fly logs --app {{app}} --process-group {{process}}
