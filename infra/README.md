# infra/ — Infrastructure as code

Terraform (or your IaC of choice) for the shared backend dependencies:

- **PostgreSQL + PostGIS** — spatial system of record (hazards, geometry, lifecycle).
- **Redis** — hazard-tile cache, sorted-set leaderboards, dedup keys.
- **Event queue** — Kafka / AWS SQS / Redis Streams between `ingestion` and
  `hazard-engine`.
- **Analytics warehouse** — BigQuery / Snowflake (or Postgres to start) for
  scorecards, model training, and licensed exports.

Stand up incrementally: nothing here is needed for Phase 1 beyond (optionally)
the collect-only ingestion path.
