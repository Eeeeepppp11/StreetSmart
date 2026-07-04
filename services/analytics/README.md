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

Tested with `node --test` (5 cases). The privacy gates live in
`@potholeproof/privacy`; the HTTP/dashboard layer is still to come.
