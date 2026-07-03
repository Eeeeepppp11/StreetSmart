# services/ingestion

NestJS event-intake service. Authenticated, batched `JoltEvent` upload →
validate → rate-limit → event queue (Kafka / SQS / Redis Streams). Decouples
spiky mobile-driven load from the `hazard-engine` processor.

**Phase 1:** runs in *collect-only* mode — accepts opt-in event uploads purely
to build the ML training set. No hazard map, no civic submission.
