# Dev Debugging

## Purpose

- Provide a stable local workflow for pausing backend execution at breakpoints while keeping auto-reload during development.

## Core API

- `just run`: Standard local API startup (alias of `just dev`).
- `just run-debug`: API startup with Node inspector enabled (`127.0.0.1:9229` by default).
- `just run-debug <debug_port> <app_port>`: Same as above with custom inspector and API ports.
- `just run-debug-brk`: API startup with Node inspector break mode (pauses before app startup).
- `just run-debug-brk <debug_port> <app_port>`: Break mode startup with custom inspector and API ports.

## Key Files

- justfile: Debug-capable runtime commands and alias command used by developers.
- .vscode/launch.json: VS Code attach debugger presets for default and custom inspector ports.
- src/app/server.ts: Backend entry point executed by debug and non-debug recipes.

## Data Flow

- `nodemon` watches TypeScript source files and restarts the process on file changes.
- `tsx` executes TypeScript directly for local runtime and forwards Node inspector flags.
- `just` sets `PORT` per process so multiple debug runs can coexist when ports differ.
- IDEs attach to the configured inspector port and set breakpoints against TypeScript source.
