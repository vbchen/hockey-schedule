# Project changelog

## 2026-05-04
- Added a strict Content-Security-Policy meta tag: `default-src 'none'`,
  `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (existing
  `<style>` block), `connect-src https://api.daysmartrecreation.com`,
  `base-uri 'none'`, `form-action 'none'`. Required extracting the inline
  `<script type="module">` body (~1150 lines) out to `src/app.js` since
  CSP blocks inline scripts.

## 2026-05-04
- Expanded `usHolidays` to year-round coverage (12 → 19 entries). Added
  Memorial Day (last Mon of May), Juneteenth, Independence Day,
  Valentine's Day, St. Patrick's Day, Mother's Day, Father's Day, and
  Easter via the Anonymous Gregorian Computus — all algorithmic, no new
  deps. Sunday holidays matter for leagues that play Sundays. Test
  count: vitest 94 → 96.

## 2026-05-04
- Auto-load the D league (`ocsportsplex/4356`) on first visit when there's
  no cached data, so a fresh page no longer requires pasting the URL.
  Clear button still wipes to an empty state for analyzing other leagues.

## 2026-05-03
- Plan-mode polish: renamed the games-per-team input to "Regular-season
  games per team" (with a tooltip + footnote) so it's clear playoffs
  aren't counted; deleting a row from the expanded slot list no longer
  jumps the scroll position back to the top.

## 2026-05-03
- Calendar now highlights US holidays observed in the hockey season window
  (Labor Day → Presidents' Day, plus Halloween / Christmas Eve / NYE / Black
  Friday). New `usHolidays`, `holidaysInRange`, `holidayMap`, and
  `holidayWeekMap` exports in `logic.js`. In plan mode, slot list rows
  display a tag for same-day holidays and a "X week" tag for any other slot
  that falls in the same Mon–Sun week. Generator no longer assigns matchups
  to slots on/after the playoff cutoff (and the polish loop runs with
  `includePlayoffs=false`); UI validation accordingly counts only
  regular-season slots when checking whether the games-per-team target fits.
  Slot-list count display now shows `"X regular + Y playoff"` when a cutoff
  is set. Test counts: vitest 86 → 93.

## 2026-05-03
- Added "Plan new season" mode alongside the existing analyzer. Top-of-page
  toggle switches between loading an existing schedule (URL/paste) and a
  planner panel that takes teams, season window, recurring weekly slot
  pattern (with per-row Every / Odd / Even frequency to support the
  alternating-Monday case), and target games-per-team. The planner expands
  the pattern to a flat slot list the user can edit (bye weeks, time shifts)
  before generating. Generation uses a circle-method round-robin
  (`generateMatchups`) and a greedy slot-assignment + `suggestSwaps` polish
  loop (`generateSchedule`) so the output flows straight into the existing
  dashboard, calendar, heatmap, and swap-list. New pure functions:
  `expandSlotPattern`, `generateMatchups`, `generateSchedule`. State now
  persists `mode` and `planConfig` via localStorage. Switched
  `playwright.config.js` from port 8000 → 8765 (8000 is in use locally).
  Test counts: vitest 69 → 86, Playwright 9 → 10.

## 2026-05-03
- Extracted `parseInputRef` into `src/logic.js` (now takes `defaultCompany`
  as an explicit parameter instead of reading `state.source?.company`).
  Added Playwright coverage for the swap apply/undo flow. Scoped Vitest
  to `tests/**/*.test.js` via `vitest.config.js` so it no longer tries
  to collect Playwright specs. Test counts: vitest 60 → 69, Playwright 7 → 9.

## 2026-05-03
- Added a thin Playwright smoke-test layer (`e2e/smoke.spec.js`, 7 tests,
  ~2s headless Chromium) to catch UI regressions that unit tests can't —
  mainly "did a panel disappear?" Driven through the paste-import path
  with a generated fixture so there's no network dependency. Run via
  `npm run e2e` (separate from `npm test`). Requires a one-time
  `npx playwright install chromium`.

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
