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
  expandSlotPattern,
  generateMatchups,
  generateSchedule,
  usHolidays,
  holidaysInRange,
  holidayMap,
  holidayWeekMap,
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

describe("expandSlotPattern", () => {
  // Sep 7 2026 is a Monday. Use this as a stable anchor across these tests.
  const MON_2026_09_07 = new Date(2026, 8, 7);

  it("returns empty for missing inputs", () => {
    expect(expandSlotPattern([], MON_2026_09_07, new Date(2026, 8, 30))).toEqual([]);
    expect(expandSlotPattern([{ weekday: 1, time: "20:00", location: "X", frequency: "every" }],
      null, new Date(2026, 8, 30))).toEqual([]);
  });

  it("expands a single weekly pattern across the window inclusively", () => {
    const out = expandSlotPattern(
      [{ weekday: 1, time: "21:00", location: "Rink A", frequency: "every" }],
      MON_2026_09_07,
      new Date(2026, 8, 28),  // Mon Sep 28
    );
    expect(out).toHaveLength(4);
    expect(out.map(s => s.date.getDate())).toEqual([7, 14, 21, 28]);
    expect(out.every(s => s.date.getDay() === 1)).toBe(true);
    expect(out.every(s => s.date.getHours() === 21 && s.date.getMinutes() === 0)).toBe(true);
    expect(out.every(s => s.location === "Rink A")).toBe(true);
  });

  it("starts at the first matching weekday at-or-after startDate", () => {
    // Start on Wed, ask for Mondays — first Mon should be the next one.
    const out = expandSlotPattern(
      [{ weekday: 1, time: "20:00", location: "L", frequency: "every" }],
      new Date(2026, 8, 9),   // Wed Sep 9
      new Date(2026, 8, 21),  // Mon Sep 21
    );
    expect(out.map(s => s.date.getDate())).toEqual([14, 21]);
  });

  it("odd and even frequencies produce disjoint, complementary date sets", () => {
    const range = [MON_2026_09_07, new Date(2026, 9, 5)];  // Sep 7 .. Oct 5 (5 Mondays)
    const odd = expandSlotPattern(
      [{ weekday: 1, time: "20:00", location: "A", frequency: "odd" }],
      range[0], range[1],
    );
    const even = expandSlotPattern(
      [{ weekday: 1, time: "20:00", location: "A", frequency: "even" }],
      range[0], range[1],
    );
    expect(odd.map(s => s.date.getDate())).toEqual([7, 21, 5]);
    expect(even.map(s => s.date.getDate())).toEqual([14, 28]);
    const oddSet = new Set(odd.map(s => s.date.getTime()));
    const evenSet = new Set(even.map(s => s.date.getTime()));
    for (const t of oddSet) expect(evenSet.has(t)).toBe(false);
  });

  it("merges and chronologically sorts across multiple patterns", () => {
    // Mon 21:00 + Wed 20:00 over two weeks
    const out = expandSlotPattern([
      { weekday: 1, time: "21:00", location: "A", frequency: "every" },
      { weekday: 3, time: "20:00", location: "B", frequency: "every" },
    ], MON_2026_09_07, new Date(2026, 8, 16));  // Sep 7 .. Wed Sep 16
    expect(out.map(s => `${s.date.getMonth()+1}/${s.date.getDate()} ${s.date.getHours()}:${String(s.date.getMinutes()).padStart(2,"0")} ${s.location}`)).toEqual([
      "9/7 21:00 A",
      "9/9 20:00 B",
      "9/14 21:00 A",
      "9/16 20:00 B",
    ]);
  });

  it("supports two same-weekday rows alternating odd/even (the user's monday case)", () => {
    const out = expandSlotPattern([
      { weekday: 1, time: "21:00", location: "Rink A", frequency: "odd" },
      { weekday: 1, time: "22:00", location: "Rink A", frequency: "even" },
    ], MON_2026_09_07, new Date(2026, 8, 28));  // 4 Mondays
    expect(out).toHaveLength(4);
    // Each Monday has exactly one slot, alternating times.
    expect(out[0].date.getHours()).toBe(21);
    expect(out[1].date.getHours()).toBe(22);
    expect(out[2].date.getHours()).toBe(21);
    expect(out[3].date.getHours()).toBe(22);
  });

  it("returns empty when end < start", () => {
    expect(expandSlotPattern(
      [{ weekday: 1, time: "20:00", location: "L", frequency: "every" }],
      new Date(2026, 8, 14), new Date(2026, 8, 7),
    )).toEqual([]);
  });
});

describe("generateMatchups", () => {
  it("returns empty for trivial inputs", () => {
    expect(generateMatchups(0, 10)).toEqual([]);
    expect(generateMatchups(1, 10)).toEqual([]);
    expect(generateMatchups(8, 0)).toEqual([]);
  });

  it("each team plays exactly target games (even N)", () => {
    const m = generateMatchups(8, 14);
    const counts = new Array(8).fill(0);
    for (const [a, b] of m) { counts[a]++; counts[b]++; }
    expect(counts.every(c => c === 14)).toBe(true);
    expect(m.length).toBe(8 * 14 / 2);
  });

  it("home/away counts are within ±1 per team (even N)", () => {
    const m = generateMatchups(8, 14);
    const home = new Array(8).fill(0);
    const away = new Array(8).fill(0);
    for (const [h, a] of m) { home[h]++; away[a]++; }
    for (let i = 0; i < 8; i++) {
      expect(Math.abs(home[i] - away[i])).toBeLessThanOrEqual(1);
    }
  });

  it("produces a complete double round-robin when target = 2*(N-1)", () => {
    // 6 teams × 10 games = 30 = 6*5 = each pair plays twice.
    const m = generateMatchups(6, 10);
    const pairCount = {};
    for (const [a, b] of m) {
      const k = [a, b].sort().join(",");
      pairCount[k] = (pairCount[k] || 0) + 1;
    }
    const counts = Object.values(pairCount);
    expect(counts.length).toBe(15);  // C(6, 2)
    expect(counts.every(c => c === 2)).toBe(true);
  });

  it("handles odd N by giving each team a bye each round", () => {
    // 7 teams, target 6 = single round-robin (each plays 6 others).
    const m = generateMatchups(7, 6);
    const counts = new Array(7).fill(0);
    for (const [a, b] of m) { counts[a]++; counts[b]++; }
    expect(counts.every(c => c === 6)).toBe(true);
    expect(m.length).toBe(7 * 6 / 2);
  });
});

describe("generateSchedule", () => {
  function pat(weekday, time, location, frequency = "every") {
    return { weekday, time, location, frequency };
  }

  it("returns empty for missing inputs", () => {
    expect(generateSchedule([], [{ date: new Date(), location: "X" }], 10)).toEqual([]);
    expect(generateSchedule(["A", "B"], [], 10)).toEqual([]);
  });

  it("produces games in the existing schema with slotKey populated", () => {
    const slots = expandSlotPattern(
      [pat(1, "21:00", "Rink A"), pat(3, "20:00", "Rink B")],
      new Date(2026, 8, 7), new Date(2026, 11, 7),
    );
    const games = generateSchedule(["A", "B", "C", "D"], slots, 6, { polish: false });
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      expect(g.id).toMatch(/^gen-/);
      expect(g.date instanceof Date).toBe(true);
      expect(typeof g.slotKey).toBe("string");
      expect(g.slotKey).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/);
      expect(g.home).toBeTruthy();
      expect(g.away).toBeTruthy();
      expect(g.home).not.toBe(g.away);
      expect(g._apiPlayoff).toBe(false);
    }
  });

  it("never schedules a team in two games on the same calendar day", () => {
    // Force conflicts: 4 teams, 3 slots per day.
    const slots = [
      { date: new Date(2026, 8, 7, 20, 0), location: "A" },
      { date: new Date(2026, 8, 7, 21, 0), location: "A" },
      { date: new Date(2026, 8, 7, 22, 0), location: "A" },
      { date: new Date(2026, 8, 14, 20, 0), location: "A" },
      { date: new Date(2026, 8, 14, 21, 0), location: "A" },
    ];
    const games = generateSchedule(["A", "B", "C", "D"], slots, 5, { polish: false });
    const byDay = new Map();
    for (const g of games) {
      const k = g.date.toDateString();
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(g);
    }
    for (const [, dayGames] of byDay) {
      const teams = [];
      for (const g of dayGames) teams.push(g.home, g.away);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("does not generate any matchups for slots on/after the playoff cutoff", () => {
    const slots = expandSlotPattern(
      [pat(1, "20:00", "A")],
      new Date(2026, 8, 7), new Date(2026, 10, 30),
    );
    const cutoff = "2026-11-01";
    const cutoffMs = new Date(cutoff).getTime();
    const games = generateSchedule(["A", "B", "C", "D"], slots, 4, { polish: false, playoffCutoff: cutoff });
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      expect(g.date.getTime()).toBeLessThan(cutoffMs);
      expect(g.isPlayoff).toBe(false);
    }
  });

  it("polish step does not increase total penalty", () => {
    const slots = expandSlotPattern(
      [pat(1, "20:00", "A"), pat(1, "21:00", "A"), pat(3, "20:00", "B")],
      new Date(2026, 8, 7), new Date(2026, 10, 30),
    );
    const teams = ["A", "B", "C", "D", "E", "F"];
    const target = 8;
    const noPolish = generateSchedule(teams, slots, target, { polish: false });
    const withPolish = generateSchedule(teams, slots, target, { polish: true, polishMaxIters: 5 });
    const opts = { slotView: "buckets", earlyEnd: "21:00", lateStart: "22:00" };
    const before = analyze(noPolish, true, opts).total;
    const after = analyze(withPolish, true, opts).total;
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe("usHolidays", () => {
  it("computes Thanksgiving as the 4th Thursday of November", () => {
    const h2026 = usHolidays(2026).find(h => h.name === "Thanksgiving");
    // 2026-11-26 is a Thursday and is the 4th Thursday of November.
    expect(h2026.date.getFullYear()).toBe(2026);
    expect(h2026.date.getMonth()).toBe(10);
    expect(h2026.date.getDate()).toBe(26);
    expect(h2026.date.getDay()).toBe(4);

    const h2024 = usHolidays(2024).find(h => h.name === "Thanksgiving");
    expect(h2024.date.getDate()).toBe(28);  // 2024-11-28
  });

  it("computes Labor Day as the 1st Monday of September", () => {
    const h = usHolidays(2026).find(d => d.name === "Labor Day");
    expect(h.date.getDate()).toBe(7);  // 2026-09-07
    expect(h.date.getDay()).toBe(1);
  });

  it("includes fixed-date holidays", () => {
    const h = usHolidays(2026);
    const veterans = h.find(d => d.name === "Veterans Day");
    expect(veterans.date.getDate()).toBe(11);
    expect(veterans.date.getMonth()).toBe(10);
    const xmas = h.find(d => d.name === "Christmas Day");
    expect(xmas.date.getDate()).toBe(25);
    const juneteenth = h.find(d => d.name === "Juneteenth");
    expect(juneteenth.date.getMonth()).toBe(5);
    expect(juneteenth.date.getDate()).toBe(19);
    const july4 = h.find(d => d.name === "Independence Day");
    expect(july4.date.getMonth()).toBe(6);
    expect(july4.date.getDate()).toBe(4);
  });

  it("computes Easter via Computus (spot-check known dates)", () => {
    // Reference values from the US Naval Observatory / standard tables.
    const cases = [
      { year: 2024, month: 2, day: 31 }, // 2024-03-31
      { year: 2025, month: 3, day: 20 }, // 2025-04-20
      { year: 2026, month: 3, day: 5 },  // 2026-04-05
      { year: 2027, month: 2, day: 28 }, // 2027-03-28
      { year: 2030, month: 3, day: 21 }, // 2030-04-21
    ];
    for (const { year, month, day } of cases) {
      const easter = usHolidays(year).find(d => d.name === "Easter");
      expect(easter.date.getMonth()).toBe(month);
      expect(easter.date.getDate()).toBe(day);
      expect(easter.date.getDay()).toBe(0); // always Sunday
    }
  });

  it("computes Mother's Day and Father's Day as Sundays", () => {
    const h = usHolidays(2026);
    const mom = h.find(d => d.name === "Mother's Day");
    expect(mom.date.getMonth()).toBe(4);
    expect(mom.date.getDate()).toBe(10); // 2nd Sun of May 2026
    expect(mom.date.getDay()).toBe(0);
    const dad = h.find(d => d.name === "Father's Day");
    expect(dad.date.getMonth()).toBe(5);
    expect(dad.date.getDate()).toBe(21); // 3rd Sun of Jun 2026
    expect(dad.date.getDay()).toBe(0);
  });

  it("computes Memorial Day as the last Monday of May", () => {
    // 2026-05-25 is a Monday and the last Monday of May 2026.
    const h2026 = usHolidays(2026).find(d => d.name === "Memorial Day");
    expect(h2026.date.getMonth()).toBe(4);
    expect(h2026.date.getDate()).toBe(25);
    expect(h2026.date.getDay()).toBe(1);
    // 2027-05-31 is itself a Monday — last-Monday math must include May 31.
    const h2027 = usHolidays(2027).find(d => d.name === "Memorial Day");
    expect(h2027.date.getDate()).toBe(31);
    expect(h2027.date.getDay()).toBe(1);
  });
});

describe("holidaysInRange", () => {
  it("returns only holidays within the given window, spanning year boundaries", () => {
    // Hockey season: Sep 1 2026 → Mar 31 2027. Should include both Thanksgiving
    // 2026 and MLK Day 2027 but exclude Independence Day in either year.
    const out = holidaysInRange(new Date(2026, 8, 1), new Date(2027, 2, 31));
    const names = out.map(h => h.name);
    expect(names).toContain("Labor Day");
    expect(names).toContain("Thanksgiving");
    expect(names).toContain("Christmas Day");
    expect(names).toContain("New Year's Day");
    expect(names).toContain("MLK Day");
    expect(names).toContain("Presidents' Day");
    // No duplicates from the year-boundary scan.
    const uniq = new Set(names);
    expect(uniq.size).toBe(names.length);
  });

  it("returns empty for invalid ranges", () => {
    expect(holidaysInRange(new Date(2026, 10, 1), new Date(2026, 9, 1))).toEqual([]);
    expect(holidaysInRange(null, new Date())).toEqual([]);
  });

  it("includes a same-day holiday even when the bound has a later time-of-day", () => {
    // The first slot of a typical season starts at 21:00 on Labor Day Mon Sep 7
    // 2026. Labor Day's date object is at 00:00, so a strict >= comparison
    // would exclude it; we want day-granularity inclusion.
    const out = holidaysInRange(new Date(2026, 8, 7, 21, 0), new Date(2026, 9, 5, 22, 0));
    expect(out.map(h => h.name)).toContain("Labor Day");
  });
});

describe("holidayMap and holidayWeekMap", () => {
  it("flags Thanksgiving on the day and the surrounding Mon–Sun week", () => {
    const range = [new Date(2026, 10, 1), new Date(2026, 10, 30)];
    const dayMap = holidayMap(range[0], range[1]);
    const wkMap = holidayWeekMap(range[0], range[1]);
    const thx = new Date(2026, 10, 26);
    expect(dayMap.get(thx.toDateString())).toBe("Thanksgiving");
    // The Monday of Thanksgiving week is 2026-11-23.
    const wk = "2026-11-23";
    expect(wkMap.get(wk)).toContain("Thanksgiving");
    // The week of 2026-11-16 (Mon) sits between Veterans Day and Thanksgiving
    // and has no holiday — its key should not appear at all.
    expect(wkMap.has("2026-11-16")).toBe(false);
  });
});
