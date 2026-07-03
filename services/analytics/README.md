# services/analytics

Scorecards + data licensing. Serves repair-time scorecards (by neighbourhood/
council district) to `apps/dashboard`, and municipal/insurer/fleet data-export
APIs.

**Every external export passes the privacy pipeline first:** trip-endpoint
trimming (drop home/work ends), anonymisation, and k-anonymity/aggregation
minimums enforced before data leaves the warehouse. **Phase 4.**
