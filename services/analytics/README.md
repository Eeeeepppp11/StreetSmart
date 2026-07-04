# services/analytics

Scorecards + data licensing. Serves repair-time scorecards (by neighbourhood/
council district) to `apps/dashboard`, and municipal/insurer/fleet data-export
APIs.

**Every external export passes the privacy pipeline first:** trip-endpoint
trimming (drop home/work ends), anonymisation, and k-anonymity/aggregation
minimums enforced before data leaves the warehouse. **Phase 4.**

## Implemented

- `scorecard.ts` — `buildScorecard(reports, hazards, { districtOf, asOf })`:
  pure per-district aggregation — reported/open/closed/rejected counts,
  median + mean repair days (submission → closure), and oldest-open age.
  District assignment and "now" are injected, so output is deterministic;
  reports with unknown hazards bucket under `unknown`.

- `export.ts` — `buildMunicipalExport(hazards, contributions, { tileOf,
  districtOf, k })`: the aggregated road-condition dataset for data licensing.
  Hazards group by coarse H3 cell with open/fixed counts and severity stats;
  any cell backed by fewer than `k` distinct contributors is **suppressed
  entirely** (not blurred), and rows carry no contributor ids or fine
  coordinates — the privacy pipeline enforced in code.

Tested with `node --test` (10 cases). The HTTP/dashboard layer is still to come.
