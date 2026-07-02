# Buggy Task Tracker

A small, intentionally-buggy Express API used to compare error monitoring
behavior between two self-hosted, Sentry-compatible platforms:
[GlitchTip](https://glitchtip.com/) and [Bugsink](https://www.bugsink.com/).

The app uses the official `@sentry/node` SDK. Since both GlitchTip and
Bugsink accept the standard Sentry ingestion protocol, you can point this
same app at either backend by changing a single environment variable
(`SENTRY_DSN`) — no code changes required.

This app has **no real database, no authentication, and no frontend**. Its
in-memory task list and every "failure" endpoint exist purely to generate
different kinds of errors, breadcrumbs, tags, and user context so you can
see how each error monitoring tool displays them.

## Install dependencies

```bash
npm install
```

## Configure environment variables

Copy the example env file and fill in your DSN:

```bash
cp .env.example .env
```

`.env`:

```
SENTRY_DSN=
SENTRY_ENVIRONMENT=local
SENTRY_RELEASE=buggy-task-tracker-ts@1.0.0
PORT=3000
```

- `SENTRY_DSN` — the DSN from your GlitchTip or Bugsink project. Leave empty
  to run the app without sending events anywhere.
- `SENTRY_ENVIRONMENT` — tagged on every event (e.g. `local`, `staging`).
- `SENTRY_RELEASE` — tagged on every event as the release version.
- `PORT` — local port for the Express server.

## Run the app

```bash
npm run dev
```

This uses `tsx watch` to run `src/index.ts` with automatic reloads on file
changes. The server starts on `http://localhost:3000` by default.

## Switching between GlitchTip and Bugsink

1. Create (or find) a project in GlitchTip and copy its DSN into
   `SENTRY_DSN` in `.env`. Restart the app (`npm run dev` picks up the new
   value on restart) and hit a few endpoints below.
2. Create (or find) a project in Bugsink and copy its DSN into `SENTRY_DSN`
   instead. Restart the app and hit the same endpoints again.
3. Compare how each tool groups, displays, and tags the resulting events —
   issue titles, breadcrumbs, tags, user context, stack traces, etc.

No other configuration changes are needed — both platforms are Sentry API
compatible.

## Endpoints

All endpoints intentionally generate errors (except `/health`, `/tasks`)
so you have a range of scenarios to compare across tools.

### `GET /health`

Basic liveness check.

```bash
curl http://localhost:3000/health
```

### `GET /tasks`

Returns the in-memory list of tasks.

```bash
curl http://localhost:3000/tasks
```

### `POST /tasks`

Adds a task to the in-memory list. Requires a JSON body with a `title`
field.

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Test error monitoring"}'
```

### `GET /crash`

Throws an unhandled exception. Sentry's Express error handler captures it
automatically and the app returns a JSON 500 response.

```bash
curl http://localhost:3000/crash
```

### `GET /handled-error`

Throws an error, catches it locally, and reports it via
`Sentry.captureException`. Returns a 200 response confirming the report.

```bash
curl http://localhost:3000/handled-error
```

### `GET /validation-error`

Simulates a validation failure when the `title` query parameter is missing
or invalid.

```bash
curl http://localhost:3000/validation-error
curl "http://localhost:3000/validation-error?title=Valid+Title"
```

### `GET /db-error`

Throws a custom `DatabaseConnectionError` to simulate a database outage
(no real database is used).

```bash
curl http://localhost:3000/db-error
```

### `GET /external-api-error`

Adds a breadcrumb describing a simulated outbound API call, then throws an
error. Useful for comparing how each tool surfaces breadcrumbs.

```bash
curl http://localhost:3000/external-api-error
```

### `GET /user-context-error`

Sets fake user context (`id`, `email`, `username`, `role`, `organization`)
on the Sentry scope, then throws an error. Compare how each tool displays
user context on the issue.

```bash
curl http://localhost:3000/user-context-error
```

### `GET /background-job-error`

Responds immediately, then fails asynchronously ~100ms later outside the
request/response cycle (simulating a background job), reporting the error
via `Sentry.captureException`.

```bash
curl http://localhost:3000/background-job-error
```

## Sentry metadata used

- `environment` — from `SENTRY_ENVIRONMENT`
- `release` — from `SENTRY_RELEASE`
- Tags — `app_name` (constant), `test_type` and `route` (per-endpoint)
- User context — set on `/user-context-error`
- Breadcrumbs — added for task creation/listing and the external API call

## Project structure

```
error-monitoring-comparison/
  README.md
  .gitignore
  .env.example
  package.json
  tsconfig.json
  src/
    index.ts
```
