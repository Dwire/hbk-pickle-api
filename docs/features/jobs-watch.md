# Jobs Watch Command

## Purpose

- Provide one local command that runs background workers and scheduler ticks together with readable per-process logs.

## Core API

- `just jobs-watch`: Runs both workers and executes `scheduler-tick` every 30 seconds.
- `just jobs-watch <tick_seconds>`: Same flow with a custom tick interval.
- `scheduler-tick` includes reminder queueing, demo-org autofill, sub-selection queueing, and stale profile-photo upload-intent cleanup.

## Key Files

- justfile: `jobs-watch` orchestration command.
- src/jobs/notificationWorker.ts: Notification queue consumer.
- src/jobs/subSelectionWorker.ts: Sub-selection queue consumer.
- src/jobs/schedulers/registrationTick.ts: Scheduler tick entrypoint.

## Data Flow

- Starts `worker-notifications` and `worker-sub-selection` concurrently.
- Runs `scheduler-tick` in a loop using the configured interval.
- Every tick includes demo-org active-league autofill during open registration windows.
- Prefixes each process output with a source label so mixed logs remain traceable in one terminal.
- Watches all child process PIDs and exits immediately when the first child process stops, returning that process exit status.
- On first child exit, shuts down the remaining child processes and reaps them before exit.
- Leaves static type validation to `just typecheck` so job loops start without extra startup flags.
- On Ctrl+C or TERM, exits with signal code and stops all spawned processes without unbound-variable cleanup failures.
