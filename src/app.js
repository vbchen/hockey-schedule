"use strict";

import {
  WEEKDAY,
  pad2,
  parseLocal,
  parsePasteDate,
  timeOf,
  bucketOf,
  slotCmp,
  weekKey,
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
  generateSchedule,
  holidayMap,
  holidayWeekMap,
} from "./logic.js";

// ---------- Constants ----------

const STORAGE_KEY = "hockey-schedule-v1";
const API_BASE = "https://api.daysmartrecreation.com/v1";
const FREE_AGENT_PREFIX = "*";
const DEFAULT_LEAGUE_REF = "ocsportsplex/4356"; // D league — auto-loaded when no cached data

// Team colors → background; pick text color for contrast.
const TEAM_STYLE = {
  "Pylons":              { bg: "#e07a1f", fg: "#1a0c00", abbr: "PYL" },
  "Tropical Depression": { bg: "#2e8b3d", fg: "#ffffff", abbr: "TD"  },
  "Ice Aged":            { bg: "#2563eb", fg: "#ffffff", abbr: "IA"  },
  "Golden Pints":        { bg: "#d4af37", fg: "#1a1200", abbr: "GP"  },
  "Rusty Blades":        { bg: "#c83232", fg: "#ffffff", abbr: "RB"  },
  "Brewins":             { bg: "#fff200", fg: "#1a1200", abbr: "BRW" },
  "Mid-Ice Crisis":      { bg: "#7c3aed", fg: "#ffffff", abbr: "MIC" },
  "Nailers":             { bg: "#6b7280", fg: "#ffffff", abbr: "NAI" },
};
const FALLBACK_STYLE = { bg: "#3a4250", fg: "#ffffff", abbr: "?" };
function styleOf(team) { return TEAM_STYLE[team] || { ...FALLBACK_STYLE, abbr: (team||"?").slice(0,3).toUpperCase() }; }

// ---------- DOM helper ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "data" && typeof v === "object") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function mount(el, ...nodes) { clear(el); for (const n of nodes.flat(Infinity)) if (n) el.append(n); }

// ---------- State ----------

let state = {
  mode: "analyze",       // "analyze" | "plan"
  source: null,
  league: null,
  teams: [],
  games: [],
  originalGames: [],
  swapsApplied: [],
  includePlayoffs: false,
  playoffCutoff: null,   // YYYY-MM-DD; games on/after this date are playoffs
  slotView: "buckets",   // "exact" | "buckets"
  earlyEnd: "21:00",     // games starting before this = early
  lateStart: "22:00",    // games starting at/after this = late
  timeFormat: "12h",     // "12h" | "24h"
  sortKey: "date",
  sortAsc: true,
  planConfig: null,      // { teamsText, startDate, endDate, patterns, expandedSlots, targetGames, playoffCutoff }
};

function serializePlanConfig(pc) {
  if (!pc) return null;
  return {
    ...pc,
    expandedSlots: (pc.expandedSlots || []).map(s => ({ ...s, date: s.date instanceof Date ? s.date.toISOString() : s.date })),
  };
}

function deserializePlanConfig(pc) {
  if (!pc) return null;
  return {
    ...pc,
    expandedSlots: (pc.expandedSlots || []).map(s => ({ ...s, date: new Date(s.date) })),
  };
}

function save() {
  const payload = {
    ...state,
    games: state.games.map(serializeGame),
    originalGames: state.originalGames.map(serializeGame),
    swapsApplied: (state.swapsApplied || []).map(serializeApplied),
    planConfig: serializePlanConfig(state.planConfig),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) {}
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    state = {
      ...state,
      ...p,
      games: (p.games || []).map(deserializeGame),
      originalGames: (p.originalGames || []).map(deserializeGame),
      swapsApplied: (p.swapsApplied || []).map(deserializeApplied),
      planConfig: deserializePlanConfig(p.planConfig),
    };
    return true;
  } catch (e) { return false; }
}

// ---------- URL parsing ----------

// ---------- API loader ----------

async function fetchLeague(company, leagueId) {
  const headers = { "Accept": "application/vnd.api+json" };
  const u = (path) => `${API_BASE}/${path}?company=${encodeURIComponent(company)}`;

  const [leagueRes, teamsRes, eventsRes] = await Promise.all([
    fetch(u(`leagues/${leagueId}`), { headers }),
    fetch(u(`leagues/${leagueId}/teams`) + `&page%5Bsize%5D=100`, { headers }),
    fetch(u(`events`) + `&filter%5Bleague_id%5D=${leagueId}&page%5Bsize%5D=500`, { headers }),
  ]);
  if (!leagueRes.ok) throw new Error(`League fetch failed: ${leagueRes.status}`);
  if (!teamsRes.ok) throw new Error(`Teams fetch failed: ${teamsRes.status}`);
  if (!eventsRes.ok) throw new Error(`Events fetch failed: ${eventsRes.status}`);

  const leagueJson = await leagueRes.json();
  const teamsJson = await teamsRes.json();
  const eventsJson = await eventsRes.json();

  const leagueAttrs = leagueJson.data?.attributes || {};
  const league = {
    name: leagueAttrs.name || `League ${leagueId}`,
    startDate: leagueAttrs.start_date || null,
    endDate: leagueAttrs.end_date || null,
  };

  const teams = (teamsJson.data || [])
    .map(t => ({ id: String(t.id), name: t.attributes?.name || `Team ${t.id}` }))
    .filter(t => !t.name.startsWith(FREE_AGENT_PREFIX));

  const teamById = Object.fromEntries(teams.map(t => [t.id, t.name]));

  const games = (eventsJson.data || [])
    .filter(e => e.attributes?.event_type_id === "g")
    .map(e => {
      const a = e.attributes || {};
      const home = teamById[String(a.hteam_id)] || null;
      const away = teamById[String(a.vteam_id)] || null;
      return {
        id: `api-${e.id}`,
        date: parseLocal(a.start),
        home, away,
        location: a.resource_id ? `Resource ${a.resource_id}` : null,
        _apiPlayoff: a.sub_type === "playoff",
        isPlayoff: false,
        slotKey: null,
      };
    })
    .filter(g => g.home && g.away && !isNaN(g.date));

  finalizeGames(games, state.playoffCutoff);
  return { league, teams, games };
}

const BUCKET_LABEL = { early: "Early", middle: "Middle", late: "Late" };

// ---------- UI ----------

const $ = id => document.getElementById(id);

function setStatus(msg, kind="") {
  const el = $("status");
  if (!msg) { clear(el); return; }
  mount(el, h("div", { class: `banner ${kind}` }, msg));
}

function fmtDate(d) {
  return d.toLocaleString(undefined, { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDateLong(d) {
  const wk = WEEKDAY[d.getDay()];
  const md = d.toLocaleString(undefined, { month: "short", day: "numeric" });
  const time = formatTime24(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`, state.timeFormat);
  return `${wk} ${md} · ${time}`;
}

function render() {
  if (!state.games.length) {
    $("dashboard").style.display = "none";
    $("loaded-summary").textContent = "";
    return;
  }
  $("dashboard").style.display = "";
  const teams = uniqueTeams(state.games);
  const summary = state.league?.name
    ? `${state.league.name} • ${state.games.length} games • ${teams.length} teams`
    : `${state.games.length} games • ${teams.length} teams`;
  const swapped = state.swapsApplied.length ? ` • ${state.swapsApplied.length} swap${state.swapsApplied.length===1?"":"s"} applied` : "";
  $("loaded-summary").textContent = summary + swapped;

  const opts = { slotView: state.slotView, earlyEnd: state.earlyEnd, lateStart: state.lateStart };
  const analysis = analyze(state.games, state.includePlayoffs, opts);
  $("penalty-summary").textContent =
    `Penalty: ${analysis.total.toFixed(1)}   ` +
    `(games ${analysis.breakdown.gameCount.toFixed(1)} · h/a ${analysis.breakdown.homeAway.toFixed(1)} · slots ${analysis.breakdown.slot.toFixed(1)} · mondays ${analysis.breakdown.monday.toFixed(1)} · weeks ${analysis.breakdown.week.toFixed(1)} · matchups ${analysis.breakdown.matchup.toFixed(1)} · b2b ${analysis.breakdown.b2b.toFixed(1)})`;

  renderSchedule();
  renderCalendar();
  renderGamesPerTeam(analysis);
  renderHomeAway(analysis);
  renderHeatmap(analysis);
  renderMonday(analysis);
  renderMatchups(analysis);
  renderB2B(analysis);
  renderSwaps(analysis);
}

function renderSchedule() {
  const tb = $("schedule-table").querySelector("tbody");
  const sk = state.sortKey, asc = state.sortAsc;
  const rows = state.games.map((g, idx) => ({
    g, idx, date: g.date.getTime(),
    slotKey: g.slotKey, home: g.home, away: g.away,
    kind: g.isPlayoff ? "playoff" : "regular",
  }));
  rows.sort((a, b) => {
    const av = a[sk], bv = b[sk];
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return a.idx - b.idx;
  });
  mount(tb, rows.map(r => h("tr", null,
    h("td", { class: "num" }, r.idx + 1),
    h("td", null, fmtDate(r.g.date)),
    h("td", null, formatSlotKey(r.g.slotKey, state.timeFormat)),
    h("td", null, r.g.home),
    h("td", null, r.g.away),
    h("td", null, h("span", { class: `pill ${r.kind}` }, r.kind)),
  )));
}

function renderCalendar() {
  // Legend
  const legendItems = uniqueTeams(state.games).map(t => {
    const s = styleOf(t);
    return h("div", { class: "legend-item" },
      h("div", { class: "legend-swatch", style: { background: s.bg } }),
      h("span", null, t),
    );
  });
  if (state.swapsApplied && state.swapsApplied.length) {
    legendItems.push(h("div", { class: "legend-item" },
      h("div", { class: "legend-swatch legend-swap-marker" }),
      h("span", null, "moved by applied swap"),
    ));
  }
  mount($("cal-legend"), legendItems);

  const swappedIds = new Set();
  for (const e of (state.swapsApplied || [])) {
    if (e.aId) swappedIds.add(e.aId);
    if (e.bId) swappedIds.add(e.bId);
  }

  // Group games by month
  const byMonth = new Map();  // "YYYY-MM" -> [games]
  for (const g of state.games) {
    const key = `${g.date.getFullYear()}-${pad2(g.date.getMonth()+1)}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(g);
  }
  const monthKeys = [...byMonth.keys()].sort();

  // Holiday lookup spans every rendered month, so a holiday in an empty month
  // (e.g., December if no games are scheduled then) still shows.
  const hMap = monthKeys.length ? holidayMap(
    new Date(+monthKeys[0].split("-")[0], +monthKeys[0].split("-")[1] - 1, 1),
    new Date(+monthKeys[monthKeys.length - 1].split("-")[0], +monthKeys[monthKeys.length - 1].split("-")[1], 0),
  ) : new Map();

  const months = monthKeys.map(mk => {
    const [yr, mo] = mk.split("-").map(Number);
    const firstDay = new Date(yr, mo - 1, 1);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const leadingBlanks = firstDay.getDay(); // 0..6 (Sun..Sat)
    const monthGames = byMonth.get(mk);
    const gamesByDay = new Map();
    for (const g of monthGames) {
      const d = g.date.getDate();
      if (!gamesByDay.has(d)) gamesByDay.set(d, []);
      gamesByDay.get(d).push(g);
    }

    const dowHeader = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
      .map(n => h("div", { class: "cal-dow" }, n));

    const cells = [];
    for (let i = 0; i < leadingBlanks; i++) {
      cells.push(h("div", { class: "cal-day cal-empty" }));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dayGames = (gamesByDay.get(d) || []).sort((a,b) => a.date - b.date);
      const dayDate = new Date(yr, mo - 1, d);
      const holidayName = hMap.get(dayDate.toDateString());
      const cellChildren = [h("div", { class: "cal-date" }, d)];
      if (holidayName) cellChildren.push(h("div", { class: "cal-holiday", title: holidayName }, holidayName));
      for (const g of dayGames) {
        const sh = styleOf(g.home), sa = styleOf(g.away);
        const hh = g.date.getHours(), mm = g.date.getMinutes();
        const time = state.timeFormat === "24h"
          ? `${pad2(hh)}:${pad2(mm)}`
          : `${((hh + 11) % 12 + 1)}:${pad2(mm)}${hh >= 12 ? "p" : "a"}`;
        const isSwapped = swappedIds.has(g.id);
        const titleText = `${g.home} (home) vs ${g.away} (away) — ${fmtDateLong(g.date)}` +
          (isSwapped ? " — moved by applied swap" : "");
        cellChildren.push(h("div", {
          class: "cal-game" + (isSwapped ? " cal-game--swapped" : ""),
          "data-game-id": g.id,
          title: titleText,
        },
          isSwapped ? h("div", { class: "swap-marker", "aria-hidden": "true" }, "↻") : null,
          h("div", { class: "time" }, time),
          h("div", { class: "half", style: { background: sh.bg, color: sh.fg } }, sh.abbr),
          h("div", { class: "half", style: { background: sa.bg, color: sa.fg } }, sa.abbr),
        ));
      }
      const cellClasses = ["cal-day"];
      if (dayGames.length) cellClasses.push("has-game");
      if (holidayName) cellClasses.push("cal-holiday-day");
      cells.push(h("div", { class: cellClasses.join(" ") }, ...cellChildren));
    }

    const monthName = firstDay.toLocaleString(undefined, { month: "long", year: "numeric" });
    return h("div", { class: "cal-month" },
      h("h3", null, monthName),
      h("div", { class: "cal-grid" }, ...dowHeader, ...cells),
    );
  });

  mount($("calendar"), months);
}

function renderGamesPerTeam(a) {
  const max = Math.max(...Object.values(a.gameCount), 1);
  const rows = a.teams.map(t => {
    const c = a.gameCount[t];
    const cls = c === a.median ? "good" : Math.abs(c - a.median) > 1 ? "bad" : "warn";
    return h("div", { class: "bar-row" },
      h("div", null, t),
      h("div", null, h("div", { class: `bar ${cls}`, style: { width: `${(c / max) * 100}%` } })),
      h("div", { class: "num" }, c),
    );
  });
  mount($("games-per-team"), rows);

  const note = $("gpt-note");
  if (a.breakdown.gameCount > 0) {
    mount(note,
      h("span", { class: "err" }, "Imbalance detected. "),
      `Median is ${a.median}. `,
      h("em", null, "A date-swap can't fix this — the matchup list itself is uneven."),
    );
  } else {
    mount(note, `All teams play ${a.median} games. ✓`);
  }
}

function renderHomeAway(a) {
  const rows = a.teams.map(t => {
    const { h: hc, a: ac } = a.homeAway[t];
    return h("div", { class: "ha-row" },
      h("div", null, t),
      h("div", { class: "ha-track" },
        h("div", { class: "h", style: { flex: String(hc) } }),
        h("div", { class: "a", style: { flex: String(ac) } }),
      ),
      h("div", { class: "num" }, `${hc} / ${ac}`),
    );
  });
  mount($("home-away"), rows);
}

function renderHeatmap(a) {
  const slots = a.slots;
  const isBucket = state.slotView === "buckets";
  const label = (s) => isBucket ? BUCKET_LABEL[s] || s : formatSlotKey(s, state.timeFormat);
  const thead = h("thead", null, h("tr", null,
    h("th"),
    slots.map(s => h("th", null, label(s))),
    h("th", null, "Σ"),
  ));
  const tbody = h("tbody", null, a.teams.map(t => {
    let row = 0;
    const cells = slots.map(sk => {
      const c = a.slotMatrix[t][sk];
      row += c;
      const exp = a.slotExpectedPerTeam[t];
      const dev = c - exp;
      const intensity = Math.min(1, Math.abs(dev) / Math.max(1, exp));
      const bg = dev > 0
        ? `hsla(0, 70%, 50%, ${intensity * 0.6})`
        : dev < 0
        ? `hsla(210, 70%, 50%, ${intensity * 0.4})`
        : "transparent";
      return h("td", { class: "cell", style: { background: bg } }, c);
    });
    return h("tr", null,
      h("td", { class: "team" }, t),
      cells,
      h("td", { class: "cell num" }, row),
    );
  }));
  mount($("heatmap"), thead, tbody);
}

function renderMonday(a) {
  const exp = a.mondayExpected;
  const max = Math.max(...Object.values(a.mondayCount), 1);
  const rows = a.teams.map(t => {
    const c = a.mondayCount[t];
    const dev = Math.abs(c - exp);
    const cls = dev < 0.75 ? "good" : dev < 1.75 ? "warn" : "bad";
    return h("div", { class: "bar-row" },
      h("div", null, t),
      h("div", null, h("div", { class: `bar ${cls}`, style: { width: `${(c / max) * 100}%` } })),
      h("div", { class: "num" }, c),
    );
  });
  mount($("monday-games"), rows);
  $("monday-note").textContent = a.mondayTotal === 0
    ? "No Monday games in the (currently filtered) schedule."
    : `${a.mondayTotal} Monday game${a.mondayTotal === 1 ? "" : "s"} total · expected ~${exp.toFixed(1)} per team if shared evenly · penalty contribution ${a.breakdown.monday.toFixed(1)}.`;
}

function renderMatchups(a) {
  const teams = a.teams;
  const exp = a.matchupExpected;
  const thead = h("thead", null, h("tr", null,
    h("th"),
    teams.map(t => {
      const s = styleOf(t);
      return h("th", { title: t, style: { background: s.bg, color: s.fg } }, s.abbr);
    }),
    h("th", null, "Σ"),
  ));
  const tbody = h("tbody", null, teams.map(t1 => {
    let row = 0;
    const cells = teams.map(t2 => {
      if (t1 === t2) {
        return h("td", { class: "cell muted", style: { background: "var(--panel-2)" } }, "—");
      }
      const c = a.matchups[t1][t2];
      row += c;
      const dev = c - exp;
      const intensity = Math.min(1, Math.abs(dev) / Math.max(1, exp));
      const bg = dev > 0
        ? `hsla(0, 70%, 50%, ${intensity * 0.6})`
        : dev < 0
        ? `hsla(210, 70%, 50%, ${intensity * 0.4})`
        : "transparent";
      return h("td", { class: "cell", style: { background: bg }, title: `${t1} vs ${t2}: ${c}` }, c);
    });
    const s1 = styleOf(t1);
    return h("tr", null,
      h("td", { class: "team", title: t1 }, t1),
      cells,
      h("td", { class: "cell num" }, row),
    );
  }));
  mount($("matchup-matrix"), thead, tbody);

  const note = $("matchup-note");
  const expStr = exp ? exp.toFixed(2) : "0";
  if (a.breakdown.matchup > 0) {
    mount(note,
      h("span", { class: "err" }, "Matchup imbalance detected. "),
      `Each pair should play ~${expStr} times. `,
      h("em", null, "A date-swap can't fix this — only changing matchups can."),
    );
  } else if (a.teams.length >= 2) {
    mount(note, `Every pair plays ${expStr} times. ✓`);
  } else {
    clear(note);
  }
}

function renderB2B(a) {
  const ul = $("b2b-list");
  if (a.b2b.length === 0) {
    mount(ul, h("li", { class: "muted" }, "No same-matchup back-to-backs detected. ✓"));
    return;
  }
  mount(ul, a.b2b.map(x => h("li", null,
    h("strong", null, x.team), " plays ",
    h("strong", null, x.opponent), " twice in a row: ",
    h("span", { class: "tag" }, fmtDateLong(x.gameA.date)),
    " → ",
    h("span", { class: "tag" }, fmtDateLong(x.gameB.date)),
  )));
}

function teamChip(team) {
  const s = styleOf(team);
  return h("span", {
    class: "chip",
    title: team,
    style: { background: s.bg, color: s.fg },
  }, s.abbr);
}

function matchupChips(g) {
  return h("span", { class: "matchup" },
    teamChip(g.home),
    h("span", { class: "vs-mark" }, "vs"),
    teamChip(g.away),
  );
}

function breakdownNode(before, after) {
  const terms = [
    ["games",    "gameCount"],
    ["h/a",      "homeAway"],
    ["slots",    "slot"],
    ["mondays",  "monday"],
    ["weeks",    "week"],
    ["matchups", "matchup"],
    ["b2b",      "b2b"],
  ];
  const parts = [];
  for (const [label, key] of terms) {
    const b = before[key], a = after[key];
    if (parts.length) parts.push(" · ");
    parts.push(`${label} `);
    if (Math.abs(a - b) < 1e-6) {
      parts.push(b.toFixed(1));
    } else {
      const cls = a < b ? "changed-good" : "changed-bad";
      parts.push(h("span", { class: cls }, `${b.toFixed(1)}→${a.toFixed(1)}`));
    }
  }
  return h("div", { class: "breakdown" }, ...parts);
}

function buildSwapCard(s, n, opts = {}) {
  const applied = !!opts.applied;
  // Resolve the two games' display data. For live suggestions we read the
  // current state; for applied swaps we use the pre-swap snapshot stored
  // when the swap was applied (state.games now holds the post-swap dates,
  // so reading from there would mislabel the from→to slots).
  const ga = applied ? s.gameA : state.games[s.i];
  const gb = applied ? s.gameB : state.games[s.j];
  if (!ga || !gb) {
    // Legacy applied entry (pre-snapshot schema): render a skinny placeholder
    // with just an Undo button.
    return h("div", { class: "swap-card swap-card--applied" },
      h("div", { class: "swap-main" },
        h("div", { class: "swap-header" },
          h("span", { class: "applied-badge" }, "Applied"), " ",
          h("span", { class: "muted" }, "Swap (no preview available)"),
        ),
      ),
      h("div", { class: "swap-side" },
        h("button", { class: "ghost", onclick: () => undoSwap(s.aId, s.bId) }, "↺ Undo"),
      ),
    );
  }
  const aDate = fmtDateLong(ga.date);
  const bDate = fmtDateLong(gb.date);

  const moves = h("div", { class: "moves" },
    h("div", { class: "move" },
      matchupChips(ga),
      h("span", { class: "slot from" }, aDate),
      h("span", { class: "arrow" }, "→"),
      h("span", { class: "slot to" }, bDate),
    ),
    h("div", { class: "move" },
      matchupChips(gb),
      h("span", { class: "slot from" }, bDate),
      h("span", { class: "arrow" }, "→"),
      h("span", { class: "slot to" }, aDate),
    ),
  );

  const previewCell = (label, nowGame, afterGame) => h("div", { class: "preview-cell" },
    h("div", { class: "preview-label" }, label),
    h("div", { class: "preview-row faded" },
      h("span", { class: "preview-tag" }, "now"),
      matchupChips(nowGame),
    ),
    h("div", { class: "preview-row" },
      h("span", { class: "preview-tag" }, "after"),
      matchupChips(afterGame),
    ),
  );

  const preview = h("div", { class: "preview" },
    previewCell(aDate, ga, gb),
    previewCell(bDate, gb, ga),
  );

  const header = applied
    ? h("div", { class: "swap-header" },
        h("span", { class: "applied-badge" }, "Applied"), " ",
        h("span", { class: "muted" }, "These two games were swapped"),
      )
    : h("div", { class: "swap-header" },
        h("strong", null, `${n + 1}.`), " ",
        h("span", { class: "muted" }, "Swap these two games"),
      );

  const actionBtn = applied
    ? h("button", { class: "ghost", onclick: () => undoSwap(s.aId, s.bId) }, "↺ Undo")
    : h("button", { class: "primary", onclick: () => applySwap(s.i, s.j) }, "Apply");

  const card = h("div", { class: applied ? "swap-card swap-card--applied" : "swap-card" },
    h("div", { class: "swap-main" },
      header,
      moves,
      preview,
      breakdownNode(s.before, s.after),
    ),
    h("div", { class: "swap-side" },
      h("div", { class: applied ? "delta delta-applied" : "delta" }, `−${s.delta.toFixed(2)}`),
      actionBtn,
    ),
  );

  return card;
}

function renderSwaps(analysis) {
  const list = $("swap-list");
  mount(list, h("div", { class: "muted" }, "Computing…"));
  requestAnimationFrame(() => {
    const cutoff = swapCutoffDate();
    const cutoffStr = cutoff.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const cutoffNote = h("div", {
      class: "muted",
      style: { fontSize: "12px", marginBottom: "10px" },
    }, `Excluding games before ${cutoffStr} — this week and next are treated as locked in.`);

    // Applied swaps render at the top, newest-first (read like a stack).
    const appliedCards = (state.swapsApplied || []).slice().reverse()
      .map((e, n) => buildSwapCard(e, n, { applied: true }));

    const opts = {
      slotView: state.slotView, earlyEnd: state.earlyEnd, lateStart: state.lateStart,
      cutoffMs: cutoff.getTime(),
    };
    const sugg = suggestSwaps(state.games, state.includePlayoffs, opts, 10);

    const liveHeader = appliedCards.length && sugg.length
      ? h("div", { class: "muted", style: { fontSize: "12px", margin: "14px 0 6px" } },
          "More suggestions:")
      : null;

    if (sugg.length === 0) {
      const emptyMsg = h("div", { class: "muted" },
        analysis.total === 0
          ? "Schedule is already balanced."
          : "No further improving single swaps found among remaining games. Remaining penalty may need a matchup change.");
      mount(list, cutoffNote, ...appliedCards, emptyMsg);
      return;
    }
    mount(list, cutoffNote, ...appliedCards, liveHeader, ...sugg.map((s, n) => buildSwapCard(s, n)));
  });
}

function applySwap(i, j) {
  // Snapshot pre-swap game data so the applied card keeps showing the right
  // from→to slots even after state.games has the swap in it.
  const ga = state.games[i], gb = state.games[j];
  const opts = { slotView: state.slotView, earlyEnd: state.earlyEnd, lateStart: state.lateStart };
  const before = analyze(state.games, state.includePlayoffs, opts).breakdown;
  const swapped = swapDates(state.games, i, j);
  const after = analyze(swapped, state.includePlayoffs, opts).breakdown;
  const delta = sumBreakdown(before) - sumBreakdown(after);
  state.games = swapped;
  state.swapsApplied.push({
    aId: ga.id,
    bId: gb.id,
    delta,
    before,
    after,
    gameA: { id: ga.id, home: ga.home, away: ga.away, date: new Date(ga.date) },
    gameB: { id: gb.id, home: gb.home, away: gb.away, date: new Date(gb.date) },
  });
  save();
  setStatus(`Applied swap G${i+1} ↔ G${j+1}.`);
  render();
}

function undoSwap(aId, bId) {
  const i = state.games.findIndex(g => g.id === aId);
  const j = state.games.findIndex(g => g.id === bId);
  if (i < 0 || j < 0) {
    // Game ids no longer present (schedule reloaded). Drop the entry only.
    state.swapsApplied = state.swapsApplied.filter(e => !(e.aId === aId && e.bId === bId));
    save();
    render();
    return;
  }
  state.games = swapDates(state.games, i, j);
  state.swapsApplied = state.swapsApplied.filter(e => !(e.aId === aId && e.bId === bId));
  save();
  setStatus("Undid swap.");
  render();
}

// ---------- Planner ----------

const WEEKDAY_OPTS = [
  { v: 0, l: "Sun" }, { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" },
  { v: 4, l: "Thu" }, { v: 5, l: "Fri" }, { v: 6, l: "Sat" },
];

function defaultPlanConfig() {
  return {
    teamsText: "",
    startDate: "",
    endDate: "",
    targetGames: 14,
    playoffCutoff: "",
    patterns: [{ weekday: 1, time: "21:00", location: "Rink A", frequency: "every" }],
    expandedSlots: null,
  };
}

function ensurePlanConfig() {
  if (!state.planConfig) state.planConfig = defaultPlanConfig();
  return state.planConfig;
}

function setMode(mode) {
  state.mode = mode;
  $("mode-analyze-btn").classList.toggle("active", mode === "analyze");
  $("mode-plan-btn").classList.toggle("active", mode === "plan");
  $("analyze-controls").style.display = mode === "analyze" ? "" : "none";
  $("plan-controls").style.display = mode === "plan" ? "" : "none";
  if (mode === "plan") {
    ensurePlanConfig();
    renderPlannerInputs();
  }
  save();
}

function renderPlannerInputs() {
  const pc = ensurePlanConfig();
  $("plan-teams").value = pc.teamsText || "";
  $("plan-start").value = pc.startDate || "";
  $("plan-end").value = pc.endDate || "";
  $("plan-target").value = pc.targetGames || 14;
  $("plan-playoff").value = pc.playoffCutoff || "";
  renderPatternRows();
  renderSlotRows();
  // Toggle the "Edit plan inputs" button when we already have generated games.
  const haveGenerated = state.source?.mode === "plan" && state.games.length > 0;
  $("plan-edit-btn").style.display = haveGenerated ? "" : "none";
}

function renderPatternRows() {
  const pc = ensurePlanConfig();
  const wrap = $("plan-pat-rows");
  clear(wrap);
  pc.patterns.forEach((p, idx) => {
    const sel = h("select", {
      onchange: (e) => { p.weekday = +e.target.value; save(); },
    }, WEEKDAY_OPTS.map(o => h("option", { value: o.v, selected: p.weekday === o.v ? "" : null }, o.l)));
    const time = h("input", {
      type: "time", value: p.time,
      onchange: (e) => { p.time = e.target.value; save(); },
    });
    const loc = h("input", {
      type: "text", value: p.location,
      onchange: (e) => { p.location = e.target.value; save(); },
    });
    const freq = h("select", {
      onchange: (e) => { p.frequency = e.target.value; save(); },
    },
      h("option", { value: "every", selected: p.frequency === "every" ? "" : null }, "Every week"),
      h("option", { value: "odd", selected: p.frequency === "odd" ? "" : null }, "Odd weeks"),
      h("option", { value: "even", selected: p.frequency === "even" ? "" : null }, "Even weeks"),
    );
    const rm = h("button", {
      class: "x-btn", title: "Remove",
      onclick: () => { pc.patterns.splice(idx, 1); save(); renderPatternRows(); },
    }, "✕");
    wrap.append(h("div", { class: "plan-pat-row" }, sel, time, loc, freq, rm));
  });
}

function renderSlotRows() {
  const pc = ensurePlanConfig();
  const wrap = $("plan-slot-rows");
  const empty = $("plan-slots-empty");
  const wrapBox = $("plan-slots-wrap");
  // Preserve scroll position across re-renders (e.g. after deleting one row).
  const prevScroll = wrap.scrollTop;
  if (!pc.expandedSlots || pc.expandedSlots.length === 0) {
    empty.style.display = "";
    wrapBox.style.display = "none";
    $("plan-slot-count").textContent = "";
    return;
  }
  empty.style.display = "none";
  wrapBox.style.display = "";
  clear(wrap);
  // Compute holiday + holiday-week maps over the slot range so each row can
  // flag itself ("Thanksgiving" on the day, "Thanksgiving week" on adjacent days).
  const slotMin = pc.expandedSlots[0].date;
  const slotMax = pc.expandedSlots[pc.expandedSlots.length - 1].date;
  const dayMap = holidayMap(slotMin, slotMax);
  const wkMap = holidayWeekMap(slotMin, slotMax);
  const cutoffMs = pc.playoffCutoff ? new Date(pc.playoffCutoff + "T00:00:00").getTime() : Infinity;
  const regCount = pc.expandedSlots.filter(s => s.date.getTime() < cutoffMs).length;
  const playoffCount = pc.expandedSlots.length - regCount;
  $("plan-slot-count").textContent = playoffCount > 0
    ? `${pc.expandedSlots.length} slots (${regCount} regular + ${playoffCount} playoff)`
    : `${pc.expandedSlots.length} slots`;
  pc.expandedSlots.forEach((s, idx) => {
    const dateStr = `${WEEKDAY[s.date.getDay()]} ${s.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    const sameDayHoliday = dayMap.get(s.date.toDateString());
    const wkHolidays = wkMap.get(weekKey(s.date));
    let holidayLabel = null;
    if (sameDayHoliday) holidayLabel = sameDayHoliday;
    else if (wkHolidays) holidayLabel = `${wkHolidays[0]} week`;
    const dateEl = h("div", null,
      dateStr,
      holidayLabel ? h("span", { class: "holiday-tag", title: holidayLabel }, holidayLabel) : null,
    );
    const timeStr = `${pad2(s.date.getHours())}:${pad2(s.date.getMinutes())}`;
    const time = h("input", {
      type: "time", value: timeStr,
      onchange: (e) => {
        const [hh, mm] = e.target.value.split(":").map(Number);
        if (!isFinite(hh) || !isFinite(mm)) return;
        s.date = new Date(s.date.getFullYear(), s.date.getMonth(), s.date.getDate(), hh, mm);
        save();
      },
    });
    const loc = h("input", {
      type: "text", value: s.location || "",
      onchange: (e) => { s.location = e.target.value; save(); },
    });
    const rm = h("button", {
      class: "x-btn", title: "Remove (bye week)",
      onclick: () => { pc.expandedSlots.splice(idx, 1); save(); renderSlotRows(); },
    }, "✕");
    wrap.append(h("div", { class: "plan-slot-row" }, dateEl, time, loc, rm));
  });
  wrap.scrollTop = prevScroll;
}

function onExpandPattern() {
  const pc = ensurePlanConfig();
  if (!pc.startDate || !pc.endDate) {
    setStatus("Set season start and end dates before expanding.", "error");
    return;
  }
  const start = new Date(pc.startDate + "T00:00:00");
  const end = new Date(pc.endDate + "T00:00:00");
  if (isNaN(start) || isNaN(end) || end < start) {
    setStatus("Season end must be on or after season start.", "error");
    return;
  }
  if (!pc.patterns.length) {
    setStatus("Add at least one recurring slot before expanding.", "error");
    return;
  }
  pc.expandedSlots = expandSlotPattern(pc.patterns, start, end);
  setStatus(`Expanded to ${pc.expandedSlots.length} slots.`);
  save();
  renderSlotRows();
}

function onGenerate() {
  const pc = ensurePlanConfig();
  const teams = (pc.teamsText || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (teams.length < 2) {
    setStatus("Enter at least 2 teams (one per line).", "error");
    return;
  }
  if (!pc.expandedSlots || pc.expandedSlots.length === 0) {
    setStatus("Click \"Expand pattern\" first to build the slot list.", "error");
    return;
  }
  const target = +pc.targetGames || 0;
  if (target < 1) {
    setStatus("Set a positive games-per-team target.", "error");
    return;
  }
  const cutoffMs = pc.playoffCutoff ? new Date(pc.playoffCutoff + "T00:00:00").getTime() : Infinity;
  const regularCount = pc.expandedSlots.filter(s => s.date.getTime() < cutoffMs).length;
  const maxPossible = Math.floor((regularCount * 2) / teams.length);
  if (target > maxPossible) {
    const cutoffNote = pc.playoffCutoff ? ` (before playoffs start)` : ``;
    setStatus(`${target} games × ${teams.length} teams needs ${Math.ceil(target * teams.length / 2)} regular-season slots${cutoffNote}, but only ${regularCount} are available. Lower the target, add more slots, or push the playoff start date later.`, "warn");
    return;
  }
  const games = generateSchedule(teams, pc.expandedSlots, target, {
    playoffCutoff: pc.playoffCutoff || null,
    slotView: state.slotView,
    earlyEnd: state.earlyEnd,
    lateStart: state.lateStart,
    polish: true,
    polishMaxIters: 10,
  });
  if (games.length === 0) {
    setStatus("Generation produced no games — check your inputs.", "error");
    return;
  }
  state.source = { mode: "plan", company: null, leagueId: null, fetchedAt: Date.now() };
  state.league = { name: "Planned season", startDate: pc.startDate || null, endDate: pc.endDate || null };
  state.teams = teams.map(n => ({ id: n, name: n }));
  state.games = games;
  state.originalGames = games.map(g => ({ ...g }));
  state.swapsApplied = [];
  state.playoffCutoff = pc.playoffCutoff || null;
  if (pc.playoffCutoff) $("playoff-cutoff").value = pc.playoffCutoff;
  save();
  setStatus(`Generated ${games.length} games for ${teams.length} teams.`);
  $("plan-edit-btn").style.display = "";
  render();
}

// ---------- Wiring ----------

async function loadLeagueByRef(ref) {
  setStatus("Loading from DaySmart…");
  try {
    const { league, teams, games } = await fetchLeague(ref.company, ref.leagueId);
    if (games.length === 0) throw new Error("No games returned");
    state.source = { mode: "api", company: ref.company, leagueId: ref.leagueId, fetchedAt: Date.now() };
    state.league = league;
    state.teams = teams;
    state.games = games;
    state.originalGames = games.map(g => ({ ...g }));
    state.swapsApplied = [];
    save();
    setStatus(`Loaded ${games.length} games from ${league.name}.`);
    render();
    return true;
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}. If the league is public this may be a CORS/network issue — try Paste mode.`, "error");
    return false;
  }
}

$("load-btn").addEventListener("click", async () => {
  const ref = parseInputRef($("url-input").value, state.source?.company);
  if (!ref) {
    setStatus("Couldn't recognize the URL. Try the full DaySmart league URL or 'company/leagueId'.", "error");
    return;
  }
  await loadLeagueByRef(ref);
});

$("paste-toggle").addEventListener("click", () => {
  const a = $("paste-area");
  a.style.display = a.style.display === "none" ? "" : "none";
});

$("paste-parse-btn").addEventListener("click", () => {
  const txt = $("paste-input").value;
  const games = parsePastedText(txt, state.playoffCutoff);
  if (games.length === 0) {
    setStatus("Couldn't parse any games. Each game should be 3 lines: home/away (tab-separated), location, then date/time.", "error");
    return;
  }
  state.source = { mode: "paste", company: null, leagueId: null, fetchedAt: Date.now() };
  state.league = { name: "Pasted schedule", startDate: null, endDate: null };
  state.teams = uniqueTeams(games).map(n => ({ id: n, name: n }));
  state.games = games;
  state.originalGames = games.map(g => ({ ...g }));
  state.swapsApplied = [];
  save();
  setStatus(`Parsed ${games.length} games.`);
  render();
});

$("reset-btn").addEventListener("click", () => {
  if (!state.originalGames.length) return;
  state.games = state.originalGames.map(g => ({ ...g }));
  state.swapsApplied = [];
  save();
  setStatus("Reset to original schedule.");
  render();
});

$("clear-btn").addEventListener("click", () => {
  if (!confirm("Clear locally-cached schedule and applied swaps?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = {
    mode: "analyze",
    source: null, league: null, teams: [], games: [], originalGames: [], swapsApplied: [],
    includePlayoffs: false, sortKey: "date", sortAsc: true,
    slotView: "buckets", earlyEnd: "21:00", lateStart: "22:00", timeFormat: "12h",
    playoffCutoff: null, planConfig: null,
  };
  $("url-input").value = "";
  $("paste-input").value = "";
  setMode("analyze");
  setStatus("");
  render();
});

$("include-playoffs").addEventListener("change", (e) => {
  state.includePlayoffs = e.target.checked;
  save();
  render();
});

$("playoff-cutoff").addEventListener("change", (e) => {
  state.playoffCutoff = e.target.value || null;
  applyPlayoffCutoff(state.games, state.playoffCutoff);
  applyPlayoffCutoff(state.originalGames, state.playoffCutoff);
  save();
  render();
});

function syncBucketControlsVisibility() {
  $("bucket-thresholds").style.display = state.slotView === "buckets" ? "" : "none";
}

$("slot-view").addEventListener("change", (e) => {
  state.slotView = e.target.value;
  syncBucketControlsVisibility();
  save();
  render();
});

$("early-end").addEventListener("change", (e) => {
  if (e.target.value) { state.earlyEnd = e.target.value; save(); render(); }
});

$("late-start").addEventListener("change", (e) => {
  if (e.target.value) { state.lateStart = e.target.value; save(); render(); }
});

$("time-format").addEventListener("change", (e) => {
  state.timeFormat = e.target.value;
  save();
  render();
});

$("mode-analyze-btn").addEventListener("click", () => setMode("analyze"));
$("mode-plan-btn").addEventListener("click", () => setMode("plan"));

$("plan-teams").addEventListener("input", (e) => { ensurePlanConfig().teamsText = e.target.value; save(); });
$("plan-start").addEventListener("change", (e) => { ensurePlanConfig().startDate = e.target.value; save(); });
$("plan-end").addEventListener("change", (e) => { ensurePlanConfig().endDate = e.target.value; save(); });
$("plan-target").addEventListener("change", (e) => { ensurePlanConfig().targetGames = +e.target.value || 0; save(); });
$("plan-playoff").addEventListener("change", (e) => {
  ensurePlanConfig().playoffCutoff = e.target.value || "";
  save();
  renderSlotRows();
});
$("plan-add-pat").addEventListener("click", () => {
  ensurePlanConfig().patterns.push({ weekday: 1, time: "21:00", location: "", frequency: "every" });
  save();
  renderPatternRows();
});
$("plan-expand-btn").addEventListener("click", onExpandPattern);
$("plan-generate-btn").addEventListener("click", onGenerate);
$("plan-edit-btn").addEventListener("click", () => {
  // Just scroll up; the planner is already visible in plan mode.
  $("plan-controls").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("schedule-table").querySelectorAll("th").forEach(th => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.sortAsc = !state.sortAsc;
    else { state.sortKey = k; state.sortAsc = true; }
    save();
    render();
  });
});

// ---------- Init ----------

$("slot-view").value = state.slotView;
$("early-end").value = state.earlyEnd;
$("late-start").value = state.lateStart;
$("time-format").value = state.timeFormat;
syncBucketControlsVisibility();

if (load()) {
  $("include-playoffs").checked = !!state.includePlayoffs;
  if (state.playoffCutoff) $("playoff-cutoff").value = state.playoffCutoff;
  $("slot-view").value = state.slotView;
  $("early-end").value = state.earlyEnd;
  $("late-start").value = state.lateStart;
  $("time-format").value = state.timeFormat;
  syncBucketControlsVisibility();
  if (state.source?.mode === "api" && state.source.company && state.source.leagueId) {
    $("url-input").value = `${state.source.company}/${state.source.leagueId}`;
  }
  setMode(state.mode || "analyze");
  if (state.games.length) {
    setStatus(`Restored ${state.games.length} games from local cache (${state.source?.mode || "?"} mode).`);
    render();
  }
} else {
  setMode("analyze");
  $("url-input").value = DEFAULT_LEAGUE_REF;
  const defaultRef = parseInputRef(DEFAULT_LEAGUE_REF);
  if (defaultRef) loadLeagueByRef(defaultRef);
}
