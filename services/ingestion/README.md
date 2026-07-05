# services/ingestion

NestJS event-intake service. Authenticated, batched `JoltEvent` upload →
validate → rate-limit → event queue (Kafka / SQS / Redis Streams). Decouples
spiky mobile-driven load from the `hazard-engine` processor.

**Phase 1:** runs in *collect-only* mode — accepts opt-in event uploads purely
to build the ML training set. No hazard map, no civic submission.

## Implemented

- `validation.ts` — pure-TS, dependency-free intake validation the NestJS
  controller will call before enqueueing:
  - `validateJoltEvent(unknown)` — structural validation against the shared
    `JoltEvent` contract; returns a reconstructed event (drops unknown fields)
    or per-field errors. No exceptions.
  - `validateUpload(unknown, maxBatch?)` — validates the `EventUpload` envelope;
    lenient per collect-only intent (accepts valid events, reports bad ones
    per-index; rejects only malformed/oversize envelopes).

- `server.ts` + `main.ts` — the **running collect-only server**: plain
  `node:http` + `node:sqlite` (zero runtime dependencies).
  - `POST /v1/uploads` — validated batch upload; labels sanitised; idempotent
    (`INSERT OR IGNORE` on event id, so re-uploads are safe).
  - `GET /v1/health` — event/labeled counts.
  - `GET /v1/training-data` — the labeled set, ready for the `ml/` rig.

## Run it

```bash
# from repo root, after building:
node node_modules/typescript/bin/tsc -p services/ingestion/tsconfig.json
node services/ingestion/dist/main.js     # PORT / PP_DB env to override
```

It prints the `http://<lan-ip>:4477` URL to paste into the phone app's
"Upload to server" box (same Wi-Fi).

Tested with `node --test` (12 cases) plus a live curl smoke test. Still to
come for production: auth, rate limiting, queue publish, Postgres.
