// Online rooms: one player hosts, everyone else joins with a room code.
// Uses PeerJS (WebRTC) so browsers talk directly to each other; PeerJS's free
// public server only introduces them. The host's browser runs the game and
// sends every player the same snapshot of what to show.
import {
  esc, standingsHTML, resultHTML, topListHTML, animateResults, runTimer, trackBest, leaderboardHTML,
} from "./ui.js";

// Bundled with the site (not a CDN) so networks that block CDNs can still play.
const PEERJS_URL = "vendor/peerjs/peerjs.min.js";
// Servers that help two browsers find a direct route to each other. Several
// providers, so one being blocked (some VPNs, some countries) isn't fatal.
const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.miwifi.com:3478" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
  },
};
const ID_PREFIX = "rarefind-room-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const MAX_PLAYERS = 12;
const GRACE_MS = 1500; // late answers still count for this long after the timer

export const normalizeCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const inviteLink = (code) => `${location.origin}${location.pathname}?room=${code}`;

function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PEERJS_URL;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error("Couldn't load the online-play library. Check your internet connection."));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------- screens

/**
 * Draws whatever phase the room is in. The same code runs on the host and on
 * guests; only the host gets the buttons that move the game along.
 */
class RoomScreen {
  constructor(app, hud, { isHost, onSubmit, onNext, onSkip, onLeave }) {
    Object.assign(this, { app, hud, isHost, onSubmit, onNext, onSkip, onLeave });
    this.key = null; // which screen is currently drawn
    this.answeredKey = null; // the question this player already answered
    this.stopTimer = () => {};
  }

  message(title, body, buttonLabel = "Back to start") {
    this.stopTimer();
    this.key = "message";
    this.hud.innerHTML = "";
    this.app.innerHTML = `<section class="card handoff">
      <div class="big-name" style="font-size:1.8rem">${esc(title)}</div>
      <p class="muted">${body}</p>
      <button class="primary" id="leave" type="button">${esc(buttonLabel)}</button>
    </section>`;
    document.getElementById("leave").onclick = this.onLeave;
  }

  show(view, me) {
    this.view = view;
    this.me = me;
    const qKey = view.question ? `${view.r}.${view.q}` : "";
    const answered = view.phase === "question" && (this.answeredKey === qKey || view.players.find((p) => p.id === me)?.answered);
    const key = `${view.phase}|${qKey}|${answered ? "done" : ""}`;
    this.renderHud();
    if (key === this.key) return this.patch(); // keep whatever the player is typing
    this.key = key;
    this.stopTimer();
    this.stopTimer = () => {};
    this[`render_${view.phase}`](answered);
  }

  renderHud() {
    const v = this.view;
    const chips = v.players.map((p) => {
      const tick = v.phase === "question" && p.answered ? " ✓" : "";
      const off = p.online ? "" : " style=\"opacity:.45\" title=\"disconnected\"";
      return `<span class="chip ${p.id === this.me ? "active" : ""}"${off}>${esc(p.name)}${tick}<b>${p.score}</b></span>`;
    }).join("");
    const where = v.question ? ` · Round ${v.r + 1}/${v.roundsTotal} · Q ${v.q + 1}/${v.qTotal}` : "";
    this.hud.innerHTML = `<span class="chip">Room <b style="color:var(--text);margin-left:0">${esc(v.code)}</b>${where}</span>${chips}`;
  }

  patch() {
    const waiting = document.getElementById("waiting");
    if (waiting) waiting.innerHTML = this.waitingHTML();
    const lobby = document.getElementById("lobbyPlayers");
    if (lobby) lobby.innerHTML = this.lobbyPlayersHTML();
    const start = document.getElementById("next");
    if (start && this.view.phase === "lobby") start.disabled = !this.view.players.length;
  }

  hostButton(label, note = "Waiting for the host…") {
    return this.isHost
      ? `<button class="primary" id="next" type="button">${esc(label)}</button>`
      : `<p class="muted">${esc(note)}</p>`;
  }

  wireButtons() {
    const next = document.getElementById("next");
    if (next) next.onclick = this.onNext;
    const leave = document.getElementById("leave");
    if (leave) leave.onclick = () => { if (confirm(this.isHost ? "Close the room for everyone?" : "Leave the room?")) this.onLeave(); };
    const skip = document.getElementById("skip");
    if (skip) skip.onclick = this.onSkip;
  }

  lobbyPlayersHTML() {
    return this.view.players.map((p) =>
      `<span class="chip">${esc(p.name)}${p.host ? " <span class=\"muted\">(host)</span>" : ""}${p.id === this.me ? " <span class=\"muted\">(you)</span>" : ""}</span>`).join("");
  }

  render_lobby() {
    const v = this.view;
    this.app.innerHTML = `<section class="card handoff">
      <div class="muted">Room code</div>
      <div class="room-code">${esc(v.code)}</div>
      <p class="muted">Players join from the start screen with this code, or with the link below.</p>
      <div class="invite"><input type="text" readonly value="${esc(inviteLink(v.code))}" id="invite">
        <button class="ghost" id="copy" type="button">Copy link</button></div>
      <h3 style="margin-top:24px">In the room</h3>
      <div class="chips center-chips" id="lobbyPlayers">${this.lobbyPlayersHTML()}</div>
      <p class="muted">${esc(v.settings.label)}</p>
      ${this.hostButton("Start game", "Waiting for the host to start the game…")}
      <p><button class="link" id="leave" type="button">${this.isHost ? "Close room" : "Leave room"}</button></p>
    </section>`;
    document.getElementById("copy").onclick = async () => {
      const input = document.getElementById("invite");
      try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand?.("copy"); }
      document.getElementById("copy").textContent = "Copied!";
    };
    this.wireButtons();
  }

  render_intro() {
    const v = this.view;
    this.app.innerHTML = `<section class="card handoff">
      <div class="muted">Round ${v.r + 1} of ${v.roundsTotal}</div>
      <div class="big-name">${esc(v.roundTitle)}</div>
      <div class="chips center-chips">${v.roundThemes.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
      <p class="muted">${v.qTotal} questions${v.timer ? ` · ${v.timer}s each` : ""}</p>
      ${this.hostButton(`Start round ${v.r + 1}`)}
    </section>`;
    this.wireButtons();
  }

  waitingHTML() {
    const left = this.view.players.filter((p) => p.online && !p.answered);
    return left.length
      ? `Still thinking: ${left.map((p) => `<b>${esc(p.name)}</b>`).join(", ")}`
      : "Everyone's in. Revealing…";
  }

  render_question(answered) {
    const v = this.view;
    const timerBar = v.timer ? `<div class="timer" id="timer"><div style="width:100%"></div></div>` : "";
    const skip = this.isHost ? `<p><button class="link" id="skip" type="button">Stop waiting and reveal now</button></p>` : "";
    if (answered) {
      this.app.innerHTML = `<section class="card handoff">
        ${timerBar}
        <div class="muted">${esc(v.question.category)}</div>
        <div class="prompt" style="margin:8px 0 16px">${esc(v.question.prompt)}</div>
        <p>✓ Your answer is locked in.</p>
        <p class="muted" id="waiting">${this.waitingHTML()}</p>
        ${skip}
      </section>`;
    } else {
      this.app.innerHTML = `<section class="card">
        ${timerBar}
        <div class="q-meta"><span>${esc(v.question.category)}</span><span>Everyone answers at once</span></div>
        <div class="prompt">${esc(v.question.prompt)}</div>
        <form class="answer-form" id="form" autocomplete="off">
          <input type="text" id="answer" maxlength="80" placeholder="Type something nobody else would say…" aria-label="Your answer">
          <button class="primary" type="submit">Submit</button>
        </form>
        <p class="hint" id="waiting">${this.waitingHTML()}</p>
        ${skip}
      </section>`;
      const input = document.getElementById("answer");
      input.focus();
      document.getElementById("form").onsubmit = (e) => { e.preventDefault(); this.submit(input.value); };
    }
    if (v.timer) {
      const endsAt = (this.endsAt?.key === this.qKey() ? this.endsAt.at : Date.now() + v.remainingMs);
      this.endsAt = { key: this.qKey(), at: endsAt };
      this.stopTimer = runTimer(document.getElementById("timer"), endsAt, v.timer * 1000, () => {
        const input = document.getElementById("answer");
        if (input) this.submit(input.value);
      });
    }
    this.wireButtons();
  }

  qKey() {
    return `${this.view.r}.${this.view.q}`;
  }

  submit(text) {
    this.answeredKey = this.qKey();
    this.onSubmit(text, this.view.question.key);
    this.show(this.view, this.me); // switch to "locked in" straight away
  }

  render_reveal() {
    const v = this.view;
    const names = new Map(v.players.map((p) => [p.id, p.name]));
    const mine = new Set(v.results.filter((r) => r.accepted).map((r) => r.answer));
    const lastInRound = v.q === v.qTotal - 1;
    const lastRound = v.r === v.roundsTotal - 1;
    const label = !lastInRound ? "Next question →" : lastRound ? "See final results →" : "Round results →";
    this.app.innerHTML = `
      <section class="card">
        <div class="q-meta"><span>${esc(v.question.category)}</span><span>Results</span></div>
        <div class="prompt" style="margin-bottom:18px">${esc(v.question.prompt)}</div>
        <div class="results">${v.results.map((r, i) =>
          resultHTML(r, i, `${names.get(r.player) || "Player"}${r.player === this.me ? " (you)" : ""}`)).join("")}</div>
      </section>
      <section class="card">
        ${topListHTML(v.top, mine)}
        <div class="actions">${this.hostButton(label)}</div>
      </section>`;
    animateResults(this.app);
    this.wireButtons();
  }

  render_summary() {
    const v = this.view;
    this.app.innerHTML = `<section class="card">
      <h1>Round ${v.r + 1} <span class="accent">complete</span></h1>
      <p class="lead">Up next: ${esc(v.nextTitle)}.</p>
      ${standingsHTML(v.players)}
      <div class="actions">${this.hostButton(`Continue to round ${v.r + 2} →`)}</div>
    </section>`;
    this.wireButtons();
  }

  render_final() {
    const v = this.view;
    const ranked = [...v.players].sort((a, b) => b.score - a.score);
    this.app.innerHTML = `<section class="card">
      <h1>${esc(ranked[0]?.name || "")} <span class="accent">wins!</span></h1>
      <p class="lead">${v.roundsTotal} round${v.roundsTotal === 1 ? "" : "s"} · ${v.totalQuestions} questions · ${v.totalQuestions * 100} points possible</p>
      ${standingsHTML(v.players)}
      <div class="actions">
        <button class="ghost" id="leave" type="button">${this.isHost ? "Close room" : "Leave room"}</button>
        ${this.isHost ? `<button class="primary" id="next" type="button">Play again in this room</button>` : `<span class="muted">The host can start another game.</span>`}
      </div>
    </section>
    ${this.isHost ? leaderboardHTML(v.board || []) : ""}`;
    this.wireButtons();
  }
}

// ---------------------------------------------------------------- host

export async function hostRoom({ game, name, settings, app, hud, onExit }) {
  let room = null;
  let cancelled = false;
  const screen = new RoomScreen(app, hud, {
    isHost: true,
    onSubmit: (text, key) => room.submit("host", text, key),
    onNext: () => room.next(),
    onSkip: () => room.finishQuestion(),
    onLeave: () => { cancelled = true; room?.close(); onExit(); },
  });
  screen.message("Creating room…", "Getting a room code.", "Cancel");

  let Peer;
  try { Peer = await loadPeer(); } catch (err) { return screen.message("Couldn't create a room", esc(err.message)); }
  room = {
    peer: null, code: null, phase: "lobby",
    players: new Map([["host", { id: "host", name, score: 0, best: null, online: true, host: true }]]),
    conns: new Map(),
    rounds: [], r: 0, q: 0, answers: new Map(), results: [], deadline: 0, timeout: null, board: null,

    view() {
      const round = this.rounds[this.r];
      const question = this.phase === "question" || this.phase === "reveal" ? round.questions[this.q] : null;
      return {
        phase: this.phase, code: this.code, settings: { label: settingsLabel(settings) }, timer: settings.timer,
        players: [...this.players.values()].map(({ id, name: n, score, best, online, host }) =>
          ({ id, name: n, score, best, online, host, answered: this.answers.has(id) })),
        r: this.r, roundsTotal: this.rounds.length || settingsRounds(settings, game),
        roundTitle: round?.title, roundThemes: round?.questions.map((x) => x.category), qTotal: round?.questions.length,
        q: this.q, question: question && { key: question.id, prompt: question.prompt, category: question.category },
        remainingMs: Math.max(0, this.deadline - Date.now()),
        results: this.phase === "reveal" ? this.results : [], top: this.top,
        nextTitle: this.rounds[this.r + 1]?.title,
        totalQuestions: this.rounds.reduce((n, x) => n + x.questions.length, 0), board: this.board,
      };
    },

    broadcast() {
      const v = this.view();
      for (const conn of this.conns.values()) if (conn.open) conn.send({ t: "state", view: v });
      screen.show(v, "host");
    },

    handle(conn, msg) {
      if (msg.t === "join") {
        if (this.phase !== "lobby") return reject(conn, "That game has already started. Ask the host to let you in next game.");
        if (this.players.size >= MAX_PLAYERS) return reject(conn, `That room is full (${MAX_PLAYERS} players).`);
        let n = String(msg.name || "").trim().slice(0, 24) || "Player";
        const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
        for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${String(msg.name).trim().slice(0, 21) || "Player"} ${i}`;
        this.players.set(conn.peer, { id: conn.peer, name: n, score: 0, best: null, online: true });
        this.conns.set(conn.peer, conn);
        conn.send({ t: "welcome", id: conn.peer });
        this.broadcast();
      } else if (msg.t === "answer") {
        this.submit(conn.peer, msg.text, msg.key);
      }
    },

    dropped(id) {
      this.conns.delete(id);
      if (!this.players.has(id)) return;
      if (this.phase === "lobby") this.players.delete(id);
      else this.players.get(id).online = false;
      if (this.phase === "question" && this.allIn()) this.finishQuestion();
      else this.broadcast();
    },

    start() {
      this.rounds = game.newGame(settings.mode, settings.rounds, settings.themes);
      for (const p of this.players.values()) Object.assign(p, { score: 0, best: null });
      this.board = null;
      this.r = 0;
      this.phase = "intro";
      this.broadcast();
    },

    startQuestion() {
      this.phase = "question";
      this.answers = new Map();
      this.results = [];
      clearTimeout(this.timeout);
      if (settings.timer) {
        this.deadline = Date.now() + settings.timer * 1000;
        this.timeout = setTimeout(() => this.finishQuestion(), settings.timer * 1000 + GRACE_MS);
      }
      this.broadcast();
    },

    allIn() {
      return [...this.players.values()].every((p) => !p.online || this.answers.has(p.id));
    },

    submit(id, text, key) {
      const current = this.rounds[this.r]?.questions[this.q];
      if (this.phase !== "question" || this.answers.has(id) || !this.players.has(id) || key !== current.id) return;
      this.answers.set(id, String(text || "").slice(0, 80));
      if (this.allIn()) this.finishQuestion();
      else this.broadcast();
    },

    finishQuestion() {
      if (this.phase !== "question") return;
      clearTimeout(this.timeout);
      const qid = this.rounds[this.r].questions[this.q].id;
      // Score in the order answers arrived; anyone who didn't answer gets 0.
      const ids = [...this.answers.keys(), ...[...this.players.keys()].filter((id) => !this.answers.has(id))];
      for (const id of ids) {
        const res = game.answer(qid, this.answers.get(id) ?? "");
        const p = this.players.get(id);
        p.score += res.points;
        trackBest(p, res);
        this.results.push({ player: id, ...res });
        this.top = res.top;
      }
      this.phase = "reveal";
      this.broadcast();
    },

    next() {
      const round = this.rounds[this.r];
      if (this.phase === "lobby") return this.start();
      if (this.phase === "intro") { this.q = 0; return this.startQuestion(); }
      if (this.phase === "summary") { this.r += 1; this.phase = "intro"; return this.broadcast(); }
      if (this.phase === "final") { this.phase = "lobby"; this.rounds = []; return this.broadcast(); }
      if (this.phase !== "reveal") return;
      if (this.q < round.questions.length - 1) { this.q += 1; return this.startQuestion(); }
      if (this.r < this.rounds.length - 1) { this.phase = "summary"; return this.broadcast(); }
      const count = this.rounds.reduce((n, x) => n + x.questions.length, 0);
      for (const p of this.players.values()) this.board = game.addScore(p.name, p.score, count);
      this.phase = "final";
      this.broadcast();
    },

    close() {
      clearTimeout(this.timeout);
      for (const conn of this.conns.values()) { try { conn.send({ t: "closed" }); } catch { /* already gone */ } }
      setTimeout(() => this.peer?.destroy(), 300);
      window.removeEventListener("beforeunload", this.unload);
    },
  };
  room.unload = () => room.peer?.destroy();
  window.addEventListener("beforeunload", room.unload);

  const reject = (conn, msg) => { conn.send({ t: "error", msg }); setTimeout(() => conn.close(), 300); };

  // Claim a free room code (retry if someone else already has it).
  for (let attempt = 0; attempt < 5 && !room.code && !cancelled; attempt++) {
    const code = newCode();
    try {
      room.peer = await new Promise((resolve, reject2) => {
        const peer = new Peer(ID_PREFIX + code, PEER_OPTIONS);
        peer.on("open", () => resolve(peer));
        peer.on("error", (err) => { peer.destroy(); reject2(err); });
      });
      room.code = code;
    } catch (err) {
      if (err.type !== "unavailable-id") {
        screen.message("Couldn't create a room", `The online service didn't respond (${esc(err.type || err.message)}). Try again in a moment.`);
        return;
      }
    }
  }
  if (cancelled) return room.peer?.destroy();
  if (!room.code) return screen.message("Couldn't create a room", "No free room code was found. Try again.");

  room.peer.on("connection", (conn) => {
    conn.on("data", (msg) => room.handle(conn, msg));
    conn.on("close", () => room.dropped(conn.peer));
    conn.on("error", () => room.dropped(conn.peer));
  });
  room.peer.on("disconnected", () => { if (!room.peer.destroyed) room.peer.reconnect(); });
  room.broadcast();
}

// ---------------------------------------------------------------- guest

export async function joinRoom({ code, name, app, hud, onExit }) {
  let conn = null;
  let peer = null;
  let me = null;
  let closedOnPurpose = false;
  const leave = () => { closedOnPurpose = true; peer?.destroy(); onExit(); };
  const screen = new RoomScreen(app, hud, {
    isHost: false,
    onSubmit: (text, key) => conn?.open && conn.send({ t: "answer", text, key }),
    onNext: () => {},
    onSkip: () => {},
    onLeave: leave,
  });
  code = normalizeCode(code);
  screen.message(`Joining ${code}…`, "Connecting to the host.", "Cancel");

  let Peer;
  try { Peer = await loadPeer(); } catch (err) { return screen.message("Couldn't connect", esc(err.message)); }
  peer = new Peer(PEER_OPTIONS);
  const giveUp = setTimeout(() => {
    if (!me) { closedOnPurpose = true; peer.destroy(); screen.message("Couldn't reach that room", "Check the code, and make sure the host still has the room open."); }
  }, 15000);

  peer.on("error", (err) => {
    if (closedOnPurpose) return;
    clearTimeout(giveUp);
    closedOnPurpose = true;
    peer.destroy();
    screen.message(
      err.type === "peer-unavailable" ? `No room called ${code}` : "Connection problem",
      err.type === "peer-unavailable" ? "Check the code with the host. Codes are 5 letters and numbers." : `Something went wrong (${esc(err.type || err.message)}).`,
    );
  });
  peer.on("open", () => {
    conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: "json" });
    conn.on("open", () => conn.send({ t: "join", name }));
    conn.on("data", (msg) => {
      if (msg.t === "welcome") { me = msg.id; clearTimeout(giveUp); }
      else if (msg.t === "state" && me) screen.show(msg.view, me);
      else if (msg.t === "error") { closedOnPurpose = true; clearTimeout(giveUp); screen.message("Can't join", esc(msg.msg)); peer.destroy(); }
      else if (msg.t === "closed") { closedOnPurpose = true; screen.message("Room closed", "The host closed the room."); peer.destroy(); }
    });
    conn.on("close", () => {
      if (!closedOnPurpose) screen.message("Disconnected", "Lost the connection to the host.");
      closedOnPurpose = true;
    });
  });
}

// ---------------------------------------------------------------- helpers

function settingsRounds(settings, game) {
  return settings.mode === "theme" ? (settings.themes?.length || game.themes.length) : settings.rounds;
}

function settingsLabel(s) {
  const timer = s.timer ? `${s.timer}s per answer` : "no timer";
  return s.mode === "theme"
    ? `Theme rounds: ${s.themeNames.join(", ")} · ${timer}`
    : `${s.rounds} mixed round${s.rounds === 1 ? "" : "s"} of 7 (one question per theme) · ${timer}`;
}
