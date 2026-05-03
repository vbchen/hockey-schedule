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
