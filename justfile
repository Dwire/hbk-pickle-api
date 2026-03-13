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
