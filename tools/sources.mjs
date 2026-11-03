// Where tools/generate.mjs gets answers from. Each entry fills one question.
//
//   file     question file in questions/
//   prompt   the question's exact prompt (a new prompt adds a new question)
//   wikidata a SPARQL pattern that binds ?item; results are ranked by how many
//            Wikipedia language editions have an article on them
//   tmdb     { discover: "movie"|"tv", ...filters } · { person, credits: "cast"|"Director" }
//            · { tvCharacters, year } — ranked by TMDB votes or episode count
//   limit    how many items to take (default 150)
//   exclude  regex of labels to skip
//   surnames add [surnames] when this creates a new question about people

const film = "?item wdt:P31 wd:Q11424 .";
const human = "?item wdt:P31 wd:Q5 .";
const tvSeries = "?item wdt:P31/wdt:P279* wd:Q5398426 .";
const isA = (q) => `?item wdt:P31 wd:${q} .`;
const kindOf = (q) => `?item wdt:P31|wdt:P279 wd:${q} .`;
const job = (q) => `${human} ?item wdt:P106 wd:${q} .`;
const genreFilm = (q) => `${film} ?item wdt:P136 wd:${q} .`;
const byDirector = (name) => `${film} ?item wdt:P57 ?who . ?who rdfs:label "${name}"@en ; wdt:P31 wd:Q5 .`;
const starring = (name) => `${film} ?item wdt:P161 ?who . ?who rdfs:label "${name}"@en ; wdt:P31 wd:Q5 .`;
const madeBy = (q) => `${film} ?item wdt:P272 wd:${q} .`;
const airedOn = (q) => `${tvSeries} ?item wdt:P449 wd:${q} .`;
const wd = (qs) => [].concat(qs).map((q) => `wd:${q}`).join(" ");

// Wikidata lists everyone who ever held a job, so the most-linked "soccer players"
// include Albert Camus and Niels Bohr. These filters drop people who are also
// known for something else, including another sport.
const OTHER_FAME = [
  "Q82955", "Q33999", "Q10800557", "Q10798782", "Q36180", "Q6625963", "Q49757", "Q214917", "Q28389",
  "Q169470", "Q4964182", "Q177220", "Q639669", "Q488205", "Q36834", "Q1028181", "Q116", "Q189290",
  "Q245068", "Q2526255", "Q11900058", "Q1930187", "Q205375", "Q14467526", "Q3282637", "Q2252262",
  "Q3501317", "Q4610556", "Q1281618", "Q2478141",
];
const SPORT_JOBS = [
  "Q937857", "Q3665646", "Q10833314", "Q11303721", "Q13156709", "Q10841764", "Q11338576", "Q12299841",
  "Q19204627", "Q10871364", "Q11774891", "Q10843402", "Q10873124", "Q13474373", "Q11607585", "Q2309784",
  "Q13219587", "Q11513337",
];
/** People with one of `jobs` who are not also known for another listed job (unless it's in `alsoFine`). */
const knownAs = (jobs, alsoFine = [], extra = "") => {
  const keep = [].concat(jobs, alsoFine);
  return {
    wikidata: `${human} VALUES ?job { ${wd(jobs)} } ?item wdt:P106 ?job . ${extra}`,
    unlessJob: [...OTHER_FAME, ...SPORT_JOBS].filter((q) => !keep.includes(q)),
  };
};
/** People ranked by how many Wikipedia articles exist on the films they're credited on via `prop`. */
const byFilmCredits = (prop) =>
  `SELECT ?item (SUM(?fl) AS ?links) WHERE { ?f wdt:P31 wd:Q11424 ; wdt:${prop} ?item ; wikibase:sitelinks ?fl . }
   GROUP BY ?item ORDER BY DESC(?links)`;

const TV = "01-television.txt";
const SPORTS = "02-sports.txt";
const FILMS = "03-films.txt";
const FOOD = "04-food.txt";
const FRUITS = "05-fruits.txt";
const TECH = "06-tech.txt";
const SCIENCE = "07-science.txt";

export default [
  // ------------------------------------------------------------ Television
  { file: TV, prompt: "Name a TV channel or network.", wikidata: isA("Q2001305") },
  { file: TV, prompt: "Name a sitcom.", wikidata: `${tvSeries} ?item wdt:P136 wd:Q170238 .` },
  { file: TV, prompt: "Name an anime series.", wikidata: isA("Q63952888") },
  { file: TV, prompt: "Name a soap opera.", wikidata: `${tvSeries} ?item wdt:P136 wd:Q23739 .` },
  { file: TV, prompt: "Name a reality TV show.", wikidata: `${tvSeries} ?item wdt:P136 wd:Q182415 .` },
  { file: TV, prompt: "Name a Korean TV drama (K-drama).", wikidata: `${tvSeries} ?item wdt:P495 wd:Q884 .`, limit: 120 },
  { file: TV, prompt: "Name a Netflix original series.", wikidata: airedOn("Q907311") },
  { file: TV, prompt: "Name an HBO series.", wikidata: airedOn("Q23633") },
  { file: TV, prompt: "Name a Nickelodeon show.", wikidata: airedOn("Q154958") },
  { file: TV, prompt: "Name a TV talk show host.", ...knownAs("Q18668527", ["Q33999", "Q10800557", "Q10798782", "Q245068", "Q177220", "Q1930187", "Q28389", "Q3282637", "Q4610556", "Q2252262", "Q639669"]), limit: 100 },
  { file: TV, prompt: "Name a Netflix original series.", tmdb: { discover: "tv", with_networks: 213 } },
  { file: TV, prompt: "Name an HBO series.", tmdb: { discover: "tv", with_networks: 49 } },
  { file: TV, prompt: "Name a Disney Channel show.", tmdb: { discover: "tv", with_networks: 54 } },
  { file: TV, prompt: "Name a Nickelodeon show.", tmdb: { discover: "tv", with_networks: 13 } },
  { file: TV, prompt: "Name a character from Friends.", tmdb: { tvCharacters: "Friends", year: 1994 } },
  { file: TV, prompt: "Name a character from The Simpsons.", tmdb: { tvCharacters: "The Simpsons", year: 1989, minEpisodes: 3 } },
  { file: TV, prompt: "Name a character from The Office (US).", tmdb: { tvCharacters: "The Office", year: 2005 } },
  { file: TV, prompt: "Name a Game of Thrones character.", tmdb: { tvCharacters: "Game of Thrones", year: 2011 } },
  { file: TV, prompt: "Name a Breaking Bad character.", tmdb: { tvCharacters: "Breaking Bad", year: 2008 } },
  { file: TV, prompt: "Name a character from Stranger Things.", tmdb: { tvCharacters: "Stranger Things", year: 2016 } },
  { file: TV, prompt: "Name a Seinfeld character.", tmdb: { tvCharacters: "Seinfeld", year: 1989 } },
  { file: TV, prompt: "Name a SpongeBob SquarePants character.", tmdb: { tvCharacters: "SpongeBob SquarePants", year: 1999, minEpisodes: 3 } },
  { file: TV, prompt: "Name a character from The Sopranos.", tmdb: { tvCharacters: "The Sopranos", year: 1999 } },
  { file: TV, prompt: "Name a Grey's Anatomy character.", tmdb: { tvCharacters: "Grey's Anatomy", year: 2005, minEpisodes: 5 } },
  { file: TV, prompt: "Name a How I Met Your Mother character.", tmdb: { tvCharacters: "How I Met Your Mother", year: 2005 } },
  { file: TV, prompt: "Name a Big Bang Theory character.", tmdb: { tvCharacters: "The Big Bang Theory", year: 2007 } },
  { file: TV, prompt: "Name a Modern Family character.", tmdb: { tvCharacters: "Modern Family", year: 2009 } },
  { file: TV, prompt: "Name a Parks and Recreation character.", tmdb: { tvCharacters: "Parks and Recreation", year: 2009 } },
  { file: TV, prompt: "Name a Brooklyn Nine-Nine character.", tmdb: { tvCharacters: "Brooklyn Nine-Nine", year: 2013 } },
  { file: TV, prompt: "Name a Family Guy character.", tmdb: { tvCharacters: "Family Guy", year: 1999, minEpisodes: 3 } },
  { file: TV, prompt: "Name a South Park character.", tmdb: { tvCharacters: "South Park", year: 1997, minEpisodes: 3 } },
  { file: TV, prompt: "Name a Futurama character.", tmdb: { tvCharacters: "Futurama", year: 1999, minEpisodes: 3 } },
  { file: TV, prompt: "Name a character from The Walking Dead.", tmdb: { tvCharacters: "The Walking Dead", year: 2010, minEpisodes: 3 } },
  { file: TV, prompt: "Name a Lost character.", tmdb: { tvCharacters: "Lost", year: 2004 } },
  { file: TV, prompt: "Name a Mad Men character.", tmdb: { tvCharacters: "Mad Men", year: 2007 } },
  { file: TV, prompt: "Name a Gilmore Girls character.", tmdb: { tvCharacters: "Gilmore Girls", year: 2000 } },
  { file: TV, prompt: "Name a Sex and the City character.", tmdb: { tvCharacters: "Sex and the City", year: 1998 } },
  { file: TV, prompt: "Name an Avatar: The Last Airbender character.", tmdb: { tvCharacters: "Avatar: The Last Airbender", year: 2005 } },

  // ------------------------------------------------------------ Sports
  { file: SPORTS, prompt: "Name a famous soccer player.", ...knownAs("Q937857"), limit: 150 },
  { file: SPORTS, prompt: "Name a famous basketball player.", ...knownAs("Q3665646"), limit: 120 },
  { file: SPORTS, prompt: "Name a famous tennis player.", ...knownAs("Q10833314"), limit: 120 },
  { file: SPORTS, prompt: "Name a famous golfer.", ...knownAs(["Q11303721", "Q13156709"]), limit: 100 },
  { file: SPORTS, prompt: "Name a Formula 1 driver.", ...knownAs("Q10841764"), limit: 120 },
  { file: SPORTS, prompt: "Name a famous boxer.", ...knownAs("Q11338576"), limit: 120, exclude: "^felix baumgartner$" },
  { file: SPORTS, prompt: "Name a famous cricket player.", ...knownAs("Q12299841"), limit: 100, exclude: "^douglas bader$" },
  { file: SPORTS, prompt: "Name a famous American football player.", ...knownAs("Q19204627"), limit: 100, exclude: "^(ronnie coleman|dwain chambers)$" },
  { file: SPORTS, prompt: "Name a famous baseball player.", ...knownAs("Q10871364"), limit: 100 },
  { file: SPORTS, prompt: "Name a famous ice hockey player.", ...knownAs("Q11774891"), limit: 100, exclude: "^aribert heim$" },
  { file: SPORTS, prompt: "Name a famous swimmer.", ...knownAs("Q10843402"), limit: 100, exclude: "^george s\\. patton$" },
  { file: SPORTS, prompt: "Name a famous chess player.", ...knownAs("Q10873124"), limit: 100 },
  { file: SPORTS, prompt: "Name a famous pro wrestler.", ...knownAs("Q13474373"), limit: 100 },
  { file: SPORTS, prompt: "Name a famous UFC or MMA fighter.", ...knownAs("Q11607585"), limit: 100 },
  { file: SPORTS, prompt: "Name a famous cyclist.", ...knownAs("Q2309784"), limit: 100 },
  { file: SPORTS, prompt: "Name a famous figure skater.", ...knownAs("Q13219587"), limit: 80 },
  { file: SPORTS, prompt: "Name a famous goalkeeper.", ...knownAs("Q937857", [], "?item wdt:P413 wd:Q201330 ."), limit: 100 },
  { file: SPORTS, prompt: "Name a famous sports stadium or arena.", wikidata: kindOf("Q483110"), limit: 150 },
  { file: SPORTS, prompt: "Name a martial art.", wikidata: kindOf("Q11417"), limit: 100 },

  // ------------------------------------------------------------ Films
  { file: FILMS, prompt: "Name a Best Picture Oscar winner.", wikidata: `${film} ?item p:P166/ps:P166 wd:Q102427 .`, limit: 120 },
  { file: FILMS, prompt: "Name a horror film.", tmdb: { discover: "movie", with_genres: 27 } },
  { file: FILMS, prompt: "Name a romantic comedy.", tmdb: { discover: "movie", with_keywords: 9799 } },
  { file: FILMS, prompt: "Name a musical film.", tmdb: { discover: "movie", with_keywords: 4344 } },
  { file: FILMS, prompt: "Name a war film.", tmdb: { discover: "movie", with_genres: 10752 } },
  { file: FILMS, prompt: "Name a western film.", tmdb: { discover: "movie", with_genres: 37 } },
  { file: FILMS, prompt: "Name a heist film.", tmdb: { discover: "movie", with_keywords: 10051 } },
  { file: FILMS, prompt: "Name a disaster film.", tmdb: { discover: "movie", with_keywords: "10617|5096" }, exclude: "^(your name|the hurt locker)$" },
  { file: FILMS, prompt: "Name a zombie film.", tmdb: { discover: "movie", with_keywords: 12377 } },
  { file: FILMS, prompt: "Name a vampire film.", tmdb: { discover: "movie", with_keywords: 3133 } },
  { file: FILMS, prompt: "Name a Bollywood film.", tmdb: { discover: "movie", with_original_language: "hi" }, limit: 120 },
  { file: FILMS, prompt: "Name a famous film director.", ranked: byFilmCredits("P57"), limit: 150 },
  { file: FILMS, prompt: "Name a famous film composer.", ranked: byFilmCredits("P86"), limit: 100 },
  ...[
    ["Name a Christopher Nolan film.", "Christopher Nolan"], ["Name a Steven Spielberg film.", "Steven Spielberg"],
    ["Name a Quentin Tarantino film.", "Quentin Tarantino"], ["Name a Martin Scorsese film.", "Martin Scorsese"],
    ["Name a Stanley Kubrick film.", "Stanley Kubrick"], ["Name an Alfred Hitchcock film.", "Alfred Hitchcock"],
    ["Name a James Cameron film.", "James Cameron"], ["Name a Tim Burton film.", "Tim Burton"],
    ["Name a Ridley Scott film.", "Ridley Scott"], ["Name a Wes Anderson film.", "Wes Anderson"],
    ["Name a Denis Villeneuve film.", "Denis Villeneuve"], ["Name a Coen brothers film.", "Joel Coen"],
  ].flatMap(([prompt, name]) => [
    { file: FILMS, prompt, wikidata: byDirector(name) },
    { file: FILMS, prompt, tmdb: { person: name, credits: "Director" } },
  ]),
  ...[
    ["Name a Tom Hanks film.", "Tom Hanks"], ["Name a Leonardo DiCaprio film.", "Leonardo DiCaprio"],
    ["Name a Tom Cruise film.", "Tom Cruise"], ["Name a Meryl Streep film.", "Meryl Streep"],
    ["Name a Jim Carrey film.", "Jim Carrey"], ["Name a Will Smith film.", "Will Smith"],
    ["Name an Arnold Schwarzenegger film.", "Arnold Schwarzenegger"], ["Name a Keanu Reeves film.", "Keanu Reeves"],
    ["Name a Brad Pitt film.", "Brad Pitt"], ["Name a Denzel Washington film.", "Denzel Washington"],
    ["Name a Robin Williams film.", "Robin Williams"], ["Name a Johnny Depp film.", "Johnny Depp"],
    ["Name a Scarlett Johansson film.", "Scarlett Johansson"], ["Name a Julia Roberts film.", "Julia Roberts"],
    ["Name a Morgan Freeman film.", "Morgan Freeman"],
  ].flatMap(([prompt, name]) => [
    { file: FILMS, prompt, wikidata: starring(name), limit: 80 },
    { file: FILMS, prompt, tmdb: { person: name, credits: "cast" }, limit: 80 },
  ]),
  { file: FILMS, prompt: "Name a Pixar film.", tmdb: { discover: "movie", with_companies: 3 } },
  { file: FILMS, prompt: "Name a Studio Ghibli film.", tmdb: { discover: "movie", with_companies: 10342 } },
  { file: FILMS, prompt: "Name a DreamWorks Animation film.", tmdb: { discover: "movie", with_companies: 521 } },
  { file: FILMS, prompt: "Name a Marvel Cinematic Universe film.", tmdb: { discover: "movie", with_companies: 420 } },
  { file: FILMS, prompt: "Name a Disney animated film.", tmdb: { discover: "movie", with_companies: 6125 } },

  // ------------------------------------------------------------ Food
  { file: FOOD, prompt: "Name a type of cheese.", wikidata: kindOf("Q10943"), exclude: "^(processed|fresh|soft|hard|white|blue|semi-hard|semi-soft|aged|brined|smoked|whey|sheep milk|goat|cow) cheese$" },
  { file: FOOD, prompt: "Name a pasta shape.", wikidata: kindOf("Q178") },
  { file: FOOD, prompt: "Name a cocktail.", wikidata: kindOf("Q134768") },
  { file: FOOD, prompt: "Name a type of bread.", wikidata: kindOf("Q7802"), exclude: "^(sacramental bread|bread crumbs)$" },
  { file: FOOD, prompt: "Name a type of sausage.", wikidata: kindOf("Q131419") },
  { file: FOOD, prompt: "Name a soup.", wikidata: kindOf("Q41415") },
  { file: FOOD, prompt: "Name a type of cake.", wikidata: kindOf("Q13276") },
  { file: FOOD, prompt: "Name a dessert.", wikidata: kindOf("Q182940"), exclude: "^congee$" },
  { file: FOOD, prompt: "Name a spice.", wikidata: kindOf("Q42527") },
  { file: FOOD, prompt: "Name a herb.", wikidata: kindOf("Q207123"), exclude: "^(medicinal plant|wild herb|herb)$" },
  { file: FOOD, prompt: "Name a type of pastry.", wikidata: kindOf("Q477248"), exclude: "^(custard|halva)$" },
  { file: FOOD, prompt: "Name a type of dumpling.", wikidata: kindOf("Q1854639") },
  { file: FOOD, prompt: "Name a fast food chain.", wikidata: isA("Q18509232") },
  { file: FOOD, prompt: "Name a famous chef.", ...knownAs("Q3499072"), limit: 100, exclude: "^(seth rollins|robert berdella)$" },

  // ------------------------------------------------------------ Fruits
  { file: FRUITS, prompt: "Name a fruit.", wikidata: kindOf("Q3314483"), limit: 200, exclude: " tree$|^(dried|tropical|subtropical|citrus|stone|climacteric|pickled|windfall|canned|exotic|soft|forest|accessory|multiple|aggregate|dry|wine grape|fruit) (fruits?|variety)$|^fruit of |^prunus |^(berry|berries|nuts?|citrus|tuna|chestnut|vanilla bean|cubeb|cooking apple|fried plantain|gaufre aux fruits)$| from |hybrid|eight rare" },
  { file: FRUITS, prompt: "Name a citrus fruit.", wikidata: kindOf("Q2574750"), exclude: "^citrus " },
  { file: FRUITS, prompt: "Name an apple variety.", wikidata: isA("Q15731356"), limit: 150 },
  { file: FRUITS, prompt: "Name a mango variety.", wikidata: isA("Q27068180") },
  { file: FRUITS, prompt: "Name a grape variety (eating or wine).", wikidata: isA("Q958314"), limit: 150 },

  // ------------------------------------------------------------ Tech
  { file: TECH, prompt: "Name a programming language.", wikidata: isA("Q9143"), limit: 200 },
  { file: TECH, prompt: "Name a video game console.", wikidata: `?item wdt:P31 ?kind . VALUES ?kind { ${wd(["Q8076", "Q17589470", "Q941818", "Q115187350", "Q67387549"])} }` },
  { file: TECH, prompt: "Name a computer operating system.", wikidata: `?item wdt:P31/wdt:P279* wd:Q9135 .` },
  { file: TECH, prompt: "Name a web browser.", wikidata: isA("Q6368"), exclude: "^huggle$" },
  { file: TECH, prompt: "Name a cryptocurrency.", wikidata: isA("Q13479982") },
  { file: TECH, prompt: "Name a Linux distribution.", wikidata: isA("Q131669") },
  { file: TECH, prompt: "Name a video game franchise.", wikidata: isA("Q7058673") },
  { file: TECH, prompt: "Name a search engine.", wikidata: isA("Q4182287"), exclude: "^(wikimedia commons|virtual international authority file|google news|technorati)$" },
  { file: TECH, prompt: "Name a social media platform.", wikidata: isA("Q3220391") },
  { file: TECH, prompt: "Name a famous video game character.", wikidata: `${isA("Q1569167")} ?item wdt:P4584 ?first . ?first wdt:P31 wd:Q7889 .` },
  { file: TECH, prompt: "Name a game engine.", wikidata: isA("Q193564") },
  { file: TECH, prompt: "Name a famous computer scientist.", ...knownAs("Q82594", ["Q205375", "Q169470", "Q43845"]), limit: 120, exclude: "^edward snowden$" },

  // ------------------------------------------------------------ Science
  { file: SCIENCE, prompt: "Name a dog breed.", wikidata: isA("Q39367"), limit: 250 },
  { file: SCIENCE, prompt: "Name a mineral.", wikidata: isA("Q12089225") },
  { file: SCIENCE, prompt: "Name a gemstone.", wikidata: kindOf("Q83437"), exclude: "^(cabochon|cint)" },
  { file: SCIENCE, prompt: "Name a disease or illness.", wikidata: isA("Q12136"), limit: 200, exclude: "^(hysteria|inferiority complex|metastasis)$" },
  { file: SCIENCE, prompt: "Name a famous volcano.", wikidata: isA("Q8072") },
  { file: SCIENCE, prompt: "Name a galaxy.", wikidata: `?item wdt:P31/wdt:P279* wd:Q318 .`, limit: 300, exclude: "\\d{2}"  },
  { file: SCIENCE, prompt: "Name a type of rock.", wikidata: kindOf("Q8063"), exclude: "^(meteorite|ore|regolith|chondrule|gangue|lithic flake|pozzolan|igneous rock|sedimentary rock|metamorphic rock)$" },
  { file: SCIENCE, prompt: "Name a famous scientist.", ...knownAs(["Q169470", "Q593644", "Q864503", "Q901", "Q11063", "Q2374149"], ["Q205375", "Q4964182", "Q170790"]), limit: 150 },
  { file: SCIENCE, prompt: "Name a famous mathematician.", ...knownAs("Q170790", ["Q169470", "Q4964182", "Q11063", "Q205375"]), limit: 120, exclude: "^(thomas edison|leo xiv|gregor mendel)$" },
  { file: SCIENCE, prompt: "Name an astronaut or cosmonaut.", ...knownAs("Q11631", ["Q189290", "Q82955", "Q205375"]), limit: 120 },
  { file: SCIENCE, prompt: "Name a famous inventor.", ...knownAs("Q205375", ["Q169470", "Q43845"]), limit: 120 },
];
