/* The Nerd Ratings - renders site/data/*.json. No build step, no dependencies. */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MINUS = "−";

  const S = {
    index: null, ratings: null, days: {}, v: "",
    view: "games", date: null,
    q: "", conf: "", edgeOnly: false, sort: "time",
    rq: "", rconf: "", swiped: false, noPicks: false,
  };

  // ------------------------------------------------------------------ formatting
  const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmtLong = (iso) => parseDay(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const fmtShort = (iso) => parseDay(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const num1 = (v) => (Math.abs(v) % 1 === 0 ? String(Math.abs(v)) : Math.abs(v).toFixed(1));
  const spread = (v) => {
    if (v == null || Number.isNaN(v)) return "—";
    const r = Math.round(v * 10) / 10;
    if (r === 0) return "PK";
    return (r > 0 ? "+" : MINUS) + num1(r);
  };
  const pctTxt = (p) => (p == null ? "—" : (p * 100).toFixed(1) + "%");
  const winTxt = (p) => (p < 0.005 ? "<1%" : p > 0.995 ? ">99%" : Math.round(p * 100) + "%");
  const wl = (w, l, p) => `${w}${MINUS}${l}${p ? MINUS + p : ""}`;

  // ------------------------------------------------------------------ data
  async function getJSON(path, fresh) {
    const url = fresh ? path : `${path}?v=${encodeURIComponent(S.v)}`;
    const r = await fetch(url, fresh ? { cache: "no-store" } : {});
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  async function loadDay(iso) {
    if (!S.days[iso]) S.days[iso] = await getJSON(`data/days/${iso}.json`);
    return S.days[iso];
  }
  async function loadRatings() {
    if (!S.ratings) S.ratings = await getJSON("data/ratings.json");
    return S.ratings;
  }

  // ------------------------------------------------------------------ game math
  function derive(g) {
    const hasLine = g.line != null && !S.noPicks;
    const edge = hasLine ? Math.round((g.margin + g.line) * 10) / 10 : null;
    const side = hasLine && edge !== 0 ? (edge > 0 ? "home" : "away") : null;
    const favored = g.margin > 0 ? "home" : g.margin < 0 ? "away" : null;
    return { hasLine, edge, side, favored, absEdge: edge == null ? -1 : Math.abs(edge) };
  }
  const sideLine = (g, side) => (side === "home" ? g.line : -g.line);
  const opp = (side) => (side === "home" ? "away" : "home");

  // ------------------------------------------------------------------ routing
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    const view = ["games", "ratings", "record", "about"].includes(parts[0]) ? parts[0] : "games";
    S.view = view;
    if (view === "games") {
      const d = parts[1] && S.index.dates.includes(parts[1]) ? parts[1] : defaultDate();
      S.date = d;
    }
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
    render().catch(showError);
  }
  function defaultDate() {
    const ds = S.index.dates, c = S.index.counts || {};
    const next = ds.find((d) => d >= S.index.today && (c[d] == null || c[d] > 0));
    return next || ds.find((d) => d >= S.index.today) || ds[ds.length - 1];
  }
  async function render() {
    if (S.view === "games") await renderGames();
    else if (S.view === "ratings") await renderRatings();
    else if (S.view === "record") renderRecord();
    else renderAbout();
  }

  // ------------------------------------------------------------------ games
  function renderStrip() {
    const ds = S.index.dates;
    const i = ds.indexOf(S.date);
    $("#day-list").innerHTML = ds.map((d) => {
      const dt = parseDay(d);
      const n = (S.index.counts || {})[d];
      const tag = d === S.index.today ? "Today" : n != null ? `${n} game${n === 1 ? "" : "s"}` : "";
      const cur = d === S.date ? ' aria-current="date"' : "";
      return `<li><a href="#/games/${d}"${cur} aria-label="${esc(fmtLong(d))}">` +
        `<span class="dow">${dt.toLocaleDateString("en-US", { weekday: "short" })}</span>` +
        `<span class="dom">${dt.getDate()}</span>` +
        `<span class="tag">${tag || dt.toLocaleDateString("en-US", { month: "short" })}</span></a></li>`;
    }).join("");
    $("#day-prev").disabled = i <= 0;
    $("#day-next").disabled = i >= ds.length - 1;
    const cur = $('#day-list a[aria-current="date"]');
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function teamLine(g, side, d, prefix) {
    const t = g[side];
    const name = d.side === side ? `<span class="mark">${esc(t.name)}</span>` : esc(t.name);
    const won = g.final && ((side === "home") === (g.final.home > g.final.away));
    return `<div class="team${won ? " won" : ""}">${prefix ? `<span class="at">${prefix}</span>` : ""}` +
      `${t.rank && S.index.avg_games >= 2 ? `<span class="rk" title="Rating rank">${t.rank}</span>` : ""}<span class="nm">${name}</span></div>`;
  }

  function injBlock(g) {
    const sides = ["away", "home"].filter((sd) => (g[sd].inj || []).length);
    if (!sides.length) return "";
    const n = sides.reduce((a, sd) => a + g[sd].inj.length, 0);
    const moved = ["away", "home"].filter((sd) => g[sd].inj_pts > 0)
      .map((sd) => `${esc(g[sd].name)} ${MINUS}${num1(g[sd].inj_pts)} pts`);
    const sum = moved.length ? `Injuries: ${moved.join(", ")}`
      : `Injuries (${n}), no change to the line`;
    const list = sides.map((sd) => `<div class="inj-team"><b>${esc(g[sd].name)}</b><ul>` +
      g[sd].inj.map((p) => {
        const out = /^(out|susp)/i.test(p.status);
        return `<li><span class="inj-p">${esc(p.name)}</span>${p.pos ? `, ${esc(p.pos)}` : ""}: ` +
          `<span class="inj-s${out ? " out" : ""}">${esc(p.status)}</span>` +
          `${p.injury ? ` (${esc(p.injury.toLowerCase())})` : ""}` +
          `${p.pts > 0 ? ` <span class="inj-pts">${MINUS}${num1(p.pts)}</span>` : ""}` +
          `${p.note ? `<span class="inj-note">${esc(p.note)}</span>` : ""}</li>`;
      }).join("") + `</ul></div>`).join("");
    return `<details class="inj"><summary>${sum}</summary>${list}</details>`;
  }

  function gameRow(g) {
    const d = derive(g);
    const done = !!g.final;
    const pa = 1 - g.p_home;
    const favCls = (side) => (d.favored === side ? "fav" : "");
    const at = g.neutral ? "vs" : "at";

    let last;
    if (done) {
      const su = g.su == null ? "" : `<span class="${g.su ? "hit" : "miss"}">Winner</span>`;
      const ats = g.ats ? `<span class="${g.ats === "W" ? "hit" : g.ats === "L" ? "miss" : "push"}">Spread</span>` : "";
      const hw = g.final.home > g.final.away;
      last = `<div class="g-edge g-result" data-label="Final">` +
        `<div class="scorebox"><span class="${hw ? "" : "final"}">${g.final.away}</span><span class="${hw ? "final" : ""}">${g.final.home}</span></div>` +
        `<div class="grade">${su}${ats}</div></div>`;
    } else if (S.noPicks) {
      last = `<div class="g-edge noline"><span class="sub">No pick yet</span></div>`;
    } else if (d.hasLine && d.side) {
      const w = Math.min(d.absEdge, 15) / 15 * 100;
      last = `<div class="g-edge"><span class="pick">${esc(g[d.side].name)} ${spread(sideLine(g, d.side))}</span>` +
        `<div class="gauge" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i><b></b></div>` +
        `<span class="sub">${num1(d.absEdge)}-point edge</span></div>`;
    } else if (d.hasLine) {
      last = `<div class="g-edge"><span class="sub">Model matches the line</span></div>`;
    } else {
      last = `<div class="g-edge noline"><span class="sub">No line yet</span></div>`;
    }

    const site = g.neutral ? '<span class="site">Neutral site</span>' : "";
    return `<li class="game${done ? " done" : ""}">` +
      `<div class="g-time">${esc((g.time || "TBA").replace(/ ET$/, ""))}${site}</div>` +
      `<div class="g-teams">${teamLine(g, "away", d, "")}${teamLine(g, "home", d, at)}${injBlock(g)}</div>` +
      `<div class="g-col g-win" data-label="Win"><span class="${favCls("away")}">${winTxt(pa)}</span><span class="${favCls("home")}">${winTxt(g.p_home)}</span></div>` +
      `<div class="g-col g-model" data-label="Model"><span class="${favCls("away")}">${spread(g.margin)}</span><span class="${favCls("home")}">${spread(-g.margin)}</span></div>` +
      `<div class="g-col g-market" data-label="Market"><span class="dim">${g.line != null ? spread(-g.line) : "—"}</span><span class="dim">${g.line != null ? spread(g.line) : "—"}</span></div>` +
      last + `</li>`;
  }

  function daySummary(day) {
    const gs = day.games;
    if (!gs.length) return "No Division I games on this date.";
    if (S.noPicks) {
      const fin = gs.filter((g) => g.final).length;
      return fin
        ? `${gs.length} games. These were played before the ratings formed, so they don't count toward the record.`
        : `${gs.length} game${gs.length > 1 ? "s" : ""}. No picks yet: every team starts even until it has played a couple of games.`;
    }
    const graded = gs.filter((g) => g.final);
    if (graded.length) {
      const su = graded.filter((g) => g.su === 1).length, suN = graded.filter((g) => g.su != null).length;
      const aw = graded.filter((g) => g.ats === "W").length, al = graded.filter((g) => g.ats === "L").length,
        ap = graded.filter((g) => g.ats === "P").length;
      const pend = gs.length - graded.length;
      return `Picked ${su} of ${suN} winners.` + (aw + al ? ` Against the spread, ${wl(aw, al, ap)}.` : "") +
        (pend ? ` ${pend} game${pend > 1 ? "s" : ""} not final yet.` : "");
    }
    const lined = gs.map((g) => [g, derive(g)]).filter(([, d]) => d.side).sort((a, b) => b[1].absEdge - a[1].absEdge);
    let s = `${gs.length} game${gs.length > 1 ? "s" : ""}.`;
    if (lined.length) {
      const [g, d] = lined[0];
      s += ` Biggest edge: <span class="mark">${esc(g[d.side].name)} ${spread(sideLine(g, d.side))}</span> ` +
        `${d.side === "away" ? (g.neutral ? "vs" : "at") : "vs"} ${esc(g[opp(d.side)].name)}, ${num1(d.absEdge)} points off the market.`;
    }
    if (day.preview) s += " Early look; numbers update each morning until game day.";
    return s;
  }

  async function renderGames() {
    renderStrip();
    $("#day-title").textContent = fmtLong(S.date);
    $("#status").hidden = true;
    let day;
    try { day = await loadDay(S.date); } catch (e) { day = { games: [] }; }
    S.noPicks = day.ratings_ready === false;
    $("#view-games .check").hidden = S.noPicks;
    $("#view-games .seg").hidden = S.noPicks;
    if (S.noPicks) { S.edgeOnly = false; S.sort = "time"; $("#g-edge").checked = false; }

    const early = S.index.early_season && S.date >= S.index.today;
    $("#early-notice").hidden = !early;
    if (early) $("#early-notice").textContent = S.index.avg_games < 1
      ? `Every team starts even, so for now the model's line is just home court and injuries. Picks against the spread start once teams have played about ${S.index.picks_min_games || 2} games each, and the ratings sharpen through December.`
      : `Ratings are still settling. Teams have played ${S.index.avg_games} games on average, so these numbers lean heavily on home court and will sharpen over the next few weeks.`;

    $("#day-summary").innerHTML = daySummary(day);
    const done = day.games.some((g) => g.final);
    $("#g-last-head").textContent = done ? "Final" : "Edge";
    $("#view-games .sheet").classList.toggle("done-day", done);

    const confs = [...new Set(day.games.flatMap((g) => [g.home.conf, g.away.conf]).filter(Boolean))].sort();
    const sel = $("#g-conf");
    if (!confs.includes(S.conf)) S.conf = "";
    sel.innerHTML = '<option value="">All</option>' + confs.map((c) => `<option${c === S.conf ? " selected" : ""}>${esc(c)}</option>`).join("");

    const q = S.q.trim().toLowerCase();
    let gs = day.games.filter((g) =>
      (!q || g.home.name.toLowerCase().includes(q) || g.away.name.toLowerCase().includes(q)) &&
      (!S.conf || g.home.conf === S.conf || g.away.conf === S.conf) &&
      (!S.edgeOnly || derive(g).absEdge >= 4));
    if (S.sort === "edge") gs = gs.slice().sort((a, b) => derive(b).absEdge - derive(a).absEdge);

    const list = $("#games");
    list.innerHTML = gs.map(gameRow).join("");
    list.querySelectorAll(".mark").forEach((m, i) => m.style.setProperty("--i", Math.min(i, 30)));
    if (!S.swiped) { list.classList.add("swipe"); S.swiped = true; } else list.classList.remove("swipe");

    const empty = $("#games-empty");
    empty.hidden = gs.length > 0;
    if (!gs.length) empty.textContent = day.games.length
      ? "No games match these filters. Clear the search or conference to see the full slate."
      : "No Division I games on this date. Pick another day above.";
  }

  // ------------------------------------------------------------------ ratings
  async function renderRatings() {
    $("#status").hidden = true;
    const R = await loadRatings();
    const teams = R.teams;
    const confs = [...new Set(teams.map((t) => t.conf).filter(Boolean))].sort();
    $("#r-conf").innerHTML = '<option value="">All</option>' + confs.map((c) => `<option${c === S.rconf ? " selected" : ""}>${esc(c)}</option>`).join("");
    $("#ratings-summary").textContent =
      `All ${teams.length} Division I teams as of ${fmtLong(R.date)}. Rating is how many points better than an average team on a neutral court.`;
    const notYet = S.index.avg_games < 1;
    $("#view-ratings .sheet").hidden = notYet;
    $("#view-ratings .controls").hidden = notYet;
    if (notYet) {
      $("#ratings-summary").textContent = "Ratings start once games are played. Check back after opening week; every team is even until then.";
      return;
    }
    const max = Math.max(...teams.map((t) => Math.abs(t.rating)), 1);
    const q = S.rq.trim().toLowerCase();
    const rows = teams.filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!S.rconf || t.conf === S.rconf));
    $("#ratings").innerHTML = rows.map((t) => {
      const chg = t.chg == null || t.chg === 0 ? '<span aria-label="no change">–</span>'
        : t.chg > 0 ? `<span class="up" aria-label="up ${t.chg}">▲${t.chg}</span>`
        : `<span class="dn" aria-label="down ${-t.chg}">▼${-t.chg}</span>`;
      const w = Math.abs(t.rating) / max * 50;
      const left = t.rating >= 0 ? 50 : 50 - w;
      return `<tr><td class="n">${t.rank}</td><td class="n chg">${chg}</td>` +
        `<td class="tm"><a href="#/games" data-team="${esc(t.name)}">${esc(t.name)}</a></td><td class="conf">${esc(t.conf)}</td>` +
        `<td class="n">${t.w}${MINUS}${t.l}</td><td class="n rt">${(t.rating > 0 ? "+" : t.rating < 0 ? MINUS : "") + Math.abs(t.rating).toFixed(1)}</td>` +
        `<td class="barcol"><div class="rbar"><i style="left:${left.toFixed(2)}%;width:${Math.max(w, 0.4).toFixed(2)}%"></i></div></td></tr>`;
    }).join("");
    $("#ratings-empty").hidden = rows.length > 0;
    $("#ratings-empty").textContent = "No teams match. Clear the search or conference filter.";
  }

  // ------------------------------------------------------------------ record
  function renderRecord() {
    $("#status").hidden = true;
    const r = S.index.record;
    if (!r.games) {
      $("#record-lede").textContent = "No graded games yet. Results appear here the morning after the first games are played.";
      document.querySelectorAll("#view-record .sheet, #record-stats").forEach((n) => (n.hidden = true));
      return;
    }
    document.querySelectorAll("#view-record .sheet, #record-stats").forEach((n) => (n.hidden = false));
    const suN = r.su.w + r.su.l;
    $("#record-lede").textContent =
      `Picked the winner in ${r.su.w} of ${suN} games this season (${pctTxt(r.su.pct)}). Every pick was made the morning of the game and never changed.`;
    const stat = (label, big, small) => `<div><dt>${label}</dt><dd>${big}<small>${small}</small></dd></div>`;
    $("#record-stats").innerHTML =
      stat("Winners", pctTxt(r.su.pct), wl(r.su.w, r.su.l)) +
      stat("Against the spread", pctTxt(r.ats.pct), r.ats.w + r.ats.l ? wl(r.ats.w, r.ats.l, r.ats.p) : "No lines yet") +
      stat(`Edges of ${r.ats_edge.threshold}+ points`, pctTxt(r.ats_edge.pct), r.ats_edge.w + r.ats_edge.l ? wl(r.ats_edge.w, r.ats_edge.l) : "None yet") +
      stat("Average miss", r.mae == null ? "—" : `${r.mae} pts`, `Brier score ${r.brier}`);
    drawChart(r.by_day);
    $("#record-days").innerHTML = r.by_day.slice().reverse().map((d) =>
      `<tr><td class="d"><a href="#/games/${d.date}">${fmtShort(d.date)}</a></td><td class="n">${d.n}</td>` +
      `<td class="n">${d.su_w} of ${d.su_w + d.su_l}</td><td class="n">${d.ats_w + d.ats_l + d.ats_p ? wl(d.ats_w, d.ats_l, d.ats_p) : "—"}</td></tr>`).join("");
  }

  function drawChart(days) {
    const el = $("#record-chart");
    const W = 900, H = 220, m = { t: 12, r: 8, b: 26, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = days.length;
    const step = iw / Math.max(n, 1);
    const bw = Math.max(Math.min(step - 2, 26), 2);
    const y = (p) => m.t + ih * (1 - p);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((p) =>
      `<line x1="${m.l}" x2="${W - m.r}" y1="${y(p)}" y2="${y(p)}"/>`).join("");
    const ylab = [0, 0.5, 1].map((p) => `<text x="${m.l - 8}" y="${y(p) + 4}" text-anchor="end">${p * 100}%</text>`).join("");
    const every = Math.ceil(n / 8);
    const xlab = days.map((d, i) => (i % every === 0 || i === n - 1)
      ? `<text x="${m.l + step * i + step / 2}" y="${H - 6}" text-anchor="middle">${parseDay(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</text>` : "").join("");
    const bars = days.map((d, i) => {
      const tot = d.su_w + d.su_l, p = tot ? d.su_w / tot : 0;
      const x = m.l + step * i + (step - bw) / 2, top = y(p), h = Math.max(y(0) - top, 0);
      const r = Math.min(4, bw / 2, h);
      const path = h > 0
        ? `M${x},${y(0)}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y(0)}Z`
        : "";
      const tip = `${fmtShort(d.date)}: ${d.su_w} of ${tot} winners (${tot ? Math.round(p * 100) : 0}%)` +
        (d.ats_w + d.ats_l + d.ats_p ? `, ${wl(d.ats_w, d.ats_l, d.ats_p)} against the spread` : "");
      return `<g tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}">` +
        `<rect class="hit-area" x="${m.l + step * i}" y="${m.t}" width="${step}" height="${ih}"/>` +
        `<path class="b" d="${path}" fill="currentColor"/></g>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Share of winners picked each day">` +
      `<g class="grid">${grid}</g><g class="ref"><line x1="${m.l}" x2="${W - m.r}" y1="${y(0.5)}" y2="${y(0.5)}"/></g>` +
      `<g class="axis">${ylab}${xlab}</g><g class="bars">${bars}</g></svg>`;
    // bars use a path; style it like the rect rule
    el.querySelectorAll("path.b").forEach((p) => p.setAttribute("style", "fill: var(--bar)"));
    const tipEl = $("#tip");
    const show = (g, x, yy) => {
      el.querySelectorAll(".bars g").forEach((n2) => n2.classList.toggle("on", n2 === g));
      el.querySelectorAll("path.b").forEach((p) => p.setAttribute("style", `fill: var(${p.parentNode === g ? "--ink" : "--bar"})`));
      tipEl.textContent = g.dataset.tip; tipEl.hidden = false;
      const tw = tipEl.offsetWidth;
      tipEl.style.left = Math.min(Math.max(8, x - tw / 2), innerWidth - tw - 8) + "px";
      tipEl.style.top = Math.max(8, yy - tipEl.offsetHeight - 12) + "px";
    };
    const hide = () => {
      tipEl.hidden = true;
      el.querySelectorAll("path.b").forEach((p) => p.setAttribute("style", "fill: var(--bar)"));
    };
    el.querySelectorAll(".bars g").forEach((g) => {
      g.addEventListener("pointermove", (e) => show(g, e.clientX, e.clientY));
      g.addEventListener("pointerleave", hide);
      g.addEventListener("focus", () => { const b = g.getBoundingClientRect(); show(g, b.left + b.width / 2, b.top + 30); });
      g.addEventListener("blur", hide);
    });
  }

  function renderAbout() {
    $("#status").hidden = true;
    const m = S.index.model || {};
    if (m.home_adv != null) $("#a-home").textContent = num1(m.home_adv);
    if (m.sigma != null) $("#a-sigma").textContent = num1(m.sigma);
  }

  // ------------------------------------------------------------------ wiring
  function showError(e) {
    const st = $("#status");
    st.hidden = false;
    st.textContent = "The ratings data didn't load. Refresh the page; if it keeps happening, today's update may still be publishing.";
    console.error(e);
  }

  function wire() {
    $("#g-q").addEventListener("input", (e) => { S.q = e.target.value; renderGames(); });
    $("#g-conf").addEventListener("change", (e) => { S.conf = e.target.value; renderGames(); });
    $("#g-edge").addEventListener("change", (e) => { S.edgeOnly = e.target.checked; renderGames(); });
    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      S.sort = b.dataset.sort;
      document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderGames();
    }));
    const go = (delta) => {
      const ds = S.index.dates, i = ds.indexOf(S.date) + delta;
      if (i >= 0 && i < ds.length) location.hash = `#/games/${ds[i]}`;
    };
    $("#day-prev").addEventListener("click", () => go(-1));
    $("#day-next").addEventListener("click", () => go(1));
    $("#r-q").addEventListener("input", (e) => { S.rq = e.target.value; renderRatings(); });
    $("#r-conf").addEventListener("change", (e) => { S.rconf = e.target.value; renderRatings(); });
    // clicking a team in the ratings jumps to today's games filtered to that team
    $("#ratings").addEventListener("click", (e) => {
      const a = e.target.closest("a[data-team]");
      if (!a) return;
      S.q = a.dataset.team; $("#g-q").value = S.q;
    });
    addEventListener("hashchange", route);
  }

  async function init() {
    try {
      S.index = await getJSON("data/index.json", true);
      S.v = S.index.generated;
      const when = new Date(S.index.generated);
      $("#updated").textContent = `Updated ${when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ` +
        `${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Predictions are made before tip-off and never revised. ${S.index.season} season.`;
      wire();
      route();
    } catch (e) { showError(e); }
  }
  init();
})();
