// ============================================================
// /sim/backend.js — in-browser mock backend for the Full Simulation.
//
// Serves the same /api/* response shapes that api/sheet.js does, but entirely
// from a localStorage store in the browser. It NEVER touches the real Supabase
// (no players / elo_log writes), so the live rankings can never be polluted.
//
// Active only when a page opts in with ?sim=1 (see sim/guard.js). This file by
// itself only defines window.__SIM__ and is harmless if never used.
//
// Phase 1 covers the Registration (daftar) stage. Later phases extend the
// router and the store with roster/appeal, groups, schedule, scoring, playoff
// and leaderboard — the data model below is already an array-of-categories so
// those phases can build on it.
// ============================================================
(function(){
  "use strict";

  var KEY = "tp_sim_v1";
  var EVENT_ID = "EV_SIM";

  // Tier floors, mirroring LEVEL_ELO on the server / getTierName on the client.
  // "open" is labelled Open but seeds from Bronze (engine: open = bronze).
  var LEVEL_ELO = { open:1500, beginner:600, upper_beginner:900, lower_bronze:1200,
    bronze:1500, upper_bronze:1800, silver:2100, gold:2500, platinum:3000 };
  var LEVEL_LABEL = { open:"Open", beginner:"Beginner", upper_beginner:"Upper Beginner",
    lower_bronze:"Lower Bronze", bronze:"Bronze", upper_bronze:"Upper Bronze",
    silver:"Silver", gold:"Gold", platinum:"Platinum" };

  // 1x1 PNG — stands in for photo/KTP uploads so auto-fill satisfies the form
  // without a real file picker. Tiny, valid, inert.
  var PLACEHOLDER_IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  // ---------- fictional data pools ----------
  var FIRST_M = ["Budi","Andi","Agus","Rizky","Fajar","Yoga","Gilang","Bayu","Wawan","Hendra","Reza","Aldi","Vino","Oka","Bagus","Tono","Joko","Galih","Dedi","Rama","Putu","Made","Eka","Bagas","Dimas"];
  var FIRST_F = ["Siti","Rina","Dewi","Dian","Nanda","Intan","Sari","Citra","Tari","Nadia","Lina","Wati","Maya","Febri","Ayu","Sinta","Nina","Putri","Rani","Mega","Vina","Gita","Shinta","Tika","Yuni"];
  var LAST = ["Saputra","Wijaya","Pratama","Lestari","Hidayat","Nugroho","Santoso","Permana","Kusuma","Maulana","Hartono","Siregar","Gunawan","Halim","Wibowo","Anggraini","Puspita","Ramadhan","Suryadi","Kurniawan"];
  var REGIONS = ["Kota Jakarta Selatan","Kota Tangerang Selatan","Kota Bandung","Kota Surabaya","Kota Depok","Kota Bekasi","Kota Semarang","Kota Denpasar","Kota Bogor","Kota Makassar"];
  var JERSEY = ["XS","S","M","L","XL","XXL"];
  var TEAM_WORDS = ["Smash","Volley","Padel","Court","Reyes","Garuda","Rajawali","Elang","Petir","Badai","Juara","Solid","Duo","Tandem","Dinamo"];

  function rnd(){ return Math.random(); }
  function pick(a){ return a[Math.floor(rnd()*a.length)]; }
  function digits(n){ var s=""; for(var i=0;i<n;i++) s+=Math.floor(rnd()*10); return s; }
  function tierName(elo){
    if(elo>=3000) return "Platinum"; if(elo>=2500) return "Gold"; if(elo>=2100) return "Silver";
    if(elo>=1800) return "Upper Bronze"; if(elo>=1500) return "Bronze"; if(elo>=1200) return "Lower Bronze";
    if(elo>=900) return "Upper Beginner"; return "Beginner";
  }

  function genPlayer(level){
    var gender = rnd()<0.5 ? "L" : "P";
    var first = gender==="L" ? pick(FIRST_M) : pick(FIRST_F);
    var name = first + " " + pick(LAST);
    var nick = first;
    var handle = (first + pick(LAST)).toLowerCase().replace(/[^a-z]/g,"");
    var base = LEVEL_ELO[String(level||"bronze").toLowerCase()] || 1500;
    var elo = base + Math.floor(rnd()*260); // within-band jitter upward
    var yr = 1985 + Math.floor(rnd()*22);
    var mo = ("0"+(1+Math.floor(rnd()*12))).slice(-2);
    var da = ("0"+(1+Math.floor(rnd()*28))).slice(-2);
    return {
      name: name, nick: nick, phone: "08"+digits(10),
      email: handle + Math.floor(rnd()*900+100) + "@example.com",
      ig: "@" + handle, gender: gender, region: pick(REGIONS),
      dob: yr+"-"+mo+"-"+da, jersey: pick(JERSEY), reclub: "",
      seedElo: elo, tier: tierName(elo)
    };
  }
  function genPair(level){
    return { teamName: pick(TEAM_WORDS)+" "+pick(TEAM_WORDS), players: [genPlayer(level), genPlayer(level)] };
  }

  // ---------- store ----------
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||"null"); }catch(e){ return null; } }
  function save(s){ try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }
  function reset(){ try{ localStorage.removeItem(KEY); }catch(e){} }

  // Build a fresh store from the control panel's options.
  // opts: { name, venue, date, startTime, numCourts, matchMinutes, theme,
  //         hideEligibility, hideQuota, fields, categories:[{label,level,fee,quota}] }
  function seedEvent(opts){
    opts = opts || {};
    var cats = (opts.categories||[]).map(function(c, i){
      return { tournamentId: "TM_SIM_"+(i+1), label: c.label || "Men's Doubles",
        level: String(c.level||"bronze").toLowerCase(), fee: c.fee!=null?c.fee:150000,
        quota: c.quota!=null?c.quota:16, req: c.req||"" };
    });
    if(!cats.length) cats = [{ tournamentId:"TM_SIM_1", label:"Men's Doubles", level:"bronze", fee:150000, quota:16, req:"" }];
    var store = {
      event: {
        eventId: EVENT_ID, name: opts.name || "Padel Sim Cup",
        slug: "padel-sim-cup", venue: opts.venue || "Demo Padel Arena",
        date: opts.date || "12 Jul 2026", startTime: opts.startTime || "08:00",
        numCourts: opts.numCourts || 4, matchMinutes: opts.matchMinutes || 15, status: "open"
      },
      config: {
        timeline: opts.timeline || { openStart:"1 Jul 2026", openEnd:"8 Jul 2026",
          curationStart:"9 Jul 2026", appealDeadline:"10 Jul 2026", tmDate:"11 Jul 2026", oopDate:"11 Jul 2026" },
        rules: opts.rules || "Best-of-3 games per match. Fair play dijunjung tinggi.",
        address: opts.address || "", maps: opts.maps || "",
        theme: opts.theme || "", hideEligibility: !!opts.hideEligibility,
        hideQuota: !!opts.hideQuota, fields: opts.fields || {}
      },
      categories: cats,
      registrations: []
    };
    save(store);
    return store;
  }

  // Inject N completed registrations into a category (bypasses the form).
  function autoRegister(categoryId, count){
    var s = load(); if(!s) return 0;
    var cat = (s.categories||[]).find(function(c){ return c.tournamentId===categoryId; }) || s.categories[0];
    if(!cat) return 0;
    var made = 0;
    for(var i=0;i<count;i++){
      var pair = genPair(cat.level);
      s.registrations.push({
        reg_id: "REG_"+Date.now()+"_"+Math.floor(rnd()*100000),
        category: cat.tournamentId, teamName: pair.teamName,
        players: pair.players, status: "pending",
        answers: { experience:"Main reguler.", achievements:"" },
        created_at: new Date().toISOString(), paymentProof: PLACEHOLDER_IMG
      });
      made++;
    }
    save(s);
    return made;
  }

  function filledFor(s, catId){
    return (s.registrations||[]).filter(function(r){ return r.category===catId && r.status!=="rejected"; }).length;
  }

  // ---------- public payload (shape = api/sheet.js reg/public) ----------
  function publicPayload(s){
    var ev = s.event || {};
    return {
      name: ev.name, status: ev.status || "open",
      event: { name: ev.name, venue: ev.venue, date: ev.date, startTime: ev.startTime },
      config: s.config || {},
      categories: (s.categories||[]).map(function(c){
        return { tournamentId:c.tournamentId, label:c.label, level:c.level, fee:c.fee,
          quota:c.quota, filled:filledFor(s, c.tournamentId), req:c.req };
      })
    };
  }

  // ---------- router ----------
  // path is the part AFTER /api/ , without query string. Returns {status,data}.
  function handle(method, path, body){
    method = (method||"GET").toUpperCase();
    body = body || {};
    var s = load();

    if(method==="GET" && path==="tournament/events"){
      return { status:200, data:{ events: s && s.event ? [s.event] : [] } };
    }
    if(method==="GET" && /^reg\/public\//.test(path)){
      if(!s || !s.event) return { status:404, data:{ error:"Pendaftaran belum tersedia." } };
      return { status:200, data: publicPayload(s) };
    }
    // Dedup / account lookup — the simulation treats every fictional name as new.
    if(method==="POST" && path==="reg/check-player") return { status:200, data:{ found:false, candidates:[] } };
    if(method==="POST" && path==="reg/lookup-email") return { status:200, data:{ found:false } };
    if(method==="POST" && path==="reg/profile/basic") return { status:200, data:{ profile:null } };
    if(method==="POST" && path==="reg/verify/start") return { status:200, data:{ available:false } };
    if(method==="POST" && path==="reg/verify/confirm") return { status:400, data:{ error:"OTP tidak dipakai di mode simulasi." } };

    if(method==="POST" && /^reg\/register\//.test(path)){
      if(!s) s = seedEvent({});
      var reg = {
        reg_id: "REG_"+Date.now()+"_"+Math.floor(rnd()*100000),
        category: body.category || (s.categories[0]||{}).tournamentId,
        teamName: body.teamName || "", players: body.players || [],
        status: "pending", answers: body.answers || {},
        created_at: new Date().toISOString(),
        photo1: body.photo1||"", photo2: body.photo2||"",
        ktp1: body.ktp1||"", ktp2: body.ktp2||"", paymentProof: body.paymentProof||""
      };
      var cat = (s.categories||[]).find(function(c){ return c.tournamentId===reg.category; });
      var waitlist = !!(cat && cat.quota>0 && filledFor(s, reg.category) >= cat.quota);
      s.registrations.push(reg); save(s);
      return { status:200, data:{ success:true, regId:reg.reg_id, waitlist:waitlist } };
    }

    // Unknown endpoint in sim mode — succeed quietly so the real page doesn't error.
    return { status:200, data:{} };
  }

  window.__SIM__ = {
    KEY: KEY, EVENT_ID: EVENT_ID, PLACEHOLDER_IMG: PLACEHOLDER_IMG,
    LEVEL_ELO: LEVEL_ELO, LEVEL_LABEL: LEVEL_LABEL,
    load: load, save: save, reset: reset, seedEvent: seedEvent,
    autoRegister: autoRegister, genPlayer: genPlayer, genPair: genPair,
    handle: handle
  };
})();
