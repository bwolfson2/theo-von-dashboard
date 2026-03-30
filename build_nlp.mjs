/**
 * NLP analysis on speaker_chunks.csv
 * - Sentiment analysis per episode
 * - Word frequency / vocabulary richness
 * - Topic evolution by year (keyword clustering)
 * - Speaking pace (words per minute) for Theo vs guests
 * - Most common phrases / n-grams Theo uses
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve("theo_von_podcasts/data");

// ── Sentiment lexicon (AFINN-style subset, expanded) ─────────────────────────
const POS_WORDS = new Set([
  "love","great","good","happy","beautiful","amazing","awesome","excellent","wonderful",
  "fantastic","brilliant","funny","hilarious","blessed","grateful","exciting","perfect",
  "incredible","inspiring","powerful","strong","kind","sweet","cool","dope","sick",
  "fire","lit","best","favorite","treasure","healing","peace","hope","joy","laugh",
  "comedy","fun","enjoy","positive","honest","real","genuine","caring","loyal","brave",
  "proud","clean","sober","free","healthy","growth","progress","better","improved",
  "success","winning","champion","legend","genius","hero","angel","king","queen",
  "beautiful","cute","lovely","nice","warm","wise","smart","talented","gifted",
  "respect","trust","faith","bless","glory","miracle","grace","divine","heaven",
]);
const NEG_WORDS = new Set([
  "bad","terrible","awful","horrible","hate","angry","sad","depressed","anxiety",
  "fear","scared","worried","pain","hurt","suffering","trauma","abuse","violence",
  "death","kill","murder","war","fight","destroy","damage","broken","lost","fail",
  "worst","ugly","stupid","dumb","crazy","insane","sick","disgusting","nasty",
  "evil","dark","wrong","problem","trouble","danger","threat","attack","crime",
  "drug","addiction","alcoholic","relapse","overdose","suicide","crash","disaster",
  "corrupt","fraud","lie","cheat","steal","exploit","manipulate","betray","toxic",
  "lonely","abandoned","neglect","poverty","homeless","prison","jail","arrest",
  "racist","sexist","hate","harassment","bully","victim","struggle","stress",
]);

// ── Stopwords for n-gram analysis ────────────────────────────────────────────
const STOPWORDS = new Set([
  "i","me","my","myself","we","our","ours","ourselves","you","your","yours",
  "yourself","yourselves","he","him","his","himself","she","her","hers","herself",
  "it","its","itself","they","them","their","theirs","themselves","what","which",
  "who","whom","this","that","these","those","am","is","are","was","were","be",
  "been","being","have","has","had","having","do","does","did","doing","a","an",
  "the","and","but","if","or","because","as","until","while","of","at","by",
  "for","with","about","against","between","through","during","before","after",
  "above","below","to","from","up","down","in","out","on","off","over","under",
  "again","further","then","once","here","there","when","where","why","how","all",
  "both","each","few","more","most","other","some","such","no","nor","not","only",
  "own","same","so","than","too","very","s","t","can","will","just","don","should",
  "now","d","ll","m","o","re","ve","y","ain","aren","couldn","didn","doesn",
  "hadn","hasn","haven","isn","ma","mightn","mustn","needn","shan","shouldn",
  "wasn","weren","won","wouldn","um","uh","like","know","yeah","oh","gonna",
  "got","right","well","okay","ok","thing","things","lot","really","actually",
  "kind","mean","think","go","get","make","say","come","would","could","way",
  "back","one","two","even","still","also","much","many","them","been","into",
  "said","going","went","came","done","made","something","anything","everything",
  "nothing","somebody","anybody","everybody","nobody","someone","anyone","everyone",
  "people","guy","guys","man","dude","bro","that's","it's","i'm","don't","didn't",
  "wasn","wasn't","he's","she's","they're","we're","you're","i've","what's",
  "there's","let","let's","gotta","wanna","kinda","sorta",
]);

// ── CSV line parser ──────────────────────────────────────────────────────────
function parseChunkLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length && fields.length < 7) {
    if (line[i] === '"') {
      i++;
      let val = "";
      while (i < line.length) {
        if (line[i] === '"') { if (line[i+1] === '"') { val += '"'; i += 2; } else { i++; break; } }
        else { val += line[i]; i++; }
      }
      fields.push(val);
      if (line[i] === ",") i++;
    } else {
      let val = "";
      while (i < line.length && line[i] !== ",") { val += line[i]; i++; }
      fields.push(val);
      if (line[i] === ",") i++;
    }
  }
  return fields;
}

// ── Load data ────────────────────────────────────────────────────────────────
console.log("Loading speaker chunks...");
const chunksRaw = readFileSync(`${DIR}/speaker_chunks.csv`, "utf-8");
const chunkLines = chunksRaw.split("\n");
console.log(`  ${chunkLines.length - 1} lines`);

const dashboard = JSON.parse(readFileSync(`${DIR}/dashboard.json`, "utf-8"));
const epDateMap = {};
for (const ep of dashboard.episodes) {
  epDateMap[ep.id] = { published: ep.published, year: ep.year, month: ep.month };
}

const FILTERED_SPEAKERS = new Set(["Speaker 1", "Speaker 2", "Speaker 3", "Unknown Speaker", "Ad/Promo Voice"]);

// ── Per-episode accumulators ─────────────────────────────────────────────────
// sentiment, vocab, pace
const episodeData = {}; // epId -> { posCount, negCount, totalWords, uniqueWords, theoWords, theoTime, guestWords, guestTime, text chunks for theo }
const theoNgrams = {}; // bigram/trigram -> count
const yearTopicWords = {}; // year -> word -> count (for topic evolution)
const theoWordFreq = {}; // word -> count

console.log("Processing chunks for NLP...");
let processed = 0;

for (let i = 1; i < chunkLines.length; i++) {
  if (!chunkLines[i]) continue;
  const [epId, , speaker, text, startTime, endTime, wordCount] = parseChunkLine(chunkLines[i]);
  if (!epId || FILTERED_SPEAKERS.has(speaker)) continue;

  const wc = parseInt(wordCount) || 0;
  const dur = (parseFloat(endTime) || 0) - (parseFloat(startTime) || 0);
  const isTheo = speaker.includes("Theo");
  const words = (text || "").toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(w => w.length > 1);

  if (!episodeData[epId]) {
    episodeData[epId] = {
      posCount: 0, negCount: 0, totalWords: 0, uniqueWords: new Set(),
      theoWords: 0, theoTime: 0, guestWords: 0, guestTime: 0,
    };
  }
  const ed = episodeData[epId];

  // Sentiment
  for (const w of words) {
    if (POS_WORDS.has(w)) ed.posCount++;
    if (NEG_WORDS.has(w)) ed.negCount++;
    ed.uniqueWords.add(w);
  }
  ed.totalWords += wc;

  // Pace
  if (isTheo) {
    ed.theoWords += wc;
    ed.theoTime += dur;
  } else {
    ed.guestWords += wc;
    ed.guestTime += dur;
  }

  // Theo n-grams and word frequency
  if (isTheo && words.length >= 2) {
    const contentWords = words.filter(w => !STOPWORDS.has(w) && w.length > 2);

    for (const w of contentWords) {
      theoWordFreq[w] = (theoWordFreq[w] || 0) + 1;
    }

    // Bigrams on raw words (including some stop words for natural phrases)
    for (let j = 0; j < words.length - 1; j++) {
      if (STOPWORDS.has(words[j]) && STOPWORDS.has(words[j+1])) continue;
      const bg = words[j] + " " + words[j+1];
      theoNgrams[bg] = (theoNgrams[bg] || 0) + 1;
    }
    // Trigrams
    for (let j = 0; j < words.length - 2; j++) {
      if (STOPWORDS.has(words[j]) && STOPWORDS.has(words[j+1]) && STOPWORDS.has(words[j+2])) continue;
      const tg = words[j] + " " + words[j+1] + " " + words[j+2];
      theoNgrams[tg] = (theoNgrams[tg] || 0) + 1;
    }
  }

  // Topic evolution: content words by year
  const epInfo = epDateMap[epId];
  if (epInfo?.year && epInfo.year !== "unknown") {
    if (!yearTopicWords[epInfo.year]) yearTopicWords[epInfo.year] = {};
    const contentWords = words.filter(w => !STOPWORDS.has(w) && w.length > 3);
    for (const w of contentWords) {
      yearTopicWords[epInfo.year][w] = (yearTopicWords[epInfo.year][w] || 0) + 1;
    }
  }

  processed++;
  if (processed % 50000 === 0) console.log(`  Processed ${processed} chunks...`);
}

console.log(`  Processed ${processed} total chunks`);

// ── Compute per-episode metrics ──────────────────────────────────────────────
console.log("Computing episode-level metrics...");

const episodeMetrics = [];
for (const [epId, ed] of Object.entries(episodeData)) {
  const epInfo = epDateMap[epId];
  if (!epInfo) continue;

  const sentimentScore = ed.totalWords > 0 ? ((ed.posCount - ed.negCount) / ed.totalWords * 1000) : 0;
  const vocabRichness = ed.totalWords > 0 ? (ed.uniqueWords.size / Math.sqrt(ed.totalWords)) : 0; // Guiraud's index
  const theoPace = ed.theoTime > 0 ? (ed.theoWords / (ed.theoTime / 60)) : 0;
  const guestPace = ed.guestTime > 0 ? (ed.guestWords / (ed.guestTime / 60)) : 0;

  episodeMetrics.push({
    id: epId,
    published: epInfo.published,
    year: epInfo.year,
    month: epInfo.month,
    sentiment: Math.round(sentimentScore * 100) / 100,
    posCount: ed.posCount,
    negCount: ed.negCount,
    totalWords: ed.totalWords,
    uniqueWords: ed.uniqueWords.size,
    vocabRichness: Math.round(vocabRichness * 100) / 100,
    theoPace: Math.round(theoPace),
    guestPace: Math.round(guestPace),
  });
}

episodeMetrics.sort((a, b) => (a.published || "").localeCompare(b.published || ""));

// ── Aggregate sentiment by month ─────────────────────────────────────────────
const sentimentByMonth = {};
for (const em of episodeMetrics) {
  if (!em.month || em.month === "unknown") continue;
  if (!sentimentByMonth[em.month]) sentimentByMonth[em.month] = { total: 0, count: 0 };
  sentimentByMonth[em.month].total += em.sentiment;
  sentimentByMonth[em.month].count++;
}
const sentimentTrend = Object.entries(sentimentByMonth)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([month, v]) => ({ month, avgSentiment: Math.round(v.total / v.count * 100) / 100 }));

// ── Aggregate vocab richness by month ────────────────────────────────────────
const vocabByMonth = {};
for (const em of episodeMetrics) {
  if (!em.month || em.month === "unknown") continue;
  if (!vocabByMonth[em.month]) vocabByMonth[em.month] = { total: 0, count: 0 };
  vocabByMonth[em.month].total += em.vocabRichness;
  vocabByMonth[em.month].count++;
}
const vocabTrend = Object.entries(vocabByMonth)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([month, v]) => ({ month, avgRichness: Math.round(v.total / v.count * 100) / 100 }));

// ── Theo speaking pace over time ─────────────────────────────────────────────
const paceByMonth = {};
for (const em of episodeMetrics) {
  if (!em.month || em.month === "unknown" || !em.theoPace) continue;
  if (!paceByMonth[em.month]) paceByMonth[em.month] = { total: 0, count: 0 };
  paceByMonth[em.month].total += em.theoPace;
  paceByMonth[em.month].count++;
}
const paceTrend = Object.entries(paceByMonth)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([month, v]) => ({ month, avgWPM: Math.round(v.total / v.count) }));

// Guest pace by month
const guestPaceByMonth = {};
for (const em of episodeMetrics) {
  if (!em.month || em.month === "unknown" || !em.guestPace) continue;
  if (!guestPaceByMonth[em.month]) guestPaceByMonth[em.month] = { total: 0, count: 0 };
  guestPaceByMonth[em.month].total += em.guestPace;
  guestPaceByMonth[em.month].count++;
}
const guestPaceTrend = Object.entries(guestPaceByMonth)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([month, v]) => ({ month, avgWPM: Math.round(v.total / v.count) }));

// ── Top n-grams (Theo's catchphrases) ────────────────────────────────────────
const topNgrams = Object.entries(theoNgrams)
  .filter(([ng, count]) => {
    const words = ng.split(" ");
    // Filter out ngrams that are mostly stopwords
    const contentCount = words.filter(w => !STOPWORDS.has(w)).length;
    return contentCount >= 1 && count >= 20;
  })
  .sort((a, b) => b[1] - a[1])
  .slice(0, 100)
  .map(([phrase, count]) => ({ phrase, count }));

// ── Theo's top words ─────────────────────────────────────────────────────────
const topWords = Object.entries(theoWordFreq)
  .filter(([w]) => !STOPWORDS.has(w) && w.length > 3)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50)
  .map(([word, count]) => ({ word, count }));

// ── Topic evolution: top keywords per year ───────────────────────────────────
const topicEvolution = {};
const TOPIC_CLUSTERS = {
  "recovery": ["sober", "sobriety", "addiction", "recovery", "rehab", "relapse", "drinking", "drugs", "clean", "alcohol"],
  "politics": ["president", "trump", "election", "democrat", "republican", "government", "vote", "biden", "political", "congress"],
  "mental-health": ["therapy", "trauma", "anxiety", "depression", "mental", "healing", "ptsd", "childhood", "counseling", "abuse"],
  "faith": ["god", "prayer", "faith", "spiritual", "church", "jesus", "bible", "heaven", "soul", "divine"],
  "comedy": ["comedy", "stand-up", "comedian", "jokes", "crowd", "stage", "touring", "special", "netflix", "funny"],
  "health": ["health", "fitness", "diet", "exercise", "sleep", "supplement", "testosterone", "fasting", "workout", "body"],
  "relationships": ["relationship", "dating", "marriage", "girlfriend", "wife", "love", "breakup", "partner", "husband", "family"],
  "psychedelics": ["psychedelic", "ayahuasca", "mushroom", "ketamine", "psilocybin", "microdose", "plant", "ibogaine", "trip", "ceremony"],
  "southern-life": ["louisiana", "cajun", "crawfish", "bayou", "southern", "country", "redneck", "baton", "orleans", "fishing"],
  "media": ["media", "social", "algorithm", "censorship", "news", "instagram", "youtube", "podcast", "internet", "phone"],
  "masculinity": ["masculine", "fatherless", "brotherhood", "manhood", "boys", "father", "masculine", "male", "testosterone", "provider"],
  "conspiracy": ["conspiracy", "government", "cover", "pharma", "controlled", "mainstream", "truth", "deep", "state", "elites"],
};

for (const [year, wordCounts] of Object.entries(yearTopicWords).sort((a,b) => a[0].localeCompare(b[0]))) {
  topicEvolution[year] = {};
  for (const [cluster, keywords] of Object.entries(TOPIC_CLUSTERS)) {
    const total = keywords.reduce((sum, kw) => sum + (wordCounts[kw] || 0), 0);
    topicEvolution[year][cluster] = total;
  }
}

// ── Overall pace stats ───────────────────────────────────────────────────────
const theoPaces = episodeMetrics.filter(e => e.theoPace > 0).map(e => e.theoPace);
const guestPaces = episodeMetrics.filter(e => e.guestPace > 0).map(e => e.guestPace);
const avgTheoPace = theoPaces.length ? Math.round(theoPaces.reduce((a,b) => a+b, 0) / theoPaces.length) : 0;
const avgGuestPace = guestPaces.length ? Math.round(guestPaces.reduce((a,b) => a+b, 0) / guestPaces.length) : 0;

// ── Build output ─────────────────────────────────────────────────────────────
const output = {
  meta: {
    episodesAnalyzed: episodeMetrics.length,
    totalChunks: processed,
    avgTheoPaceWPM: avgTheoPace,
    avgGuestPaceWPM: avgGuestPace,
  },
  sentimentTrend,
  vocabTrend,
  paceTrend,
  guestPaceTrend,
  topNgrams,
  topWords,
  topicEvolution,
  episodeMetrics: episodeMetrics.map(em => ({
    id: em.id,
    published: em.published,
    sentiment: em.sentiment,
    vocabRichness: em.vocabRichness,
    theoPace: em.theoPace,
    guestPace: em.guestPace,
  })),
};

writeFileSync(`${DIR}/nlp.json`, JSON.stringify(output, null, 2));
console.log(`\nNLP analysis written: ${DIR}/nlp.json`);
console.log(`  Episodes analyzed: ${output.meta.episodesAnalyzed}`);
console.log(`  Avg Theo pace: ${avgTheoPace} WPM`);
console.log(`  Avg Guest pace: ${avgGuestPace} WPM`);
console.log(`  Top phrases: ${topNgrams.slice(0, 5).map(n => `"${n.phrase}" (${n.count})`).join(", ")}`);
console.log(`  Sentiment trend range: ${sentimentTrend[0]?.avgSentiment} to ${sentimentTrend[sentimentTrend.length-1]?.avgSentiment}`);
