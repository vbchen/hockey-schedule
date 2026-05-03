# Project changelog

## 2026-05-02
- Initial commit. Standalone HTML+JS hockey schedule analyzer for TAHL D Division.
  Pulls live schedule from DaySmart Recreation public API (CORS-open), visualizes it
  as a colored monthly calendar, and runs fairness analysis (game count, home/away,
  early/middle/late slot distribution, same-matchup back-to-back). Suggests minimum
  single-swap fixes that improve fairness, with apply/reset and localStorage caching.
