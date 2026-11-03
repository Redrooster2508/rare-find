import { Game, QUESTIONS_PER_ROUND } from "./engine.js";
import {
  esc, legendHTML, leaderboardHTML, standingsHTML, resultHTML, topListHTML, animateResults, runTimer, trackBest,
} from "./ui.js";
import { hostRoom, joinRoom, normalizeCode } from "./online.js";

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
  stopTimer: () => {},
  inGame: false, // a same-device game, or an online room, is running
};

const currentQuestion = () => state.rounds[state.r].questions[state.q];
const totalQuestions = () => state.rounds.reduce((n, r) => n + r.questions.length, 0);

function loadSetup() {
  try { return JSON.parse(localStorage.getItem("rarefind.setup")) || {}; } catch { return {}; }
}
function saveSetup(setup) {
  try { localStorage.setItem("rarefind.setup", JSON.stringify(setup)); } catch { /* ignore */ }
}

function stopTimer() {
  state.stopTimer();
  state.stopTimer = () => {};
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

// ---------------------------------------------------------------- setup

function renderSetup() {
  stopTimer();
  state.inGame = false;
  renderHud();
  const { game } = state;
  const saved = loadSetup();
  const roomFromLink = normalizeCode(new URLSearchParams(location.search).get("room"));
  const names = saved.names?.length ? saved.names : ["Player 1"];
  const chosen = new Set(saved.themes?.length ? saved.themes : game.themes.map((t) => t.id));
  let where = roomFromLink ? "online" : saved.where === "online" ? "online" : "local";
  let mode = saved.mode === "theme" ? "theme" : "mixed";

  app.innerHTML = `
  <section class="card">
    <h1>Don't say what everyone says. <span class="accent">Find the rare one.</span></h1>
    <p class="lead">Every question is open-ended, so type any answer that fits. The fewer people who have given that answer
      before, the more points you score. Answers that don't fit the question score 0.</p>
    <div class="grid2">
      <div>
        <h3>How are you playing?</h3>
        <div class="seg" role="radiogroup">
          <button type="button" data-where="local">Same device</button>
          <button type="button" data-where="online">Online room</button>
        </div>

        <div id="localBox" style="margin-top:14px">
          <div id="players"></div>
          <button class="ghost" id="addPlayer" type="button">+ Add player</button>
        </div>

        <div id="onlineBox" style="margin-top:14px">
          <label>Your name <input type="text" id="myName" maxlength="24" value="${esc(saved.myName || names[0])}"></label>
          <div class="join-box">
            <h3 style="margin:0 0 8px">Join a friend's room</h3>
            <div class="answer-form">
              <input type="text" id="code" maxlength="8" placeholder="Room code" value="${esc(roomFromLink)}" aria-label="Room code" style="text-transform:uppercase">
              <button class="primary" id="join" type="button">Join</button>
            </div>
          </div>
          <p class="hint">Or set up the rounds below and create a room for others to join.</p>
        </div>

        <h3 style="margin-top:24px">Rounds</h3>
        <div class="seg" role="radiogroup">
          <button type="button" data-mode="mixed">Mixed rounds</button>
          <button type="button" data-mode="theme">Theme rounds</button>
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
        <button class="primary big" id="start" type="button"></button>
      </div>
      <div>
        <h3>Scoring brackets</h3>
        ${legendHTML()}
        <p class="hint">Rarity is the share of everyone's past answers to that question that match yours.</p>
        <h3 style="margin-top:24px">Themes</h3>
        <p class="hint" style="margin-top:0">${game.themes.map((t) => `${esc(t.name)} (${t.questions.length})`).join(" · ")}</p>
      </div>
    </div>
  </section>
  ${leaderboardHTML(game.leaderboard())}
  <p class="center"><button class="link" id="reset" type="button">Reset learned answers and scores on this device</button></p>`;

  // players (same device)
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

  // toggles
  const apply = () => {
    app.querySelectorAll("[data-where]").forEach((b) => b.classList.toggle("on", b.dataset.where === where));
    app.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    document.getElementById("localBox").hidden = where !== "local";
    document.getElementById("onlineBox").hidden = where !== "online";
    document.getElementById("mixedOpts").hidden = mode !== "mixed";
    document.getElementById("themeOpts").hidden = mode !== "theme";
    document.getElementById("modeHint").textContent = mode === "mixed"
      ? `Each round is ${QUESTIONS_PER_ROUND} questions, one from each theme.`
      : `Each theme you pick is a round of ${QUESTIONS_PER_ROUND} questions from that theme.`;
    document.getElementById("start").textContent = where === "online" ? "Create a room" : "Start game";
  };
  app.querySelectorAll("[data-where]").forEach((b) => { b.onclick = () => { where = b.dataset.where; apply(); }; });
  app.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => { mode = b.dataset.mode; apply(); }; });
  app.querySelectorAll("[data-theme]").forEach((b) => { b.onclick = () => b.classList.toggle("on"); });
  apply();

  const collect = () => {
    const themes = [...app.querySelectorAll("[data-theme].on")].map((b) => b.dataset.theme);
    const setup = {
      where, mode, themes,
      themeNames: themes.map((id) => game.themes.find((t) => t.id === id).name),
      names: currentNames().map((n, i) => n.trim() || `Player ${i + 1}`),
      myName: document.getElementById("myName").value.trim() || "Player",
      rounds: Number(document.getElementById("rounds").value),
      timer: Number(document.getElementById("timer").value),
    };
    saveSetup(setup);
    return setup;
  };
  const leaveRoom = () => {
    history.replaceState(null, "", location.pathname);
    renderSetup();
  };

  document.getElementById("start").onclick = () => {
    const setup = collect();
    if (setup.mode === "theme" && !setup.themes.length) { alert("Pick at least one theme."); return; }
    if (setup.where === "local") return startGame(setup);
    state.inGame = true;
    hostRoom({ game, name: setup.myName, settings: setup, app, hud, onExit: () => { state.inGame = false; leaveRoom(); } });
  };
  document.getElementById("join").onclick = () => {
    const setup = collect();
    const code = normalizeCode(document.getElementById("code").value);
    if (code.length < 4) { alert("Enter the room code the host gave you."); return; }
    state.inGame = true;
    joinRoom({ code, name: setup.myName, app, hud, onExit: () => { state.inGame = false; leaveRoom(); } });
  };
  document.getElementById("code").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("join").click(); });

  document.getElementById("reset").onclick = () => {
    if (!confirm("Forget every answer this device has learned, and the hall of fame?")) return;
    game.reset();
    location.reload();
  };
}

// ---------------------------------------------------------------- same-device game

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
  app.innerHTML = `
    <section class="card handoff">
      <div class="muted">Round ${state.r + 1} of ${state.rounds.length}</div>
      <div class="big-name">${esc(round.title)}</div>
      <div class="chips center-chips">${round.questions.map((q) => `<span class="chip">${esc(q.category)}</span>`).join("")}</div>
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
        <button class="primary" type="submit">Submit</button>
      </form>
      <p class="hint">Go obscure, but it still has to be a real, valid answer.</p>
    </section>`;
  const input = document.getElementById("answer");
  input.focus();
  document.getElementById("form").onsubmit = (e) => {
    e.preventDefault();
    submitAnswer(input.value);
  };
  if (state.timer) {
    const total = state.timer * 1000;
    state.stopTimer = runTimer(document.getElementById("timer"), Date.now() + total, total, () => submitAnswer(input.value));
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

function showReveal() {
  renderHud();
  const q = currentQuestion();
  const lastInRound = state.q === state.rounds[state.r].questions.length - 1;
  const lastRound = state.r === state.rounds.length - 1;
  const nextLabel = !lastInRound ? "Next question →" : lastRound ? "See final results →" : "Round results →";
  const multi = state.players.length > 1;
  const mine = new Set(state.results.filter((r) => r.accepted).map((r) => r.answer));
  app.innerHTML = `
    <section class="card">
      <div class="q-meta"><span>${esc(q.category)}</span><span>Results</span></div>
      <div class="prompt" style="margin-bottom:18px">${esc(q.prompt)}</div>
      <div class="results">${state.results.map((r, i) =>
        resultHTML(r, i, multi ? state.players[r.player].name : "")).join("")}</div>
    </section>
    <section class="card">
      ${topListHTML(state.results[state.results.length - 1].top, mine)}
      <div class="actions">
        <button class="primary" id="next" type="button">${nextLabel}</button>
      </div>
    </section>`;
  animateResults(app);
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
  if (state.game) location.href = location.pathname; // also drops any online connection
};

Game.load()
  .then((game) => { state.game = game; renderSetup(); })
  .catch((err) => {
    console.error(err);
    app.innerHTML = `<section class="card"><h2>Couldn't load the questions</h2>
      <p class="muted">Open this page through a web server, not straight from the file.
      For example, run <code>python3 -m http.server</code> in this folder and visit http://localhost:8000.</p></section>`;
  });
