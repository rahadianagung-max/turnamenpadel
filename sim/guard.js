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

  // The admin console (admin-event.html) auto-logs-in when a token is already in
  // localStorage. Pre-seed a superadmin sim session BEFORE its script runs, so
  // the demo lands straight in the dashboard. The sim backend accepts any token.
  if(/\/admin(-event)?(\.html|\/|$)|\/kelola/.test(location.pathname)){
    try{
      localStorage.setItem("tp_admin_token", "SIM_TOKEN");
      localStorage.setItem("tp_admin_user", "Panitia Sim");
      localStorage.setItem("tp_admin_role", "superadmin");
      localStorage.setItem("tp_admin_events", "");
    }catch(e){}
  }

  // ---- fetch interceptor ----
  window.fetch = function(input, init){
    try{
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      var m = /\/api\/(.*)/.exec(url);  // capture path AND query (?r=&t=&token=)
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
    var p = location.pathname;
    if(/\/daftar(\.html|\/|$)/.test(p)) return "daftar";
    if(/\/bayar(\.html|\/|$)/.test(p)) return "bayar";
    if(/\/roster(\.html|\/|$)/.test(p)) return "roster";
    if(/\/admin(-event)?(\.html|\/|$)|\/kelola/.test(p)) return "admin";
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

  // bayar.html: PROOF (let) + submitPay() are top-level in that page.
  function autoPayBayar(){
    if(typeof submitPay !== "function"){ alert("Form pembayaran belum siap."); return; }
    try{ PROOF = SIM.PLACEHOLDER_IMG; }catch(e){}
    submitPay();
  }

  // roster.html: R / api() are top-level. File a fictional appeal on the first pair.
  function autoAppealRoster(){
    if(typeof R === "undefined" || !R.data){ alert("Roster belum siap."); return; }
    var cat = (R.data.categories||[]).filter(function(c){ return c.tournamentId===R.cat; })[0] || (R.data.categories||[])[0] || {};
    var pr = (cat.pairs||[])[0];
    if(!pr){ alert("Belum ada pasangan untuk di-appeal. Daftarkan peserta dulu."); return; }
    var g = SIM.genPlayer(cat.level || "bronze");
    api("reg/appeal", { method:"POST", body:{
      eventId: R.eventId, category: R.cat, againstRegId: pr.regId,
      againstLabel: (pr.p1.name+" + "+pr.p2.name)+" — di-appeal: "+pr.p1.name,
      targetPlayer: "p1", targetNames: pr.p1.name,
      appellantName: g.name, appellantEmail: g.email,
      reason: "Diduga bermain di atas level kategori (sandbagging).",
      proof: SIM.PLACEHOLDER_IMG, proof2: ""
    }}).then(function(){ alert("Appeal fiktif terkirim thd "+pr.p1.name+". Buka tahap Panitia untuk memutuskan."); })
       .catch(function(e){ alert("Gagal: "+(e&&e.message||e)); });
  }

  // admin-event.html: approve every waiting registration in one go.
  function approveAllAdmin(){
    var st = SIM.load(); if(!st){ return; }
    var pend = (st.registrations||[]).filter(function(r){ return r.status!=="approved" && r.status!=="rejected" && r.status!=="cancelled"; });
    if(!pend.length){ alert("Tidak ada pendaftar yang menunggu approval."); return; }
    pend.forEach(function(r){ r.status = "approved"; });
    SIM.save(st);
    if(typeof loadRegs === "function") loadRegs();
    alert(pend.length + " pendaftar di-approve.");
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
    var actions = "";
    if(p==="daftar") actions = btn("simFill","🎲 Auto-isi formulir") + ghost("simBulk","➕ Daftarkan N pasangan");
    else if(p==="bayar") actions = btn("simPay","🎲 Auto-kirim bukti bayar");
    else if(p==="roster") actions = btn("simAppeal","⚑ Auto-ajukan appeal") + ghost("simBulk","➕ Daftarkan N pasangan");
    else if(p==="admin") actions = btn("simApprove","✔ Approve semua pendaftar");
    bar.innerHTML = tag + actions +
      ghost("simReset","♻ Reset data") +
      '<span style="margin-left:auto;color:#94a3b8;font-weight:500">Mode simulasi — tak ada data yang ditulis ke server</span>';
    document.body.appendChild(bar);
    document.body.style.paddingBottom = "64px";
    var wire = function(id, fn){ var el = document.getElementById(id); if(el) el.onclick = fn; };
    wire("simFill", autofillDaftar);
    wire("simBulk", bulkRegister);
    wire("simPay", autoPayBayar);
    wire("simAppeal", autoAppealRoster);
    wire("simApprove", approveAllAdmin);
    wire("simReset", resetSim);
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildToolbar);
  else buildToolbar();
})();
