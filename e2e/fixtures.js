// Far-future Mondays so they always sit past swapCutoffDate(now), regardless
// of when these tests run. The 4-game shape is deliberately b2b-improvable
// (mirrors the suggestSwaps fixture in tests/logic.test.js): A and B play
// each other in weeks 1+2 (back-to-back), then A-C and B-D in weeks 3+4.
// Swapping game 2 with game 4 dissolves both teams' same-opponent streaks.
export const PASTE_FIXTURE = [
  ["A", "B", "Rink 1", "1/7/2030 7:30 pm"],
  ["B", "A", "Rink 1", "1/14/2030 7:30 pm"],
  ["A", "C", "Rink 1", "1/21/2030 7:30 pm"],
  ["B", "D", "Rink 1", "1/28/2030 7:30 pm"],
]
  .map(([h, a, loc, dt]) => `${h}\t${a}\n${loc}\n${dt}`)
  .join("\n");

export const FIXTURE_GAME_COUNT = 4;
