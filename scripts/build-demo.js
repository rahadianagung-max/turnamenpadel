#!/usr/bin/env node
/*
 * Build /demo.html — a pixel-and-behaviour-faithful copy of the real engine
 * (engine/index.html) that runs entirely in the browser. The actual backend
 * (api/sheet.js) is embedded and driven against an in-memory Google-Sheets
 * shim, so every algorithm (draw, schedule, playoff, standings, display names)
 * behaves EXACTLY like production — but nothing touches the real spreadsheet.
 *
 * Regenerate with:  node scripts/build-demo.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const apiSrc = fs.readFileSync(path.join(ROOT, "api", "sheet.js"), "utf8");
let engine = fs.readFileSync(path.join(ROOT, "engine", "index.html"), "utf8");

function mustReplace(hay, needle, repl, label) {
  if (hay.indexOf(needle) === -1) throw new Error(`build-demo: marker not found (${label})`);
  return hay.replace(needle, repl);
}

// 1) Drop the login gate — inject a demo superadmin session instead of bouncing.
engine = mustReplace(
  engine,
  `if (!SESSION || !SESSION.username) { location.replace("/admin.html"); }`,
  `SESSION = (SESSION && SESSION.username) ? SESSION : { username:"demo", role:"superadmin", venue:"Demo Arena" };`,
  "session gate"
);

// 2) Route the engine's single api() chokepoint at the in-browser backend.
const apiFnStart = `async function api(path, opts={}){`;
const apiFnEnd = `  return data;\n}`;
const s = engine.indexOf(apiFnStart);
const e = engine.indexOf(apiFnEnd, s);
if (s === -1 || e === -1) throw new Error("build-demo: api() function not found");
const newApi = `async function api(path, opts={}){
  await (window.__demoReady || Promise.resolve());
  const res = await window.__demoApi(opts.method || "GET", path, opts.body || null);
  if(!res.ok){ const err = new Error((res.json && res.json.error) || ("HTTP "+res.status)); err.status = res.status; err.data = res.json; throw err; }
  return res.json;
}`;
engine = engine.slice(0, s) + newApi + engine.slice(e + apiFnEnd.length);

// 3) Retitle.
engine = engine.replace(/<title>[^<]*<\/title>/, "<title>Engine Demo — TurnamenPadel</title>");

// 4) Demo ribbon just inside <body>.
const ribbon = `
<div id="demoRibbon" style="position:sticky;top:0;z-index:200;background:linear-gradient(90deg,#FF6A00,#FFB000);color:#0A0A0B;font:700 12.5px/1.4 'Plus Jakarta Sans',sans-serif;padding:8px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center;">
  <span>🎾 <b>MODE DEMO</b> — engine sungguhan, tapi datanya cuma tersimpan di browser ini. Coba bebas: buat event, undi grup, jadwalkan, input skor. Refresh halaman untuk reset.</span>
  <a href="/admin.html" style="color:#0A0A0B;text-decoration:underline;font-weight:800;white-space:nowrap;">Masuk ke engine asli →</a>
</div>`;
engine = mustReplace(engine, "<body>", "<body>\n" + ribbon, "body open");

// 5) The in-browser backend: shim + embedded sheet.js + seed. Inserted right
//    before the engine's own <script> so window.__demoApi/__demoReady exist first.
const backend = `<script>
/* =============================================================
 * DEMO BACKEND — in-memory Google Sheets shim + embedded sheet.js
 * ============================================================= */
(function(){
  var DB = { tabs: {} };
  function ensureTab(t){ if(!DB.tabs[t]) DB.tabs[t] = []; return DB.tabs[t]; }
  function colToIdx(col){ var n=0; for(var i=0;i<col.length;i++) n = n*26 + (col.charCodeAt(i)-64); return n-1; }
  function parseRange(range){
    var title = range, cell = "";
    var bang = range.indexOf("!");
    if(bang >= 0){ title = range.slice(0,bang); cell = range.slice(bang+1); }
    title = title.replace(/^'|'$/g, "");
    if(!cell) return { title:title, r1:0, c1:0, r2:Infinity, c2:Infinity };
    var parts = cell.split(":");
    var m1 = /^([A-Z]+)(\\d+)?$/.exec(parts[0]);
    var c1 = colToIdx(m1[1]); var r1 = m1[2] ? parseInt(m1[2],10)-1 : 0;
    var c2, r2;
    if(parts[1]){ var m2 = /^([A-Z]+)(\\d+)?$/.exec(parts[1]); c2 = colToIdx(m2[1]); r2 = m2[2] ? parseInt(m2[2],10)-1 : Infinity; }
    else { c2 = c1; r2 = m1[2] ? r1 : Infinity; }
    return { title:title, r1:r1, c1:c1, r2:r2, c2:c2 };
  }
  function rowHasData(row){ if(!row) return false; for(var i=0;i<row.length;i++){ if(String(row[i]!=null?row[i]:"").length) return true; } return false; }
  function lastNonEmpty(rows){ var last=-1; for(var i=0;i<rows.length;i++){ if(rowHasData(rows[i])) last=i; } return last; }
  function valuesGet(range){
    var p = parseRange(range); var rows = DB.tabs[p.title] || [];
    var last = p.r2 === Infinity ? rows.length-1 : Math.min(p.r2, rows.length-1);
    var out = [];
    for(var r=p.r1; r<=last; r++){
      var row = rows[r] || []; var end = p.c2 === Infinity ? row.length-1 : p.c2; var slice = [];
      for(var c=p.c1; c<=end; c++) slice.push(row[c]!=null?row[c]:"");
      out.push(slice);
    }
    while(out.length && out[out.length-1].every(function(c){ return String(c).length===0; })) out.pop();
    return { data:{ values: out } };
  }
  function valuesUpdate(range, values){
    var p = parseRange(range); var rows = ensureTab(p.title); values = values || [];
    for(var i=0;i<values.length;i++){
      var rr = p.r1 + i; while(rows.length <= rr) rows.push([]);
      var row = rows[rr]; var vals = values[i] || [];
      for(var j=0;j<vals.length;j++){ var cc = p.c1 + j; while(row.length <= cc) row.push(""); row[cc] = vals[j]!=null?vals[j]:""; }
    }
    return { data:{} };
  }
  function valuesAppend(range, values){
    var p = parseRange(range); var rows = ensureTab(p.title); values = values || [];
    var start = lastNonEmpty(rows) + 1;
    for(var i=0;i<values.length;i++){
      var rr = start + i; while(rows.length <= rr) rows.push([]);
      var row = rows[rr]; var vals = values[i] || [];
      for(var j=0;j<vals.length;j++){ var cc = (p.c1||0) + j; while(row.length <= cc) row.push(""); row[cc] = vals[j]!=null?vals[j]:""; }
    }
    return { data:{} };
  }
  function valuesClear(range){
    var p = parseRange(range); var rows = DB.tabs[p.title]; if(!rows) return { data:{} };
    var last = p.r2 === Infinity ? rows.length-1 : Math.min(p.r2, rows.length-1);
    for(var r=p.r1; r<=last; r++){ if(!rows[r]) continue; var end = p.c2 === Infinity ? rows[r].length-1 : p.c2; for(var c=p.c1; c<=end; c++) rows[r][c] = ""; }
    if(p.r2 === Infinity && rows.length > p.r1) rows.length = p.r1;
    return { data:{} };
  }
  function valuesBatchGet(ranges){ return { data:{ valueRanges: (ranges||[]).map(function(r){ return valuesGet(r).data; }) } }; }
  function valuesBatchUpdate(req){ ((req && req.data) || []).forEach(function(d){ valuesUpdate(d.range, d.values); }); return { data:{} }; }

  var DEMO_GOOGLE = { google: {
    auth: { JWT: function(){} },
    drive: function(){ return {}; },
    sheets: function(){ return { spreadsheets: {
      get: function(){ return Promise.resolve({ data:{ sheets: Object.keys(DB.tabs).map(function(t){ return { properties:{ title:t } }; }) } }); },
      batchUpdate: function(a){ ((a.requestBody && a.requestBody.requests) || []).forEach(function(rq){ if(rq.addSheet) ensureTab(rq.addSheet.properties.title); }); return Promise.resolve({ data:{} }); },
      values: {
        get: function(a){ return Promise.resolve(valuesGet(a.range)); },
        update: function(a){ return Promise.resolve(valuesUpdate(a.range, a.requestBody.values)); },
        append: function(a){ return Promise.resolve(valuesAppend(a.range, a.requestBody.values)); },
        clear: function(a){ return Promise.resolve(valuesClear(a.range)); },
        batchGet: function(a){ return Promise.resolve(valuesBatchGet(a.ranges)); },
        batchUpdate: function(a){ return Promise.resolve(valuesBatchUpdate(a.requestBody)); }
      }
    } }; }
  } };

  // Node shims so api/sheet.js runs unchanged in the browser.
  var process = { env: { GOOGLE_SHEET_ID:"demo", SHEET_ID:"demo", GOOGLE_SERVICE_ACCOUNT_EMAIL:"demo", GOOGLE_PRIVATE_KEY:"demo" } };
  var module = { exports: {} };
  var Buffer = { from: function(s){ return { toString: function(){ return String(s); } }; } };
  function require(name){ if(name === "googleapis") return DEMO_GOOGLE; if(name === "stream") return { Readable:{ from:function(){ return null; } } }; return {}; }

  /* ===================== embedded api/sheet.js ===================== */
${apiSrc}
  /* =================== end embedded api/sheet.js =================== */

  function rawCall(method, fullpath, body){
    var sp = String(fullpath).split("?"); var query = {};
    if(sp[1]) sp[1].split("&").forEach(function(kv){ var i = kv.indexOf("="); var k = i<0?kv:kv.slice(0,i); var v = i<0?"":kv.slice(i+1); if(k) query[decodeURIComponent(k)] = decodeURIComponent(v); });
    return netlifyHandler({ httpMethod: method, path: "/api/" + sp[0], queryStringParameters: query, body: body != null ? JSON.stringify(body) : null });
  }
  window.__demoApi = function(method, fullpath, body){
    return Promise.resolve(rawCall(method, fullpath, body)).then(function(r){
      var json = {}; try{ json = JSON.parse(r.body || "{}"); }catch(e){}
      return { ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, json: json };
    });
  };

  async function call(method, p, body){ var r = await window.__demoApi(method, p, body); if(!r.ok) throw new Error((r.json && r.json.error) || ("HTTP "+r.status)); return r.json; }

  async function seedDemo(){
    var first = ["Andi","Budi","Cahya","Dedi","Eka","Fajar","Gilang","Hadi","Indra","Joko","Krisna","Lukman","Made","Nanda","Oka","Putra","Rizki","Surya","Tomi","Umar","Vino","Wahyu","Yoga","Zaki"];
    var last  = ["Wijaya","Santoso","Pratama","Kurnia","Nugraha","Saputra","Hidayat","Wibowo"];
    var pRows = [["Name","IG","Verified","Display_Name","Gender","Region","Photo","Clubs","CreatedAt","WinnerAt","Tournaments"]];
    var names = [];
    for(var i=0;i<24;i++){ var nm = first[i] + " " + last[i % last.length]; names.push(nm); pRows.push([nm, "@"+first[i].toLowerCase(), "TRUE", first[i], "M", "Jakarta", "", "", "2026-01-01", "", ""]); }
    DB.tabs["Players"] = pRows;

    var evName = "Demo Open 2026";
    var today = new Date().toISOString().slice(0,10);
    var ev = await call("POST", "tournament/event", { name: evName, venue: "Padel Arena", date: today, startTime: "09:00", numCourts: 3, matchMinutes: 15, adminUsername: "demo" });
    var eventId = ev.eventId;
    var tm = await call("POST", "tournament", { eventId: eventId, category: "Men's Doubles", level: "lower_bronze", format: "SINGLE", groupSizeTarget: 4, advancersPerGroup: 2, adminUsername: "demo" });
    var tid = tm.tournamentId;

    var fr = [["Timestamp","Category","Player1_Name","Player1_IG","Player2_Name","Player2_IG","Contact_WA","Tournament"]];
    for(var t=0;t<12;t++){ fr.push(["2026-01-01", "Men's Doubles Lower Bronze", names[t*2], "", names[t*2+1], "", "0811", evName]); }
    DB.tabs["Form_Responses"] = fr;

    await call("POST", "tournament/" + tid + "/import", {});
    await call("POST", "tournament/" + tid + "/draw", {});
    await call("POST", "tournament/event/" + eventId + "/schedule", {});

    try{
      var ms = await call("GET", "tournament/" + tid + "/matches", {});
      var gm = (ms.matches || []).filter(function(m){ return m.stage === "GROUP"; }).slice(0, 6);
      for(var k=0;k<gm.length;k++){ await call("PUT", "tournament/match", { matchId: gm[k].matchId, tournamentId: tid, scoreA: 6, scoreB: (k % 3) + 1 }); }
    }catch(e){ /* scoring is best-effort for the seed */ }
  }

  window.__demoReady = (async function(){ try{ await seedDemo(); }catch(e){ console.error("demo seed failed:", e); } })();
  window.__demoReset = function(){ DB.tabs = {}; window.__demoReady = (async function(){ try{ await seedDemo(); }catch(e){ console.error(e); } })(); return window.__demoReady; };
})();
</script>
`;

// Insert the backend script immediately before the FIRST engine <script> that
// defines the session (the big app script starts with the SESSION block).
const engineScriptMarker = `<script>\n// Require a signed-in admin session`;
if (engine.indexOf(engineScriptMarker) === -1) throw new Error("build-demo: engine app <script> marker not found");
engine = engine.replace(engineScriptMarker, backend + engineScriptMarker);

fs.writeFileSync(path.join(ROOT, "demo.html"), engine);
console.log("demo.html written (" + engine.length + " bytes)");
