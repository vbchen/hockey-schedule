export const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const W_GAMECOUNT = 4;
const W_HOMEAWAY = 1;
const W_SLOT = 1;
const W_B2B = 8;
const W_MATCHUP = 3;
const W_MONDAY = 3;
const W_WEEK = 3;

const BUCKET_ORDER = ["early", "middle", "late"];

export function pad2(n) { return String(n).padStart(2, "0"); }

export function parseLocal(iso) {
  if (!iso) return new Date(NaN);
  if (/Z|[+\-]\d\d:?\d\d$/.test(iso)) return new Date(iso);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(iso);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

export function parsePasteDate(s) {
  const m = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap]m)\s*$/i);
  if (!m) return new Date(NaN);
  let [, mo, da, yr, hh, mm, ap] = m;
  hh = +hh; if (ap.toLowerCase() === "pm" && hh !== 12) hh += 12;
  if (ap.toLowerCase() === "am" && hh === 12) hh = 0;
  return new Date(+yr, +mo - 1, +da, hh, +mm);
}

export function timeOf(slotKey) {
  const t = slotKey.split(" ")[1];
  return t;
}

export function bucketOf(slotKey, earlyEnd, lateStart) {
  const t = timeOf(slotKey);
  if (t < earlyEnd) return "early";
  if (t >= lateStart) return "late";
  return "middle";
}

export function slotCmp(a, b) {
  const order = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const [da, ta] = a.split(" ");
  const [db, tb] = b.split(" ");
  return (order[da] - order[db]) || ta.localeCompare(tb);
}

export function weekKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function uniqueTeams(games) {
  const set = new Set();
  for (const g of games) { set.add(g.home); set.add(g.away); }
  return [...set].filter(Boolean).sort();
}

export function swapDates(games, i, j) {
  const out = games.map(g => ({ ...g }));
  const tmpDate = out[i].date, tmpLoc = out[i].location, tmpSlot = out[i].slotKey;
  out[i].date = out[j].date; out[i].location = out[j].location; out[i].slotKey = out[j].slotKey;
  out[j].date = tmpDate; out[j].location = tmpLoc; out[j].slotKey = tmpSlot;
  return out;
}

export function hasTeamConflict(games) {
  const byDay = {};
  for (const g of games) {
    const k = g.date.toDateString();
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(g);
  }
  for (const k of Object.keys(byDay)) {
    const teams = [];
    for (const g of byDay[k]) { teams.push(g.home, g.away); }
    if (new Set(teams).size !== teams.length) return true;
  }
  return false;
}

export function sumBreakdown(b) {
  return (b.gameCount || 0) + (b.homeAway || 0) + (b.slot || 0)
    + (b.b2b || 0) + (b.matchup || 0) + (b.monday || 0) + (b.week || 0);
}

export function serializeGame(g) {
  return { ...g, date: g.date instanceof Date ? g.date.toISOString() : g.date };
}

export function deserializeGame(g) {
  return { ...g, date: new Date(g.date) };
}

export function serializeApplied(e) {
  if (!e.gameA || !e.gameB) return e;
  return {
    ...e,
    gameA: { ...e.gameA, date: e.gameA.date instanceof Date ? e.gameA.date.toISOString() : e.gameA.date },
    gameB: { ...e.gameB, date: e.gameB.date instanceof Date ? e.gameB.date.toISOString() : e.gameB.date },
  };
}

export function deserializeApplied(e) {
  if (!e || !e.gameA || !e.gameB) return e;
  return {
    ...e,
    gameA: { ...e.gameA, date: new Date(e.gameA.date) },
    gameB: { ...e.gameB, date: new Date(e.gameB.date) },
  };
}

export function parseInputRef(s, defaultCompany) {
  s = (s || "").trim();
  if (!s) return null;
  let m = s.match(/online\/([a-z0-9_-]+)\/leagues\/(\d+)/i);
  if (m) return { company: m[1], leagueId: m[2] };
  m = s.match(/^([a-z0-9_-]+)[\/\s,]+(\d+)$/i);
  if (m) return { company: m[1], leagueId: m[2] };
  m = s.match(/^(\d+)$/);
  if (m && defaultCompany) return { company: defaultCompany, leagueId: m[1] };
  return null;
}

export function formatTime24(t, timeFormat) {
  if (timeFormat === "24h") return t;
  const [hh, mm] = t.split(":").map(Number);
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${pad2(mm)} ${ap}`;
}

export function formatSlotKey(slotKey, timeFormat) {
  const sp = slotKey.indexOf(" ");
  if (sp < 0) return slotKey;
  return slotKey.slice(0, sp) + " " + formatTime24(slotKey.slice(sp + 1), timeFormat);
}

export function applyPlayoffCutoff(games, cutoff) {
  const cutoffMs = cutoff ? new Date(cutoff).getTime() : null;
  for (const g of games) {
    const fromApi = g._apiPlayoff === true;
    const fromCutoff = cutoffMs != null && g.date.getTime() >= cutoffMs;
    g.isPlayoff = fromApi || fromCutoff;
  }
}

export function finalizeGames(games, cutoff) {
  games.sort((a, b) => a.date - b.date);
  for (const g of games) {
    g.slotKey = `${WEEKDAY[g.date.getDay()]} ${pad2(g.date.getHours())}:${pad2(g.date.getMinutes())}`;
  }
  applyPlayoffCutoff(games, cutoff);
}

export function parsePastedText(text, cutoff) {
  const PAGINATION = /^\s*(«|»|…|\.\.\.|\d+\s*\(current\)|\d+)\s*$/;
  const HEADER = /home\s*\t.*away/i;

  const lines = text.split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => !PAGINATION.test(s))
    .filter(s => !HEADER.test(s));

  const games = [];
  for (let i = 0; i + 2 < lines.length; ) {
    const teamLine = lines[i];
    const locLine = lines[i + 1];
    const dtLine = lines[i + 2];
    const fields = teamLine.split(/\t+/).map(s => s.trim()).filter(Boolean);
    const dt = parsePasteDate(dtLine);
    if (fields.length >= 2 && !isNaN(dt)) {
      games.push({
        id: `paste-${games.length + 1}`,
        date: dt,
        home: fields[0],
        away: fields[1],
        location: locLine,
        _apiPlayoff: false,
        isPlayoff: false,
        slotKey: null,
      });
      i += 3;
    } else {
      i += 1;
    }
  }
  finalizeGames(games, cutoff);
  return games;
}

export function swapCutoffDate(now = new Date()) {
  const day = now.getDay();
  const daysUntilNextMonday = day === 0 ? 1 : (8 - day);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilNextMonday + 7);
}

export function suggestSwaps(games, includePlayoffs, opts, max = 10) {
  const baseAnalysis = analyze(games, includePlayoffs, opts);
  const baseTotal = baseAnalysis.total;
  const cutoffMs = opts.cutoffMs || 0;
  const suggestions = [];
  for (let i = 0; i < games.length; i++) {
    if (games[i].date.getTime() < cutoffMs) continue;
    for (let j = i + 1; j < games.length; j++) {
      if (games[j].date.getTime() < cutoffMs) continue;
      if (games[i].date.getTime() === games[j].date.getTime()) continue;
      const swapped = swapDates(games, i, j);
      if (hasTeamConflict(swapped)) continue;
      const aft = analyze(swapped, includePlayoffs, opts);
      const delta = baseTotal - aft.total;
      if (delta > 1e-6) {
        suggestions.push({
          i, j, delta,
          before: baseAnalysis.breakdown,
          after: aft.breakdown,
        });
      }
    }
  }
  suggestions.sort((a, b) => b.delta - a.delta);
  return suggestions.slice(0, max);
}

export function usHolidays(year) {
  function nthDayOfMonth(month, weekday, n) {
    const first = new Date(year, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month, 1 + offset + (n - 1) * 7);
  }
  const thx = nthDayOfMonth(10, 4, 4);
  return [
    { date: nthDayOfMonth(8, 1, 1), name: "Labor Day" },
    { date: nthDayOfMonth(9, 1, 2), name: "Indigenous Peoples' Day" },
    { date: new Date(year, 9, 31), name: "Halloween" },
    { date: new Date(year, 10, 11), name: "Veterans Day" },
    { date: thx, name: "Thanksgiving" },
    { date: new Date(year, 10, thx.getDate() + 1), name: "Black Friday" },
    { date: new Date(year, 11, 24), name: "Christmas Eve" },
    { date: new Date(year, 11, 25), name: "Christmas Day" },
    { date: new Date(year, 11, 31), name: "New Year's Eve" },
    { date: new Date(year, 0, 1), name: "New Year's Day" },
    { date: nthDayOfMonth(0, 1, 3), name: "MLK Day" },
    { date: nthDayOfMonth(1, 1, 3), name: "Presidents' Day" },
  ];
}

export function holidaysInRange(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return [];
  // Day-granularity bounds — usHolidays returns dates at 00:00, so a slot at
  // e.g. 21:00 on the same day must still include that day's holiday.
  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
  const out = [];
  for (let y = startDay.getFullYear(); y <= endDay.getFullYear(); y++) {
    for (const h of usHolidays(y)) {
      if (h.date >= startDay && h.date <= endDay) out.push(h);
    }
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}

export function holidayMap(startDate, endDate) {
  const m = new Map();
  for (const h of holidaysInRange(startDate, endDate)) {
    m.set(h.date.toDateString(), h.name);
  }
  return m;
}

export function holidayWeekMap(startDate, endDate) {
  const m = new Map();
  for (const h of holidaysInRange(startDate, endDate)) {
    const wk = weekKey(h.date);
    if (!m.has(wk)) m.set(wk, []);
    m.get(wk).push(h.name);
  }
  return m;
}

export function expandSlotPattern(patterns, startDate, endDate) {
  if (!startDate || !endDate || !(patterns && patterns.length)) return [];
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  if (end < start) return [];
  const out = [];
  for (const p of patterns) {
    const wd = +p.weekday;
    const tm = (p.time || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!tm) continue;
    const hh = +tm[1], mm = +tm[2];
    const freq = p.frequency || "every";
    const offset = (wd - start.getDay() + 7) % 7;
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    let idx = 1;
    while (cur <= end) {
      const include =
        freq === "every" ||
        (freq === "odd" && (idx % 2) === 1) ||
        (freq === "even" && (idx % 2) === 0);
      if (include) {
        out.push({
          date: new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), hh, mm),
          location: p.location || "",
        });
      }
      cur.setDate(cur.getDate() + 7);
      idx++;
    }
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}

export function generateMatchups(teamCount, targetGamesPerTeam) {
  if (teamCount < 2 || targetGamesPerTeam < 1) return [];
  const N = teamCount;
  const isOdd = N % 2 === 1;
  const M = isOdd ? N + 1 : N;
  const PHANTOM = isOdd ? M - 1 : -1;

  function roundPairs(r) {
    const pos = new Array(M);
    pos[0] = 0;
    for (let i = 1; i < M; i++) {
      pos[i] = ((i - 1 + r) % (M - 1)) + 1;
    }
    const pairs = [];
    for (let i = 0; i < M / 2; i++) {
      pairs.push([pos[i], pos[M - 1 - i]]);
    }
    return pairs;
  }

  const matchups = [];
  const gameCount = new Array(N).fill(0);

  let epoch = 0;
  let progress = true;
  while (progress && epoch < 100) {
    progress = false;
    for (let r = 0; r < M - 1; r++) {
      // Alternate the home side by both round and epoch. Same-epoch round
      // alternation balances any team that sits in a fixed circle position
      // (e.g. team 0 in the circle method); cross-epoch alternation flips
      // each pair's direction on its second meeting so a complete double
      // round-robin is perfectly balanced.
      const flip = (r + epoch) % 2 === 1;
      for (const [a, b] of roundPairs(r)) {
        if (a === PHANTOM || b === PHANTOM) continue;
        if (gameCount[a] >= targetGamesPerTeam) continue;
        if (gameCount[b] >= targetGamesPerTeam) continue;
        const home = flip ? b : a;
        const away = flip ? a : b;
        matchups.push([home, away]);
        gameCount[a]++;
        gameCount[b]++;
        progress = true;
      }
    }
    epoch++;
  }
  return matchups;
}

export function generateSchedule(teams, slots, targetGamesPerTeam, opts = {}) {
  if (!teams || teams.length < 2 || !slots || slots.length === 0) return [];
  const N = teams.length;
  const cutoff = opts.playoffCutoff || null;
  // Slots on/after the cutoff are reserved for playoffs — the generator does
  // not assign matchups to them. Playoff brackets aren't known at planning time.
  const cutoffMs = cutoff ? new Date(cutoff).getTime() : Infinity;
  const regSlots = slots.filter(s => s.date.getTime() < cutoffMs);
  if (regSlots.length === 0) return [];

  const matchups = generateMatchups(N, targetGamesPerTeam);
  const sortedSlots = regSlots.slice().sort((a, b) => a.date - b.date);

  const used = new Array(matchups.length).fill(false);
  const teamsByDay = new Map();
  const games = [];

  for (const slot of sortedSlots) {
    const dayKey = slot.date.toDateString();
    const booked = teamsByDay.get(dayKey);
    let chosen = -1;
    for (let m = 0; m < matchups.length; m++) {
      if (used[m]) continue;
      const [hi, ai] = matchups[m];
      if (booked && (booked.has(hi) || booked.has(ai))) continue;
      chosen = m;
      break;
    }
    if (chosen === -1) continue;
    used[chosen] = true;
    const [hi, ai] = matchups[chosen];
    games.push({
      id: `gen-${games.length + 1}`,
      date: new Date(slot.date),
      home: teams[hi],
      away: teams[ai],
      location: slot.location,
      _apiPlayoff: false,
      isPlayoff: false,
      slotKey: null,
    });
    if (!teamsByDay.has(dayKey)) teamsByDay.set(dayKey, new Set());
    teamsByDay.get(dayKey).add(hi);
    teamsByDay.get(dayKey).add(ai);
  }

  finalizeGames(games, cutoff);

  if (opts.polish !== false && games.length > 0) {
    const analyzeOpts = {
      slotView: opts.slotView || "buckets",
      earlyEnd: opts.earlyEnd || "21:00",
      lateStart: opts.lateStart || "22:00",
      cutoffMs: 0,
    };
    const maxIters = opts.polishMaxIters != null ? opts.polishMaxIters : 10;
    for (let it = 0; it < maxIters; it++) {
      const sugg = suggestSwaps(games, false, analyzeOpts, 1);
      if (sugg.length === 0 || sugg[0].delta < 1e-6) break;
      const swapped = swapDates(games, sugg[0].i, sugg[0].j);
      for (let k = 0; k < games.length; k++) games[k] = swapped[k];
    }
  }

  return games;
}

export function analyze(games, includePlayoffs, opts = {}) {
  const useBuckets = opts.slotView === "buckets";
  const earlyEnd = opts.earlyEnd || "21:00";
  const lateStart = opts.lateStart || "22:00";

  const fair = includePlayoffs ? games : games.filter(g => !g.isPlayoff);
  const teams = uniqueTeams(games);

  const slotKeyOf = useBuckets
    ? (g) => bucketOf(g.slotKey, earlyEnd, lateStart)
    : (g) => g.slotKey;

  const slots = useBuckets
    ? BUCKET_ORDER.filter(b => games.some(g => bucketOf(g.slotKey, earlyEnd, lateStart) === b))
    : [...new Set(games.map(g => g.slotKey))].sort(slotCmp);

  const gameCount = Object.fromEntries(teams.map(t => [t, 0]));
  for (const g of fair) { gameCount[g.home]++; gameCount[g.away]++; }
  const counts = Object.values(gameCount);
  const median = counts.length ? counts.slice().sort((a,b)=>a-b)[Math.floor(counts.length/2)] : 0;
  const gameCountPenalty = counts.reduce((s, c) => s + (c - median) ** 2, 0);

  const ha = Object.fromEntries(teams.map(t => [t, { h: 0, a: 0 }]));
  for (const g of fair) { if (ha[g.home]) ha[g.home].h++; if (ha[g.away]) ha[g.away].a++; }
  const homeAwayPenalty = teams.reduce((s, t) => s + (ha[t].h - ha[t].a) ** 2, 0);

  const slotMatrix = {};
  for (const t of teams) slotMatrix[t] = Object.fromEntries(slots.map(s => [s, 0]));
  for (const g of fair) {
    const sk = slotKeyOf(g);
    if (slotMatrix[g.home] && sk in slotMatrix[g.home]) slotMatrix[g.home][sk]++;
    if (slotMatrix[g.away] && sk in slotMatrix[g.away]) slotMatrix[g.away][sk]++;
  }
  let slotPenalty = 0;
  const slotExpectedPerTeam = {};
  for (const t of teams) {
    const total = slots.reduce((s, sk) => s + slotMatrix[t][sk], 0);
    const expected = slots.length ? total / slots.length : 0;
    slotExpectedPerTeam[t] = expected;
    for (const sk of slots) {
      slotPenalty += (slotMatrix[t][sk] - expected) ** 2;
    }
  }

  const mondayCount = Object.fromEntries(teams.map(t => [t, 0]));
  let mondayTotal = 0;
  for (const g of fair) {
    if (g.date.getDay() === 1) {
      if (mondayCount[g.home] != null) mondayCount[g.home]++;
      if (mondayCount[g.away] != null) mondayCount[g.away]++;
      mondayTotal++;
    }
  }
  const mondayExpected = teams.length ? (mondayTotal * 2) / teams.length : 0;
  let mondayPenalty = 0;
  for (const t of teams) {
    mondayPenalty += (mondayCount[t] - mondayExpected) ** 2;
  }

  const weekTeamCount = {};
  const weeksSeen = new Set();
  const teamSet = new Set(teams);
  for (const g of fair) {
    const wk = weekKey(g.date);
    weeksSeen.add(wk);
    if (!weekTeamCount[wk]) weekTeamCount[wk] = {};
    if (teamSet.has(g.home)) weekTeamCount[wk][g.home] = (weekTeamCount[wk][g.home] || 0) + 1;
    if (teamSet.has(g.away)) weekTeamCount[wk][g.away] = (weekTeamCount[wk][g.away] || 0) + 1;
  }
  let weekPenalty = 0;
  for (const wk of weeksSeen) {
    const counts = weekTeamCount[wk] || {};
    for (const t of teams) {
      const c = counts[t] || 0;
      weekPenalty += (c - 1) ** 2;
    }
  }

  const matchups = {};
  for (const t of teams) matchups[t] = Object.fromEntries(teams.map(o => [o, 0]));
  for (const g of fair) {
    if (matchups[g.home] && matchups[g.home][g.away] != null) matchups[g.home][g.away]++;
    if (matchups[g.away] && matchups[g.away][g.home] != null) matchups[g.away][g.home]++;
  }
  let matchupPenalty = 0;
  let matchupExpected = 0;
  if (teams.length >= 2) {
    matchupExpected = (2 * fair.length) / (teams.length * (teams.length - 1));
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const c = matchups[teams[i]][teams[j]];
        matchupPenalty += (c - matchupExpected) ** 2;
      }
    }
  }

  const b2b = [];
  for (const t of teams) {
    const myGames = games.filter(g => g.home === t || g.away === t).sort((a,b)=>a.date - b.date);
    for (let i = 0; i < myGames.length - 1; i++) {
      const oppA = myGames[i].home === t ? myGames[i].away : myGames[i].home;
      const oppB = myGames[i+1].home === t ? myGames[i+1].away : myGames[i+1].home;
      if (oppA === oppB) {
        b2b.push({ team: t, opponent: oppA, gameA: myGames[i], gameB: myGames[i+1] });
      }
    }
  }
  const seen = new Set();
  const b2bUnique = [];
  for (const x of b2b) {
    const key = [x.gameA.id, x.gameB.id].sort().join("|");
    if (!seen.has(key)) { seen.add(key); b2bUnique.push(x); }
  }
  const b2bPenalty = b2bUnique.length;

  const total =
    W_GAMECOUNT * gameCountPenalty +
    W_HOMEAWAY * homeAwayPenalty +
    W_SLOT * slotPenalty +
    W_B2B * b2bPenalty +
    W_MATCHUP * matchupPenalty +
    W_MONDAY * mondayPenalty +
    W_WEEK * weekPenalty;

  return {
    teams, slots, gameCount, median,
    homeAway: ha,
    slotMatrix, slotExpectedPerTeam,
    matchups, matchupExpected,
    mondayCount, mondayTotal, mondayExpected,
    b2b: b2bUnique,
    breakdown: {
      gameCount: W_GAMECOUNT * gameCountPenalty,
      homeAway: W_HOMEAWAY * homeAwayPenalty,
      slot: W_SLOT * slotPenalty,
      b2b: W_B2B * b2bPenalty,
      matchup: W_MATCHUP * matchupPenalty,
      monday: W_MONDAY * mondayPenalty,
      week: W_WEEK * weekPenalty,
    },
    total,
  };
}
