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
      registrations: [],
      appeals: [],
      tstate: {}
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

  // ---------- transforms used by the admin / roster / appeal stages ----------
  function pget(r, i){ return (r.players && r.players[i]) || {}; }
  function catOf(s, id){ return (s.categories||[]).find(function(c){ return c.tournamentId===id; }) || {}; }

  // Stored registration -> the shape admin-event.html expects (data.player1/2).
  function adminReg(s, r){
    var cat = catOf(s, r.category);
    function pa(p, photo, ktp){
      return { name:p.name||"", phone:p.phone||"", email:p.email||"", ig:p.ig||"", reclub:p.reclub||"",
        nick:p.nick||"", dob:p.dob||"", gender:p.gender||"", region:p.region||"", jersey:p.jersey||"",
        photoUrl:photo||"", ktpUrl:ktp||"", elo:p.seedElo, tier:p.tier };
    }
    return {
      reg_id: r.reg_id, regId: r.reg_id, status: r.status||"pending",
      timestamp: r.created_at || r.timestamp || new Date().toISOString(),
      teamName: r.teamName||"", category: r.category, paymentProofUrl: r.paymentProof||"",
      data: { player1: pa(pget(r,0), r.photo1, r.ktp1), player2: pa(pget(r,1), r.photo2, r.ktp2),
        category: r.category, level: cat.level||"", categoryLabel: cat.label||"",
        teamName: r.teamName||"", answers: r.answers||{} }
    };
  }

  function appealOpenNow(s){
    var iso = s.config && s.config.timeline && s.config.timeline.appealDeadlineISO;
    if(!iso) return true;
    var t = Date.parse(iso);
    return isNaN(t) ? true : (Date.now() < t);
  }

  // Public roster (reg/roster) — approved-ish pairs grouped by category.
  function rosterPayload(s){
    var cats = (s.categories||[]).map(function(c){
      var pairs = (s.registrations||[]).filter(function(r){
        return r.category===c.tournamentId && r.status!=="rejected" && r.status!=="cancelled";
      }).map(function(r){
        var p1 = pget(r,0), p2 = pget(r,1);
        return { regId:r.reg_id,
          p1:{ name:p1.name, ig:p1.ig, region:p1.region, photoUrl:r.photo1||"" },
          p2:{ name:p2.name, ig:p2.ig, region:p2.region, photoUrl:r.photo2||"" } };
      });
      return { tournamentId:c.tournamentId, label:c.label, level:c.level, fee:c.fee, pairs:pairs };
    });
    return { name:(s.event||{}).name, appealOpen:appealOpenNow(s),
      appealDeadline:(s.config && s.config.timeline && s.config.timeline.appealDeadline) || "",
      categories:cats };
  }

  function appealList(s){
    return (s.appeals||[]).map(function(a){
      var reg = (s.registrations||[]).find(function(r){ return r.reg_id===a.againstRegId; });
      var players = [];
      if(reg) (reg.players||[]).forEach(function(p){ players.push({ name:p.name, phone:p.phone, elo:p.seedElo, tier:p.tier }); });
      return { appealId:a.appealId, category:a.category, againstRegId:a.againstRegId, againstLabel:a.againstLabel,
        appellantName:a.appellantName, appellantEmail:a.appellantEmail, appellantPhone:a.appellantPhone||"",
        reason:a.reason, proofUrl:a.proofUrl||"", proofUrl2:a.proofUrl2||"", createdAt:a.createdAt,
        status:a.status||"baru", decision:a.decision||"", decidedAt:a.decidedAt||"", note:a.note||"", players:players };
    });
  }

  function activeRegCount(s){
    return (s.registrations||[]).filter(function(r){ return r.status!=="rejected" && r.status!=="cancelled"; }).length;
  }

  // ---------- engine (groups / schedule) helpers ----------
  function tstate(s, tid){
    s.tstate = s.tstate || {};
    s.tstate[tid] = s.tstate[tid] || { entrants:null, groups:[], matches:[] };
    return s.tstate[tid];
  }
  // A sim category presented as an engine "tournament".
  function tournamentOf(s, cat){
    return { tournamentId:cat.tournamentId, eventId:(s.event||{}).eventId, category:cat.label,
      level:cat.level, format:"SINGLE", rankMode:"wins", groupSizeTarget:4, advancersPerGroup:2,
      startTime:"", status:"active", playoffTopOverall:8, autoPlayoff:false };
  }
  // Entrants derived from the category's non-rejected registrations (materialized once so edits persist).
  function entrantsFor(s, tid){
    var ts = tstate(s, tid);
    if(ts.entrants) return ts.entrants;
    var cat = catOf(s, tid);
    var base = LEVEL_ELO[cat.level] || 1500;
    var regs = (s.registrations||[]).filter(function(r){ return r.category===tid && r.status!=="rejected" && r.status!=="cancelled"; });
    ts.entrants = regs.map(function(r, i){
      var p1 = pget(r,0), p2 = pget(r,1);
      var e1 = p1.seedElo || base, e2 = p2.seedElo || base;
      return { entrantId:"ENT_"+tid+"_"+(i+1), player1Name:p1.name||("Pemain "+(i*2+1)),
        player2Name:p2.name||("Pemain "+(i*2+2)), seedElo:Math.round((e1+e2)/2),
        teamName:r.teamName||"", isNewP1:false, isNewP2:false };
    });
    return ts.entrants;
  }
  // Same split rule as engine computeSizesJS (min group 3).
  function splitSizes(n, target){
    target = Math.max(3, target||4);
    if(n<=0) return [];
    var g = Math.max(1, Math.ceil(n/target));
    while(g>1 && Math.floor(n/g)<3) g--;
    var base = Math.floor(n/g), rem = n%g, out = [];
    for(var i=0;i<g;i++) out.push(base + (i<rem?1:0));
    return out;
  }
  function drawGroupsFor(s, tid){
    var ts = tstate(s, tid);
    var ents = entrantsFor(s, tid).slice();
    for(var i=ents.length-1;i>0;i--){ var j=Math.floor(rnd()*(i+1)); var t=ents[i]; ents[i]=ents[j]; ents[j]=t; } // shuffle
    var tour = tournamentOf(s, catOf(s, tid));
    var sizes = splitSizes(ents.length, tour.groupSizeTarget);
    var groups = [], idx = 0;
    for(var gi=0; gi<sizes.length; gi++){
      var members = [];
      for(var k=0;k<sizes[gi];k++){ var e=ents[idx++]; if(e) members.push({ entrantId:e.entrantId,
        player1Name:e.player1Name, player2Name:e.player2Name, seedElo:e.seedElo, teamName:e.teamName }); }
      groups.push({ label:String.fromCharCode(65+gi), size:members.length,
        matches:members.length*(members.length-1)/2, members:members });
    }
    ts.groups = groups; ts.matches = [];
    return groups;
  }
  // Round-robin group matches across all drawn categories, assigned to courts/time slots.
  function genSchedule(s){
    var ev = s.event || {}, numCourts = ev.numCourts || 4, mm = ev.matchMinutes || 15;
    var sp = String(ev.startTime||"08:00").split(":"), startMin = (parseInt(sp[0])||8)*60 + (parseInt(sp[1])||0);
    var flat = [];
    (s.categories||[]).forEach(function(cat){
      var ts = tstate(s, cat.tournamentId);
      if(!ts.groups || !ts.groups.length) return;
      var ms = [];
      ts.groups.forEach(function(g){
        for(var a=0;a<g.members.length;a++) for(var b=a+1;b<g.members.length;b++){
          ms.push({ matchId:"M_"+cat.tournamentId+"_"+(ms.length+1), stage:"GROUP", groupLabel:g.label,
            entrantA:g.members[a].entrantId, entrantB:g.members[b].entrantId,
            scoreA:"", scoreB:"", winner:"", status:"PENDING" });
        }
      });
      ts.matches = ms;
      ms.forEach(function(m){ flat.push(m); });
    });
    flat.forEach(function(m, i){
      var court = (i % numCourts) + 1, sl = Math.floor(i / numCourts), tmin = startMin + sl*mm;
      m.court = court; m.slot = sl;
      m.time = String(Math.floor(tmin/60)).padStart(2,"0")+":"+String(tmin%60).padStart(2,"0");
      m.date = ev.date || "";
    });
    return { scheduledMatches:flat.length, slotsUsed:Math.ceil(flat.length/Math.max(1,numCourts)), numCourts:numCourts };
  }

  // Draw + schedule every category that isn't ready yet (used before scoring stages).
  function ensureSchedule(s){
    s = s || load(); if(!s) return;
    (s.categories||[]).forEach(function(cat){
      var ts = tstate(s, cat.tournamentId);
      if(!ts.groups || !ts.groups.length) drawGroupsFor(s, cat.tournamentId);
    });
    var any = (s.categories||[]).some(function(cat){ return (tstate(s, cat.tournamentId).matches||[]).length; });
    if(!any) genSchedule(s);
    save(s);
  }

  function findMatch(s, matchId){
    var ks = Object.keys(s.tstate||{});
    for(var i=0;i<ks.length;i++){ var arr=s.tstate[ks[i]].matches||[];
      for(var j=0;j<arr.length;j++) if(arr[j].matchId===matchId) return arr[j]; }
    return null;
  }
  function setScore(m, sa, sb){
    m.scoreA = sa; m.scoreB = sb;
    m.winner = sa>sb ? m.entrantA : (sb>sa ? m.entrantB : "");
    m.status = "DONE";
  }
  // Auto-simulate every not-yet-scored group match (best-of to 6).
  function autoScoreAll(s){
    s = s || load(); if(!s) return 0;
    var n = 0;
    (s.categories||[]).forEach(function(cat){
      (tstate(s, cat.tournamentId).matches||[]).forEach(function(m){
        if(m.status==="DONE") return;
        var loser = Math.floor(rnd()*5); // 0..4
        if(rnd()<0.5) setScore(m, 6, loser); else setScore(m, loser, 6);
        n++;
      });
    });
    save(s);
    return n;
  }

  // ---------- public live payload (court-admin / court / mobile / tv) ----------
  function computeStandings(ts, entrants){
    var nameOf = function(eid){ var e=entrants[eid]||{}; return e.teamName || ((e.player1||"")+" + "+(e.player2||"")); };
    return (ts.groups||[]).map(function(g){
      var stat = {};
      g.members.forEach(function(mm){ stat[mm.entrantId] = { eid:mm.entrantId, team:nameOf(mm.entrantId),
        played:0, wins:0, losses:0, draws:0, gf:0, ga:0 }; });
      (ts.matches||[]).forEach(function(m){
        if(m.groupLabel!==g.label || m.status!=="DONE") return;
        var A=stat[m.entrantA], B=stat[m.entrantB]; if(!A||!B) return;
        var sa=parseInt(m.scoreA)||0, sb=parseInt(m.scoreB)||0;
        A.played++; B.played++; A.gf+=sa; A.ga+=sb; B.gf+=sb; B.ga+=sa;
        if(sa>sb){ A.wins++; B.losses++; } else if(sb>sa){ B.wins++; A.losses++; } else { A.draws++; B.draws++; }
      });
      var rows = Object.keys(stat).map(function(k){ var r=stat[k]; r.gd=r.gf-r.ga; r.points=r.wins*3+r.draws; return r; });
      rows.sort(function(a,b){ return (b.wins-a.wins) || (b.gd-a.gd) || (b.gf-a.gf); });
      rows.forEach(function(r,i){ r.rank=i+1; });
      return { label:g.label, standings:rows };
    });
  }
  function publicLive(s){
    var ev = s.event || {};
    var cats = (s.categories||[]).map(function(cat){
      var ts = tstate(s, cat.tournamentId);
      var entrants = {};
      entrantsFor(s, cat.tournamentId).forEach(function(e){
        entrants[e.entrantId] = { player1:e.player1Name, player2:e.player2Name, teamName:e.teamName, seedElo:e.seedElo };
      });
      var nameOf = function(eid){ var e=entrants[eid]||{}; return e.teamName || ((e.player1||"")+" + "+(e.player2||"")); };
      var schedule = (ts.matches||[]).map(function(m){
        return { matchId:m.matchId, court:m.court||0, slot:m.slot||0, time:m.time||"", date:m.date||"",
          groupLabel:m.groupLabel, entrantA:m.entrantA, entrantB:m.entrantB,
          teamA:nameOf(m.entrantA), teamB:nameOf(m.entrantB),
          scoreA:m.scoreA, scoreB:m.scoreB, winner:m.winner, status:m.status };
      });
      return { tournamentId:cat.tournamentId, category:cat.label, level:cat.level, format:"SINGLE",
        advancersPerGroup:2, entrants:entrants, schedule:schedule,
        groups:computeStandings(ts, entrants), playoff:(ts.playoff||[]), playoffProjection:[], qualifyPanel:null };
    });
    return { event:{ name:ev.name, venue:ev.venue, date:ev.date, numCourts:ev.numCourts,
      startTime:ev.startTime, slug:ev.slug, matchMinutes:ev.matchMinutes }, categories:cats, liveEventId:ev.eventId };
  }

  // ---------- playoff (bracket) ----------
  function nameOfEnt(s, tid, eid){
    if(!eid) return "";
    var e = entrantsFor(s, tid).filter(function(x){ return x.entrantId===eid; })[0];
    return e ? (e.teamName || (e.player1Name+" + "+e.player2Name)) : "";
  }
  // Qualified teams, ordered as seeds: top-N overall, or top-2 per group then ranked overall.
  function qualifiedSeeds(s, tid, topOverall){
    var ts = tstate(s, tid);
    var entrants = {}; entrantsFor(s, tid).forEach(function(e){ entrants[e.entrantId]={player1:e.player1Name,player2:e.player2Name,teamName:e.teamName}; });
    var stand = computeStandings(ts, entrants);
    var flat = [];
    if(topOverall>=2){
      stand.forEach(function(g){ (g.standings||[]).forEach(function(r){ flat.push(r); }); });
      flat.sort(function(a,b){ return (b.wins-a.wins)||(b.gd-a.gd)||(b.gf-a.gf)||((a.ga||0)-(b.ga||0)); });
      flat = flat.slice(0, topOverall);
    } else {
      stand.forEach(function(g){ (g.standings||[]).slice(0,2).forEach(function(r){ flat.push(r); }); });
      flat.sort(function(a,b){ return (b.wins-a.wins)||(b.gd-a.gd)||(b.gf-a.gf); });
    }
    return flat.map(function(r){ return { entrantId:r.eid, team:r.team }; });
  }
  // Standard bracket seed order for a power-of-two size B.
  function seedSlots(B){
    var r=[1,2];
    while(r.length<B){ var m=r.length*2+1, nx=[]; r.forEach(function(sd){ nx.push(sd); nx.push(m-sd); }); r=nx; }
    return r;
  }
  function propagatePlayoff(s, tid, br){
    var rounds = br.rounds;
    for(var r=0;r<rounds.length-1;r++){
      rounds[r].matches.forEach(function(m){
        if(!m.winner) return;
        var nxt = rounds[r+1].matches[Math.floor(m.idx/2)];
        if(!nxt) return;
        if(m.idx%2===0){ nxt.entrantA=m.winner; nxt.teamA=nameOfEnt(s,tid,m.winner); }
        else { nxt.entrantB=m.winner; nxt.teamB=nameOfEnt(s,tid,m.winner); }
      });
    }
    if(br.bronze && br.numRounds>=2){
      var semis = rounds[br.numRounds-2] ? rounds[br.numRounds-2].matches : [];
      var losers = [];
      semis.forEach(function(m){ if(m.winner && m.entrantA && m.entrantB){
        losers.push(String(m.winner)===String(m.entrantA)?m.entrantB:m.entrantA); } });
      br.bronze.entrantA=losers[0]||""; br.bronze.teamA=nameOfEnt(s,tid,losers[0]||"");
      br.bronze.entrantB=losers[1]||""; br.bronze.teamB=nameOfEnt(s,tid,losers[1]||"");
    }
  }
  function buildPlayoff(s, tid, topOverall){
    var qual = qualifiedSeeds(s, tid, topOverall);
    var n = qual.length; if(n<2){ tstate(s,tid).playoff=[]; return []; }
    var B=1; while(B<n) B*=2;
    var slots = seedSlots(B);
    var numRounds = Math.round(Math.log(B)/Math.LN2);
    var date = (s.event||{}).date || "";
    var rounds = [];
    var r1 = [];
    for(var i=0;i<B/2;i++){
      var sa=slots[i*2], sb=slots[i*2+1];
      var ea = sa<=n ? qual[sa-1] : null, eb = sb<=n ? qual[sb-1] : null;
      var m = { matchId:"P_"+tid+"_1_"+i, round:1, idx:i,
        entrantA:ea?ea.entrantId:"", entrantB:eb?eb.entrantId:"",
        teamA:ea?ea.team:"", teamB:eb?eb.team:"", scoreA:"", scoreB:"", winner:"", status:"PENDING", court:0, time:"", date:date };
      if(ea && !eb){ m.winner=ea.entrantId; m.status="BYE"; }
      else if(!ea && eb){ m.winner=eb.entrantId; m.status="BYE"; }
      r1.push(m);
    }
    rounds.push({ round:1, matches:r1 });
    for(var rr=2; rr<=numRounds; rr++){
      var cnt = B/Math.pow(2,rr), ms=[];
      for(var j=0;j<cnt;j++) ms.push({ matchId:"P_"+tid+"_"+rr+"_"+j, round:rr, idx:j,
        entrantA:"", entrantB:"", teamA:"", teamB:"", scoreA:"", scoreB:"", winner:"", status:"PENDING", court:0, time:"", date:date });
      rounds.push({ round:rr, matches:ms });
    }
    var bronze = numRounds>=2 ? { matchId:"P_"+tid+"_BRONZE", round:"BRONZE", idx:0,
      entrantA:"", entrantB:"", teamA:"", teamB:"", scoreA:"", scoreB:"", winner:"", status:"PENDING", court:0, time:"", date:date } : null;
    var br = { tier:"MAIN", nQual:n, numRounds:numRounds, rounds:rounds, bronze:bronze,
      method: topOverall>=2 ? "overall" : "cross", entrants:n };
    propagatePlayoff(s, tid, br);
    tstate(s, tid).playoff = [br];
    return [br];
  }
  function findPlayoffMatch(s, matchId){
    var ks = Object.keys(s.tstate||{});
    for(var i=0;i<ks.length;i++){
      var brs = s.tstate[ks[i]].playoff || [];
      for(var b=0;b<brs.length;b++){
        var br=brs[b];
        for(var r=0;r<br.rounds.length;r++){ var ms=br.rounds[r].matches;
          for(var j=0;j<ms.length;j++) if(ms[j].matchId===matchId) return { tid:ks[i], br:br, m:ms[j] }; }
        if(br.bronze && br.bronze.matchId===matchId) return { tid:ks[i], br:br, m:br.bronze };
      }
    }
    return null;
  }
  // Auto-play an entire bracket round by round (used by auto-score / ensureFinished).
  function autoPlayBracket(s, tid, br){
    for(var r=0;r<br.rounds.length;r++){
      br.rounds[r].matches.forEach(function(m){
        if(m.status==="DONE" || m.status==="BYE") return;
        if(!m.entrantA || !m.entrantB) return;
        var lo=Math.floor(rnd()*5); if(rnd()<0.5) setScore(m,6,lo); else setScore(m,lo,6);
      });
      propagatePlayoff(s, tid, br);
    }
    if(br.bronze && br.bronze.entrantA && br.bronze.entrantB && br.bronze.status!=="DONE"){
      var lo2=Math.floor(rnd()*5); if(rnd()<0.5) setScore(br.bronze,6,lo2); else setScore(br.bronze,lo2,6);
    }
  }

  // Approve every waiting registration and file one sample appeal (curation step).
  function autoCurate(s){
    s = s || load(); if(!s) return;
    (s.registrations||[]).forEach(function(r){ if(r.status!=="rejected" && r.status!=="cancelled") r.status="approved"; });
    s.appeals = s.appeals || [];
    if(!s.appeals.length){
      var reg = (s.registrations||[])[0];
      if(reg){
        var p1 = pget(reg,0), p2 = pget(reg,1);
        var g = genPlayer((catOf(s, reg.category)||{}).level || "bronze");
        s.appeals.push({ appealId:"APL_"+Date.now()+"_"+Math.floor(rnd()*100000), category:reg.category,
          againstRegId:reg.reg_id, againstLabel:((p1.name||"")+" + "+(p2.name||""))+" — di-appeal: "+(p1.name||""),
          appellantName:g.name, appellantEmail:g.email, appellantPhone:"",
          reason:"Diduga bermain di atas level kategori (sandbagging).", proofUrl:PLACEHOLDER_IMG, proofUrl2:"",
          createdAt:new Date().toISOString(), status:"baru", decision:"", decidedAt:"", note:"" });
      }
    }
    save(s);
  }

  // Run the whole event to completion: schedule -> score groups -> build + play playoff.
  function ensureFinished(s){
    s = s || load(); if(!s) return;
    ensureSchedule(s);
    autoScoreAll(s);
    (s.categories||[]).forEach(function(cat){
      var ts = tstate(s, cat.tournamentId);
      if(!ts.playoff || !ts.playoff.length) buildPlayoff(s, cat.tournamentId, 0);
      (ts.playoff||[]).forEach(function(br){ autoPlayBracket(s, cat.tournamentId, br); });
    });
    save(s);
  }

  // ---------- router ----------
  // `rest` is everything after /api/ (may include ?query). Returns {status,data}.
  function handle(method, rest, body){
    method = (method||"GET").toUpperCase();
    body = body || {};
    var s = load();

    // Split path and query.
    var path = String(rest||""), query = {};
    var qi = path.indexOf("?");
    if(qi >= 0){
      try{ new URLSearchParams(path.slice(qi+1)).forEach(function(v,k){ query[k]=v; }); }catch(e){}
      path = path.slice(0, qi);
    }
    var seg = path.split("/");

    // ---- auth (sim always grants superadmin) ----
    if(method==="POST" && path==="auth/login"){
      return { status:200, data:{ token:"SIM_TOKEN", role:"superadmin", username: body.username || "Panitia Sim", venue:"" } };
    }

    if(method==="GET" && path==="tournament/events"){
      return { status:200, data:{ events: s && s.event ? [s.event] : [] } };
    }
    if(method==="GET" && /^reg\/public\//.test(path)){
      if(!s || !s.event) return { status:404, data:{ error:"Pendaftaran belum tersedia." } };
      return { status:200, data: publicPayload(s) };
    }

    // ---- registration (daftar) ----
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
      var rcat = catOf(s, reg.category);
      var waitlist = !!(rcat.quota>0 && filledFor(s, reg.category) >= rcat.quota);
      s.registrations.push(reg); save(s);
      return { status:200, data:{ success:true, regId:reg.reg_id, waitlist:waitlist } };
    }

    // ---- payment (bayar) ----
    if(method==="GET" && /^reg\/pay-info\//.test(path)){
      if(!s) return { status:404, data:{ error:"Event tidak ditemukan." } };
      var pr = (s.registrations||[]).find(function(r){ return r.reg_id===query.r; }) || (s.registrations||[])[0];
      if(!pr) return { status:404, data:{ error:"Pendaftaran tidak ditemukan." } };
      var pc = catOf(s, pr.category);
      return { status:200, data:{ theme:(s.config||{}).theme||"", status:pr.status||"pending",
        team: pr.teamName || ((pget(pr,0).name||"")+" & "+(pget(pr,1).name||"")),
        category: pc.label || "", eventName:(s.event||{}).name || "",
        fee: pc.fee!=null?pc.fee:150000, account:"BCA 1234567890 a.n. Panitia Sim (demo)" } };
    }
    if(method==="POST" && path==="reg/pay"){
      if(!s) return { status:404, data:{ error:"Event tidak ditemukan." } };
      var payreg = (s.registrations||[]).find(function(r){ return r.reg_id===body.regId; });
      if(payreg){ payreg.paymentProof = body.proof || payreg.paymentProof || PLACEHOLDER_IMG; payreg.status = "received"; save(s); }
      return { status:200, data:{ success:true } };
    }

    // ---- roster (public) ----
    if(method==="GET" && /^reg\/roster\//.test(path)){
      if(!s || !s.event) return { status:404, data:{ error:"Roster belum tersedia." } };
      return { status:200, data: rosterPayload(s) };
    }

    // ---- curation / admin ----
    if(method==="GET" && /^reg\/event\/[^/]+\/registrations$/.test(path)){
      if(!s) return { status:200, data:{ registrations:[] } };
      return { status:200, data:{ registrations: (s.registrations||[]).map(function(r){ return adminReg(s, r); }) } };
    }
    if(method==="POST" && /^reg\/event\/[^/]+\/approve$/.test(path)){
      if(s){ var ar=(s.registrations||[]).find(function(r){return r.reg_id===body.regId;}); if(ar){ ar.status="approved"; save(s); } }
      return { status:200, data:{ success:true } };
    }
    if(method==="POST" && /^reg\/event\/[^/]+\/reject$/.test(path)){
      if(s){ var rr=(s.registrations||[]).find(function(r){return r.reg_id===body.regId;}); if(rr){ rr.status="rejected"; save(s); } }
      return { status:200, data:{ success:true } };
    }
    if(method==="POST" && /^reg\/event\/[^/]+\/delete-reg$/.test(path)){
      if(s){ s.registrations=(s.registrations||[]).filter(function(r){return r.reg_id!==body.regId;}); save(s); }
      return { status:200, data:{ success:true } };
    }

    // ---- appeal window + blast ----
    if(method==="POST" && /^reg\/event\/[^/]+\/appeal-deadline$/.test(path)){
      if(s){ s.config = s.config||{}; s.config.timeline = s.config.timeline||{};
        s.config.timeline.appealDeadlineISO = body.iso || "";
        s.config.timeline.appealDeadline = body.iso ? new Date(body.iso).toLocaleString("id-ID") : "";
        save(s); }
      return { status:200, data:{ success:true, appealOpen: s?appealOpenNow(s):true } };
    }
    if(method==="POST" && /^reg\/event\/[^/]+\/roster-blast$/.test(path)){
      var n = s ? activeRegCount(s) : 0;
      return { status:200, data:{ success:true, sent:n, recipients:n } };
    }

    // ---- appeals ----
    if(method==="GET" && /^reg\/event\/[^/]+\/appeals$/.test(path)){
      if(!s) return { status:200, data:{ appeals:[] } };
      return { status:200, data:{ appeals: appealList(s), count:(s.appeals||[]).length } };
    }
    if(method==="POST" && path==="reg/appeal"){
      if(!s) return { status:404, data:{ error:"Event tidak ditemukan." } };
      s.appeals = s.appeals || [];
      var ap = {
        appealId: "APL_"+Date.now()+"_"+Math.floor(rnd()*100000),
        category: body.category || "", againstRegId: body.againstRegId || "",
        againstLabel: body.againstLabel || "", appellantName: body.appellantName || "",
        appellantEmail: body.appellantEmail || "", appellantPhone: "",
        reason: body.reason || "", proofUrl: body.proof || "", proofUrl2: body.proof2 || "",
        createdAt: new Date().toISOString(), status: "baru", decision: "", decidedAt: "", note: ""
      };
      s.appeals.push(ap); save(s);
      return { status:200, data:{ success:true, appealId:ap.appealId } };
    }
    if(method==="POST" && /^reg\/appeal\/[^/]+\/decision$/.test(path)){
      if(s){ var aid=seg[2]; var a=(s.appeals||[]).find(function(x){return x.appealId===aid;});
        if(a){ a.decision=body.decision||""; a.note=body.note||""; a.decidedAt=new Date().toISOString();
          a.status = a.decision==="levelup" ? "levelup" : "decided"; save(s); } }
      return { status:200, data:{ success:true } };
    }
    if(method==="POST" && /^reg\/appeal\/[^/]+\/apply-level$/.test(path)){
      if(s){ var aid2=seg[2]; var a2=(s.appeals||[]).find(function(x){return x.appealId===aid2;});
        if(a2){ a2.status="applied"; save(s); } }
      return { status:200, data:{ success:true, applied:(body.players||[]).map(function(nm){ return { name:nm }; }) } };
    }

    // ---- engine: event / category create (if driven from the engine UI) ----
    if(method==="POST" && path==="tournament/event"){
      if(!s) s = seedEvent({});
      if(body.name) s.event.name = body.name;
      if(body.venue) s.event.venue = body.venue;
      if(body.date) s.event.date = body.date;
      if(body.startTime) s.event.startTime = body.startTime;
      if(body.numCourts) s.event.numCourts = parseInt(body.numCourts)||s.event.numCourts;
      if(body.matchMinutes) s.event.matchMinutes = parseInt(body.matchMinutes)||s.event.matchMinutes;
      save(s);
      return { status:200, data:{ eventId: s.event.eventId } };
    }
    if(method==="POST" && path==="tournament"){
      if(!s) s = seedEvent({});
      var tid = "TM_SIM_"+((s.categories||[]).length+1);
      s.categories.push({ tournamentId:tid, label:body.category||"Kategori", level:String(body.level||"bronze"),
        fee:150000, quota:16, req:"" });
      save(s);
      return { status:200, data:{ tournamentId:tid } };
    }

    // ---- engine: tournaments / entrants / groups / schedule ----
    if(method==="GET" && path==="tournament/list"){
      if(!s) return { status:200, data:{ tournaments:[] } };
      return { status:200, data:{ tournaments:(s.categories||[]).map(function(c){ return tournamentOf(s, c); }) } };
    }
    if(method==="GET" && /^tournament\/[^/]+$/.test(path)){
      if(!s) return { status:404, data:{ error:"Event tidak ditemukan." } };
      var gcat = catOf(s, seg[1]);
      if(!gcat.tournamentId) return { status:404, data:{ error:"Kategori tidak ditemukan." } };
      return { status:200, data:{ tournament:tournamentOf(s, gcat), entrantCount:entrantsFor(s, seg[1]).length } };
    }
    if(method==="DELETE" && /^tournament\/[^/]+$/.test(path)){
      if(s){ s.categories = (s.categories||[]).filter(function(c){ return c.tournamentId!==seg[1]; });
        s.registrations = (s.registrations||[]).filter(function(r){ return r.category!==seg[1]; });
        if(s.tstate) delete s.tstate[seg[1]]; save(s); }
      return { status:200, data:{ success:true } };
    }
    if(method==="PUT" && /^tournament\/[^/]+\/level$/.test(path)){
      if(s){ var lc=catOf(s, seg[1]); if(lc.tournamentId){ lc.level=String(body.level||lc.level); save(s); } }
      return { status:200, data:{ success:true } };
    }
    if(method==="GET" && /^tournament\/[^/]+\/entrants$/.test(path)){
      if(!s) return { status:200, data:{ entrants:[] } };
      return { status:200, data:{ entrants: entrantsFor(s, seg[1]) } };
    }
    if(method==="PUT" && path==="tournament/entrant"){
      if(s){ Object.keys(s.tstate||{}).forEach(function(tid){
        var arr = (s.tstate[tid].entrants)||[];
        arr.forEach(function(e){ if(e.entrantId===body.entrantId){ var u=body.updates||{};
          if(u.player1Name!=null) e.player1Name=u.player1Name;
          if(u.player2Name!=null) e.player2Name=u.player2Name;
          if(u.teamName!=null) e.teamName=u.teamName;
          if(u.seedElo!=null) e.seedElo=parseInt(u.seedElo)||e.seedElo; } });
      }); save(s); }
      return { status:200, data:{ success:true } };
    }
    if((method==="POST"||method==="PUT") && /^tournament\/[^/]+\/import/.test(path)){
      if(!s) return { status:200, data:{ entrants:[], imported:0, preview:[] } };
      var ie = entrantsFor(s, seg[1]);
      return { status:200, data:{ entrants:ie, preview:ie, imported:ie.length, added:ie.length } };
    }
    if(method==="POST" && /^tournament\/[^/]+\/draw$/.test(path)){
      if(!s) return { status:404, data:{ error:"Event tidak ditemukan." } };
      var dg = drawGroupsFor(s, seg[1]); save(s);
      return { status:200, data:{ success:true, groupCount:dg.length, groups:dg } };
    }
    if(method==="GET" && /^tournament\/[^/]+\/groups$/.test(path)){
      if(!s) return { status:200, data:{ groups:[] } };
      return { status:200, data:{ groups: tstate(s, seg[1]).groups || [] } };
    }
    if(method==="PUT" && /^tournament\/[^/]+\/groups$/.test(path)){
      if(s){ var tsg = tstate(s, seg[1]);
        var byId = {}; entrantsFor(s, seg[1]).forEach(function(e){ byId[e.entrantId]=e; });
        tsg.groups = (body.groups||[]).map(function(gp, gi){
          var members = (gp.entrantIds||[]).map(function(id){ var e=byId[id]||{};
            return { entrantId:id, player1Name:e.player1Name, player2Name:e.player2Name, seedElo:e.seedElo, teamName:e.teamName }; });
          return { label:String.fromCharCode(65+gi), size:members.length,
            matches:members.length*(members.length-1)/2, members:members };
        });
        save(s); }
      return { status:200, data:{ success:true } };
    }
    if(method==="GET" && /^tournament\/[^/]+\/matches$/.test(path)){
      if(!s) return { status:200, data:{ matches:[] } };
      return { status:200, data:{ matches: tstate(s, seg[1]).matches || [] } };
    }
    if(method==="GET" && /^tournament\/[^/]+\/standings$/.test(path)){
      if(!s) return { status:200, data:{ groups:[], rankMode:"wins" } };
      var stEnt={}; entrantsFor(s, seg[1]).forEach(function(e){ stEnt[e.entrantId]={player1:e.player1Name,player2:e.player2Name,teamName:e.teamName}; });
      return { status:200, data:{ groups: computeStandings(tstate(s, seg[1]), stEnt), rankMode:"wins" } };
    }
    if(method==="GET" && /^tournament\/[^/]+\/playoff$/.test(path)){
      if(!s) return { status:200, data:{ brackets:[], projection:[], qualifyPanel:null, topOverall:0, autoPlayoff:{auto:false} } };
      var pts = tstate(s, seg[1]);
      return { status:200, data:{ brackets: pts.playoff||[], projection:[], qualifyPanel:null,
        topOverall: pts.topOverall||0, autoPlayoff:{ auto: !!pts.autoPlayoff } } };
    }
    if(method==="POST" && /^tournament\/[^/]+\/playoff$/.test(path)){
      if(!s) return { status:404, data:{ error:"Event tidak ditemukan." } };
      var brs = buildPlayoff(s, seg[1], parseInt(body.topOverall)||0); save(s);
      return { status:200, data:{ brackets: brs.map(function(b){ return { tier:b.tier, entrants:b.entrants, method:b.method }; }) } };
    }
    if(method==="DELETE" && /^tournament\/[^/]+\/playoff$/.test(path)){
      if(s){ tstate(s, seg[1]).playoff=[]; save(s); }
      return { status:200, data:{ success:true } };
    }
    if(method==="PUT" && /^tournament\/[^/]+\/playoff-plan$/.test(path)){
      if(s){ tstate(s, seg[1]).topOverall = parseInt(body.topOverall)||0; save(s); }
      return { status:200, data:{ success:true } };
    }
    if(method==="PUT" && /^tournament\/[^/]+\/playoff-auto$/.test(path)){
      if(s){ tstate(s, seg[1]).autoPlayoff = !!body.auto; save(s); }
      return { status:200, data:{ success:true } };
    }
    if((method==="POST"||method==="PUT") && /^tournament\/event\/[^/]+\/schedule$/.test(path)){
      if(!s) return { status:200, data:{ scheduledMatches:0 } };
      if(method==="PUT") return { status:200, data:{ updated:(body.edits||[]).length, skipped:0, errorCount:0 } };
      if(body.numCourts) s.event.numCourts = parseInt(body.numCourts)||s.event.numCourts;
      if(body.matchMinutes) s.event.matchMinutes = parseInt(body.matchMinutes)||s.event.matchMinutes;
      if(body.startTime) s.event.startTime = body.startTime;
      var sch = genSchedule(s); save(s);
      return { status:200, data:{ engine:"grid-parallel-v1", mode:(body.mode==="intense"?"intense":"normal"),
        courtLayout:"parallel", scheduledMatches:sch.scheduledMatches, slotsUsed:sch.slotsUsed,
        numCourts:sch.numCourts, breaks:body.breaks||[], categoryStarts:{}, clashes:[] } };
    }
    if(method==="GET" && path==="tournament/archived-events") return { status:200, data:{ events:[] } };

    // ---- scoring (court-admin / court / mobile / tv) ----
    if(method==="GET" && /^tournament\/event\/[^/]+\/public$/.test(path)){
      if(!s || !s.event) return { status:404, data:{ error:"Event tidak ditemukan." } };
      return { status:200, data: publicLive(s) };
    }
    if(method==="GET" && path==="settings"){
      return { status:200, data:{ settings:{ liveEventId: (s && s.event) ? s.event.eventId : "" } } };
    }
    if(method==="POST" && path==="settings") return { status:200, data:{ success:true } };
    if(method==="PUT" && path==="tournament/match"){
      if(s){ var gm=findMatch(s, body.matchId); if(gm){ setScore(gm, parseInt(body.scoreA)||0, parseInt(body.scoreB)||0); save(s); return { status:200, data:{ success:true, winner:gm.winner, status:"DONE" } }; } }
      return { status:200, data:{ success:true } };
    }
    if(method==="PUT" && path==="tournament/playoff/match"){
      if(s){ var pf=findPlayoffMatch(s, body.matchId);
        if(pf){ setScore(pf.m, parseInt(body.scoreA)||0, parseInt(body.scoreB)||0); propagatePlayoff(s, pf.tid, pf.br); save(s);
          return { status:200, data:{ success:true, winner:pf.m.winner } }; } }
      return { status:200, data:{ success:true } };
    }

    // ---- finalize ELO / publish (recap wrap-up; all mock — never touches real ELO) ----
    if(method==="POST" && /^tournament\/event\/[^/]+\/finalize-elo\/review$/.test(path)){
      var rv = [];
      if(s) (s.categories||[]).forEach(function(cat){ entrantsFor(s, cat.tournamentId).forEach(function(e){
        rv.push({ name:e.player1Name, status:"new", elo:e.seedElo, matches:0, warnings:[], similar:[] });
        rv.push({ name:e.player2Name, status:"new", elo:e.seedElo, matches:0, warnings:[], similar:[] });
      }); });
      return { status:200, data:{ total:rv.length, players:rv } };
    }
    if(method==="POST" && /^tournament\/event\/[^/]+\/finalize-elo\/rename-player$/.test(path)){
      return { status:200, data:{ success:true, changed:1 } };
    }
    if(method==="POST" && /^tournament\/event\/[^/]+\/finalize-elo$/.test(path)){
      var results = [], replayed = 0;
      if(s) (s.categories||[]).forEach(function(cat){
        var ts2 = tstate(s, cat.tournamentId);
        replayed += (ts2.matches||[]).filter(function(m){ return m.status==="DONE"; }).length;
        entrantsFor(s, cat.tournamentId).forEach(function(e){
          [e.player1Name, e.player2Name].forEach(function(nm){
            var delta = Math.floor(rnd()*70) - 30;
            results.push({ name:nm, oldElo:e.seedElo, newElo:e.seedElo+delta, delta:delta });
          });
        });
      });
      return { status:200, data:{ playersUpdated:results.length, matchesReplayed:replayed, recomputed:!!body.force, results:results } };
    }
    if(method==="POST" && /^tournament\/event\/[^/]+\/(publish-venue|archive)$/.test(path)){
      return { status:200, data:{ success:true, published:true } };
    }
    if(method==="PUT" && path==="tournament/match/meta"){
      if(s){ var mm2=findMatch(s, body.matchId); if(mm2){ if(body.court!=null && body.court!=="") mm2.court=parseInt(body.court)||mm2.court; if(body.time!=null && body.time!=="") mm2.time=body.time; save(s); } }
      return { status:200, data:{ success:true } };
    }

    // Unknown endpoint in sim mode — succeed quietly so the real page doesn't error.
    return { status:200, data:{} };
  }

  window.__SIM__ = {
    KEY: KEY, EVENT_ID: EVENT_ID, PLACEHOLDER_IMG: PLACEHOLDER_IMG,
    LEVEL_ELO: LEVEL_ELO, LEVEL_LABEL: LEVEL_LABEL,
    load: load, save: save, reset: reset, seedEvent: seedEvent,
    autoRegister: autoRegister, genPlayer: genPlayer, genPair: genPair,
    ensureSchedule: ensureSchedule, autoScore: autoScoreAll, autoCurate: autoCurate, ensureFinished: ensureFinished,
    handle: handle
  };
})();
