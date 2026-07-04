# @potholeproof/privacy

Privacy-by-construction primitives, per the architecture's rule that these run
**before** any data leaves the device or the warehouse.

- `trimTraceEndpoints(points, trimMeters)` — drop everything within
  `trimMeters` of a drive's start/end, measured **along the path**, so trip
  endpoints (home, work) never leave the phone. Traces shorter than the two trim
  zones vanish entirely. Generic over anything with a `location` (GPS fixes,
  jolt events).
- `meetsKAnonymity(contributorIds, k)` — gate for aggregate exports: releasable
  only with ≥ k distinct contributors.

Tested with `node --test` (5 cases).
