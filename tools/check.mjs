// Validate the question files:  node tools/check.mjs
// Prints per-theme counts, duplicate questions, thin questions, and answers that
// can never be matched because another answer's alias already claims them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseThemeFile } from "../engine.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "questions");
const files = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
let problems = 0;

for (const file of files) {
  const theme = parseThemeFile(file, readFileSync(join(dir, file), "utf8"));
  const ids = theme.questions.map((q) => q.id);
  const sizes = theme.questions.map((q) => q.answers.length);
  console.log(`${theme.name.padEnd(12)} ${String(ids.length).padStart(4)} questions   answers per question: ` +
    `min ${Math.min(...sizes)}, avg ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    problems++;
    console.log(`   duplicate question: ${id}`);
  }
  for (const q of theme.questions) {
    if (q.answers.length < 5) console.log(`   only ${q.answers.length} answers: ${q.prompt}`);
    q.answers.forEach((a, pos) => {
      const hit = q.match(a.name);
      if (hit !== pos) {
        problems++;
        console.log(`   "${a.name}" is shadowed by "${q.answers[hit]?.name}" in: ${q.prompt}`);
      }
    });
  }
}
console.log(problems ? `\n${problems} problem(s) found.` : "\nAll good.");
process.exit(problems ? 1 : 0);
