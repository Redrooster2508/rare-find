// Rare Find game engine: question loading, answer matching, rarity scoring and
// local persistence. Runs entirely in the browser (and in Node for tools/check.mjs).

export const QUESTIONS_PER_ROUND = 7;

// Five rarity brackets, rarest first. Rarity = share of all recorded answers to
// that question that match yours. Each bracket is worth a fixed number of points.
export const BRACKETS = [
  { key: "ultra", name: "Ultra Rare", minPct: 0, maxPct: 1, points: 100 },
  { key: "rare", name: "Rare", minPct: 1, maxPct: 3, points: 60 },
  { key: "uncommon", name: "Uncommon", minPct: 3, maxPct: 7, points: 40 },
  { key: "common", name: "Common", minPct: 7, maxPct: 15, points: 20 },
  { key: "very_common", name: "Very Common", minPct: 15, maxPct: 100, points: 10 },
];
// The rarity meter treats anything at or above this share as fully common.
const VERY_COMMON_SCALE_CAP = 40;

// Answers without an explicit "*count" get a survey-like seed from their rank:
// the first-listed answer is the most popular, and popularity falls off as 1/rank^1.3.
const ZIPF_EXPONENT = 1.3;
const SEED_TOTAL = 1000;

// ---------------------------------------------------------------- matching

export function baseNorm(text) {
  let s = String(text).toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/\+\+/g, " plus plus ").replace(/#/g, " sharp ").replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  return s.replace(/^(a|an|the)\s+/, "");
}

function singularWord(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** All lookup keys for a piece of text, most literal first. */
function variants(text) {
  const raw = baseNorm(text);
  const sing = raw.split(" ").map(singularWord).join(" ");
  const out = [];
  for (const k of [raw, sing, raw.replace(/ /g, ""), sing.replace(/ /g, "")]) {
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Levenshtein distance where swapping two adjacent letters counts as one edit. */
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
      cur.push(d);
    }
    if (Math.min(...cur) > limit) return limit + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Rough "sounds like" key for each word, so spellings that sound the same
 * collide: "derek ray" and "derrick rae" both become "drk r".
 */
function phonetic(text) {
  return baseNorm(text).split(" ").map((word) => {
    let w = word.replace(/[^a-z]/g, "");
    if (!w) return "";
    w = w.replace(/^(kn|gn|pn|wr|ps)/, (m) => m[1])
      .replace(/ph/g, "f").replace(/ck/g, "k").replace(/sch/g, "sk").replace(/tch/g, "ch")
      .replace(/dg(?=[eiy])/g, "j").replace(/c(?=[eiy])/g, "s").replace(/[cq]/g, "k")
      .replace(/x/g, "ks").replace(/z/g, "s").replace(/gh(?![aeiou])/g, "").replace(/wh/g, "w");
    const head = /[aeiouy]/.test(w[0]) ? "a" : w[0];
    return (head + w.slice(1).replace(/[aeiouyhw]/g, "")).replace(/(.)\1+/g, "$1");
  }).filter(Boolean).join(" ");
}

function rankSeeds(n) {
  const weights = Array.from({ length: n }, (_, r) => 1 / (r + 1) ** ZIPF_EXPONENT);
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => Math.max(1, Math.round((SEED_TOTAL * w) / total)));
}

export class Question {
  constructor(id, theme, prompt, entries, surnames = false) {
    Object.assign(this, { id, theme, prompt, surnames });
    this.answers = []; // [{name, seed}]
    this.entries = []; // alias lists, indexed lazily on first match
    this.index = null;
    const seeds = rankSeeds(entries.length);
    entries.forEach(({ names, seed }, i) => this.add(names, seed ?? seeds[i]));
  }

  add(names, seed) {
    const pos = this.answers.length;
    this.answers.push({ name: names[0], seed });
    this.entries.push(names);
    if (this.index) this.indexEntry(pos);
    return pos;
  }

  indexEntry(pos) {
    const names = [...this.entries[pos]];
    for (const n of [...names]) {
      // "Star Wars: A New Hope" also answers to "A New Hope"
      if (n.includes(":")) names.push(...n.split(":").filter((p) => p.trim()));
    }
    if (this.surnames && names[0].includes(" ")) names.push(names[0].split(" ").pop());
    for (const n of names) {
      // An exact spelling beats another answer's plural or space-squashed form
      // ("Glass" vs "Glasses"); otherwise the earlier, more popular answer wins.
      variants(n).forEach((key, tier) => {
        const held = this.index.get(key);
        if (!held || tier < held.tier) this.index.set(key, { pos, tier });
      });
      this.phrases.push([baseNorm(n), pos]);
      this.sounds.push([phonetic(n), baseNorm(n).replace(/ /g, ""), pos]);
    }
  }

  ensureIndex() {
    if (this.index) return;
    this.index = new Map(); // lookup key -> answer position
    this.phrases = []; // [spaced key, position] for partial-title matching
    this.sounds = []; // [phonetic key, compact spelling, position] for sound-alike matching
    this.entries.forEach((_, pos) => this.indexEntry(pos));
  }

  match(text) {
    this.ensureIndex();
    const keys = variants(text);
    if (!keys.length) return null;
    for (const key of keys) if (this.index.has(key)) return this.index.get(key).pos;
    // A distinctive chunk of a longer title ("fellowship of the ring").
    let probe = keys[0];
    if (probe.includes(" ") || probe.length >= 4) {
      let best = null;
      for (const [phrase, pos] of this.phrases) {
        if (` ${phrase} `.includes(` ${probe} `) && (probe.includes(" ") || probe.length * 2 >= phrase.length)) {
          if (best === null || pos < best) best = pos;
        }
      }
      if (best !== null) return best;
    }
    // Forgive typos: more slack the longer the word ("libray" -> "library").
    probe = keys[keys.length - 1];
    const limit = probe.length >= 12 ? 3 : probe.length >= 7 ? 2 : probe.length >= 4 ? 1 : 0;
    let best = null;
    let bestDist = limit + 1;
    if (limit) {
      for (const [key, { pos }] of this.index) {
        // Short words must keep their first letter, so "bear" isn't read as "pear".
        if (key.includes(" ") || (probe.length < 7 && key[0] !== probe[0])) continue;
        const d = editDistance(probe, key, limit);
        if (d < bestDist) [best, bestDist] = [pos, d];
      }
    }
    if (best !== null) return best;
    // Sounds the same ("derek ray" -> "derrick rae"), as long as the spelling
    // is still reasonably close, so short unrelated words don't slip through.
    const sound = phonetic(text);
    const compact = keys[0].replace(/ /g, "");
    if (!sound || compact.length < 3) return null;
    bestDist = Infinity;
    for (const [key, spelling, pos] of this.sounds) {
      if (key !== sound) continue;
      const allowed = Math.floor(0.45 * Math.max(compact.length, spelling.length));
      const d = editDistance(compact, spelling, allowed);
      if (d <= allowed && (d < bestDist || (d === bestDist && pos < best))) [best, bestDist] = [pos, d];
    }
    return best;
  }
}

/** Parse one theme file. See the header of any file in questions/ for the format. */
export function parseThemeFile(fileName, text) {
  const id = fileName.replace(/\.txt$/, "").replace(/^\d+[-_]/, "");
  const theme = { id, name: id[0].toUpperCase() + id.slice(1), questions: [] };
  const specs = [];
  let cur = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("@theme")) {
      theme.name = line.slice("@theme".length).trim();
    } else if (line.startsWith("Q:")) {
      let prompt = line.slice(2).trim();
      let flags = [];
      const m = prompt.match(/\s*\[([a-z, ]+)\]$/);
      if (m) {
        flags = m[1].split(",").map((f) => f.trim());
        prompt = prompt.slice(0, m.index);
      }
      cur = { prompt, flags, entries: [], seen: new Map() };
      specs.push(cur);
    } else if (!cur) {
      throw new Error(`${fileName}:${i + 1}: answers before the first 'Q:' line`);
    } else {
      for (let item of line.split(";")) {
        item = item.trim();
        if (!item) continue;
        let seed = null;
        const star = item.lastIndexOf("*");
        if (star > 0) {
          seed = parseInt(item.slice(star + 1), 10);
          item = item.slice(0, star);
        }
        const names = item.split("=").map((n) => n.trim()).filter(Boolean);
        const key = baseNorm(names[0]);
        if (cur.seen.has(key)) {
          // repeated answer: keep the first, merge aliases
          cur.seen.get(key).names.push(...names.slice(1));
          continue;
        }
        const entry = { names, seed };
        cur.seen.set(key, entry);
        cur.entries.push(entry);
      }
    }
  });
  for (const s of specs) {
    const qid = `${id}/${baseNorm(s.prompt).replace(/ /g, "-")}`;
    theme.questions.push(new Question(qid, theme.name, s.prompt, s.entries, s.flags.includes("surnames")));
  }
  return theme;
}

export function score(pct) {
  for (const b of BRACKETS) {
    if (pct < b.maxPct || b === BRACKETS[BRACKETS.length - 1]) {
      const hi = Math.min(b.maxPct, VERY_COMMON_SCALE_CAP);
      const t = Math.max(0, Math.min(1, (hi - pct) / (hi - b.minPct)));
      return { bracket: b, points: b.points, position: t };
    }
  }
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- storage

// Everything players teach the game lives in this browser's localStorage.
class LocalStore {
  constructor(prefix = "rarefind.") {
    this.prefix = prefix;
  }
  get(key, fallback) {
    try {
      const v = globalThis.localStorage?.getItem(this.prefix + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the game still works, it just won't remember */
    }
  }
  remove(key) {
    try {
      globalThis.localStorage?.removeItem(this.prefix + key);
    } catch {
      /* ignore */
    }
  }
}

export class Game {
  constructor(themes, store = new LocalStore()) {
    this.themes = themes;
    this.store = store;
    this.questions = new Map(themes.flatMap((t) => t.questions.map((q) => [q.id, q])));
    this.stats = store.get("stats", {}); // qid -> {answer name: player count}
    this.board = store.get("board", []);
  }

  static async load(baseUrl = "") {
    const files = await (await fetch(`${baseUrl}questions/index.json`)).json();
    const texts = await Promise.all(files.map(async (f) => (await fetch(`${baseUrl}questions/${f}`)).text()));
    return new Game(files.map((f, i) => parseThemeFile(f, texts[i])));
  }

  count(q, pos) {
    const a = q.answers[pos];
    return a.seed + (this.stats[q.id]?.[a.name] || 0);
  }

  total(q) {
    return q.answers.reduce((s, _, i) => s + this.count(q, i), 0);
  }

  top(q, n = 8) {
    const total = this.total(q);
    return q.answers
      .map((_, i) => i)
      .sort((a, b) => this.count(q, b) - this.count(q, a))
      .slice(0, n)
      .map((i) => ({ answer: q.answers[i].name, pct: Math.round((1000 * this.count(q, i)) / total) / 10 }));
  }

  question(qid) {
    const q = this.questions.get(qid);
    if (!q) throw new Error("Unknown question");
    return q;
  }

  /** Mixed: each round is one question from every theme. Theme: one round of 7 per chosen theme. */
  newGame(mode, rounds, themeIds) {
    const pools = new Map(this.themes.map((t) => [t.id, shuffle(t.questions)]));
    const pick = (q) => ({ id: q.id, prompt: q.prompt, category: q.theme });
    if (mode === "theme") {
      const ids = themeIds?.length ? themeIds : this.themes.map((t) => t.id);
      return ids.map((tid) => {
        const t = this.themes.find((x) => x.id === tid);
        return { title: t.name, questions: pools.get(tid).splice(0, QUESTIONS_PER_ROUND).map(pick) };
      });
    }
    return Array.from({ length: Math.max(1, rounds) }, () => ({
      title: "Mixed round",
      questions: this.themes.map((t) => pools.get(t.id).pop()).filter(Boolean).slice(0, QUESTIONS_PER_ROUND).map(pick),
    }));
  }

  answer(qid, text) {
    const q = this.question(qid);
    text = String(text || "").trim().slice(0, 80);
    const pos = text ? q.match(text) : null;
    if (pos === null) {
      return { accepted: false, input: text, points: 0, top: this.top(q), reason: text ? "Not on the board" : "No answer" };
    }
    return this.record(q, pos, text);
  }

  record(q, pos, text) {
    // Rarity is judged against everything said *before* this answer.
    const count = this.count(q, pos);
    const total = this.total(q);
    const pct = (100 * count) / total;
    const { bracket, points, position } = score(pct);
    const name = q.answers[pos].name;
    const perQ = (this.stats[q.id] ||= {});
    perQ[name] = (perQ[name] || 0) + 1;
    this.store.set("stats", this.stats);
    return {
      accepted: true, input: text, answer: name, count, total, pct: Math.round(pct * 100) / 100,
      bracket, bracketPosition: Math.round(position * 1000) / 1000, points, top: this.top(q),
    };
  }

  leaderboard(n = 10) {
    return [...this.board].sort((a, b) => b.avg - a.avg || b.score - a.score).slice(0, n);
  }

  addScore(name, score, rounds) {
    name = (String(name).trim() || "Anonymous").slice(0, 24);
    rounds = Math.max(1, rounds | 0);
    const today = new Date().toISOString().slice(0, 10);
    this.board.push({ name, score, rounds, avg: Math.round((10 * score) / rounds) / 10, date: today });
    this.board = this.leaderboard(100);
    this.store.set("board", this.board);
    return this.leaderboard();
  }

  /** Forget everything players taught this browser: learned counts and scores. */
  reset() {
    ["stats", "board"].forEach((k) => this.store.remove(k));
  }
}
