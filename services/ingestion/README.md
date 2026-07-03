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

Tested with `node --test` (7 cases). The HTTP/NestJS layer, auth, rate-limiting,
and queue publish are still to come.
