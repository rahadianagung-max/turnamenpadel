// ============================================================
// Supabase-backed drop-in for the Google Sheets client used by api/sheet.js.
//
// turnamenpadel shares ONE database (Google Sheet) with Trekkr; that data now
// lives in Supabase. This module mirrors the Sheets client surface used by
// api/sheet.js and translates every call to Supabase (PostgREST), so the
// business logic keeps working unchanged.
//
// Activated only when SUPABASE_URL + SUPABASE_SERVICE_KEY are set (see
// getSheets() in api/sheet.js) — a safe on/off switch.
//
// Column orders below follow the PHYSICAL sheet (shared with Trekkr): each app
// interprets positions its own way, so we map to physical columns and let the
// caller read them as it always did. Where turnamenpadel uses MORE columns than
// Trekkr (tournament tables), the map holds the wider superset.
// ============================================================

const SHEET_MAP = {
  Players:            { table: "players",             cols: ["name","ig","verified","display_name","gender","region","photo_url","clubs","created_at","winner_at","tournaments","claim_email"] },
  Sessions:           { table: "sessions",            cols: ["session_id","session_name","source_url","format","sub_format","venue","player_count","match_count","created_at"] },
  ELO_Log:            { table: "elo_log",             cols: ["session_id","player","new_elo","elo_change","wins","losses","timestamp"] },
  Venues:             { table: "venues",              cols: ["name","location","region","schedule","prize_pool","contact","logo_url","created_at","register_url"] },
  Admins:             { table: "admins",              cols: ["username","password","role","venue","created_at"] },
  Claims:             { table: "claims",              cols: ["name","ig","session_id","status","created_at"] },
  PlayRank_Active:    { table: "playrank_active",     cols: ["event_id","title","venue","level","gender","format","week_start","week_end","status","players","leader","url","highlight"] },

  // Tournament engine (wider than Trekkr): break windows, playoff, team name, etc.
  Tournament_Events:  { table: "tournament_events",   cols: ["event_id","name","venue","date","start_time","num_courts","match_minutes","created_at","status","format","category","url","highlight","admin_username","break1_start","break1_end","break2_start","break2_end","break3_start","break3_end","break4_start","break4_end"] },
  Tournaments:        { table: "tournaments",         cols: ["tournament_id","event_id","category","level","format","group_size_target","advancers_per_group","status","admin_username","created_at","playoff_top_overall","auto_playoff"] },
  Tournament_Entrants:{ table: "tournament_entrants", cols: ["tournament_id","entrant_id","player1_name","player1_ig","player2_name","player2_ig","seed_elo","is_new_p1","is_new_p2","created_at","team_name"] },
  Tournament_Groups:  { table: "tournament_groups",   cols: ["tournament_id","category","group_label","entrant_id","player1_name","player2_name","seed_elo","team_name"] },
  Tournament_Matches: { table: "tournament_matches",  cols: ["tournament_id","match_id","stage","group_label","bracket","round","court","slot_index","scheduled_time","entrant_a","entrant_b","score_a","score_b","winner","status","updated_at","scheduled_date"] },
  Form_Responses:     { table: "form_responses",      cols: ["timestamp","category","player1_name","player1_ig","player2_name","player2_ig","contact_wa","tournament"] },

  RegForms:           { table: "reg_forms",           cols: ["form_id","name","status","linked_tournament","config","created_at","updated_at"] },
  Registrations:      { table: "registrations",       cols: ["reg_id","form_id","timestamp","name","gender","phone","photo_url","payment_proof_url","data","linked_tournament","status"] },

  // The live Tournament_Leads tab is the real 15-column layout (preserved as
  // tournament_leads_legacy during the Trekkr migration).
  Tournament_Leads:   { table: "tournament_leads_legacy", cols: ["timestamp","name","whatsapp","email","tournament_date","participants","category","venue","city","package","notes","status","tournament_days","hours_per_day","courts"] },

  Tracked_Events:     { table: "tracked_events",      cols: ["month_year","name","location","logo_url","url"] },
  Calculator_Leads:   { table: "calculator_leads",    cols: ["timestamp","lead_id","name","email","source","user_agent","status"] },
  Calculator_Results: { table: "calculator_results",  cols: ["timestamp","lead_id","name","email","mode","format_priority","input_unit","target_pairs","hours_available","courts","court_rate_per_hour","total_pairs","total_players","categories_count","categories_detail","total_matches","total_duration_min","total_duration_label","court_hours_optimal","court_hours_full","estimated_court_cost","potential_saving","has_bye","options_considered","services_requested","rules_ref","interested_in_management","status"] },

  Draw_Results:       { table: "draw_results",        cols: ["timestamp","draw_id","tournament_id","tournament_name","mode","groups","pairs_per_group","random_key","random_key_hash","group_label","pot","pair_id","player1","player2","rating","team_name","status"] },
  Draw_Log:           { table: "draw_log",            cols: ["timestamp","draw_id","tournament_id","n","pot","group_label","pair_id","at_time"] },
  Tournament_Archive: { table: "tournament_archive",  cols: ["archived_at","event_id","source_tab","row_json"] },
  Mexicano:           { table: "mexicano",            cols: ["mexicano_id","slug","data_json","updated_at"] },
};

// Per-venue match tabs (Venue_<X>) share one table, keyed by `venue`.
const VENUE_TABLE = "venue_matches";
const VENUE_COLS = ["week","date","p1_team1","p2_team1","p1_team2","p2_team2","score_t1","score_t2","p1_team1_gender","p2_team1_gender","p1_team2_gender","p2_team2_gender","source_url"];
function venueFromTab(title) { return title.replace(/^Venue_/, "").replace(/_/g, " ").trim(); }

function colToIdx(letters) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRange(range) {
  const bang = String(range).indexOf("!");
  const title = bang >= 0 ? range.slice(0, bang) : range;
  const a1 = bang >= 0 ? range.slice(bang + 1) : "";
  if (!a1) return { title, startCol: 0, endCol: null, startRow: null, endRow: null };
  const [left, right] = a1.split(":");
  const lm = /^([A-Za-z]+)?(\d+)?$/.exec(left) || [];
  const startCol = lm[1] ? colToIdx(lm[1]) : 0;
  const startRow = lm[2] ? parseInt(lm[2], 10) : null;
  let endCol = null, endRow = null;
  if (right) {
    const rm = /^([A-Za-z]+)?(\d+)?$/.exec(right) || [];
    endCol = rm[1] ? colToIdx(rm[1]) : null;
    endRow = rm[2] ? parseInt(rm[2], 10) : null;
  } else {
    endCol = startCol; endRow = startRow;
  }
  return { title, startCol, endCol, startRow, endRow };
}

function resolve(title) {
  if (/^Venue_/.test(title)) return { table: VENUE_TABLE, cols: VENUE_COLS, venue: venueFromTab(title) };
  const m = SHEET_MAP[title];
  if (!m) return null;
  return { table: m.table, cols: m.cols, venue: null };
}

function s(v) { return v == null ? "" : String(v); }

function makeRest(baseUrl, key) {
  const root = String(baseUrl).replace(/\/+$/, "") + "/rest/v1";
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function req(method, path, body, extraHeaders) {
    const resp = await fetch(root + path, {
      method,
      headers: { ...H, ...(extraHeaders || {}) },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Supabase ${method} ${path} -> ${resp.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    async selectAll(table, selectCols, venue) {
      const sel = encodeURIComponent(selectCols.join(",") + ",id");
      let out = [], offset = 0; const page = 1000;
      for (;;) {
        let p = `/${table}?select=${sel}&order=id.asc&limit=${page}&offset=${offset}`;
        if (venue != null) p += `&venue=eq.${encodeURIComponent(venue)}`;
        const rows = await req("GET", p);
        out = out.concat(rows || []);
        if (!rows || rows.length < page) break;
        offset += page;
      }
      return out;
    },
    async selectIds(table, venue) {
      let out = [], offset = 0; const page = 1000;
      for (;;) {
        let p = `/${table}?select=id&order=id.asc&limit=${page}&offset=${offset}`;
        if (venue != null) p += `&venue=eq.${encodeURIComponent(venue)}`;
        const rows = await req("GET", p);
        out = out.concat((rows || []).map((r) => r.id));
        if (!rows || rows.length < page) break;
        offset += page;
      }
      return out;
    },
    insert(table, objs) { return req("POST", `/${table}`, objs, { Prefer: "return=minimal" }); },
    patchById(table, id, obj) { return req("PATCH", `/${table}?id=eq.${id}`, obj, { Prefer: "return=minimal" }); },
    deleteById(table, id) { return req("DELETE", `/${table}?id=eq.${id}`, null, { Prefer: "return=minimal" }); },
    deleteAll(table, venue) {
      let p = `/${table}?id=gte.0`;
      if (venue != null) p += `&venue=eq.${encodeURIComponent(venue)}`;
      return req("DELETE", p, null, { Prefer: "return=minimal" });
    },
  };
}

function buildClient(rest) {
  const titleList = Object.keys(SHEET_MAP);
  const idToTitle = {}, titleToId = {};
  titleList.forEach((t, i) => { const id = 1000 + i; idToTitle[id] = t; titleToId[t] = id; });
  function venueSheetId(title) {
    if (titleToId[title] != null) return titleToId[title];
    const id = 5000 + Object.keys(idToTitle).length;
    idToTitle[id] = title; titleToId[title] = id; return id;
  }
  function rowToArr(cols, obj) { return cols.map((c) => s(obj[c])); }

  async function readRange(range) {
    const r = parseRange(range);
    const info = resolve(r.title);
    if (!info) return { values: [] };
    const rows = await rest.selectAll(info.table, info.cols, info.venue);
    const dataArrs = rows.map((o) => rowToArr(info.cols, o));
    const includeHeader = r.startRow === 1 || r.startRow == null;
    const body = includeHeader ? [info.cols.slice()].concat(dataArrs) : dataArrs;
    return { values: body };
  }

  const values = {
    async get({ range }) { return { data: await readRange(range) }; },
    async batchGet({ ranges }) {
      const valueRanges = [];
      for (const rg of ranges || []) valueRanges.push(await readRange(rg));
      return { data: { valueRanges } };
    },
    async append({ range, requestBody }) {
      const r = parseRange(range);
      const info = resolve(r.title);
      if (!info) return { data: {} };
      const rowsIn = (requestBody && requestBody.values) || [];
      const objs = rowsIn.map((vals) => {
        const o = {};
        info.cols.forEach((c, i) => { o[c] = i < vals.length ? s(vals[i]) : ""; });
        if (info.venue != null) o.venue = info.venue;
        return o;
      });
      if (objs.length) await rest.insert(info.table, objs);
      return { data: { updates: { updatedRows: objs.length } } };
    },
    async update({ range, requestBody }) {
      const r = parseRange(range);
      if (r.startRow === 1 && (r.endRow === 1 || r.endRow == null)) return { data: {} };
      const info = resolve(r.title);
      if (!info) return { data: {} };
      const rowsIn = (requestBody && requestBody.values) || [];
      const ids = await rest.selectIds(info.table, info.venue);
      let dataPos = (r.startRow || 2) - 2;
      // Google Sheets `values.update` writes cells whether or not a row already
      // exists there. We emulate that: patch a row that exists at this position,
      // otherwise (when writing full rows from column A) INSERT it. This is what
      // makes the "clear() then update(A2, allRows)" rewrite idiom actually
      // persist — after clear() there are no ids, so every row must be inserted.
      const toInsert = [];
      for (const vals of rowsIn) {
        const id = ids[dataPos];
        if (id != null) {
          const o = {};
          for (let i = 0; i < vals.length; i++) {
            const colIdx = r.startCol + i;
            if (colIdx < info.cols.length) o[info.cols[colIdx]] = s(vals[i]);
          }
          if (Object.keys(o).length) await rest.patchById(info.table, id, o);
        } else if (r.startCol === 0) {
          // Beyond the existing rows and writing a full row from column A → insert.
          const o = {};
          info.cols.forEach((c, i) => { o[c] = i < vals.length ? s(vals[i]) : ""; });
          if (info.venue != null) o.venue = info.venue;
          toInsert.push(o);
        }
        dataPos++;
      }
      if (toInsert.length) await rest.insert(info.table, toInsert);
      return { data: {} };
    },
    async batchUpdate({ requestBody }) {
      const data = (requestBody && requestBody.data) || [];
      for (const d of data) await values.update({ range: d.range, requestBody: { values: d.values } });
      return { data: {} };
    },
    async clear({ range }) {
      const r = parseRange(range);
      const info = resolve(r.title);
      if (info) await rest.deleteAll(info.table, info.venue);
      return { data: {} };
    },
  };

  const spreadsheets = {
    values,
    async get() {
      const sheetsMeta = titleList.map((t) => ({ properties: { title: t, sheetId: titleToId[t] } }));
      try {
        const venueRows = await rest.selectAll(VENUE_TABLE, ["venue"], null);
        const seen = new Set();
        for (const row of venueRows) {
          const v = s(row.venue).trim();
          if (!v || seen.has(v)) continue;
          seen.add(v);
          const title = "Venue_" + v.replace(/[^a-zA-Z0-9]/g, "_");
          sheetsMeta.push({ properties: { title, sheetId: venueSheetId(title) } });
        }
      } catch (e) { /* optional */ }
      return { data: { sheets: sheetsMeta } };
    },
    async batchUpdate({ requestBody }) {
      const requests = (requestBody && requestBody.requests) || [];
      for (const rq of requests) {
        if (rq.addSheet) continue;
        if (rq.deleteDimension) {
          const dd = rq.deleteDimension.range || {};
          const title = idToTitle[dd.sheetId];
          if (!title) continue;
          const info = resolve(title);
          if (!info) continue;
          const ids = await rest.selectIds(info.table, info.venue);
          const from = Math.max(1, dd.startIndex || 0);
          const to = dd.endIndex || (from + 1);
          const victims = [];
          for (let sheetRow = from; sheetRow < to; sheetRow++) {
            const id = ids[sheetRow - 1];
            if (id != null) victims.push(id);
          }
          for (const id of victims) await rest.deleteById(info.table, id);
        }
      }
      return { data: {} };
    },
  };

  return { spreadsheets };
}

function makeSupabaseSheets() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return buildClient(makeRest(url, key));
}

module.exports = { makeSupabaseSheets, buildClient, parseRange, colToIdx, resolve, SHEET_MAP, VENUE_COLS };
