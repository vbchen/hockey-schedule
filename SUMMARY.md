# Project changelog

## 2026-05-03
- Extracted the remaining testable logic (`formatTime24`, `formatSlotKey`,
  `applyPlayoffCutoff`, `finalizeGames`, `parsePastedText`, `swapCutoffDate`,
  `suggestSwaps`) into `src/logic.js`. Where these functions previously read
  `state.timeFormat` or `state.playoffCutoff` directly, they now take the
  value as an explicit parameter; call sites in `index.html` were updated
  to pass it. Test count: 39 → 60.

## 2026-05-03
- Added unit-testing pilot. Extracted pure logic from `index.html` into
  `src/logic.js` as an ES module (date/slot helpers, serializers,
  `analyze`, `swapDates`, `hasTeamConflict`, etc.). `index.html`'s
  `<script>` is now `type="module"` and imports them. Added Vitest with
  39 tests in `tests/logic.test.js`. Local dev now needs an HTTP
  server (e.g. `python3 -m http.server`) instead of opening the file
  via `file://`; GitHub Pages is unaffected.

## 2026-05-03
- Swap engine: reject any swap that puts a team in two games on the same
  calendar day (was previously only checking same exact timestamp). Added
  W_WEEK ×3 penalty term (squared deviation from 1 game/team/week) to
  prefer one-per-week schedules.
- Swap UI: applied swaps stay visible at the top of the list with a green
  "Applied" badge and per-swap Undo button. Moved games are highlighted on
  the calendar with a green dashed border and a ↻ glyph.

## 2026-05-02
- Tuned penalty weights: home/away ×2 → ×1 (less critical for the D league),
  Monday-share ×2 → ×3 (Monday avoidance matters more in practice).

## 2026-05-02
- Added head-to-head matchup matrix and Monday-games-per-team panels.
  Both feed into the penalty function (matchup variance ×3, Monday-share ×2).
- Reworked swap suggestions: weekday-prefixed long dates, team color chips,
  explicit from→to slot pills, side-by-side now/after preview cell per slot,
  green highlighting of penalty terms that decreased.
- Swap engine now skips games in the current and upcoming Mon–Sun weeks
  (cutoff = start of the Monday after next, local time).

## 2026-05-02
- Added 12h/24h time format toggle. Affects schedule slot column,
  exact-view heatmap header, and calendar time chip. Default is 12h.
- Changed default "late game" threshold from 10:30pm to 10:00pm.

## 2026-05-02
- Initial commit. Standalone HTML+JS hockey schedule analyzer for TAHL D Division.
  Pulls live schedule from DaySmart Recreation public API (CORS-open), visualizes it
  as a colored monthly calendar, and runs fairness analysis (game count, home/away,
  early/middle/late slot distribution, same-matchup back-to-back). Suggests minimum
  single-swap fixes that improve fairness, with apply/reset and localStorage caching.
