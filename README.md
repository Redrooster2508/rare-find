# 💎 Rare Find

An open-ended trivia game where **the rarer your answer, the more points you score.**
There are 700 questions across 7 themes, and it runs entirely in the browser.

## Play

- **On GitHub Pages:** go to the repo's *Settings → Pages*, set the source to the `main` branch and the `/ (root)` folder, and open the URL it gives you.
- **Locally:** run `python3 -m http.server 8000` in this folder, then open http://localhost:8000.

Opening `index.html` straight from disk won't work, because the browser blocks loading the question files from `file://`.

## How a game works

| Mode | Each round |
|---|---|
| **Mixed rounds** (default) | 7 questions, one from each theme. Choose 1–5 rounds. |
| **Theme rounds** | 7 questions from a single theme. Each theme you pick is one round. |

The themes are Television, Sports, Films, Food, Fruits, Tech and Science, with 100 questions each. A question never repeats within a game.

- **Players:** 1–8 people on one device. In multiplayer, answers stay hidden until everyone has locked in.
- **Timer:** optional, 20, 30 or 45 seconds per answer.
- **Hall of fame:** ranked by average points per question.

## Scoring

Rarity is the share of all answers ever given to a question that match yours.

| Bracket | Share of answers | Points |
|---|---|---|
| Ultra Rare | under 1% | 86–100 |
| Rare | 1–3% | 66–85 |
| Uncommon | 3–7% | 46–65 |
| Common | 7–15% | 26–45 |
| Very Common | 15%+ | 10–25 |

A rarer answer lands higher inside its bracket's range. An answer that isn't on the board scores 0.

- **Starting counts:** each question starts with survey-style seed counts, so scoring makes sense from the first game.
- **Learning:** every valid answer adds to those counts. A rare answer that keeps winning slowly becomes common.
- **Where it's stored:** the learned counts, accepted answers and leaderboard live in the browser's `localStorage`. Each device learns separately, and *Reset* on the start screen clears it.
- **Accept anyway:** if a real answer isn't on the list, players can click **It's valid, accept it**. That adds the answer to the board on that device and scores it (it'll be ultra rare).

Matching ignores capitals, plurals, accents, punctuation and small typos. It also accepts aliases ("ping pong", "NY", "Curie") and distinctive parts of long titles ("prisoner of azkaban").

## Adding or editing questions

Questions live in `questions/*.txt`, one file per theme, listed in `questions/index.json`:

```
@theme Fruits

Q: Name a citrus fruit.
Orange; Lemon; Lime; Grapefruit; Kumquat=cumquat; Yuzu
```

- List answers **most popular first**. Seed counts are generated from that order.
- Join aliases with `=`. Fix a specific seed count with `*n`, e.g. `Apple*190`.
- Add `[surnames]` after a prompt about people to accept last names alone.

Check your edits with `node tools/check.mjs`. It flags duplicate questions and answers that shadow each other.
