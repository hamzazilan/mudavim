(function () {
  "use strict";

  // =================================================================
  //  AYARLAR
  // =================================================================
  const CFG = window.MUDAVIM_CONFIG || {};
  const FB_ON = !!(
    window.firebase &&
    CFG.firebase &&
    CFG.firebase.apiKey &&
    !String(CFG.firebase.apiKey).startsWith("BURAYA")
  );
  const ADMIN_EMAILS = (CFG.adminEmails || []).map((e) => String(e).trim().toLowerCase());
  const STORE_KEY = "mudavim-db-v2";
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let fbAuth = null;
  let fbDb = null;
  if (FB_ON) {
    firebase.initializeApp(CFG.firebase);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
  }

  // =================================================================
  //  VERİ
  //  Firebase açıksa veri Firestore'dan gelir (seasons, players, matches).
  //  Kapalıysa data.js + bu tarayıcının localStorage'ı kullanılır.
  // =================================================================
  let DB = null;
  let isLocal = false; // localStorage'daki kopya mı kullanılıyor
  let needsSeed = false; // Firestore boş, data.js henüz yüklenmedi

  function normalize(db) {
    db.club = db.club || window.MUDAVIM.club;
    db.players = db.players || [];
    db.matches = db.matches || [];
    db.seasons = (db.seasons || []).map((s, i) => ({ ...s, order: s.order ?? i, legacy: s.legacy || {} }));
    db.seasons.sort((a, b) => a.order - b.order);
    return db;
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        isLocal = true;
        return normalize(JSON.parse(raw));
      }
    } catch (e) {}
    isLocal = false;
    return normalize(clone(window.MUDAVIM));
  }

  async function loadRemote() {
    const [s, p, m] = await Promise.all(
      ["seasons", "players", "matches"].map((c) => fbDb.collection(c).get())
    );
    const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const db = { seasons: docs(s), players: docs(p), matches: docs(m) };
    if (!db.seasons.length && !db.players.length) {
      needsSeed = true;
      return normalize(clone(window.MUDAVIM));
    }
    needsSeed = false;
    return normalize(db);
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(DB));
      isLocal = true;
    } catch (e) {
      throw new Error("Tarayıcı depolamaya izin vermiyor.");
    }
  }

  const withoutId = ({ id, ...rest }) => JSON.parse(JSON.stringify(rest)); // undefined alanları da temizler

  // Her yazma işlemi: önce Firestore (varsa), sonra yerel kopya.
  async function write(remoteFn, localFn) {
    try {
      if (FB_ON) {
        if (needsSeed) throw new Error("Önce data.js verisini Firebase'e yükle (Veri Gir sayfası).");
        await remoteFn();
      }
      localFn();
      if (!FB_ON) saveLocal();
      return true;
    } catch (e) {
      console.error(e);
      toast("Kaydedilemedi: " + errText(e), true);
      return false;
    }
  }

  const col = (name) => fbDb.collection(name);

  const store = {
    addMatch: (m) => write(() => col("matches").doc(m.id).set(toRemoteMatch(m)), () => DB.matches.push(m)),
    openVoting: (m, untilMs) =>
      write(
        () =>
          col("matches").doc(m.id).update({
            voteUntil: firebase.firestore.Timestamp.fromMillis(untilMs),
            ratingFinal: false,
          }),
        () => {
          m.voteUntil = untilMs;
          m.ratingFinal = false;
          m.ratingSummary = m.ratingSummary || {};
        }
      ),
    deleteMatch: (id) =>
      write(() => col("matches").doc(id).delete(), () => (DB.matches = DB.matches.filter((m) => m.id !== id))),
    addSeason: (s) => write(() => col("seasons").doc(s.id).set(withoutId(s)), () => DB.seasons.push(s)),
    renameSeason: (id, name) =>
      write(() => col("seasons").doc(id).update({ name }), () => (seasonById(id).name = name)),
    deleteSeason: (id) =>
      write(() => col("seasons").doc(id).delete(), () => (DB.seasons = DB.seasons.filter((s) => s.id !== id))),
    addPlayer: (p) => write(() => col("players").doc(p.id).set(withoutId(p)), () => DB.players.push(p)),
    setPlayerUid: (id, uid) =>
      write(
        () => col("players").doc(id).update({ uid: uid || null }),
        () => (DB.players.find((p) => p.id === id).uid = uid || null)
      ),
  };

  async function seedRemote() {
    const src = normalize(clone(window.MUDAVIM));
    const batch = fbDb.batch();
    for (const s of src.seasons) batch.set(col("seasons").doc(s.id), withoutId(s));
    for (const p of src.players) batch.set(col("players").doc(p.id), withoutId(p));
    for (const m of src.matches) batch.set(col("matches").doc(m.id), withoutId(m));
    await batch.commit();
  }

  function exportDataJs() {
    const out = clone(DB);
    out.seasons.forEach((s) => delete s.order);
    const text =
      "// MÜDAVİM VERİ DOSYASI — siteden dışa aktarıldı: " +
      new Date().toLocaleString("tr-TR") +
      "\nwindow.MUDAVIM = " +
      JSON.stringify(out, null, 2) +
      ";\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "data.js";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const playerById = () => Object.fromEntries(DB.players.map((p) => [p.id, p]));
  const seasonById = (id) => DB.seasons.find((s) => s.id === id);
  const currentSeason = () => DB.seasons[DB.seasons.length - 1] || null;

  // =================================================================
  //  OTURUM
  // =================================================================
  const session = { user: null, profile: null, ready: !FB_ON };

  const emailOf = (u) => (u && u.email ? u.email.toLowerCase() : "");
  const isAdminUser = (u) => !!u && u.emailVerified && ADMIN_EMAILS.includes(emailOf(u));

  // Firebase yoksa (yerel mod) herkes düzenleyebilir — eski davranış.
  const isAdmin = () => (FB_ON ? isAdminUser(session.user) : true);
  const isApproved = () => isAdmin() || (session.profile && session.profile.status === "approved");
  const myPlayer = () => session.user && DB.players.find((p) => p.uid === session.user.uid);

  async function ensureProfile(user) {
    const ref = col("users").doc(user.uid);
    const snap = await ref.get();
    if (snap.exists) return snap.data();
    const data = {
      email: emailOf(user),
      displayName: session.pendingName || user.displayName || emailOf(user).split("@")[0],
      status: isAdminUser(user) ? "approved" : "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return data;
  }

  const AUTH_ERRORS = {
    "auth/invalid-credential": "Mail veya şifre hatalı.",
    "auth/wrong-password": "Mail veya şifre hatalı.",
    "auth/user-not-found": "Bu maille kayıtlı hesap yok.",
    "auth/email-already-in-use": "Bu mail zaten kayıtlı. Giriş yapmayı dene.",
    "auth/weak-password": "Şifre en az 6 karakter olmalı.",
    "auth/invalid-email": "Geçerli bir mail adresi yaz.",
    "auth/missing-password": "Şifre yaz.",
    "auth/popup-closed-by-user": "Google penceresi kapatıldı.",
    "auth/popup-blocked": "Tarayıcı açılır pencereyi engelledi.",
    "auth/unauthorized-domain": "Bu adres Firebase'de yetkili değil (Authentication > Settings > Authorized domains).",
    "auth/operation-not-supported-in-this-environment":
      "Giriş, dosyayı doğrudan açınca çalışmaz; siteyi GitHub Pages adresinden aç.",
    "auth/too-many-requests": "Çok fazla deneme yapıldı, biraz bekle.",
    "auth/network-request-failed": "İnternet bağlantısı yok gibi görünüyor.",
    "permission-denied": "Bu işlem için yetkin yok.",
  };
  const errText = (e) => AUTH_ERRORS[e && e.code] || (e && e.message) || String(e);

  // =================================================================
  //  YARDIMCILAR
  // =================================================================
  const app = document.getElementById("app");

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const initials = (name) =>
    String(name || "")
      .split(/\s+/)
      .filter((w) => /\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => w[0].toLocaleUpperCase("tr"))
      .join("") || "?";

  function slugify(str) {
    const map = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u" };
    return str
      .toLocaleLowerCase("tr")
      .replace(/[çğıöşüâîû]/g, (c) => map[c] || c)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function uniqueId(base, exists) {
    base = base || "x";
    let id = base;
    let n = 2;
    while (exists(id)) id = `${base}-${n++}`;
    return id;
  }

  const pct = (won, played) => (played ? (won / played) * 100 : 0);
  const fmtPct = (v) => "%" + Math.round(v);
  const todayIso = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fmtDate = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });

  function winTier(rate) {
    if (rate >= 75) return "tier-elite";
    if (rate >= 62) return "tier-great";
    if (rate >= 52) return "tier-good";
    if (rate >= 45) return "tier-ok";
    if (rate >= 35) return "tier-poor";
    return "tier-bad";
  }

  const badge = (rate) => `<span class="badge ${winTier(rate)}">${fmtPct(rate)}</span>`;
  const avatar = (p, size = "") => `<span class="avatar ${size}">${esc(initials(p.name))}</span>`;

  function toast(msg, isError) {
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 10);
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, isError ? 4500 : 2600);
  }

  // İki tıklamalı onay
  function confirmClick(btn, action) {
    btn.addEventListener("click", () => {
      if (btn.dataset.armed) return action();
      btn.dataset.armed = "1";
      const old = btn.textContent;
      btn.textContent = "Emin misin? Tekrar tıkla";
      btn.classList.add("armed");
      setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = old;
        btn.classList.remove("armed");
      }, 3000);
    });
  }

  // Buton çalışırken kilitle
  async function busy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await fn();
    } finally {
      btn.disabled = false;
    }
  }

  function resultFor(m, pid) {
    const [h, a] = m.score;
    if (m.home.players.includes(pid)) return h > a ? "W" : h < a ? "L" : "D";
    if (m.away.players.includes(pid)) return a > h ? "W" : a < h ? "L" : "D";
    return null;
  }
  const RES_LABEL = { W: "G", D: "B", L: "M" };
  const resChip = (r) => `<span class="chip res-${r}">${RES_LABEL[r]}</span>`;

  const sortedMatches = (list) =>
    [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  // =================================================================
  //  RATING
  //  privateVotes : {match, rater, target, score, uid}  → admin + puanı veren okur
  //  publicVotes  : {match, target, score}              → herkes okur (isimsiz)
  //  voteLocks    : aynı kişiye iki kez puan verilmesini engeller
  //  Puanlama süresi bitince admin tarayıcısı sonuçları maçın içine
  //  (ratingSummary) yazar; böylece eski maçlar için tekrar okuma gerekmez.
  // =================================================================
  const VOTE_DAYS = 3;
  const tsMs = (t) =>
    !t ? 0 : typeof t === "number" ? t : t.toMillis ? t.toMillis() : t.seconds ? t.seconds * 1000 : 0;
  const votingOpen = (m) => FB_ON && Date.now() < tsMs(m.voteUntil);
  const inMatch = (m, pid) => m.home.players.includes(pid) || m.away.players.includes(pid);

  function ratingOf(m, pid) {
    const r = m.ratingSummary && m.ratingSummary[pid];
    return r && r.n ? r.s / r.n : null;
  }

  // Maçın oyuncusu: en yüksek ortalama (eşitlikte daha çok oy alan)
  function motmOf(m) {
    let best = null;
    for (const pid of [...m.home.players, ...m.away.players]) {
      const r = m.ratingSummary && m.ratingSummary[pid];
      if (!r || !r.n) continue;
      const avg = r.s / r.n;
      if (!best || avg > best.avg || (avg === best.avg && r.n > best.n)) best = { pid, avg, n: r.n };
    }
    return best && best.pid;
  }

  function ratingTier(v) {
    if (v >= 9) return "tier-elite";
    if (v >= 8) return "tier-great";
    if (v >= 7) return "tier-good";
    if (v >= 6) return "tier-ok";
    if (v >= 5) return "tier-poor";
    return "tier-bad";
  }

  const ratingBadge = (v, title = "") =>
    v == null
      ? `<span class="badge none">–</span>`
      : `<span class="badge ${ratingTier(v)}" ${title ? `title="${esc(title)}"` : ""}>${v.toFixed(1)}</span>`;

  // Puanlaması bitmemiş maçların isimsiz oylarını okuyup ortalamaları hesapla
  async function loadRatings() {
    const open = DB.matches.filter((m) => !m.ratingFinal && m.voteUntil);
    for (let i = 0; i < open.length; i += 30) {
      const chunk = open.slice(i, i + 30);
      const snap = await col("publicVotes").where("match", "in", chunk.map((m) => m.id)).get();
      const agg = {};
      snap.forEach((d) => {
        const v = d.data();
        const a = (agg[v.match] = agg[v.match] || {});
        const r = (a[v.target] = a[v.target] || { s: 0, n: 0 });
        r.s += v.score;
        r.n += 1;
      });
      for (const m of chunk) {
        m.ratingSummary = agg[m.id] || {};
        liveLoaded.add(m.id);
      }
    }
  }
  const liveLoaded = new Set(); // oyları başarıyla okunmuş maçlar

  // Admin girişinde: süresi dolan maçların sonuçlarını kalıcı yaz
  async function finalizeRatings() {
    if (!FB_ON || !isAdmin() || needsSeed) return;
    const closed = DB.matches.filter(
      (m) => !m.ratingFinal && m.voteUntil && liveLoaded.has(m.id) && Date.now() > tsMs(m.voteUntil) + 60000
    );
    for (const m of closed) {
      try {
        await col("matches").doc(m.id).update({ ratingSummary: m.ratingSummary || {}, ratingFinal: true });
        m.ratingFinal = true;
      } catch (e) {
        console.error("Rating sonucu yazılamadı", m.id, e);
      }
    }
  }

  // Maç tarihinin sonu ya da şimdi (hangisi sonraysa) + VOTE_DAYS gün
  function voteDeadlineFor(dateIso) {
    const end = new Date(dateIso + "T23:59:59").getTime();
    return Math.max(end, Date.now()) + VOTE_DAYS * 86400000;
  }

  function toRemoteMatch(m) {
    const data = withoutId({ ...m, voteUntil: undefined });
    if (m.voteUntil) data.voteUntil = firebase.firestore.Timestamp.fromMillis(tsMs(m.voteUntil));
    return data;
  }

  // =================================================================
  //  İSTATİSTİK  (seasonId yoksa tüm zamanlar)
  // =================================================================
  function computeStats(seasonId) {
    const stats = {};
    for (const p of DB.players) {
      stats[p.id] = {
        player: p, played: 0, won: 0, drawn: 0, lost: 0, legacyPlayed: 0, goals: 0, assists: 0,
        ratings: [], motm: 0,
      };
    }
    for (const season of DB.seasons) {
      if (seasonId && season.id !== seasonId) continue;
      for (const [pid, l] of Object.entries(season.legacy || {})) {
        const s = stats[pid];
        if (!s) continue;
        s.played += l.played;
        s.won += l.won;
        s.legacyPlayed += l.played;
      }
    }
    for (const m of DB.matches) {
      if (seasonId && m.season !== seasonId) continue;
      for (const pid of [...m.home.players, ...m.away.players]) {
        const s = stats[pid];
        if (!s) continue;
        const r = resultFor(m, pid);
        s.played++;
        if (r === "W") s.won++;
        else if (r === "D") s.drawn++;
        else s.lost++;
        const rt = ratingOf(m, pid);
        if (rt != null) s.ratings.push(rt);
      }
      for (const g of m.goals || []) {
        if (stats[g.player]) stats[g.player].goals++;
        if (g.assist && stats[g.assist]) stats[g.assist].assists++;
      }
      const best = motmOf(m);
      if (best && stats[best]) stats[best].motm++;
    }
    for (const s of Object.values(stats)) {
      s.rate = pct(s.won, s.played);
      s.rating = s.ratings.length ? s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length : null;
    }
    return stats;
  }

  // =================================================================
  //  ORTAK PARÇALAR
  // =================================================================
  function seasonPills(activeId) {
    return `
      <div class="pills">
        <a class="pill ${!activeId ? "active" : ""}" href="#/">Tüm zamanlar</a>
        ${[...DB.seasons]
          .reverse()
          .map((s) => `<a class="pill ${s.id === activeId ? "active" : ""}" href="#/sezon/${s.id}">${esc(s.name)}</a>`)
          .join("")}
      </div>`;
  }

  function highlightsHtml(statsList) {
    const active = statsList.filter((s) => s.played > 0);
    if (!active.length) return "";
    const maxPlayed = Math.max(...active.map((s) => s.played));
    const minForRate = Math.min(10, Math.max(1, Math.ceil(maxPlayed / 3)));
    const best = (key, pool) => [...pool].sort((a, b) => b[key] - a[key] || b.played - a.played)[0];
    const items = [
      { label: "En çok maç", s: best("played", active), value: (s) => s.played + " maç" },
      { label: "En çok galibiyet", s: best("won", active), value: (s) => s.won + " G" },
      {
        label: `En iyi oran (${minForRate}+ maç)`,
        s: best("rate", active.filter((s) => s.played >= minForRate)),
        value: (s) => fmtPct(s.rate),
      },
    ];
    const rated = active.filter((s) => s.ratings.length);
    if (rated.length) {
      const maxRated = Math.max(...rated.map((s) => s.ratings.length));
      const minRated = Math.max(1, Math.ceil(maxRated / 3));
      items.push({
        label: `En yüksek rating (${minRated}+ maç)`,
        s: best("rating", rated.filter((s) => s.ratings.length >= minRated)),
        value: (s) => s.rating.toFixed(2),
      });
    }
    items.splice(0, items.length, ...items.filter((h) => h.s));

    return `
      <section class="highlights">
        ${items
          .map(
            (h) => `
          <a class="card hl" href="#/oyuncu/${h.s.player.id}">
            ${avatar(h.s.player)}
            <div>
              <div class="hl-label">${h.label}</div>
              <div class="hl-name">${esc(h.s.player.name)}</div>
            </div>
            <div class="hl-value">${h.value(h.s)}</div>
          </a>`
          )
          .join("")}
      </section>`;
  }

  const tableState = { sort: "played", dir: -1, minPlayed: 1, q: "" };
  const COLUMNS = [
    { key: "played", label: "Maç" },
    { key: "won", label: "G" },
    { key: "other", label: "B+M", hideSm: true },
    { key: "rate", label: "Gal. Oranı" },
    { key: "rating", label: "Rating" },
  ];

  function mountStandings(el, statsList) {
    const minOptions = [1, 5, 10, 20];
    el.innerHTML = `
      <div class="card-head">
        <h2>Oyuncular</h2>
        <div class="filters">
          <input class="input" data-q type="search" placeholder="Oyuncu ara…" value="${esc(tableState.q)}">
          <select class="select" data-min>
            ${minOptions
              .map((n) => `<option value="${n}" ${n === tableState.minPlayed ? "selected" : ""}>En az ${n} maç</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>#</th><th>Oyuncu</th>
          ${COLUMNS.map(
            (c) => `<th class="num sortable ${c.hideSm ? "hide-sm" : ""} ${tableState.sort === c.key ? "sorted" : ""}"
                     data-sort="${c.key}">${c.label}${tableState.sort === c.key ? (tableState.dir < 0 ? " ↓" : " ↑") : ""}</th>`
          ).join("")}
          <th class="hide-sm"></th>
        </tr></thead>
        <tbody></tbody>
      </table></div>`;

    const tbody = el.querySelector("tbody");
    const val = (s) =>
      tableState.sort === "other" ? s.played - s.won : tableState.sort === "rating" ? s.rating ?? -1 : s[tableState.sort];
    const mine = myPlayer();

    function draw() {
      const q = tableState.q.trim().toLocaleLowerCase("tr");
      const rows = statsList
        .filter((s) => s.played > 0 && s.played >= tableState.minPlayed)
        .filter((s) => !q || s.player.name.toLocaleLowerCase("tr").includes(q))
        .sort((a, b) => (val(b) - val(a)) * -tableState.dir || b.played - a.played);

      tbody.innerHTML = rows.length
        ? rows
            .map(
              (s, i) => `
          <tr data-id="${s.player.id}" class="${mine && mine.id === s.player.id ? "me" : ""}">
            <td class="rank">${i + 1}</td>
            <td><div class="who">${avatar(s.player, "sm")}${esc(s.player.name)}</div></td>
            <td class="num">${s.played}</td>
            <td class="num">${s.won}</td>
            <td class="num hide-sm">${s.played - s.won}</td>
            <td class="num">${badge(s.rate)}</td>
            <td class="num">${ratingBadge(s.rating, s.ratings.length ? s.ratings.length + " maç" : "")}</td>
            <td class="hide-sm"><span class="bar"><i style="width:${s.rate}%"></i></span></td>
          </tr>`
            )
            .join("")
        : `<tr><td colspan="8" class="empty">Gösterilecek oyuncu yok.</td></tr>`;
    }
    draw();

    el.querySelector("[data-q]").addEventListener("input", (e) => {
      tableState.q = e.target.value;
      draw();
    });
    el.querySelector("[data-min]").addEventListener("change", (e) => {
      tableState.minPlayed = Number(e.target.value);
      draw();
    });
    el.querySelectorAll("th.sortable").forEach((th) =>
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        tableState.dir = tableState.sort === key ? -tableState.dir : -1;
        tableState.sort = key;
        mountStandings(el, statsList);
      })
    );
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) location.hash = "#/oyuncu/" + tr.dataset.id;
    });
  }

  function matchRow(m, showSeason = true) {
    const [h, a] = m.score;
    const season = seasonById(m.season);
    return `
      <a class="match-row" href="#/mac/${m.id}">
        <div class="m-date">${fmtDate(m.date)}${showSeason && season ? `<small>${esc(season.name)}</small>` : ""}</div>
        <div class="m-team home ${h > a ? "win" : ""}">${esc(m.home.name)}</div>
        <div class="m-score">${h} <span>-</span> ${a}</div>
        <div class="m-team away ${a > h ? "win" : ""}">${esc(m.away.name)}</div>
      </a>`;
  }

  function matchListCard(title, matches, showSeason = true, emptyText = "Henüz maç girilmedi.") {
    return `
      <section class="card">
        <div class="card-head"><h2>${title}</h2><span class="muted">${matches.length} maç</span></div>
        ${
          matches.length
            ? `<div class="match-list">${sortedMatches(matches).map((m) => matchRow(m, showSeason)).join("")}</div>`
            : `<div class="empty">${emptyText}${isAdmin() ? ` <a class="link" href="#/veri">Maç gir →</a>` : ""}</div>`
        }
      </section>`;
  }

  const adminBtn = (href, label) => (isAdmin() ? `<a class="btn" href="${href}">${label}</a>` : "");

  // =================================================================
  //  SAYFALAR — herkese açık
  // =================================================================
  function renderHome() {
    const stats = Object.values(computeStats());
    app.innerHTML = `
      <h1 class="page-title">Sıralama</h1>
      <p class="page-sub">Tüm sezonlar birlikte · ${DB.players.length} müdavim</p>
      ${seasonPills(null)}
      ${highlightsHtml(stats)}
      <section class="card" id="standings"></section>`;
    mountStandings(document.getElementById("standings"), stats);
  }

  function renderSeasons() {
    const cur = currentSeason();
    app.innerHTML = `
      <div class="title-row">
        <div>
          <h1 class="page-title">Sezonlar</h1>
          <p class="page-sub">${DB.seasons.length} sezon${cur ? " · güncel sezon: " + esc(cur.name) : ""}</p>
        </div>
        ${adminBtn("#/veri#sezon", "+ Yeni sezon")}
      </div>
      <section class="season-grid">
        ${[...DB.seasons]
          .reverse()
          .map((s) => {
            const st = Object.values(computeStats(s.id)).filter((x) => x.played > 0);
            const matches = DB.matches.filter((m) => m.season === s.id);
            const top = [...st].sort((a, b) => b.played - a.played)[0];
            return `
            <a class="card season-card" href="#/sezon/${s.id}">
              <div class="season-head">
                <span class="season-name">${esc(s.name)}</span>
                ${s === cur ? `<span class="tag">Güncel</span>` : ""}
              </div>
              <div class="season-nums">
                <div><b>${matches.length}</b><small>Kayıtlı maç</small></div>
                <div><b>${st.length}</b><small>Oyuncu</small></div>
              </div>
              ${s.note ? `<div class="muted small">${esc(s.note)}</div>` : ""}
              ${top ? `<div class="season-top">En çok oynayan: <b>${esc(top.player.name)}</b> (${top.played})</div>` : ""}
            </a>`;
          })
          .join("")}
      </section>`;
  }

  function renderSeason(id) {
    const season = seasonById(id);
    if (!season) return renderNotFound();
    const stats = Object.values(computeStats(id));
    const matches = DB.matches.filter((m) => m.season === id);
    const active = stats.filter((s) => s.played > 0);

    app.innerHTML = `
      <div class="title-row">
        <div>
          <h1 class="page-title">${esc(season.name)} ${season === currentSeason() ? `<span class="tag">Güncel</span>` : ""}</h1>
          <p class="page-sub">${matches.length} kayıtlı maç · ${active.length} oyuncu${season.note ? " · " + esc(season.note) : ""}</p>
        </div>
        ${adminBtn("#/veri", "+ Maç gir")}
      </div>
      ${seasonPills(id)}
      ${highlightsHtml(stats)}
      <section class="card" id="standings" style="margin-bottom:16px"></section>
      ${matchListCard("Maçlar", matches, false, "Bu sezona henüz maç girilmedi.")}`;
    mountStandings(document.getElementById("standings"), stats);
  }

  function renderMatches() {
    app.innerHTML = `
      <div class="title-row">
        <div>
          <h1 class="page-title">Maçlar</h1>
          <p class="page-sub">Siteye girilen tüm maçlar</p>
        </div>
        ${adminBtn("#/veri", "+ Maç gir")}
      </div>
      ${matchListCard("Maç geçmişi", DB.matches)}`;
  }

  function renderMatch(id) {
    const m = DB.matches.find((x) => x.id === id);
    if (!m) return renderNotFound();
    const P = playerById();
    const season = seasonById(m.season);
    const [h, a] = m.score;

    const motm = motmOf(m);
    const lineup = (team, won) => `
      <div class="card lineup">
        <div class="card-head"><h2>${esc(team.name)}</h2>${won ? `<span class="tag">Kazanan</span>` : ""}</div>
        <ul>
          ${team.players
            .map((pid) => P[pid] || { id: pid, name: pid })
            .map((p) => {
              const r = m.ratingSummary && m.ratingSummary[p.id];
              return `<li><a href="#/oyuncu/${p.id}">
                ${avatar(p, "sm")}<span class="ln-name">${esc(p.name)}</span>
                ${p.id === motm ? `<span class="motm" title="Maçın oyuncusu">★</span>` : ""}
                ${ratingBadge(ratingOf(m, p.id), r ? r.n + " oy" : "")}
              </a></li>`;
            })
            .join("")}
        </ul>
      </div>`;

    const motmP = motm && (P[motm] || { id: motm, name: motm });
    const motmHtml = motmP
      ? `<a class="card motm-card" href="#/oyuncu/${motmP.id}">
          <span class="motm big">★</span>
          <div><div class="hl-label">Maçın oyuncusu</div><div class="hl-name">${esc(motmP.name)}</div></div>
          <div class="motm-val">${ratingBadge(ratingOf(m, motm))}</div>
        </a>`
      : "";

    app.innerHTML = `
      <a class="back" href="#/maclar">← Maçlar</a>
      <section class="card scoreboard">
        <div class="sb-meta">${fmtDate(m.date)}${season ? ` · <a href="#/sezon/${season.id}">${esc(season.name)}</a>` : ""}</div>
        <div class="sb-main">
          <div class="sb-team ${h > a ? "win" : ""}">${esc(m.home.name)}</div>
          <div class="sb-score">${h} <span>-</span> ${a}</div>
          <div class="sb-team ${a > h ? "win" : ""}">${esc(m.away.name)}</div>
        </div>
        <div class="sb-meta">${h === a ? "Berabere" : "Maç sonu"} · ${m.home.players.length} v ${m.away.players.length}</div>
      </section>
      ${motmHtml}
      <section class="lineups">
        ${lineup(m.home, h > a)}
        ${lineup(m.away, a > h)}
      </section>
      <div id="vote"></div>
      <div id="vote-admin"></div>`;

    mountVotePanel(m);
    mountAdminVotes(m);
  }

  // ---- Puanlama paneli ----
  async function mountVotePanel(m) {
    const el = document.getElementById("vote");
    if (!el || !FB_ON) return;
    const open = votingOpen(m);
    const until = tsMs(m.voteUntil);
    const untilText = until
      ? new Date(until).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
      : "";

    const shell = (inner, head = "Oyuncuları puanla") => `
      <section class="card vote-card">
        <div class="card-head"><h2>${head}</h2>${open ? `<span class="muted">${untilText}'e kadar açık</span>` : ""}</div>
        ${inner}
      </section>`;

    // Admin: puanlamayı aç / uzat
    const adminTools = isAdmin()
      ? `<div class="pad form-actions"><button class="btn ghost" id="v-open">${
          open ? `Süreyi ${VOTE_DAYS} gün uzat` : `Puanlamayı aç (${VOTE_DAYS} gün)`
        }</button></div>`
      : "";
    const bindAdminTools = () => {
      const b = document.getElementById("v-open");
      if (b)
        b.addEventListener("click", () =>
          busy(b, async () => {
            if (await store.openVoting(m, Date.now() + VOTE_DAYS * 86400000)) {
              toast("Puanlama açıldı.");
              renderMatch(m.id);
            }
          })
        );
    };

    const mine = myPlayer();
    const plays = mine && inMatch(m, mine.id);

    if (!open) {
      if (!until && !isAdmin()) return (el.innerHTML = "");
      el.innerHTML = shell(
        `<div class="empty">${until ? "Bu maçın puanlaması kapandı." : "Bu maç için puanlama açılmadı."}</div>${adminTools}`,
        "Puanlama"
      );
      return bindAdminTools();
    }
    if (!session.ready) return (el.innerHTML = shell(`<div class="empty">Yükleniyor…</div>`));
    if (!session.user) {
      el.innerHTML = shell(`<div class="empty">Bu maçta oynadıysan puan vermek için <a class="link" href="#/giris">giriş yap</a>.</div>`);
      return;
    }
    if (!plays) {
      el.innerHTML = shell(
        `<div class="empty">${
          !mine
            ? `Puan verebilmek için <a class="link" href="#/hesap">oyuncu profilini seç</a>.`
            : "Sadece bu maçta oynayanlar puan verebilir."
        }</div>${adminTools}`
      );
      return bindAdminTools();
    }

    // Daha önce puanladıklarını bul
    el.innerHTML = shell(`<div class="empty">Yükleniyor…</div>`);
    let done = new Set();
    try {
      const snap = await col("voteLocks").where("match", "==", m.id).where("uid", "==", session.user.uid).get();
      snap.forEach((d) => done.add(d.data().target));
    } catch (err) {
      el.innerHTML = shell(`<div class="empty">Puanlar yüklenemedi: ${esc(errText(err))}</div>`);
      return;
    }
    if (!document.body.contains(el)) return;

    const P = playerById();
    const myTeam = m.home.players.includes(mine.id) ? "home" : "away";
    const groups = [
      { title: m[myTeam].name + " (takımın)", ids: m[myTeam].players },
      { title: m[myTeam === "home" ? "away" : "home"].name + " (rakip)", ids: m[myTeam === "home" ? "away" : "home"].players },
    ];
    const targets = [...m.home.players, ...m.away.players].filter((pid) => pid !== mine.id);
    const left = targets.filter((pid) => !done.has(pid));
    const picks = {};

    el.innerHTML = shell(`
      <div class="pad muted">
        Maçtaki performanslarına göre 1–10 arası puan ver. Puanların gizlidir; diğer üyeler sadece ortalamaları görür.
        <b>Gönderdikten sonra değiştirilemez.</b>
      </div>
      ${groups
        .map(
          (g) => `
        <div class="vote-group">${esc(g.title)}</div>
        ${g.ids
          .filter((pid) => pid !== mine.id)
          .map((pid) => {
            const p = P[pid] || { id: pid, name: pid };
            return `
          <div class="vote-row" data-pid="${pid}">
            <span class="who">${avatar(p, "sm")}${esc(p.name)}</span>
            ${
              done.has(pid)
                ? `<span class="voted">Puanladın ✓</span>`
                : `<span class="score-btns">${Array.from({ length: 10 }, (_, i) => i + 1)
                    .map((n) => `<button type="button" data-score="${n}">${n}</button>`)
                    .join("")}</span>`
            }
          </div>`;
          })
          .join("")}`
        )
        .join("")}
      ${
        left.length
          ? `<div class="pad form-actions"><span class="muted" id="v-count">0 / ${left.length} seçildi</span>
               <button class="btn" id="v-send">Puanları gönder</button></div>`
          : `<div class="pad muted">Bu maçtaki herkesi puanladın. Teşekkürler!</div>`
      }
      ${adminTools}`);
    bindAdminTools();

    el.querySelectorAll(".score-btns").forEach((wrap) =>
      wrap.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-score]");
        if (!b) return;
        const pid = wrap.closest("[data-pid]").dataset.pid;
        picks[pid] = Number(b.dataset.score);
        wrap.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
        wrap.className = "score-btns picked " + ratingTier(picks[pid]);
        document.getElementById("v-count").textContent = `${Object.keys(picks).length} / ${left.length} seçildi`;
      })
    );

    const send = document.getElementById("v-send");
    if (send)
      send.addEventListener("click", () =>
        busy(send, async () => {
          const entries = Object.entries(picks).filter(([pid]) => !done.has(pid));
          if (!entries.length) return toast("Önce en az bir oyuncuya puan ver.", true);
          let ok = 0;
          for (const [target, score] of entries) {
            const vid = col("privateVotes").doc().id;
            const batch = fbDb.batch();
            batch.set(col("privateVotes").doc(vid), { match: m.id, rater: mine.id, target, score, uid: session.user.uid });
            batch.set(col("voteLocks").doc(`${m.id}_${mine.id}_${target}`), {
              match: m.id, rater: mine.id, target, uid: session.user.uid, voteId: vid,
            });
            batch.set(col("publicVotes").doc(vid), { match: m.id, target, score });
            try {
              await batch.commit();
              ok++;
              m.ratingSummary = m.ratingSummary || {};
              const r = (m.ratingSummary[target] = m.ratingSummary[target] || { s: 0, n: 0 });
              r.s += score;
              r.n += 1;
            } catch (err) {
              console.error(err);
              toast("Bir puan gönderilemedi: " + errText(err), true);
              break;
            }
          }
          if (ok) {
            toast(`${ok} puan gönderildi.`);
            renderMatch(m.id);
          }
        })
      );
  }

  // ---- Admin: kim kime kaç verdi ----
  function mountAdminVotes(m) {
    const el = document.getElementById("vote-admin");
    if (!el || !FB_ON || !isAdmin() || !m.voteUntil) return;
    el.innerHTML = `
      <section class="card admin-votes">
        <div class="card-head"><h2>Puan detayları <span class="tag">Sadece admin</span></h2>
          <button class="btn ghost" id="va-load">Göster</button></div>
        <div id="va-body"></div>
      </section>`;
    const btn = document.getElementById("va-load");
    btn.addEventListener("click", () =>
      busy(btn, async () => {
        const body = document.getElementById("va-body");
        let votes;
        try {
          const snap = await col("privateVotes").where("match", "==", m.id).get();
          votes = snap.docs.map((d) => d.data());
        } catch (err) {
          body.innerHTML = `<div class="empty">Yüklenemedi: ${esc(errText(err))}</div>`;
          return;
        }
        const P = playerById();
        const name = (pid) => esc((P[pid] && P[pid].name) || pid);
        const byRater = {};
        votes.forEach((v) => (byRater[v.rater] = byRater[v.rater] || []).push(v));
        const raters = Object.keys(byRater).sort((a, b) => name(a).localeCompare(name(b), "tr"));
        const players = [...m.home.players, ...m.away.players];
        const notVoted = players.filter((pid) => !byRater[pid]);

        body.innerHTML = votes.length
          ? `<div class="table-wrap"><table class="plain">
              <thead><tr><th>Puan veren</th>${players.map((pid) => `<th class="num vt">${name(pid)}</th>`).join("")}</tr></thead>
              <tbody>${raters
                .map(
                  (r) => `<tr><td><b>${name(r)}</b></td>${players
                    .map((t) => {
                      const v = byRater[r].find((x) => x.target === t);
                      return `<td class="num">${t === r ? `<span class="muted">—</span>` : v ? ratingBadge(v.score) : ""}</td>`;
                    })
                    .join("")}</tr>`
                )
                .join("")}</tbody>
            </table></div>
            ${notVoted.length ? `<div class="pad muted">Henüz puan vermeyenler: ${notVoted.map(name).join(", ")}</div>` : ""}`
          : `<div class="empty">Bu maç için henüz puan verilmedi.</div>`;
        btn.hidden = true;
      })
    );
  }

  function renderPlayer(id) {
    const all = computeStats();
    const s = all[id];
    if (!s) return renderNotFound();
    const p = s.player;
    const other = s.played - s.won;
    const isMe = session.user && p.uid === session.user.uid;

    const myMatches = sortedMatches(DB.matches.filter((m) => resultFor(m, id)));
    const formChips = myMatches.slice(0, 5).map((m) => resChip(resultFor(m, id))).join("");

    const perSeason = [...DB.seasons]
      .reverse()
      .map((season) => ({ season, st: computeStats(season.id)[id] }))
      .filter((x) => x.st.played > 0);

    app.innerHTML = `
      <a class="back" href="#/">← Sıralama</a>

      <section class="card profile">
        ${avatar(p, "lg")}
        <div>
          <h1>${esc(p.name)} ${isMe ? `<span class="tag">Sen</span>` : ""}</h1>
          <div class="meta">${esc(DB.club.name)}${p.uid && !isMe ? " · Üye hesabına bağlı" : ""}</div>
          ${formChips ? `<div class="form">Son maçlar: ${formChips}</div>` : ""}
        </div>
        <div class="big-badge">${badge(s.rate)}<small>Galibiyet oranı</small></div>
      </section>

      <section class="stat-grid">
        <div class="card stat"><div class="v">${s.played}</div><div class="l">Maç</div></div>
        <div class="card stat"><div class="v">${s.won}</div><div class="l">Galibiyet</div></div>
        <div class="card stat"><div class="v">${other}</div><div class="l">Beraberlik + Mağlubiyet</div></div>
        <div class="card stat"><div class="v">${s.rating != null ? ratingBadge(s.rating) : "–"}</div>
          <div class="l">Ort. rating</div><div class="s">${s.ratings.length} puanlanan maç</div></div>
        <div class="card stat"><div class="v">${s.motm}</div><div class="l">Maçın oyuncusu</div></div>
        <div class="card stat"><div class="v">${s.goals}</div><div class="l">Gol</div></div>
        <div class="card stat"><div class="v">${s.assists}</div><div class="l">Asist</div></div>
      </section>

      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Sezonlar</h2></div>
        ${
          perSeason.length
            ? `<div class="table-wrap"><table class="plain">
                <thead><tr><th>Sezon</th><th class="num">Maç</th><th class="num">G</th><th class="num">B+M</th><th class="num">Oran</th><th class="num">Rating</th></tr></thead>
                <tbody>${perSeason
                  .map(
                    ({ season, st }) => `
                  <tr data-href="#/sezon/${season.id}">
                    <td>${esc(season.name)}</td>
                    <td class="num">${st.played}</td>
                    <td class="num">${st.won}</td>
                    <td class="num">${st.played - st.won}</td>
                    <td class="num">${badge(st.rate)}</td>
                    <td class="num">${ratingBadge(st.rating)}</td>
                  </tr>`
                  )
                  .join("")}</tbody>
              </table></div>`
            : `<div class="empty">Kayıt yok.</div>`
        }
      </section>

      <section class="card">
        <div class="card-head"><h2>Maç geçmişi</h2><span class="muted">${myMatches.length} kayıtlı maç</span></div>
        ${
          myMatches.length
            ? `<div class="match-list">${myMatches
                .map(
                  (m) =>
                    `<div class="with-res">${resChip(resultFor(m, id))}${matchRow(m)}<span class="row-rating">${
                      motmOf(m) === id ? `<span class="motm" title="Maçın oyuncusu">★</span>` : ""
                    }${ratingBadge(ratingOf(m, id))}</span></div>`
                )
                .join("")}</div>`
            : `<div class="empty">Siteye girilmiş maçı yok.${
                s.legacyPlayed ? `<br>Excel'den gelen ${s.legacyPlayed} maçın detayı kayıtlı değil.` : ""
              }</div>`
        }
      </section>`;

    app.querySelectorAll("tr[data-href]").forEach((tr) =>
      tr.addEventListener("click", () => (location.hash = tr.dataset.href))
    );
  }

  // =================================================================
  //  GİRİŞ / KAYIT
  // =================================================================
  let authTab = "login";

  function renderLogin() {
    if (!FB_ON) return renderNoFirebase();
    if (session.user) return (location.hash = "#/hesap");

    app.innerHTML = `
      <div class="auth-wrap">
        <section class="card auth-card">
          <img class="auth-logo" src="assets/logo.png" alt="">
          <h1 class="page-title">${authTab === "login" ? "Giriş yap" : "Kayıt ol"}</h1>
          <p class="page-sub">${
            authTab === "login"
              ? "Müdavim hesabınla giriş yap."
              : "Kayıt olduktan sonra bir admin hesabını onaylayacak."
          }</p>

          <div class="tabs">
            <button class="${authTab === "login" ? "active" : ""}" data-tab="login">Giriş</button>
            <button class="${authTab === "signup" ? "active" : ""}" data-tab="signup">Kayıt ol</button>
          </div>

          <button class="btn google" id="a-google">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Google ile devam et
          </button>

          <div class="divider"><span>ya da mail ile</span></div>

          <form id="a-form" class="auth-form" novalidate>
            ${
              authTab === "signup"
                ? `<label>Adın <input class="input" id="a-name" autocomplete="name" placeholder="Ad Soyad"></label>`
                : ""
            }
            <label>Mail <input class="input" id="a-email" type="email" autocomplete="email" placeholder="ornek@gmail.com"></label>
            <label>Şifre <input class="input" id="a-pass" type="password" autocomplete="${
              authTab === "login" ? "current-password" : "new-password"
            }" placeholder="${authTab === "signup" ? "En az 6 karakter" : ""}"></label>
            <button class="btn" type="submit" id="a-submit">${authTab === "login" ? "Giriş yap" : "Kayıt ol"}</button>
          </form>
          ${authTab === "login" ? `<button class="text-btn" id="a-forgot">Şifremi unuttum</button>` : ""}
        </section>
      </div>`;

    app.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        authTab = b.dataset.tab;
        renderLogin();
      })
    );

    const $ = (id) => document.getElementById(id);

    $("a-google").addEventListener("click", (e) =>
      busy(e.currentTarget, async () => {
        try {
          await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (err) {
          toast(errText(err), true);
        }
      })
    );

    $("a-form").addEventListener("submit", (e) => {
      e.preventDefault();
      busy($("a-submit"), async () => {
        const email = $("a-email").value.trim();
        const pass = $("a-pass").value;
        try {
          if (authTab === "login") {
            await fbAuth.signInWithEmailAndPassword(email, pass);
          } else {
            const name = $("a-name").value.trim();
            if (!name) return toast("Adını yaz.", true);
            // Profil onAuthStateChanged içinde oluşturulur; adı oraya taşımak için önceden sakla
            session.pendingName = name;
            const cred = await fbAuth.createUserWithEmailAndPassword(email, pass);
            await cred.user.updateProfile({ displayName: name });
            await cred.user.sendEmailVerification();
            toast("Kayıt oldun. Mailine doğrulama bağlantısı gönderdik.");
          }
        } catch (err) {
          toast(errText(err), true);
        }
      });
    });

    if ($("a-forgot"))
      $("a-forgot").addEventListener("click", async () => {
        const email = $("a-email").value.trim();
        if (!email) return toast("Önce mail adresini yaz.", true);
        try {
          await fbAuth.sendPasswordResetEmail(email);
          toast("Şifre sıfırlama maili gönderildi.");
        } catch (err) {
          toast(errText(err), true);
        }
      });
  }

  // =================================================================
  //  HESABIM
  // =================================================================
  function renderAccount() {
    if (!FB_ON) return renderNoFirebase();
    if (!session.user) return (location.hash = "#/giris");

    const u = session.user;
    const prof = session.profile || {};
    const admin = isAdmin();
    const approved = isApproved();
    const mine = myPlayer();
    const usesPassword = u.providerData.some((p) => p.providerId === "password");
    const isListedAdmin = ADMIN_EMAILS.includes(emailOf(u));

    const statusHtml = admin
      ? `<span class="status ok">Admin</span>`
      : prof.status === "approved"
      ? `<span class="status ok">Onaylı üye</span>`
      : prof.status === "rejected"
      ? `<span class="status bad">Reddedildi</span>`
      : `<span class="status wait">Onay bekliyor</span>`;

    const verifyHtml =
      usesPassword && !u.emailVerified
        ? `<section class="card notice">
            <div><b>Mailini doğrula.</b> ${esc(u.email)} adresine bir doğrulama bağlantısı gönderdik.
            ${isListedAdmin ? "Admin yetkilerin mailini doğruladıktan sonra açılacak." : ""}</div>
            <div class="notice-actions">
              <button class="btn ghost" id="v-resend">Tekrar gönder</button>
              <button class="btn" id="v-check">Doğruladım</button>
            </div>
          </section>`
        : "";

    let body = "";
    if (approved && needsSeed) {
      body = `
        <section class="card notice">
          <div><b>Veritabanı henüz kurulmadı.</b> ${
            admin
              ? "Profil seçmeden önce oyuncu listesini Firebase'e yükle."
              : "Bir admin oyuncu listesini yükleyince buradan profilini seçebileceksin."
          }</div>
          ${admin ? `<div class="notice-actions"><a class="btn" href="#/veri">Veri Gir'e git</a></div>` : ""}
        </section>`;
    } else if (!approved) {
      body =
        prof.status === "rejected"
          ? `<section class="card pad">Kaydın bir admin tarafından reddedildi. Bir hata olduğunu düşünüyorsan adminlerle konuş.</section>`
          : `<section class="card pad wait-card">
              <div class="big-icon">⏳</div>
              <div>
                <b>Hesabın onay bekliyor.</b><br>
                Bir admin kaydını onayladığında buradan oyuncu profilini seçebileceksin.
              </div>
            </section>`;
    } else if (mine) {
      body = `
        <section class="card">
          <div class="card-head"><h2>Oyuncu profilin</h2></div>
          <div class="pad linked">
            <a class="who" href="#/oyuncu/${mine.id}">${avatar(mine)}<b>${esc(mine.name)}</b></a>
            <button class="btn ghost danger" id="l-unlink">Bağlantıyı kaldır</button>
          </div>
        </section>`;
    } else {
      const free = DB.players
        .filter((p) => !p.uid)
        .sort((a, b) => a.name.localeCompare(b.name, "tr"));
      body = `
        <section class="card">
          <div class="card-head"><h2>Oyuncu profilini seç</h2></div>
          <div class="pad">
            <p class="muted">Daha önce maçlara girdiysen listeden kendini seç. Listede yoksan adınla yeni profil oluştur.</p>
            <div class="inline-form">
              <select class="select" id="l-pick">
                <option value="">Listeden seç…</option>
                ${free.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
              </select>
              <button class="btn" id="l-claim">Bu benim</button>
            </div>
            <div class="divider"><span>ya da</span></div>
            <div class="inline-form">
              <input class="input" id="l-new" placeholder="Adın (sitede böyle görünecek)" maxlength="40"
                value="${esc(prof.displayName || u.displayName || "")}">
              <button class="btn ghost" id="l-create">Yeni profil oluştur</button>
            </div>
          </div>
        </section>`;
    }

    app.innerHTML = `
      <h1 class="page-title">Hesabım</h1>
      <p class="page-sub">${esc(u.email)} ${statusHtml}</p>
      ${verifyHtml}
      ${body}
      <div class="form-actions" style="margin-top:16px">
        <button class="btn ghost" id="logout">Çıkış yap</button>
      </div>`;

    const $ = (id) => document.getElementById(id);

    $("logout").addEventListener("click", async () => {
      await fbAuth.signOut();
      location.hash = "#/";
    });

    if ($("v-resend"))
      $("v-resend").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          try {
            await u.sendEmailVerification();
            toast("Doğrulama maili tekrar gönderildi.");
          } catch (err) {
            toast(errText(err), true);
          }
        })
      );

    if ($("v-check"))
      $("v-check").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          await u.reload();
          if (!fbAuth.currentUser.emailVerified) return toast("Mail henüz doğrulanmamış görünüyor.", true);
          await fbAuth.currentUser.getIdToken(true); // yeni yetkiler için token'ı yenile
          session.user = fbAuth.currentUser;
          toast("Mail doğrulandı.");
          await refreshSession();
        })
      );

    if ($("l-claim"))
      $("l-claim").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          const id = $("l-pick").value;
          if (!id) return toast("Listeden bir oyuncu seç.", true);
          if (await store.setPlayerUid(id, u.uid)) {
            toast("Profilin bağlandı.");
            renderAccount();
            updateTopbar();
          }
        })
      );

    if ($("l-create"))
      $("l-create").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          const name = $("l-new").value.trim().replace(/\s+/g, " ");
          if (name.length < 2) return toast("Adını yaz.", true);
          if (DB.players.some((p) => p.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr")))
            return toast("Bu isimde bir oyuncu zaten var; listeden seçmeyi dene.", true);
          const id = uniqueId(slugify(name), (x) => DB.players.some((p) => p.id === x));
          const player = { id, name, uid: u.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
          const ok = await write(
            () => col("players").doc(id).set(withoutIdKeepTs(player)),
            () => DB.players.push({ id, name, uid: u.uid })
          );
          if (ok) {
            toast("Profilin oluşturuldu.");
            renderAccount();
            updateTopbar();
          }
        })
      );

    if ($("l-unlink"))
      confirmClick($("l-unlink"), async () => {
        if (await store.setPlayerUid(mine.id, null)) {
          toast("Bağlantı kaldırıldı.");
          renderAccount();
          updateTopbar();
        }
      });
  }

  // serverTimestamp nesnesini JSON'a çevirmeden id'yi çıkar
  const withoutIdKeepTs = ({ id, ...rest }) => rest;

  // =================================================================
  //  ÜYELER (admin)
  // =================================================================
  async function renderMembers() {
    if (!FB_ON) return renderNoFirebase();
    if (!isAdmin()) return renderAdminOnly();

    app.innerHTML = `<h1 class="page-title">Üyeler</h1><div class="card empty">Yükleniyor…</div>`;
    let users;
    try {
      const snap = await col("users").get();
      users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    } catch (err) {
      app.innerHTML = `<h1 class="page-title">Üyeler</h1><div class="card empty">Üyeler yüklenemedi: ${esc(
        errText(err)
      )}<br>firestore.rules dosyasındaki admin listesini kontrol et.</div>`;
      return;
    }
    if (location.hash.split("#")[1] !== "/uyeler") return; // kullanıcı bu arada başka sayfaya geçti

    const time = (u) => (u.createdAt && u.createdAt.toMillis ? u.createdAt.toMillis() : 0);
    users.sort((a, b) => time(b) - time(a));
    const linked = (uid) => DB.players.find((p) => p.uid === uid);

    const group = (title, list, actions) => `
      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>${title}</h2><span class="muted">${list.length}</span></div>
        ${
          list.length
            ? `<ul class="member-list">${list
                .map((u) => {
                  const p = linked(u.uid);
                  const adminTag = ADMIN_EMAILS.includes((u.email || "").toLowerCase()) ? `<span class="tag">Admin</span>` : "";
                  return `
                <li data-uid="${u.uid}">
                  <div class="member-info">
                    <b>${esc(u.displayName || "—")}</b> ${adminTag}
                    <span class="muted">${esc(u.email)}</span>
                    ${p ? `<span class="muted">Oyuncu: <a class="link" href="#/oyuncu/${p.id}">${esc(p.name)}</a></span>` : ""}
                  </div>
                  <div class="member-actions">${actions(u, p)}</div>
                </li>`;
                })
                .join("")}</ul>`
            : `<div class="empty">Yok.</div>`
        }
      </section>`;

    const pending = users.filter((u) => u.status === "pending");
    const approved = users.filter((u) => u.status === "approved");
    const rejected = users.filter((u) => u.status === "rejected");

    app.innerHTML = `
      <h1 class="page-title">Üyeler</h1>
      <p class="page-sub">${users.length} kayıtlı hesap · ${pending.length} onay bekliyor</p>
      ${group("Onay bekleyenler", pending, () => `
        <button class="btn" data-act="approve">Onayla</button>
        <button class="btn ghost danger" data-act="reject">Reddet</button>`)}
      ${group("Onaylı üyeler", approved, (u, p) => `
        ${p ? `<button class="btn ghost" data-act="unlink" data-player="${p.id}">Profili ayır</button>` : ""}
        ${u.uid !== session.user.uid ? `<button class="btn ghost danger" data-act="reject">Onayı kaldır</button>` : ""}`)}
      ${group("Reddedilenler", rejected, () => `
        <button class="btn ghost" data-act="approve">Onayla</button>
        <button class="btn ghost danger" data-act="delete">Kaydı sil</button>`)}`;

    app.querySelectorAll("[data-act]").forEach((btn) => {
      const uid = btn.closest("[data-uid]").dataset.uid;
      const run = () =>
        busy(btn, async () => {
          try {
            const act = btn.dataset.act;
            if (act === "approve") await col("users").doc(uid).update({ status: "approved" });
            else if (act === "reject") await col("users").doc(uid).update({ status: "rejected" });
            else if (act === "delete") await col("users").doc(uid).delete();
            else if (act === "unlink") {
              if (!(await store.setPlayerUid(btn.dataset.player, null))) return;
            }
            toast("Güncellendi.");
            renderMembers();
          } catch (err) {
            toast(errText(err), true);
          }
        });
      if (["reject", "delete", "unlink"].includes(btn.dataset.act)) confirmClick(btn, run);
      else btn.addEventListener("click", run);
    });
  }

  // =================================================================
  //  VERİ GİR (admin)
  // =================================================================
  const form = {
    season: null,
    date: null,
    homeName: "Sarılar",
    awayName: "Siyahlar",
    homeScore: "",
    awayScore: "",
    side: {},
    q: "",
  };

  function suggestNextSeasonName() {
    const last = currentSeason();
    const m = last && /^WS\s?(\d{2})\/(\d{2})$/i.exec(last.name);
    if (!m) return "";
    const pad = (n) => String(n % 100).padStart(2, "0");
    return `WS${pad(+m[1] + 1)}/${pad(+m[2] + 1)}`;
  }

  function renderAdmin() {
    if (!isAdmin()) return renderAdminOnly();

    if (FB_ON && needsSeed) {
      app.innerHTML = `
        <h1 class="page-title">Veri Gir</h1>
        <section class="card notice">
          <div><b>Firebase veritabanı boş.</b> data.js dosyasındaki ${DB.players.length} oyuncu,
          ${DB.seasons.length} sezon ve ${DB.matches.length} maç Firebase'e yüklenecek. Bunu sadece bir kez yapman yeterli.</div>
          <div class="notice-actions"><button class="btn" id="seed">Verileri Firebase'e yükle</button></div>
        </section>`;
      document.getElementById("seed").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          try {
            await seedRemote();
            DB = await loadRemote();
            toast("Veriler yüklendi.");
            renderAdmin();
          } catch (err) {
            toast("Yüklenemedi: " + errText(err), true);
          }
        })
      );
      return;
    }

    if (!form.season || !seasonById(form.season)) form.season = currentSeason() && currentSeason().id;
    if (!form.date) form.date = todayIso();

    const notice = FB_ON
      ? `<section class="card notice">
          <div><b>Veriler Firebase'de.</b> Girdiğin her şey anında herkese görünür.</div>
          <div class="notice-actions"><button class="btn ghost" id="export">Yedek indir (data.js)</button></div>
        </section>`
      : `<section class="card notice">
          <div>
            <b>${isLocal ? "Değişiklikler bu tarayıcıda kayıtlı." : "Şu an data.js dosyasındaki veri gösteriliyor."}</b>
            Firebase henüz ayarlanmadığı için girdiğin bilgiler sadece bu tarayıcıda saklanır.
            Kalıcı yapmak için <b>Dışa aktar</b> ile <code>data.js</code>'i indirip sitedeki dosyanın yerine koy.
          </div>
          <div class="notice-actions">
            <button class="btn" id="export">Dışa aktar (data.js)</button>
            ${isLocal ? `<button class="btn ghost danger" id="reset">Yerel kaydı sil</button>` : ""}
          </div>
        </section>`;

    app.innerHTML = `
      <h1 class="page-title">Veri Gir</h1>
      <p class="page-sub">Maç, sezon ve oyuncu ekle</p>
      ${notice}

      <section class="card" id="mac">
        <div class="card-head"><h2>Yeni maç</h2></div>
        ${
          !currentSeason()
            ? `<div class="empty">Önce aşağıdan bir sezon oluştur.</div>`
            : `
        <div class="pad form-grid">
          <label>Sezon
            <select class="select" id="f-season">
              ${[...DB.seasons]
                .reverse()
                .map((s) => `<option value="${s.id}" ${s.id === form.season ? "selected" : ""}>${esc(s.name)}</option>`)
                .join("")}
            </select>
          </label>
          <label>Tarih <input class="input" type="date" id="f-date" value="${form.date}"></label>
        </div>

        <div class="pad score-entry">
          <div class="se-team">
            <input class="input team-name" id="f-home" value="${esc(form.homeName)}" aria-label="1. takım adı">
            <input class="input score" id="f-hs" type="number" min="0" inputmode="numeric" value="${form.homeScore}" placeholder="0" aria-label="1. takım skoru">
          </div>
          <span class="se-dash">-</span>
          <div class="se-team">
            <input class="input score" id="f-as" type="number" min="0" inputmode="numeric" value="${form.awayScore}" placeholder="0" aria-label="2. takım skoru">
            <input class="input team-name" id="f-away" value="${esc(form.awayName)}" aria-label="2. takım adı">
          </div>
        </div>

        <div class="pad picker-head">
          <div id="f-counts" class="muted"></div>
          <input class="input" id="f-q" type="search" placeholder="Oyuncu ara…" value="${esc(form.q)}">
        </div>
        <div class="picker" id="f-picker"></div>

        <div class="pad form-actions">
          <button class="btn ghost" id="f-clear">Temizle</button>
          <button class="btn" id="f-save">Maçı kaydet</button>
        </div>`
        }
      </section>

      <div class="admin-cols">
        <section class="card" id="sezon">
          <div class="card-head"><h2>Sezonlar</h2></div>
          <div class="pad">
            <div class="inline-form">
              <input class="input" id="s-name" placeholder="örn. WS26/27" value="${esc(suggestNextSeasonName())}">
              <button class="btn" id="s-add">Sezon oluştur</button>
            </div>
            <p class="muted small">Yeni oluşturulan sezon güncel sezon olur; yeni maçlar varsayılan olarak ona girilir.</p>
            <ul class="edit-list">
              ${[...DB.seasons]
                .reverse()
                .map((s) => {
                  const used = DB.matches.some((m) => m.season === s.id) || Object.keys(s.legacy || {}).length;
                  return `
                <li data-season="${s.id}">
                  <input class="input" value="${esc(s.name)}" aria-label="Sezon adı">
                  <button class="btn ghost" data-rename>Kaydet</button>
                  ${used ? "" : `<button class="btn ghost danger" data-del>Sil</button>`}
                </li>`;
                })
                .join("")}
            </ul>
          </div>
        </section>

        <section class="card" id="oyuncu">
          <div class="card-head"><h2>Yeni oyuncu</h2></div>
          <div class="pad">
            <div class="inline-form">
              <input class="input" id="p-name" placeholder="Ad Soyad" maxlength="40">
              <button class="btn" id="p-add">Ekle</button>
            </div>
            <p class="muted small">Toplam ${DB.players.length} oyuncu kayıtlı. Üyeler kendi profillerini de oluşturabilir.</p>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h2>Kayıtlı maçlar</h2><span class="muted">${DB.matches.length} maç</span></div>
        ${
          DB.matches.length
            ? `<div class="match-list">${sortedMatches(DB.matches)
                .map((m) => `<div class="with-del">${matchRow(m)}<button class="btn ghost danger" data-del-match="${m.id}">Sil</button></div>`)
                .join("")}</div>`
            : `<div class="empty">Henüz maç girilmedi.</div>`
        }
      </section>`;

    bindAdmin();
  }

  function bindAdmin() {
    const $ = (id) => document.getElementById(id);

    $("export").addEventListener("click", () => {
      exportDataJs();
      toast("data.js indirildi.");
    });
    if ($("reset"))
      confirmClick($("reset"), () => {
        try {
          localStorage.removeItem(STORE_KEY);
        } catch (e) {}
        DB = loadLocal();
        toast("Yerel kayıt silindi, data.js'e dönüldü.");
        renderAdmin();
      });

    // ---- Maç formu ----
    if ($("f-picker")) {
      const bindVal = (id, key) => $(id).addEventListener("input", (e) => (form[key] = e.target.value));
      bindVal("f-date", "date");
      bindVal("f-home", "homeName");
      bindVal("f-away", "awayName");
      bindVal("f-hs", "homeScore");
      bindVal("f-as", "awayScore");
      $("f-season").addEventListener("change", (e) => (form.season = e.target.value));
      $("f-home").addEventListener("input", drawPicker);
      $("f-away").addEventListener("input", drawPicker);
      $("f-q").addEventListener("input", (e) => {
        form.q = e.target.value;
        drawPicker();
      });

      const totals = computeStats();
      const ordered = [...DB.players].sort(
        (a, b) => totals[b.id].played - totals[a.id].played || a.name.localeCompare(b.name, "tr")
      );

      function drawPicker() {
        const q = form.q.trim().toLocaleLowerCase("tr");
        const home = form.homeName || "1. takım";
        const away = form.awayName || "2. takım";
        const nH = Object.values(form.side).filter((v) => v === "home").length;
        const nA = Object.values(form.side).filter((v) => v === "away").length;
        $("f-counts").innerHTML = `<b class="c-home">${esc(home)}: ${nH}</b> · <b class="c-away">${esc(away)}: ${nA}</b>`;

        const list = ordered
          .filter((p) => form.side[p.id] || !q || p.name.toLocaleLowerCase("tr").includes(q))
          .sort((a, b) => (form.side[b.id] ? 1 : 0) - (form.side[a.id] ? 1 : 0));

        $("f-picker").innerHTML = list
          .map((p) => {
            const side = form.side[p.id];
            return `
            <div class="pick ${side ? "on-" + side : ""}" data-id="${p.id}">
              <span class="who">${avatar(p, "sm")}${esc(p.name)}</span>
              <span class="seg">
                <button type="button" data-side="home" class="${side === "home" ? "sel" : ""}">${esc(home)}</button>
                <button type="button" data-side="away" class="${side === "away" ? "sel" : ""}">${esc(away)}</button>
              </span>
            </div>`;
          })
          .join("");
      }
      drawPicker();

      $("f-picker").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-side]");
        if (!btn) return;
        const id = btn.closest("[data-id]").dataset.id;
        if (form.side[id] === btn.dataset.side) delete form.side[id];
        else form.side[id] = btn.dataset.side;
        drawPicker();
      });

      $("f-clear").addEventListener("click", () => {
        Object.assign(form, { homeScore: "", awayScore: "", side: {}, q: "" });
        renderAdmin();
      });

      $("f-save").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          const hs = parseInt(form.homeScore, 10);
          const as = parseInt(form.awayScore, 10);
          const homeP = Object.keys(form.side).filter((k) => form.side[k] === "home");
          const awayP = Object.keys(form.side).filter((k) => form.side[k] === "away");

          if (!form.date) return toast("Tarih seç.", true);
          if (!form.homeName.trim() || !form.awayName.trim()) return toast("İki takımın da adı olmalı.", true);
          if (!(hs >= 0) || !(as >= 0)) return toast("Skoru gir.", true);
          if (!homeP.length || !awayP.length) return toast("İki takıma da en az bir oyuncu seç.", true);

          const id = uniqueId(form.date, (x) => DB.matches.some((m) => m.id === x));
          const match = {
            id,
            season: form.season,
            date: form.date,
            home: { name: form.homeName.trim(), players: homeP },
            away: { name: form.awayName.trim(), players: awayP },
            score: [hs, as],
            goals: [],
          };
          if (FB_ON) {
            match.voteUntil = voteDeadlineFor(form.date);
            match.ratingSummary = {};
          }
          if (!(await store.addMatch(match))) return;
          Object.assign(form, { homeScore: "", awayScore: "", side: {}, q: "" });
          toast("Maç kaydedildi.");
          location.hash = "#/mac/" + id;
        })
      );
    }

    // ---- Sezonlar ----
    $("s-add").addEventListener("click", (e) =>
      busy(e.currentTarget, async () => {
        const name = $("s-name").value.trim();
        if (!name) return toast("Sezon adı yaz.", true);
        if (DB.seasons.some((s) => s.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr")))
          return toast("Bu isimde sezon zaten var.", true);
        const id = uniqueId(slugify(name), (x) => !!seasonById(x));
        const order = DB.seasons.reduce((m, s) => Math.max(m, s.order), -1) + 1;
        if (await store.addSeason({ id, name, order, legacy: {} })) {
          form.season = id;
          toast(`${name} oluşturuldu.`);
          renderAdmin();
        }
      })
    );

    app.querySelectorAll("[data-season]").forEach((li) => {
      const id = li.dataset.season;
      li.querySelector("[data-rename]").addEventListener("click", (e) =>
        busy(e.currentTarget, async () => {
          const name = li.querySelector("input").value.trim();
          if (!name) return toast("Sezon adı boş olamaz.", true);
          if (await store.renameSeason(id, name)) {
            toast("Sezon adı güncellendi.");
            renderAdmin();
          }
        })
      );
      const del = li.querySelector("[data-del]");
      if (del)
        confirmClick(del, async () => {
          if (await store.deleteSeason(id)) {
            toast("Sezon silindi.");
            renderAdmin();
          }
        });
    });

    // ---- Oyuncular ----
    const addPlayer = () =>
      busy($("p-add"), async () => {
        const name = $("p-name").value.trim().replace(/\s+/g, " ");
        if (!name) return toast("Oyuncu adı yaz.", true);
        if (DB.players.some((p) => p.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr")))
          return toast("Bu isimde oyuncu zaten var.", true);
        const id = uniqueId(slugify(name), (x) => DB.players.some((p) => p.id === x));
        if (await store.addPlayer({ id, name })) {
          toast(`${name} eklendi.`);
          renderAdmin();
        }
      });
    $("p-add").addEventListener("click", addPlayer);
    $("p-name").addEventListener("keydown", (e) => e.key === "Enter" && addPlayer());

    // ---- Maç silme ----
    app.querySelectorAll("[data-del-match]").forEach((btn) =>
      confirmClick(btn, async () => {
        if (await store.deleteMatch(btn.dataset.delMatch)) {
          toast("Maç silindi.");
          renderAdmin();
        }
      })
    );

    const anchor = location.hash.split("#")[2];
    if (anchor && $(anchor)) setTimeout(() => $(anchor).scrollIntoView({ behavior: "smooth" }), 50);
  }

  // =================================================================
  //  DURUM SAYFALARI
  // =================================================================
  function renderAdminOnly() {
    app.innerHTML = `
      <div class="card empty">
        Bu sayfa sadece adminler için.<br><br>
        ${session.user ? `<a class="btn" href="#/hesap">Hesabım</a>` : `<a class="btn" href="#/giris">Giriş yap</a>`}
      </div>`;
  }

  function renderNoFirebase() {
    app.innerHTML = `
      <div class="card empty">
        Giriş sistemi henüz kurulmadı.<br>
        <span class="small">config.js dosyasına Firebase ayarlarını ekle (KURULUM.md'ye bak).</span>
      </div>`;
  }

  function renderNotFound() {
    app.innerHTML = `
      <a class="back" href="#/">← Sıralama</a>
      <div class="card empty">Aradığın sayfa bulunamadı.</div>`;
  }

  // =================================================================
  //  ÜST BAR
  // =================================================================
  function updateTopbar() {
    document.querySelectorAll("[data-admin]").forEach((el) => (el.hidden = !isAdmin()));
    const box = document.getElementById("userbox");
    if (!box) return;
    if (!FB_ON) {
      box.innerHTML = "";
      return;
    }
    if (!session.ready) {
      box.innerHTML = "";
      return;
    }
    if (!session.user) {
      box.innerHTML = `<a class="login-btn" href="#/giris">Giriş yap</a>`;
      return;
    }
    const mine = myPlayer();
    const name = (mine && mine.name) || (session.profile && session.profile.displayName) || session.user.email;
    const pending = !isApproved();
    box.innerHTML = `
      <a class="user-chip" href="#/hesap" title="${esc(session.user.email)}">
        ${avatar({ name }, "sm")}
        <span>${esc(name)}</span>
        ${pending ? `<i class="dot" title="Onay bekliyor"></i>` : ""}
      </a>`;
  }

  async function refreshSession() {
    const u = fbAuth.currentUser;
    session.user = u;
    session.profile = null;
    if (u) {
      try {
        session.profile = await ensureProfile(u);
        if (session.profile) session.pendingName = null;
      } catch (err) {
        console.error(err);
        toast("Profil yüklenemedi: " + errText(err), true);
      }
    }
    session.ready = true;
    updateTopbar();
    route();
    finalizeRatings();
  }

  // =================================================================
  //  YÖNLENDİRİCİ
  // =================================================================
  function route() {
    if (!DB) return;
    const path = location.hash.replace(/^#\/?/, "").split("#")[0];
    const [page, arg] = path.split("/").filter(Boolean).map(decodeURIComponent);
    let nav = "";

    // Oturum gerektiren sayfalar, oturum bilgisi gelene kadar beklesin
    const needsSession = ["giris", "hesap", "uyeler", "veri"].includes(page);
    if (needsSession && !session.ready) {
      app.innerHTML = `<div class="card empty">Yükleniyor…</div>`;
      return;
    }

    if (!page) (nav = "home"), renderHome();
    else if (page === "sezonlar") (nav = "seasons"), renderSeasons();
    else if (page === "sezon" && arg) (nav = "seasons"), renderSeason(arg);
    else if (page === "maclar") (nav = "matches"), renderMatches();
    else if (page === "mac" && arg) (nav = "matches"), renderMatch(arg);
    else if (page === "oyuncu" && arg) renderPlayer(arg);
    else if (page === "veri") (nav = "admin"), renderAdmin();
    else if (page === "uyeler") (nav = "members"), renderMembers();
    else if (page === "giris") renderLogin();
    else if (page === "hesap") renderAccount();
    else renderNotFound();

    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
    if (!location.hash.split("#")[2]) window.scrollTo(0, 0);
  }

  // =================================================================
  //  BAŞLAT
  // =================================================================
  async function start() {
    window.addEventListener("hashchange", route);
    updateTopbar();

    if (!FB_ON) {
      DB = loadLocal();
      route();
      return;
    }

    app.innerHTML = `<div class="card empty">Yükleniyor…</div>`;
    try {
      DB = await loadRemote();
      if (!needsSeed) {
        try {
          await loadRatings();
        } catch (err) {
          console.error("Rating'ler yüklenemedi", err);
        }
      }
    } catch (err) {
      console.error(err);
      DB = normalize(clone(window.MUDAVIM));
      toast("Firebase'den veri alınamadı, yedek veri gösteriliyor: " + errText(err), true);
    }
    route();
    fbAuth.onAuthStateChanged(() => refreshSession());
  }

  start();
})();
