// ============================================================
// /sim/guard.js — activates "simulation mode" on a real engine page.
//
// Loaded (together with sim/backend.js) ONLY when the page URL carries ?sim=1.
// It patches window.fetch so every call to /api/* is served by the in-browser
// mock backend (window.__SIM__) instead of the real serverless API — nothing
// is ever written to Supabase. It also drops a small floating toolbar into the
// page with auto-fill / bulk-register helpers for the demo.
//
// Inert by construction: if ?sim=1 is absent, or __SIM__ is missing, it does
// nothing, so production page loads are untouched.
// ============================================================
(function(){
  "use strict";
  try{
    if(new URLSearchParams(location.search).get("sim") !== "1") return;
  }catch(e){ return; }
  if(!window.__SIM__){ try{ console.warn("[sim] backend not loaded — guard inert"); }catch(_){} return; }

  var SIM = window.__SIM__;
  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  // ---- fetch interceptor ----
  window.fetch = function(input, init){
    try{
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      var m = /\/api\/([^?#]*)/.exec(url);
      if(m){
        var path = m[1];
        var method = ((init && init.method) || (typeof input !== "string" && input && input.method) || "GET");
        var body = null;
        var raw = (init && init.body) || (typeof input !== "string" && input && input.body);
        if(raw && typeof raw === "string"){ try{ body = JSON.parse(raw); }catch(e){ body = null; } }
        var res = SIM.handle(method, path, body);
        var payload = JSON.stringify(res && res.data != null ? res.data : {});
        return Promise.resolve(new Response(payload, {
          status: (res && res.status) || 200,
          headers: { "Content-Type": "application/json" }
        }));
      }
    }catch(e){ try{ console.error("[sim] shim error", e); }catch(_){} }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error("fetch unavailable"));
  };

  // ---- floating toolbar (built once the DOM is ready) ----
  function page(){
    // Which engine page are we on? Phase 1 only knows "daftar".
    if(/\/daftar(\/|$|\?)/.test(location.pathname) || /\/daftar/.test(location.pathname)) return "daftar";
    return "";
  }

  // daftar.html declares its state as `const F` / top-level functions. Classic
  // scripts share the global lexical scope, so these are reachable as barewords
  // (NOT as window.F — const is not a window property).
  function autofillDaftar(){
    if(typeof F === "undefined" || !F || !F.data){ return; }
    var cats = F.data.categories || [];
    if(!F.catId && cats.length) F.catId = cats[0].tournamentId;
    var curCat = cats.filter(function(c){ return c.tournamentId === F.catId; })[0] || cats[0] || {};
    var on = (typeof fieldsOn === "function") ? fieldsOn() : function(){ return true; };
    var pair = SIM.genPair(curCat.level || "bronze");
    F.started = true;
    F.teamName = pair.teamName;
    F.qExperience = "Main reguler 2x seminggu di klub."; F.qAchievements = "Runner-up tarkam lokal.";
    for(var i=0;i<2;i++){
      var p = F.players[i], g = pair.players[i];
      p.decision = "new"; p.name = g.name; p.phone = g.phone; p.email = g.email; p.ig = g.ig;
      p.nick = g.nick; p.gender = g.gender; p.region = g.region; p.dob = g.dob; p.jersey = g.jersey; p.reclub = g.reclub;
      p.chk = null; p.cand = null; p.otpStage = null;
      if(on("photo")) p.photo = SIM.PLACEHOLDER_IMG;
      if(on("ktp")) p.ktp = SIM.PLACEHOLDER_IMG;
    }
    // Jump to the summary step so the filled registration is visible in one view.
    if(typeof go === "function"){ go("summary"); }
    else if(typeof render === "function"){ render(); }
  }

  function bulkRegister(){
    var cat = (typeof F !== "undefined" && F && F.catId) || ((SIM.load()||{}).categories||[{}])[0].tournamentId;
    var n = parseInt(prompt("Berapa pasangan fiktif yang didaftarkan otomatis?", "8"), 10);
    if(!n || n < 1) return;
    var made = SIM.autoRegister(cat, n);
    alert(made + " pasangan fiktif terdaftar. Halaman dimuat ulang untuk memperbarui kuota.");
    location.reload();
  }

  function resetSim(){
    if(!confirm("Hapus semua data simulasi dan muat ulang?")) return;
    SIM.reset(); location.reload();
  }

  function buildToolbar(){
    if(document.getElementById("simBar")) return;
    var bar = document.createElement("div");
    bar.id = "simBar";
    bar.setAttribute("style",
      "position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;gap:8px;align-items:center;"+
      "flex-wrap:wrap;padding:8px 12px;background:#0F172A;color:#fff;font:600 12px/1.2 system-ui,sans-serif;"+
      "box-shadow:0 -6px 24px rgba(0,0,0,.35)");
    var tag = '<span style="background:#FF5722;color:#fff;border-radius:100px;padding:3px 10px;letter-spacing:.08em;text-transform:uppercase;font-size:10px;font-weight:800">● Simulasi</span>';
    var btn = function(id,label){ return '<button id="'+id+'" style="border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font:700 12px system-ui,sans-serif;background:#FF5722;color:#fff">'+label+'</button>'; };
    var ghost = function(id,label){ return '<button id="'+id+'" style="border:1px solid #334155;border-radius:8px;padding:8px 12px;cursor:pointer;font:700 12px system-ui,sans-serif;background:transparent;color:#cbd5e1">'+label+'</button>'; };
    var p = page();
    bar.innerHTML = tag +
      (p==="daftar" ? btn("simFill","🎲 Auto-isi formulir") + ghost("simBulk","➕ Daftarkan N pasangan") : "") +
      ghost("simReset","♻ Reset data") +
      '<span style="margin-left:auto;color:#94a3b8;font-weight:500">Mode simulasi — tak ada data yang ditulis ke server</span>';
    document.body.appendChild(bar);
    document.body.style.paddingBottom = "64px";
    var f = document.getElementById("simFill"); if(f) f.onclick = autofillDaftar;
    var b = document.getElementById("simBulk"); if(b) b.onclick = bulkRegister;
    var r = document.getElementById("simReset"); if(r) r.onclick = resetSim;
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildToolbar);
  else buildToolbar();
})();
