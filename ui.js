// Rendering helpers shared by same-device play (app.js) and online rooms (online.js).
import { BRACKETS } from "./engine.js";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const color = (key) => `var(--${key})`;

function bracketRange(b) {
  if (b.minPct === 0) return `under ${b.maxPct}% of answers`;
  if (b.maxPct >= 100) return `${b.minPct}%+ of answers`;
  return `${b.minPct}–${b.maxPct}% of answers`;
}

export function legendHTML() {
  return `<div class="legend">${BRACKETS.map((b) => `
    <div class="legend-item">
      <span class="dot" style="background:${color(b.key)}"></span>
      <div><div class="name">${b.name}</div><div class="range">${bracketRange(b)}</div></div>
      <div class="pts" style="color:${color(b.key)}">${b.minPts}–${b.maxPts}</div>
    </div>`).join("")}
  </div>`;
}

export function leaderboardHTML(rows) {
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

/** players: [{name, score, best, note?}] */
export function standingsHTML(players) {
  const medals = ["🥇", "🥈", "🥉"];
  return `<div class="podium">${[...players].sort((a, b) => b.score - a.score).map((p, i) => `
    <div class="standing ${i === 0 ? "first" : ""}">
      <div class="place">${medals[i] || i + 1}</div>
      <div>
        <div class="nm">${esc(p.name)}${p.note ? ` <span class="muted" style="font-weight:400">${esc(p.note)}</span>` : ""}</div>
        <div class="sub">${p.best
          ? `Best find: <b style="color:${color(p.best.bracket.key)}">${esc(p.best.answer)}</b> (${p.best.bracket.name}, ${p.best.points} pts)`
          : "No valid answers yet"}</div>
      </div>
      <div class="sc">${p.score}</div>
    </div>`).join("")}
  </div>`;
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

/** One player's result card. `who` is shown above the answer in multiplayer. */
export function resultHTML(r, i, who) {
  const delay = `animation-delay:${i * 120}ms`;
  const whoLine = who ? `<div class="who">${esc(who)}</div>` : "";
  if (!r.accepted) {
    return `<div class="result" style="${delay}">
      <div class="result-head">
        <div>
          ${whoLine}
          <div class="ans">${r.input ? `“${esc(r.input)}”` : "—"}</div>
          <span class="badge none">${esc(r.reason)}</span>
          <div class="stat">${r.input ? "That answer isn't on our list for this question." : "No answer was submitted in time."}</div>
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
        ${whoLine}
        <div class="ans">${esc(r.answer)}</div>
        ${typedDiffers ? `<div class="typed">you typed “${esc(r.input)}”</div>` : ""}
        <span class="badge">${esc(r.bracket.name)}</span>
        <div class="stat">${r.pct}% of answers: ${people} out of ${r.total} said this before you.</div>
      </div>
      <div class="points"><span data-count="${r.points}">0</span><small>points</small></div>
    </div>
    ${meterHTML(r)}
  </div>`;
}

export function topListHTML(top, mine) {
  const maxPct = Math.max(...top.map((t) => t.pct));
  return `<h3>Most common answers</h3>
    <ul class="top-list">${top.map((t) => `
      <li class="${mine.has(t.answer) ? "mine" : ""}">
        <div class="bar"><i style="width:${(100 * t.pct) / maxPct}%"></i><span>${esc(t.answer)}</span></div>
        <div class="pct">${t.pct}%</div>
      </li>`).join("")}
    </ul>`;
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

/** Start the point count-ups and slide the rarity markers into place. */
export function animateResults(root) {
  requestAnimationFrame(() => {
    root.querySelectorAll(".marker").forEach((el) => { el.style.left = `${el.dataset.left}%`; });
    root.querySelectorAll("[data-count]").forEach((el) => countUp(el, Number(el.dataset.count)));
  });
}

/** Drive a `.timer` bar until `endsAt`; returns a stop function. */
export function runTimer(wrap, endsAt, totalMs, onExpire) {
  const bar = wrap.firstElementChild;
  const id = setInterval(() => {
    const left = Math.max(0, endsAt - Date.now());
    bar.style.width = `${(100 * left) / totalMs}%`;
    wrap.classList.toggle("low", left < 5000);
    if (left === 0) {
      clearInterval(id);
      onExpire?.();
    }
  }, 100);
  return () => clearInterval(id);
}

export function trackBest(p, res) {
  if (res.accepted && (!p.best || res.points > p.best.points)) {
    p.best = { answer: res.answer, points: res.points, bracket: res.bracket };
  }
}
