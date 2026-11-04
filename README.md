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

- **Same device:** 1–8 people pass one phone or laptop around. Answers stay hidden until everyone has locked in.
- **Online room:** one person picks *Online room → Create a room* and shares the 5-character code (or the invite link). Everyone else picks *Online room*, types the code and joins on their own device. All players answer at the same time, the host moves the game along, and up to 12 players can join.
  - Rooms use [PeerJS](https://peerjs.com/), so browsers connect directly to each other. PeerJS's free public server only introduces them, and no account or API key is needed. The library is bundled with the site, and several providers of connection-helper (STUN) servers are configured, so a single blocked one (some VPNs, some countries) doesn't stop play.
  - The host's browser runs the game, so the room closes if the host leaves.
  - Very strict networks (some school or office Wi-Fi) can block these direct connections.
- **Timer:** optional, 20, 30 or 45 seconds per answer.
- **Hall of fame:** ranked by average points per question.

## Scoring

Rarity is the share of all answers ever given to a question that match yours.

| Bracket | Share of answers | Points |
|---|---|---|
| Ultra Rare | under 1% | 100 |
| Rare | 1–3% | 60 |
| Uncommon | 3–7% | 40 |
| Common | 7–15% | 20 |
| Very Common | 15%+ | 10 |

Every answer in a bracket scores the same. An answer that isn't on the board scores 0.

- **Starting counts:** each question starts with survey-style seed counts, so scoring makes sense from the first game.
- **Learning:** every valid answer adds to those counts. A rare answer that keeps winning slowly becomes common.
- **Where it's stored:** the learned counts and leaderboard live in the browser's `localStorage`. Each device learns separately, and *Reset* on the start screen clears it.

Matching is forgiving. It ignores capitals, plurals, accents and punctuation, and it fixes typos ("libray" → Library) and sound-alike spellings ("derek ray" → Derrick Rae). It also accepts aliases ("ping pong", "NY", "Curie") and distinctive parts of long titles ("prisoner of azkaban"). When an answer is corrected, the results show what you typed. A guess that is itself an ordinary English word is never corrected into a different answer, so "ball" isn't read as the Chicago Bulls and "dog" isn't Doug. Common homophones are listed as spellings instead ("time" counts as Thyme, "pair" as Pear). The word list is in `vendor/scowl/`.

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

## Filling questions from Wikidata and TMDB

`tools/generate.mjs` pulls complete answer lists from databases and merges them into the question files. Answers already on a question keep their place and pick up new spellings. New answers go at the end, most popular first, and become that question's rare answers. The sources are listed in `tools/sources.mjs`.

```bash
node tools/generate.mjs --preview          # see what each source returns, change nothing
node tools/generate.mjs --only wikidata    # free, no key needed
TMDB_API_KEY=your_key node tools/generate.mjs --only tmdb
node tools/check.mjs                       # then validate
```

- **Wikidata** is free, needs no key, and its data is CC0. Answers are ranked by how many Wikipedia language editions cover them.
- **TMDB** is free for non-commercial use. Get an API key at https://www.themoviedb.org/settings/api. Answers are ranked by votes, or by episode count for TV characters.
- Film genres (horror, heist, zombie and so on) come from TMDB's genres and keywords, because Wikidata's genre tags are loose.
- People questions drop anyone who is also known for another job or sport, so Niels Bohr (who played football) doesn't become a famous soccer player. Directors and composers are ranked by how well known their films are.
- A source can set `exclude` (a regex) to skip labels it gets wrong. Plants labelled with Latin names get their common name.
- Downloads are cached in `tools/.cache/` (not committed). Pass `--fresh` to refetch.

## Credits

Answer data from [Wikidata](https://www.wikidata.org) (CC0) and [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB. Online rooms use [PeerJS](https://peerjs.com) (MIT, bundled in `vendor/peerjs`). The English word list comes from [SCOWL](http://wordlist.aspell.net/) by Kevin Atkinson (see `vendor/scowl/LICENSE`).
