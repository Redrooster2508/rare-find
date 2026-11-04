// Fill questions from Wikidata and TMDB:  node tools/generate.mjs [options]
//
//   --preview         show what each source returns, change nothing
//   --only <source>   just "wikidata" or "tmdb"
//   --match <text>    just the questions whose prompt contains <text>
//   --fresh           ignore the download cache in tools/.cache
//
// Sources are listed in tools/sources.mjs. Every answer a source returns is merged
// into that question in questions/*.txt: answers already there keep their place
// (and gain any new aliases), and new ones are added to the end, most popular
// first, where they become the question's rare answers.
// TMDB needs a free API key: TMDB_API_KEY=... node tools/generate.mjs --only tmdb
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseNorm, variants } from "../engine.js";
import sources from "./sources.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", ".cache");
const USER_AGENT = "RareFind-question-generator/1.0 (https://github.com/Redrooster2508/rare-find)";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fetching

async function cachedJson(url, init = {}) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, createHash("sha1").update(url).digest("hex") + ".json");
  if (!flag("--fresh") && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers } });
    if (res.ok) {
      const data = await res.json();
      writeFileSync(file, JSON.stringify(data));
      await sleep(400); // be polite to free public services
      return data;
    }
    if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    }
    // Wikidata asks clients to honour Retry-After when it rate-limits them.
    const wait = Number(res.headers.get("retry-after")) * 1000 || 10000 * attempt;
    await sleep(wait);
  }
}

/** Items matching a SPARQL pattern on ?item, most Wikipedia language editions first. */
async function fromWikidata({ wikidata, ranked, unlessJob, commonNames, limit = 150, minLinks = 1 }) {
  // Two small queries: one big query that also fetches labels times out on the
  // public endpoint, because the optimiser joins labels before the LIMIT.
  // `ranked` is a full query binding ?item and its own ?links score.
  // Filtering by job inside the query times out for big jobs, so fetch extra and filter here.
  const fetchLimit = unlessJob ? limit * 2 : limit;
  const top = await sparql(ranked ? `${ranked} LIMIT ${fetchLimit}` : `
    SELECT ?item ?links WHERE {
      ${wikidata}
      ?item wikibase:sitelinks ?links . FILTER(?links >= ${minLinks})
    } ORDER BY DESC(?links) LIMIT ${fetchLimit}`);
  if (!top.length) return [];
  const links = new Map(top.map((b) => [b.item.value, Number(b.links.value)]));
  const ids = [...links.keys()].map((u) => `wd:${u.split("/").pop()}`).join(" ");
  const named = await sparql(`
    SELECT ?item ?label ?taxon (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts)
           (GROUP_CONCAT(DISTINCT ?job; separator="|") AS ?jobs)
           (GROUP_CONCAT(DISTINCT ?cn; separator="|") AS ?cns) WHERE {
      VALUES ?item { ${ids} }
      ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
      OPTIONAL { ?item wdt:P225 ?taxon }
      OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) = "en") }
      ${unlessJob ? "OPTIONAL { ?item wdt:P106 ?job }" : ""}
      ${commonNames ? `OPTIONAL { ?item wdt:P1843 ?cn . FILTER(LANG(?cn) = "en") }` : ""}
    } GROUP BY ?item ?label ?taxon`);
  const unless = new Set((unlessJob || []).map((q) => `http://www.wikidata.org/entity/${q}`));
  return named
    .filter((b) => !b.jobs?.value || !b.jobs.value.split("|").some((j) => unless.has(j)))
    .map((b) => {
      const aliases = b.alts?.value ? b.alts.value.split("|") : [];
      const item = { label: b.label.value, taxon: b.taxon?.value, aliases, score: links.get(b.item.value) };
      if (!commonNames) return commonName(item);
      // Taxa are answered by their English common name, e.g. "Fragaria" -> "strawberry".
      const names = (b.cns?.value ? b.cns.value.split("|") : []).filter((n) => new RegExp(commonNames, "i").test(n));
      return names.length ? { label: names[0], aliases: names.slice(1), score: item.score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Plants labelled by taxon name ("Foeniculum vulgare") are answered as "Fennel" instead, or dropped. */
function commonName({ taxon, ...item }) {
  if (!taxon || item.label !== taxon) return item;
  const genus = taxon.split(" ")[0];
  const common = item.aliases.find((a) => !a.startsWith(genus) && a.split(" ").length <= 3);
  if (!common) return null;
  return { ...item, label: common, aliases: item.aliases.filter((a) => a !== common).concat(taxon) };
}

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query.replace(/\s+/g, " ").trim())}`;
  const data = await cachedJson(url, { headers: { Accept: "application/sparql-results+json" } });
  return data.results.bindings;
}

function tmdbGet(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  const token = process.env.TMDB_TOKEN;
  if (!key && !token) throw new Error("no TMDB key: set TMDB_API_KEY (or TMDB_TOKEN)");
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cacheUrl = url.toString(); // the key is added after, so it never lands in the cache
  if (key) url.searchParams.set("api_key", key);
  return cachedJsonKeyed(cacheUrl, url.toString(), token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

async function cachedJsonKeyed(cacheUrl, realUrl, init) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, createHash("sha1").update(cacheUrl).digest("hex") + ".json");
  if (!flag("--fresh") && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const data = await cachedJson(realUrl, init);
  writeFileSync(file, JSON.stringify(data));
  return data;
}

const SELF = /^(himself|herself|themselves|self|narrator|various|additional voices?|guest|host|cameo)\b/i;
// Unnamed roles credited by job or relation rather than by name.
const GENERIC = /^(the )?(daughter|son|mother|father|wife|husband|girlfriend|boyfriend|waiter|waitress|bartender|nurse|doctor|receptionist|reporter|cop|police officer|officer|guard|man|woman|girl|boy|guy|kid|student|teacher|customer|patient|driver|neighbor|secretary|assistant|stewardess|clerk)( #?\d+)?$/i;

/** "Tyrion 'The Halfman' Lannister" → label "Tyrion Lannister", aliases ["The Halfman"]; "Brandon 'Bran' Stark" adds "Bran Stark". */
function splitNickname(name) {
  const m = name.match(/^(.*?)\s*['"‘“]([^'"’”]+)['"’”]\s*(.*)$/);
  if (!m || !m[1]) return { label: name, aliases: [] };
  const [, first, nick, rest] = m;
  const label = `${first} ${rest}`.trim();
  const aliases = [nick];
  if (rest && !/^the\b/i.test(nick)) aliases.push(`${nick} ${rest}`);
  return { label, aliases };
}
const DOCUMENTARY = 99;

/** Films/shows/characters from TMDB, most votes (or most episodes) first. */
async function fromTmdb({ tmdb, limit = 150, minVotes = 30 }) {
  const items = [];
  const add = (label, score, aliases = []) => items.push({ label, score, aliases });

  if (tmdb.discover) {
    const { discover, ...filters } = tmdb;
    for (let page = 1; items.length < limit && page <= 10; page++) {
      const data = await tmdbGet(`discover/${discover}`, { sort_by: "vote_count.desc", page, ...filters });
      for (const r of data.results) {
        if ((r.vote_count || 0) < minVotes || r.genre_ids?.includes(DOCUMENTARY)) continue;
        add(r.title || r.name, r.vote_count);
      }
      if (page >= data.total_pages) break;
    }
  } else if (tmdb.person) {
    const found = await tmdbGet("search/person", { query: tmdb.person });
    const person = found.results.find((p) => p.name.toLowerCase() === tmdb.person.toLowerCase()) || found.results[0];
    if (!person) throw new Error(`TMDB has no person called ${tmdb.person}`);
    const credits = await tmdbGet(`person/${person.id}/movie_credits`);
    const list = tmdb.credits === "cast"
      ? credits.cast.filter((c) => !SELF.test(c.character || ""))
      : credits.crew.filter((c) => c.job === tmdb.credits);
    const seen = new Set();
    for (const c of list.sort((a, b) => b.vote_count - a.vote_count)) {
      if (seen.has(c.id) || c.vote_count < minVotes || c.genre_ids?.includes(DOCUMENTARY) || c.video) continue;
      seen.add(c.id);
      add(c.title, c.vote_count);
    }
  } else if (tmdb.tvCharacters) {
    const found = await tmdbGet("search/tv", { query: tmdb.tvCharacters, ...(tmdb.year ? { first_air_date_year: tmdb.year } : {}) });
    const show = found.results[0];
    if (!show) throw new Error(`TMDB has no show called ${tmdb.tvCharacters}`);
    const credits = await tmdbGet(`tv/${show.id}/aggregate_credits`);
    const episodes = new Map();
    for (const actor of credits.cast) {
      for (const role of actor.roles || []) {
        for (let name of String(role.character || "").split(/\s+\/\s+|;/)) {
          name = name.replace(/\((voice|uncredited|archive footage|singing voice)[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
          if (!name || SELF.test(name) || GENERIC.test(name) || name.length > 40) continue;
          episodes.set(name, (episodes.get(name) || 0) + (role.episode_count || 1));
        }
      }
    }
    for (const [name, count] of [...episodes].sort((a, b) => b[1] - a[1])) {
      if (count < (tmdb.minEpisodes ?? 2)) continue;
      const { label, aliases } = splitNickname(name);
      // "Ser Jorah Mormont" → "Jorah Mormont", keeping the titled form as a spelling
      const plain = label.replace(/^(sir|ser|lord|lady|maester|grand maester|septa|dame) (?=\S+ \S)/i, "");
      add(plain, count, plain === label ? aliases : [label, ...aliases]);
    }
  }
  return items.slice(0, limit);
}

// ---------------------------------------------------------------- merging

/** Make a database label safe for the question file format. */
function clean(text) {
  const t = String(text)
    .replace(/\s*\([^)]*\)\s*$/, "") // trailing disambiguation, e.g. "Mercury (planet)"
    .replace(/\s+(PDO|PGI|PAT|TSG|DOP|AOP|AOC|IGP|DOC|DOCG)$/, "") // protected-origin tags on food names
    .replace(/[;=*\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 60 || /^Q\d+$/.test(t) || !/[a-z]/i.test(t)) return null;
  return t[0].toUpperCase() + t.slice(1);
}

function parseEntries(lines) {
  const entries = [];
  for (const line of lines) {
    for (let item of line.split(";")) {
      item = item.trim();
      if (!item) continue;
      let seed = null;
      const star = item.lastIndexOf("*");
      if (star > 0) { seed = item.slice(star + 1); item = item.slice(0, star); }
      entries.push({ names: item.split("=").map((n) => n.trim()).filter(Boolean), seed });
    }
  }
  return entries;
}

const keysOf = (names) => new Set(names.flatMap((n) => variants(n)));

/** Returns {text, added, merged} with the source items folded into the question. */
function mergeQuestion(fileText, prompt, items, spec) {
  const lines = fileText.split("\n");
  const start = lines.findIndex((l) => l.startsWith("Q:") && l.slice(2).replace(/\s*\[[a-z, ]+\]$/, "").trim() === prompt);
  let end = start + 1;
  if (start >= 0) while (end < lines.length && !lines[end].startsWith("Q:")) end++;
  const body = start >= 0 ? lines.slice(start + 1, end) : [];
  const entries = parseEntries(body.filter((l) => l.trim() && !l.trim().startsWith("#")));
  const explicitSeeds = entries.some((e) => e.seed !== null);
  const owner = new Map(); // lookup key -> entry
  for (const e of entries) for (const k of keysOf(e.names)) if (!owner.has(k)) owner.set(k, e);

  let added = 0;
  let merged = 0;
  const exclude = spec.exclude ? new RegExp(spec.exclude, "i") : null;
  const trim = spec.trim ? new RegExp(spec.trim, "i") : null;
  for (const item of items) {
    if (trim?.test(item.label)) item.aliases = [item.label, ...item.aliases];
    const label = clean(trim ? item.label.replace(trim, "") : item.label);
    if (!label || exclude?.test(label)) continue;
    const aliases = item.aliases.map(clean)
      .filter((a) => a && a.length >= 3 && !exclude?.test(a) && baseNorm(a) !== baseNorm(label))
      // Other scripts vanish when matching ("Λ Ori" would become "ori" and claim Rigel).
      .filter((a) => !/[^\p{Script=Latin}\p{Script=Common}\p{M}]/u.test(a))
      // Catalogue numbers ("HD 48915", "58 Orionis") when the source asks for it.
      .filter((a) => !spec.noNumbers || !/\b\d+\b/.test(a) || /\d/.test(label))
      .slice(0, 6);
    const names = [label, ...aliases];
    const hit = names.flatMap((n) => variants(n)).map((k) => owner.get(k)).find(Boolean);
    if (hit) {
      // Already on the board: just learn spellings it didn't know yet.
      for (const n of names) {
        const ks = variants(n);
        if (ks.some((k) => owner.has(k))) continue;
        hit.names.push(n);
        ks.forEach((k) => owner.set(k, hit));
        merged++;
      }
      continue;
    }
    const fresh = names.filter((n) => !variants(n).some((k) => owner.has(k)));
    if (!fresh.length || fresh[0] !== label) continue;
    const entry = { names: fresh, seed: explicitSeeds ? "1" : null };
    entries.push(entry);
    for (const k of keysOf(fresh)) owner.set(k, entry);
    added++;
  }

  const answerLine = entries.map((e) => e.names.join("=") + (e.seed !== null ? `*${e.seed}` : "")).join("; ");
  if (start >= 0) {
    const comments = body.filter((l) => l.trim().startsWith("#"));
    lines.splice(start + 1, end - start - 1, ...comments, answerLine, ...(end < lines.length ? [""] : []));
  } else {
    lines.push("", `Q: ${prompt}${spec.surnames ? " [surnames]" : ""}`, answerLine);
  }
  return { text: lines.join("\n"), added, merged, isNew: start < 0 };
}

// ---------------------------------------------------------------- main

const only = option("--only");
const match = option("--match")?.toLowerCase();
const todo = sources.filter((s) =>
  (!only || (only === "tmdb" ? s.tmdb : !s.tmdb)) && (!match || s.prompt.toLowerCase().includes(match)));

const files = new Map();
const read = (f) => files.get(f) ?? readFileSync(join(ROOT, "questions", f), "utf8");
let totalAdded = 0;
let failures = 0;

for (const spec of todo) {
  const source = spec.tmdb ? "tmdb" : "wikidata";
  let items;
  try {
    items = spec.tmdb ? await fromTmdb(spec) : await fromWikidata(spec);
  } catch (err) {
    failures++;
    console.log(`✗ ${spec.prompt} (${source}): ${err.message}`);
    continue;
  }
  if (flag("--preview")) {
    console.log(`• ${spec.prompt} (${source}, ${items.length}): ${items.slice(0, 12).map((i) => clean(i.label)).filter(Boolean).join(", ")}`);
    continue;
  }
  const result = mergeQuestion(read(spec.file), spec.prompt, items, spec);
  files.set(spec.file, result.text);
  totalAdded += result.added;
  console.log(`${result.isNew ? "+" : "✓"} ${spec.prompt} (${source}): ${items.length} found, ${result.added} new answers, ${result.merged} new spellings`);
}

if (!flag("--preview")) {
  for (const [f, text] of files) writeFileSync(join(ROOT, "questions", f), text);
  console.log(`\n${totalAdded} answers added across ${files.size} file(s).${failures ? ` ${failures} source(s) failed.` : ""}`);
  console.log("Next: node tools/check.mjs");
}
