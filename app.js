import { Game, BRACKETS, QUESTIONS_PER_ROUND } from "./engine.js";

const app = document.getElementById("app");
const hud = document.getElementById("hud");

const state = {
  game: null,
  players: [], // {name, score, best}
  timer: 0,
  rounds: [], // [{title, questions}]
  r: 0, // round index
  q: 0, // question index within the round
  turn: 0,
  results: [], // this question: {player, ...result}
  timerId: null,
  inGame: false,
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const color = (key) => `var(--${key})`;
const currentQuestion = () => state.rounds[state.r].questions[state.q];
const totalQuestions = () => state.rounds.reduce((n, r) => n + r.questions.length, 0);

function loadSetup() {
  try { return JSON.parse(localStorage.getItem("rarefind.setup")) || {}; } catch { return {}; }
}
function saveSetup(setup) {
  try { localStorage.setItem("rarefind.setup", JSON.stringify(setup)); } catch { /* ignore */ }
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

// ---------------------------------------------------------------- shared bits

function bracketRange(b) {
  if (b.minPct === 0) return `under ${b.maxPct}% of answers`;
  if (b.maxPct >= 100) return `${b.minPct}%+ of answers`;
  return `${b.minPct}–${b.maxPct}% of answers`;
}

function legendHTML() {
  return `<div class="legend">${BRACKETS.map((b) => `
    <div class="legend-item">
      <span class="dot" style="background:${color(b.key)}"></span>
      <div><div class="name">${b.name}</div><div class="range">${bracketRange(b)}</div></div>
      <div class="pts" style="color:${color(b.key)}">${b.minPts}–${b.maxPts}</div>
    </div>`).join("")}
  </div>`;
}

function leaderboardHTML(rows) {
  if (!rows.length) return "";
  return `<section class="card">
    <h3>Hall of fame <span class="muted" style="text-transform:none;letter-spacing:0">— ranked by average points per question</span></h3>
    <table>
      <thead><tr><th>#</th><th>Player</th><th class="num">Avg</th><th class="num">Score</th><th class="num">Qs</th><th class="num">Date</th></tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num"><b>${r.avg}</b></td>
        <td class="num">${r.score}</td><td class="num">${r.rounds}</td><td class="num muted">${esc(r.date)}</td></tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function standingsHTML(players) {
  const medals = ["🥇", "🥈", "🥉"];
  return `<div class="podium">${[...players].sort((a, b) => b.score - a.score).map((p, i) => `
    <div class="standing ${i === 0 ? "first" : ""}">
      <div class="place">${medals[i] || i + 1}</div>
      <div>
        <div class="nm">${esc(p.name)}</div>
        <div class="sub">${p.best
          ? `Best find: <b style="color:${color(p.best.bracket.key)}">${esc(p.best.answer)}</b> (${p.best.bracket.name}, ${p.best.points} pts)`
          : "No valid answers yet"}</div>
      </div>
      <div class="sc">${p.score}</div>
    </div>`).join("")}
  </div>`;
}

function renderHud() {
  if (!state.inGame) { hud.innerHTML = ""; return; }
  const multi = state.players.length > 1;
  const answering = state.results.length < state.players.length;
  hud.innerHTML =
    `<span class="chip">Round ${state.r + 1}/${state.rounds.length} · Q ${state.q + 1}/${state.rounds[state.r].questions.length}</span>` +
    state.players.map((p, i) =>
      `<span class="chip ${multi && answering && i === state.turn ? "active" : ""}">${esc(p.name)}<b>${p.score}</b></span>`
    ).join("");
}

function countUp(el, to, ms = 900) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- setup

function renderSetup() {
  stopTimer();
  state.inGame = false;
  renderHud();
  const { game } = state;
  const saved = loadSetup();
  const names = saved.names?.length ? saved.names : ["Player 1"];
  const mode = saved.mode === "theme" ? "theme" : "mixed";
  const chosen = new Set(saved.themes?.length ? saved.themes : game.themes.map((t) => t.id));

  app.innerHTML = `
  <section class="card">
    <h1>Don't say what everyone says. <span class="accent">Find the rare one.</span></h1>
    <p class="lead">Every question is open-ended, so type any answer that fits. The fewer people who have given that answer
      before, the more points you score. Answers that don't fit the question score 0.</p>
    <div class="grid2">
      <div>
        <h3>Players</h3>
        <div id="players"></div>
        <button class="ghost" id="addPlayer" type="button">+ Add player</button>

        <h3 style="margin-top:24px">Rounds</h3>
        <div class="seg" role="radiogroup">
          <button type="button" data-mode="mixed" class="${mode === "mixed" ? "on" : ""}">Mixed rounds</button>
          <button type="button" data-mode="theme" class="${mode === "theme" ? "on" : ""}">Theme rounds</button>
        </div>
        <p class="hint" id="modeHint"></p>
        <div id="mixedOpts" class="row">
          <label>Number of rounds
            <select id="rounds">${[1, 2, 3, 4, 5].map((n) =>
              `<option value="${n}" ${n === (saved.rounds || 1) ? "selected" : ""}>${n} (${n * QUESTIONS_PER_ROUND} questions)</option>`).join("")}</select>
          </label>
        </div>
        <div id="themeOpts" class="chips">${game.themes.map((t) =>
          `<button type="button" class="pick ${chosen.has(t.id) ? "on" : ""}" data-theme="${t.id}">${esc(t.name)}</button>`).join("")}</div>

        <div class="row">
          <label>Timer
            <select id="timer">${[[0, "Off"], [20, "20 seconds"], [30, "30 seconds"], [45, "45 seconds"]]
              .map(([v, l]) => `<option value="${v}" ${v === (saved.timer || 0) ? "selected" : ""}>${l}</option>`).join("")}</select>
          </label>
        </div>
        <button class="primary big" id="start" type="button">Start game</button>
      </div>
      <div>
        <h3>Scoring brackets</h3>
        ${legendHTML()}
        <p class="hint">Within each bracket, the rarer your answer, the closer you get to the top of the range.</p>
        <h3 style="margin-top:24px">Themes</h3>
        <p class="hint" style="margin-top:0">${game.themes.map((t) => `${esc(t.name)} (${t.questions.length})`).join(" · ")}</p>
      </div>
    </div>
  </section>
  ${leaderboardHTML(game.leaderboard())}
  <p class="center"><button class="link" id="reset" type="button">Reset learned answers and scores on this device</button></p>`;

  // players
  const list = document.getElementById("players");
  const drawPlayers = (arr) => {
    list.innerHTML = arr.map((n, i) => `
      <div class="player-row">
        <input type="text" maxlength="24" value="${esc(n)}" placeholder="Player ${i + 1}" aria-label="Player ${i + 1} name">
        ${arr.length > 1 ? `<button class="icon-btn" data-remove="${i}" type="button" title="Remove">✕</button>` : ""}
      </div>`).join("");
  };
  const currentNames = () => [...list.querySelectorAll("input")].map((el) => el.value);
  drawPlayers(names);
  list.addEventListener("click", (e) => {
    const idx = e.target.dataset.remove;
    if (idx === undefined) return;
    const arr = currentNames();
    arr.splice(Number(idx), 1);
    drawPlayers(arr);
  });
  document.getElementById("addPlayer").onclick = () => {
    const arr = currentNames();
    if (arr.length >= 8) return;
    arr.push(`Player ${arr.length + 1}`);
    drawPlayers(arr);
    list.querySelector(".player-row:last-child input").select();
  };

  // round style
  let curMode = mode;
  const applyMode = () => {
    app.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === curMode));
    document.getElementById("mixedOpts").hidden = curMode !== "mixed";
    document.getElementById("themeOpts").hidden = curMode !== "theme";
    document.getElementById("modeHint").textContent = curMode === "mixed"
      ? `Each round is ${QUESTIONS_PER_ROUND} questions, one from each theme.`
      : `Each theme you pick is a round of ${QUESTIONS_PER_ROUND} questions from that theme.`;
  };
  app.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => { curMode = b.dataset.mode; applyMode(); }; });
  app.querySelectorAll("[data-theme]").forEach((b) => { b.onclick = () => b.classList.toggle("on"); });
  applyMode();

  document.getElementById("start").onclick = () => {
    const playerNames = currentNames().map((n, i) => n.trim() || `Player ${i + 1}`);
    const themes = [...app.querySelectorAll("[data-theme].on")].map((b) => b.dataset.theme);
    if (curMode === "theme" && !themes.length) { alert("Pick at least one theme."); return; }
    const setup = {
      names: playerNames, mode: curMode, themes,
      rounds: Number(document.getElementById("rounds").value),
      timer: Number(document.getElementById("timer").value),
    };
    saveSetup(setup);
    startGame(setup);
  };

  document.getElementById("reset").onclick = () => {
    if (!confirm("Forget every answer this device has learned, all accepted answers, and the hall of fame?")) return;
    game.reset();
    location.reload();
  };
}

// ---------------------------------------------------------------- game flow

function startGame(setup) {
  state.rounds = state.game.newGame(setup.mode, setup.rounds, setup.themes);
  state.players = setup.names.map((name) => ({ name, score: 0, best: null }));
  state.timer = setup.timer;
  state.r = 0;
  state.inGame = true;
  beginRound();
}

function beginRound() {
  state.q = 0;
  state.results = [];
  renderHud();
  const round = state.rounds[state.r];
  const themes = round.questions.map((q) => q.category);
  app.innerHTML = `
    <section class="card handoff">
      <div class="muted">Round ${state.r + 1} of ${state.rounds.length}</div>
      <div class="big-name">${esc(round.title)}</div>
      <div class="chips center-chips">${themes.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
      <p class="muted">${round.questions.length} questions${state.timer ? ` · ${state.timer}s each` : ""}</p>
      <button class="primary" id="go" type="button">Start round ${state.r + 1}</button>
    </section>`;
  const go = document.getElementById("go");
  go.focus();
  go.onclick = beginQuestion;
}

function beginQuestion() {
  state.turn = 0;
  state.results = [];
  beginTurn();
}

function beginTurn() {
  renderHud();
  if (state.players.length > 1) showHandoff();
  else showQuestion();
}

function showHandoff() {
  const p = state.players[state.turn];
  const locked = state.turn > 0 ? `<p class="muted">✓ ${esc(state.players[state.turn - 1].name)}'s answer is locked in.</p>` : "";
  app.innerHTML = `
    <section class="card handoff">
      ${locked}
      <div class="muted">Pass the device to</div>
      <div class="big-name">${esc(p.name)}</div>
      <button class="primary" id="ready" type="button">I'm ready, show the question</button>
    </section>`;
  const btn = document.getElementById("ready");
  btn.focus();
  btn.onclick = showQuestion;
}

function showQuestion() {
  const q = currentQuestion();
  const p = state.players[state.turn];
  const multi = state.players.length > 1;
  app.innerHTML = `
    <section class="card">
      ${state.timer ? `<div class="timer" id="timer"><div style="width:100%"></div></div>` : ""}
      <div class="q-meta"><span>${esc(q.category)}</span><span>${multi ? `<span class="turn-name">${esc(p.name)}</span>'s turn` : ""}</span></div>
      <div class="prompt">${esc(q.prompt)}</div>
      <form class="answer-form" id="form" autocomplete="off">
        <input type="text" id="answer" maxlength="80" placeholder="Type something nobody else would say…" aria-label="Your answer">
        <button class="primary" type="submit" id="submit">Submit</button>
      </form>
      <p class="hint">Go obscure, but it still has to be a real, valid answer.</p>
    </section>`;
  const input = document.getElementById("answer");
  input.focus();
  document.getElementById("form").onsubmit = (e) => {
    e.preventDefault();
    submitAnswer(input.value);
  };
  if (state.timer) startTimer(() => submitAnswer(input.value));
}

function startTimer(onExpire) {
  stopTimer();
  const ends = Date.now() + state.timer * 1000;
  const wrap = document.getElementById("timer");
  const bar = wrap.firstElementChild;
  state.timerId = setInterval(() => {
    const left = Math.max(0, ends - Date.now());
    bar.style.width = `${(100 * left) / (state.timer * 1000)}%`;
    wrap.classList.toggle("low", left < 5000);
    if (left === 0) { stopTimer(); onExpire(); }
  }, 100);
}

function trackBest(p, res) {
  if (res.accepted && (!p.best || res.points > p.best.points)) {
    p.best = { answer: res.answer, points: res.points, bracket: res.bracket };
  }
}

function submitAnswer(text) {
  stopTimer();
  const res = state.game.answer(currentQuestion().id, text);
  const p = state.players[state.turn];
  p.score += res.points;
  trackBest(p, res);
  state.results.push({ player: state.turn, ...res });
  state.turn += 1;
  if (state.turn < state.players.length) beginTurn();
  else showReveal();
}

function acceptAnswer(idx) {
  const r = state.results[idx];
  const res = state.game.accept(currentQuestion().id, r.input);
  const p = state.players[r.player];
  p.score += res.points;
  trackBest(p, res);
  state.results[idx] = { player: r.player, houseRule: true, ...res };
  showReveal(false);
}

function meterHTML(r) {
  const order = [...BRACKETS].reverse(); // common → rare, left to right
  const idx = order.findIndex((b) => b.key === r.bracket.key);
  const pos = ((idx + r.bracketPosition) / order.length) * 100;
  return `
    <div class="meter">
      ${order.map((b, i) => `<span class="${i === idx ? "on" : ""}" style="background:${color(b.key)}"></span>`).join("")}
      <div class="marker" data-left="${pos}" style="left:0%"></div>
    </div>
    <div class="meter-labels"><span>More common</span><span>Rarer</span></div>`;
}

function resultHTML(r, i, animate) {
  const p = state.players[r.player];
  const multi = state.players.length > 1;
  const delay = animate ? `animation-delay:${i * 120}ms` : "animation:none";
  if (!r.accepted) {
    return `<div class="result" style="${delay}">
      <div class="result-head">
        <div>
          ${multi ? `<div class="who">${esc(p.name)}</div>` : ""}
          <div class="ans">${r.input ? `“${esc(r.input)}”` : "—"}</div>
          <span class="badge none">${esc(r.reason)}</span>
          <div class="stat">${r.input ? "That answer isn't on our list for this question." : "Time ran out before an answer was submitted."}</div>
          ${r.input ? `<button class="ghost small" data-accept="${i}" type="button">It's valid, accept it</button>` : ""}
        </div>
        <div class="points">0<small>points</small></div>
      </div>
    </div>`;
  }
  const typedDiffers = r.input.trim().toLowerCase() !== r.answer.toLowerCase();
  const people = r.count === 1 ? "1 person" : `${r.count} people`;
  return `<div class="result ${r.bracket.key === "ultra" ? "ultra-glow" : ""}" style="--c:${color(r.bracket.key)};${delay}">
    <div class="result-head">
      <div>
        ${multi ? `<div class="who">${esc(p.name)}</div>` : ""}
        <div class="ans">${esc(r.answer)}</div>
        ${typedDiffers ? `<div class="typed">you typed “${esc(r.input)}”</div>` : ""}
        <span class="badge">${esc(r.bracket.name)}</span>${r.houseRule ? ` <span class="badge none">accepted by players</span>` : ""}
        <div class="stat">${r.pct}% of answers: ${people} out of ${r.total} said this before you.</div>
      </div>
      <div class="points"><span data-count="${r.points}">${animate ? 0 : r.points}</span><small>points</small></div>
    </div>
    ${meterHTML(r)}
  </div>`;
}

function showReveal(animate = true) {
  renderHud();
  const q = currentQuestion();
  const lastInRound = state.q === state.rounds[state.r].questions.length - 1;
  const lastRound = state.r === state.rounds.length - 1;
  const nextLabel = !lastInRound ? "Next question →" : lastRound ? "See final results →" : "Round results →";
  const top = state.results[state.results.length - 1].top;
  const mine = new Set(state.results.filter((r) => r.accepted).map((r) => r.answer));
  const maxPct = Math.max(...top.map((t) => t.pct));
  app.innerHTML = `
    <section class="card">
      <div class="q-meta"><span>${esc(q.category)}</span><span>Results</span></div>
      <div class="prompt" style="margin-bottom:18px">${esc(q.prompt)}</div>
      <div class="results">${state.results.map((r, i) => resultHTML(r, i, animate)).join("")}</div>
    </section>
    <section class="card">
      <h3>Most common answers</h3>
      <ul class="top-list">${top.map((t) => `
        <li class="${mine.has(t.answer) ? "mine" : ""}">
          <div class="bar"><i style="width:${(100 * t.pct) / maxPct}%"></i><span>${esc(t.answer)}</span></div>
          <div class="pct">${t.pct}%</div>
        </li>`).join("")}
      </ul>
      <div class="actions">
        <button class="primary" id="next" type="button">${nextLabel}</button>
      </div>
    </section>`;

  const settle = () => {
    app.querySelectorAll(".marker").forEach((el) => { el.style.left = `${el.dataset.left}%`; });
    if (animate) app.querySelectorAll("[data-count]").forEach((el) => countUp(el, Number(el.dataset.count)));
  };
  if (animate) requestAnimationFrame(settle); else settle();

  app.querySelectorAll("[data-accept]").forEach((b) => {
    b.onclick = () => acceptAnswer(Number(b.dataset.accept));
  });
  const next = document.getElementById("next");
  next.focus();
  next.onclick = () => {
    if (!lastInRound) { state.q += 1; beginQuestion(); return; }
    if (lastRound) { showFinal(); return; }
    showRoundSummary();
  };
}

function showRoundSummary() {
  const done = state.r + 1;
  app.innerHTML = `
    <section class="card">
      <h1>Round ${done} <span class="accent">complete</span></h1>
      <p class="lead">${state.rounds.length - done} round${state.rounds.length - done === 1 ? "" : "s"} to go. Up next: ${esc(state.rounds[done].title)}.</p>
      ${standingsHTML(state.players)}
      <div class="actions"><button class="primary" id="next" type="button">Continue to round ${done + 1} →</button></div>
    </section>`;
  const next = document.getElementById("next");
  next.focus();
  next.onclick = () => { state.r += 1; beginRound(); };
}

function showFinal() {
  const count = totalQuestions();
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  state.inGame = false;
  renderHud();
  let board = [];
  for (const p of state.players) board = state.game.addScore(p.name, p.score, count);

  app.innerHTML = `
    <section class="card">
      <h1>${ranked.length > 1 ? `${esc(ranked[0].name)} <span class="accent">wins!</span>` : `Final score: <span class="accent">${ranked[0].score}</span>`}</h1>
      <p class="lead">${state.rounds.length} round${state.rounds.length === 1 ? "" : "s"} · ${count} questions · ${count * 100} points possible</p>
      ${standingsHTML(state.players)}
      <div class="actions">
        <button class="ghost" id="setup" type="button">Change settings</button>
        <button class="primary" id="again" type="button">Play again</button>
      </div>
    </section>
    ${leaderboardHTML(board)}`;
  document.getElementById("setup").onclick = renderSetup;
  document.getElementById("again").onclick = () => startGame(loadSetup());
}

// ---------------------------------------------------------------- boot

document.getElementById("home").onclick = () => {
  if (state.inGame && !confirm("Leave the current game?")) return;
  if (state.game) renderSetup();
};

Game.load()
  .then((game) => { state.game = game; renderSetup(); })
  .catch((err) => {
    console.error(err);
    app.innerHTML = `<section class="card"><h2>Couldn't load the questions</h2>
      <p class="muted">Open this page through a web server, not straight from the file.
      For example, run <code>python3 -m http.server</code> in this folder and visit http://localhost:8000.</p></section>`;
  });
