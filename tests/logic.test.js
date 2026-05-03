import { describe, it, expect } from "vitest";
import {
  pad2,
  parseLocal,
  parsePasteDate,
  timeOf,
  bucketOf,
  slotCmp,
  weekKey,
  WEEKDAY,
  uniqueTeams,
  swapDates,
  hasTeamConflict,
  sumBreakdown,
  serializeGame,
  deserializeGame,
  serializeApplied,
  deserializeApplied,
  analyze,
  formatTime24,
  formatSlotKey,
  applyPlayoffCutoff,
  finalizeGames,
  parsePastedText,
  swapCutoffDate,
  suggestSwaps,
  parseInputRef,
} from "../src/logic.js";

function game(id, home, away, date, { isPlayoff = false, location = "Rink 1" } = {}) {
  const d = new Date(date);
  const slotKey = `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return { id, home, away, date: d, location, slotKey, isPlayoff };
}

describe("pad2", () => {
  it("pads single digits with a leading zero", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(5)).toBe("05");
    expect(pad2(9)).toBe("09");
  });
  it("leaves two-digit numbers unchanged", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(59)).toBe("59");
  });
});

describe("parseLocal", () => {
  it("parses bare ISO datetime as local time", () => {
    const d = parseLocal("2025-11-15T19:30");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(30);
  });
  it("respects explicit Z offset (UTC)", () => {
    const d = parseLocal("2025-11-15T19:30:00Z");
    expect(d.getUTCHours()).toBe(19);
  });
  it("returns Invalid Date for empty input", () => {
    expect(isNaN(parseLocal(""))).toBe(true);
    expect(isNaN(parseLocal(null))).toBe(true);
  });
});

describe("parsePasteDate", () => {
  it("parses M/D/YYYY h:mm AM/PM", () => {
    const d = parsePasteDate("11/15/2025 7:30 pm");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(30);
  });
  it("handles 12 AM as midnight and 12 PM as noon", () => {
    expect(parsePasteDate("1/1/2025 12:00 am").getHours()).toBe(0);
    expect(parsePasteDate("1/1/2025 12:00 pm").getHours()).toBe(12);
  });
  it("returns Invalid Date for malformed input", () => {
    expect(isNaN(parsePasteDate("not a date"))).toBe(true);
    expect(isNaN(parsePasteDate("2025-11-15 19:30"))).toBe(true);
  });
});

describe("timeOf", () => {
  it("extracts the HH:MM portion from a slotKey", () => {
    expect(timeOf("Mon 19:30")).toBe("19:30");
    expect(timeOf("Sat 08:00")).toBe("08:00");
  });
});

describe("bucketOf", () => {
  it("classifies early/middle/late by thresholds", () => {
    expect(bucketOf("Mon 18:00", "21:00", "22:00")).toBe("early");
    expect(bucketOf("Mon 21:00", "21:00", "22:00")).toBe("middle");
    expect(bucketOf("Mon 21:30", "21:00", "22:00")).toBe("middle");
    expect(bucketOf("Mon 22:00", "21:00", "22:00")).toBe("late");
    expect(bucketOf("Mon 23:15", "21:00", "22:00")).toBe("late");
  });
});

describe("slotCmp", () => {
  it("orders days Sun..Sat", () => {
    expect(slotCmp("Mon 19:00", "Tue 19:00")).toBeLessThan(0);
    expect(slotCmp("Sat 19:00", "Sun 19:00")).toBeGreaterThan(0);
  });
  it("orders by time within the same day", () => {
    expect(slotCmp("Wed 18:00", "Wed 21:30")).toBeLessThan(0);
    expect(slotCmp("Wed 21:30", "Wed 18:00")).toBeGreaterThan(0);
  });
  it("returns 0 for identical slots", () => {
    expect(slotCmp("Fri 20:00", "Fri 20:00")).toBe(0);
  });
});

describe("weekKey", () => {
  it("anchors to the Monday of that week", () => {
    // Wed Nov 12 2025 -> Mon Nov 10 2025
    expect(weekKey(new Date(2025, 10, 12))).toBe("2025-11-10");
    // Mon itself
    expect(weekKey(new Date(2025, 10, 10))).toBe("2025-11-10");
    // Sunday rolls back to the *previous* Monday
    expect(weekKey(new Date(2025, 10, 16))).toBe("2025-11-10");
  });
  it("handles month and year boundaries", () => {
    // Thu Jan 1 2026 -> Mon Dec 29 2025
    expect(weekKey(new Date(2026, 0, 1))).toBe("2025-12-29");
  });
});

describe("WEEKDAY", () => {
  it("indexes Date#getDay() correctly", () => {
    expect(WEEKDAY[0]).toBe("Sun");
    expect(WEEKDAY[6]).toBe("Sat");
  });
});

describe("uniqueTeams", () => {
  it("returns the sorted union of home and away teams", () => {
    const games = [
      game("1", "B", "A", new Date(2025, 0, 6, 19, 30)),
      game("2", "C", "A", new Date(2025, 0, 13, 19, 30)),
    ];
    expect(uniqueTeams(games)).toEqual(["A", "B", "C"]);
  });
  it("filters falsy team names", () => {
    const games = [game("1", "A", "", new Date(2025, 0, 6, 19, 30))];
    expect(uniqueTeams(games)).toEqual(["A"]);
  });
  it("returns [] for empty input", () => {
    expect(uniqueTeams([])).toEqual([]);
  });
});

describe("swapDates", () => {
  it("swaps date, location, and slotKey between two games", () => {
    const g1 = game("1", "A", "B", new Date(2025, 0, 6, 19, 30), { location: "Rink 1" });
    const g2 = game("2", "C", "D", new Date(2025, 0, 13, 21, 0), { location: "Rink 2" });
    const out = swapDates([g1, g2], 0, 1);
    expect(out[0].date.getTime()).toBe(g2.date.getTime());
    expect(out[0].location).toBe("Rink 2");
    expect(out[0].slotKey).toBe(g2.slotKey);
    expect(out[1].date.getTime()).toBe(g1.date.getTime());
    expect(out[1].location).toBe("Rink 1");
    expect(out[1].slotKey).toBe(g1.slotKey);
  });
  it("preserves home/away/id on the swapped games", () => {
    const g1 = game("1", "A", "B", new Date(2025, 0, 6, 19, 30));
    const g2 = game("2", "C", "D", new Date(2025, 0, 13, 21, 0));
    const out = swapDates([g1, g2], 0, 1);
    expect(out[0].home).toBe("A");
    expect(out[0].away).toBe("B");
    expect(out[0].id).toBe("1");
    expect(out[1].home).toBe("C");
    expect(out[1].away).toBe("D");
  });
  it("does not mutate the input array or its games", () => {
    const g1 = game("1", "A", "B", new Date(2025, 0, 6, 19, 30));
    const g2 = game("2", "C", "D", new Date(2025, 0, 13, 21, 0));
    const original1Date = g1.date.getTime();
    const original2Date = g2.date.getTime();
    swapDates([g1, g2], 0, 1);
    expect(g1.date.getTime()).toBe(original1Date);
    expect(g2.date.getTime()).toBe(original2Date);
  });
});

describe("hasTeamConflict", () => {
  it("returns false when no team appears twice on the same day", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "C", "D", new Date(2025, 0, 6, 21, 0)),
    ];
    expect(hasTeamConflict(games)).toBe(false);
  });
  it("returns true when a team plays twice on the same day", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "A", "C", new Date(2025, 0, 6, 21, 0)),
    ];
    expect(hasTeamConflict(games)).toBe(true);
  });
  it("returns false when the same teams play on different days", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "A", "B", new Date(2025, 0, 13, 19, 30)),
    ];
    expect(hasTeamConflict(games)).toBe(false);
  });
});

describe("sumBreakdown", () => {
  it("sums all seven categories", () => {
    expect(sumBreakdown({
      gameCount: 1, homeAway: 2, slot: 3, b2b: 4, matchup: 5, monday: 6, week: 7,
    })).toBe(28);
  });
  it("treats missing keys as 0", () => {
    expect(sumBreakdown({})).toBe(0);
    expect(sumBreakdown({ b2b: 8 })).toBe(8);
  });
});

describe("serializeGame / deserializeGame", () => {
  it("serializes Date to ISO string", () => {
    const g = game("1", "A", "B", new Date(Date.UTC(2025, 0, 6, 19, 30)));
    const s = serializeGame(g);
    expect(typeof s.date).toBe("string");
    expect(s.date).toBe("2025-01-06T19:30:00.000Z");
    expect(s.home).toBe("A");
  });
  it("round-trips a game", () => {
    const g = game("1", "A", "B", new Date(2025, 0, 6, 19, 30));
    const back = deserializeGame(serializeGame(g));
    expect(back.date instanceof Date).toBe(true);
    expect(back.date.getTime()).toBe(g.date.getTime());
    expect(back.home).toBe("A");
  });
  it("serializeGame leaves a non-Date date untouched", () => {
    const s = serializeGame({ id: "x", home: "A", away: "B", date: "2025-01-06T19:30:00.000Z" });
    expect(s.date).toBe("2025-01-06T19:30:00.000Z");
  });
});

describe("serializeApplied / deserializeApplied", () => {
  it("returns legacy entries (no gameA/gameB) unchanged", () => {
    const legacy = { aId: "1", bId: "2" };
    expect(serializeApplied(legacy)).toBe(legacy);
    expect(deserializeApplied(legacy)).toBe(legacy);
  });
  it("serializes nested gameA/gameB Dates", () => {
    const e = {
      gameA: game("1", "A", "B", new Date(Date.UTC(2025, 0, 6, 19, 30))),
      gameB: game("2", "C", "D", new Date(Date.UTC(2025, 0, 13, 21, 0))),
      delta: 5,
    };
    const s = serializeApplied(e);
    expect(typeof s.gameA.date).toBe("string");
    expect(typeof s.gameB.date).toBe("string");
    expect(s.delta).toBe(5);
  });
  it("round-trips applied entries", () => {
    const e = {
      gameA: game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      gameB: game("2", "C", "D", new Date(2025, 0, 13, 21, 0)),
    };
    const back = deserializeApplied(serializeApplied(e));
    expect(back.gameA.date instanceof Date).toBe(true);
    expect(back.gameA.date.getTime()).toBe(e.gameA.date.getTime());
    expect(back.gameB.date.getTime()).toBe(e.gameB.date.getTime());
  });
  it("deserializeApplied handles null/undefined", () => {
    expect(deserializeApplied(null)).toBe(null);
    expect(deserializeApplied(undefined)).toBe(undefined);
  });
});

describe("analyze", () => {
  it("returns an empty-ish but well-formed result for empty games", () => {
    const a = analyze([], false, {});
    expect(a.teams).toEqual([]);
    expect(a.slots).toEqual([]);
    expect(a.b2b).toEqual([]);
    expect(a.total).toBe(0);
    expect(a.breakdown).toMatchObject({
      gameCount: 0, homeAway: 0, slot: 0, b2b: 0, matchup: 0, monday: 0, week: 0,
    });
  });

  it("scores a perfectly-balanced 2-team home-and-home as W_B2B only", () => {
    // Mon Jan 6 2025 and Mon Jan 13 2025; same slot; A and B alternate H/A.
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "B", "A", new Date(2025, 0, 13, 19, 30)),
    ];
    const a = analyze(games, false, {});
    expect(a.teams).toEqual(["A", "B"]);
    expect(a.gameCount).toEqual({ A: 2, B: 2 });
    expect(a.breakdown.gameCount).toBe(0);
    expect(a.breakdown.homeAway).toBe(0);
    expect(a.breakdown.slot).toBe(0);
    expect(a.breakdown.matchup).toBe(0);
    expect(a.breakdown.monday).toBe(0);
    expect(a.breakdown.week).toBe(0);
    // Both games are A-vs-B in consecutive weeks → 1 unique back-to-back.
    expect(a.b2b.length).toBe(1);
    expect(a.breakdown.b2b).toBe(8); // W_B2B * 1
    expect(a.total).toBe(8);
  });

  it("excludes playoff games from fairness counts when includePlayoffs=false", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30), { isPlayoff: true }),
      game("2", "A", "B", new Date(2025, 0, 13, 19, 30)),
    ];
    const fair = analyze(games, false, {});
    const all = analyze(games, true, {});
    expect(fair.gameCount).toEqual({ A: 1, B: 1 });
    expect(all.gameCount).toEqual({ A: 2, B: 2 });
  });

  it("sorts non-bucket slots via slotCmp (Sun..Sat, then time)", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 7, 21, 30)), // Tue 21:30
      game("2", "C", "D", new Date(2025, 0, 6, 19, 30)), // Mon 19:30
      game("3", "A", "C", new Date(2025, 0, 6, 21, 30)), // Mon 21:30
    ];
    const a = analyze(games, false, {});
    expect(a.slots).toEqual(["Mon 19:30", "Mon 21:30", "Tue 21:30"]);
  });

  it("uses bucket labels when slotView=buckets", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 0)),  // 19:00 → early
      game("2", "C", "D", new Date(2025, 0, 6, 22, 30)), // 22:30 → late
    ];
    const a = analyze(games, false, { slotView: "buckets", earlyEnd: "21:00", lateStart: "22:00" });
    expect(a.slots).toEqual(["early", "late"]);
  });
});

describe("formatTime24", () => {
  it("returns input unchanged in 24h mode", () => {
    expect(formatTime24("19:30", "24h")).toBe("19:30");
    expect(formatTime24("00:00", "24h")).toBe("00:00");
  });
  it("converts to 12h with AM/PM otherwise", () => {
    expect(formatTime24("00:00", "12h")).toBe("12:00 AM");
    expect(formatTime24("00:30", "12h")).toBe("12:30 AM");
    expect(formatTime24("11:59", "12h")).toBe("11:59 AM");
    expect(formatTime24("12:00", "12h")).toBe("12:00 PM");
    expect(formatTime24("12:30", "12h")).toBe("12:30 PM");
    expect(formatTime24("13:30", "12h")).toBe("1:30 PM");
    expect(formatTime24("23:59", "12h")).toBe("11:59 PM");
  });
});

describe("formatSlotKey", () => {
  it("formats the time portion while preserving the day", () => {
    expect(formatSlotKey("Mon 19:30", "24h")).toBe("Mon 19:30");
    expect(formatSlotKey("Mon 19:30", "12h")).toBe("Mon 7:30 PM");
    expect(formatSlotKey("Sat 22:00", "12h")).toBe("Sat 10:00 PM");
  });
  it("returns the input unchanged when there is no space", () => {
    expect(formatSlotKey("bucket", "12h")).toBe("bucket");
  });
});

describe("applyPlayoffCutoff", () => {
  function mkGame(date, apiPlayoff = false) {
    return { date, _apiPlayoff: apiPlayoff, isPlayoff: false };
  }
  it("flags games on or after the cutoff", () => {
    const games = [
      mkGame(new Date(2025, 0, 1)),
      mkGame(new Date(2025, 1, 15)),
      mkGame(new Date(2025, 2, 1)),
    ];
    applyPlayoffCutoff(games, "2025-02-01T00:00");
    expect(games.map(g => g.isPlayoff)).toEqual([false, true, true]);
  });
  it("respects the _apiPlayoff flag even with no cutoff", () => {
    const games = [
      mkGame(new Date(2025, 0, 1), true),
      mkGame(new Date(2025, 0, 2)),
    ];
    applyPlayoffCutoff(games, null);
    expect(games[0].isPlayoff).toBe(true);
    expect(games[1].isPlayoff).toBe(false);
  });
  it("recomputes (not just sets) isPlayoff — clearing cutoff unflags non-API games", () => {
    const games = [mkGame(new Date(2025, 0, 1))];
    applyPlayoffCutoff(games, "2024-12-01T00:00");
    expect(games[0].isPlayoff).toBe(true);
    applyPlayoffCutoff(games, null);
    expect(games[0].isPlayoff).toBe(false);
  });
  it("mutates the input array in place", () => {
    const games = [{ date: new Date(2025, 0, 1), _apiPlayoff: false, isPlayoff: false }];
    const result = applyPlayoffCutoff(games, "2024-12-01T00:00");
    expect(result).toBeUndefined();
    expect(games[0].isPlayoff).toBe(true);
  });
});

describe("finalizeGames", () => {
  it("sorts games by date and populates slotKey", () => {
    const games = [
      { id: "2", home: "A", away: "B", date: new Date(2025, 0, 13, 19, 30), isPlayoff: false, _apiPlayoff: false },
      { id: "1", home: "C", away: "D", date: new Date(2025, 0, 6, 21, 0), isPlayoff: false, _apiPlayoff: false },
    ];
    finalizeGames(games, null);
    expect(games[0].id).toBe("1");
    expect(games[0].slotKey).toBe("Mon 21:00");
    expect(games[1].id).toBe("2");
    expect(games[1].slotKey).toBe("Mon 19:30");
  });
  it("applies the playoff cutoff during finalization", () => {
    const games = [
      { id: "1", home: "A", away: "B", date: new Date(2025, 0, 6, 19, 30), isPlayoff: false, _apiPlayoff: false },
      { id: "2", home: "A", away: "B", date: new Date(2025, 1, 17, 19, 30), isPlayoff: false, _apiPlayoff: false },
    ];
    finalizeGames(games, "2025-02-01T00:00");
    expect(games[0].isPlayoff).toBe(false);
    expect(games[1].isPlayoff).toBe(true);
  });
});

describe("parsePastedText", () => {
  it("parses 3-line records", () => {
    const text = [
      "Pylons\tNailers",
      "Rink 1",
      "1/6/2025 7:30 pm",
      "Brewins\tIce Aged",
      "Rink 2",
      "1/13/2025 9:00 pm",
    ].join("\n");
    const games = parsePastedText(text, null);
    expect(games.length).toBe(2);
    expect(games[0].home).toBe("Pylons");
    expect(games[0].away).toBe("Nailers");
    expect(games[0].location).toBe("Rink 1");
    expect(games[0].slotKey).toBe("Mon 19:30");
    expect(games[1].home).toBe("Brewins");
    expect(games[1].slotKey).toBe("Mon 21:00");
  });
  it("skips pagination markers and header lines", () => {
    const text = [
      "1",
      "« 2 (current) »",
      "home\taway\ttime",
      "Pylons\tNailers",
      "Rink 1",
      "1/6/2025 7:30 pm",
    ].join("\n");
    const games = parsePastedText(text, null);
    expect(games.length).toBe(1);
    expect(games[0].home).toBe("Pylons");
  });
  it("honors the playoff cutoff", () => {
    const text = [
      "A\tB",
      "Rink 1",
      "1/6/2025 7:30 pm",
      "A\tB",
      "Rink 1",
      "2/17/2025 9:00 pm",
    ].join("\n");
    const games = parsePastedText(text, "2025-02-01T00:00");
    expect(games[0].isPlayoff).toBe(false);
    expect(games[1].isPlayoff).toBe(true);
  });
});

describe("swapCutoffDate", () => {
  it("returns the start of the Monday after next, local midnight", () => {
    // Wed Jan 1 2025 → next Mon = Jan 6, Monday after next = Jan 13
    const cutoff = swapCutoffDate(new Date(2025, 0, 1, 14, 30));
    expect(cutoff.getFullYear()).toBe(2025);
    expect(cutoff.getMonth()).toBe(0);
    expect(cutoff.getDate()).toBe(13);
    expect(cutoff.getHours()).toBe(0);
    expect(cutoff.getMinutes()).toBe(0);
  });
  it("when 'now' is a Monday, advances 14 days", () => {
    // Mon Jan 6 2025 → Jan 20
    const cutoff = swapCutoffDate(new Date(2025, 0, 6, 12, 0));
    expect(cutoff.getDate()).toBe(20);
  });
  it("when 'now' is a Sunday, advances 8 days", () => {
    // Sun Jan 5 2025 → Mon Jan 13
    const cutoff = swapCutoffDate(new Date(2025, 0, 5, 12, 0));
    expect(cutoff.getDate()).toBe(13);
  });
  it("uses Date.now() when called with no argument", () => {
    expect(swapCutoffDate() instanceof Date).toBe(true);
  });
});

describe("suggestSwaps", () => {
  it("returns [] when no swap improves the schedule", () => {
    // 3-team round-robin already has 0 b2b penalty; nothing to gain.
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "A", "C", new Date(2025, 0, 13, 19, 30)),
      game("3", "B", "C", new Date(2025, 0, 20, 19, 30)),
    ];
    expect(suggestSwaps(games, false, {})).toEqual([]);
  });

  it("finds a swap that breaks up a back-to-back", () => {
    // A's first two games are both vs B (b2b penalty 8). Swapping game 2
    // (B-A) with game 4 (B-D) puts game 3 (A-C) between them, breaking
    // both A's and B's same-opponent consecutive streaks.
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "B", "A", new Date(2025, 0, 13, 19, 30)),
      game("3", "A", "C", new Date(2025, 0, 20, 19, 30)),
      game("4", "B", "D", new Date(2025, 0, 27, 19, 30)),
    ];
    const out = suggestSwaps(games, false, {});
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].delta).toBeGreaterThan(0);
    // The fix should swap dates between games 2 and 4.
    const top = out[0];
    expect([top.i, top.j].sort()).toEqual([1, 3]);
  });

  it("respects opts.cutoffMs by skipping pre-cutoff games", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "B", "A", new Date(2025, 0, 13, 19, 30)),
      game("3", "C", "D", new Date(2025, 0, 20, 19, 30)),
    ];
    // Cutoff after all games → no swaps eligible.
    const cutoffMs = new Date(2025, 1, 1).getTime();
    expect(suggestSwaps(games, false, { cutoffMs })).toEqual([]);
  });

  it("caps the result at `max`", () => {
    const games = [
      game("1", "A", "B", new Date(2025, 0, 6, 19, 30)),
      game("2", "B", "A", new Date(2025, 0, 13, 19, 30)),
      game("3", "A", "B", new Date(2025, 0, 20, 19, 30)),
      game("4", "C", "D", new Date(2025, 0, 27, 19, 30)),
      game("5", "C", "D", new Date(2025, 1, 3, 19, 30)),
    ];
    const out = suggestSwaps(games, false, {}, 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe("parseInputRef", () => {
  it("parses a full DaySmart league URL", () => {
    expect(parseInputRef("https://app.daysmartrecreation.com/dash/online/tahl/leagues/12345"))
      .toEqual({ company: "tahl", leagueId: "12345" });
  });
  it("parses a slash-form 'company/id'", () => {
    expect(parseInputRef("tahl/12345")).toEqual({ company: "tahl", leagueId: "12345" });
  });
  it("parses a comma-form 'company,id'", () => {
    expect(parseInputRef("tahl,12345")).toEqual({ company: "tahl", leagueId: "12345" });
  });
  it("parses a space-form 'company id'", () => {
    expect(parseInputRef("tahl 12345")).toEqual({ company: "tahl", leagueId: "12345" });
  });
  it("uses defaultCompany for a bare league id", () => {
    expect(parseInputRef("12345", "tahl")).toEqual({ company: "tahl", leagueId: "12345" });
  });
  it("returns null for a bare id without defaultCompany", () => {
    expect(parseInputRef("12345")).toBeNull();
    expect(parseInputRef("12345", null)).toBeNull();
    expect(parseInputRef("12345", "")).toBeNull();
  });
  it("returns null for empty / whitespace / null input", () => {
    expect(parseInputRef("")).toBeNull();
    expect(parseInputRef("   ")).toBeNull();
    expect(parseInputRef(null)).toBeNull();
    expect(parseInputRef(undefined)).toBeNull();
  });
  it("returns null for unrecognized input", () => {
    expect(parseInputRef("not a url")).toBeNull();
    expect(parseInputRef("hello world")).toBeNull();
  });
  it("trims surrounding whitespace", () => {
    expect(parseInputRef("  tahl/12345  ")).toEqual({ company: "tahl", leagueId: "12345" });
  });
});
