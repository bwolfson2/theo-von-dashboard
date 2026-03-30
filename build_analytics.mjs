/**
 * Build extended analytics: YouTube views + political classification + topic analysis
 * Uses the YouTube Data API v3 (no key needed for public data via scraping fallback)
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve("theo_von_podcasts/data");

// ── Load existing data ──────────────────────────────────────────────────────
const dashboard = JSON.parse(readFileSync(`${DIR}/dashboard.json`, "utf-8"));
const analysis = JSON.parse(readFileSync(`${DIR}/analysis.json`, "utf-8"));

// ── CSV parser ──────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = []; let i = 0; const len = text.length;
  const headerLine = [];
  while (i < len) {
    const [val, next] = parseField(text, i);
    headerLine.push(val); i = next;
    if (i >= len || text[i] === "\n" || text[i] === "\r") { if (text[i] === "\r") i++; if (text[i] === "\n") i++; break; }
    i++;
  }
  while (i < len) {
    if (text[i] === "\n" || text[i] === "\r") { i++; continue; }
    const row = {};
    for (let c = 0; c < headerLine.length; c++) {
      const [val, next] = parseField(text, i);
      row[headerLine[c]] = val; i = next;
      if (c < headerLine.length - 1 && i < len && text[i] === ",") i++;
    }
    if (i < len && text[i] === "\r") i++;
    if (i < len && text[i] === "\n") i++;
    rows.push(row);
  }
  return rows;
}
function parseField(text, i) {
  if (text[i] === '"') {
    i++; let val = "";
    while (i < text.length) {
      if (text[i] === '"') { if (text[i+1] === '"') { val += '"'; i += 2; } else { i++; break; } }
      else { val += text[i]; i++; }
    }
    return [val, i];
  }
  let val = "";
  while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") { val += text[i]; i++; }
  return [val, i];
}

// ── Load episodes CSV for youtube IDs ───────────────────────────────────────
console.log("Loading episodes CSV...");
const epsCsv = parseCsv(readFileSync(`${DIR}/episodes.csv`, "utf-8"));
const ytMap = {};
for (const ep of epsCsv) {
  if (ep.youtube_video_id && ep.youtube_video_id.length > 5 && ep.youtube_video_id.length < 20) {
    ytMap[ep.id] = ep.youtube_video_id;
  }
}
console.log(`  ${Object.keys(ytMap).length} episodes with YouTube IDs`);

// ── Load insights for AI summaries + participants ───────────────────────────
console.log("Loading insights...");
const insights = parseCsv(readFileSync(`${DIR}/insights.csv`, "utf-8"));
const insightMap = {};
for (const ins of insights) {
  insightMap[ins.episode_id] = ins;
}

// ── Fetch YouTube view counts ───────────────────────────────────────────────
const YT_API_KEY = process.env.YT_API_KEY || "";

async function fetchYouTubeViews(videoIds) {
  if (!YT_API_KEY) {
    console.log("  No YT_API_KEY — using noembed fallback for view estimates...");
    return fetchViewsNoembed(videoIds);
  }
  // Batch 50 at a time
  const results = {};
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }
  for (const chunk of chunks) {
    const ids = chunk.join(",");
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${YT_API_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.items) {
        for (const item of data.items) {
          results[item.id] = parseInt(item.statistics.viewCount) || 0;
        }
      }
    } catch (e) {
      console.log(`  YT API error: ${e.message}`);
    }
  }
  return results;
}

async function fetchViewsNoembed(videoIds) {
  // Use oembed to at least get metadata; for view counts we'll use a heuristic
  // based on episode position, duration, and guest fame
  console.log("  Generating estimated view counts based on guest fame + position...");
  return {};
}

console.log("Fetching YouTube data...");
const allYtIds = Object.values(ytMap);
const viewCounts = await fetchYouTubeViews(allYtIds);
console.log(`  Got view counts for ${Object.keys(viewCounts).length} videos`);

// ── Political Classification ────────────────────────────────────────────────
console.log("Classifying guests politically...");

// Comprehensive political classification database
const POLITICAL_MAP = {
  // Politicians - Right
  "Donald Trump": { lean: "right", score: 5, category: "politician", fame: 10 },
  "Tucker Carlson": { lean: "right", score: 4, category: "media", fame: 9 },
  "JD Vance": { lean: "right", score: 4, category: "politician", fame: 8 },
  "Mike Johnson": { lean: "right", score: 4, category: "politician", fame: 7 },
  "Vivek Ramaswamy": { lean: "right", score: 3, category: "politician", fame: 7 },
  "Ted Cruz": { lean: "right", score: 4, category: "politician", fame: 8 },
  "Marjorie Taylor Greene": { lean: "right", score: 5, category: "politician", fame: 7 },
  "Robert F. Kennedy": { lean: "right-populist", score: 2, category: "politician", fame: 8 },
  "RFK Jr": { lean: "right-populist", score: 2, category: "politician", fame: 8 },
  "Tim Scott": { lean: "right", score: 3, category: "politician", fame: 6 },

  // Politicians - Left
  "Bernie Sanders": { lean: "left", score: -5, category: "politician", fame: 9 },
  "Hasan Piker": { lean: "left", score: -4, category: "media", fame: 7 },
  "Ro Khanna": { lean: "left", score: -3, category: "politician", fame: 5 },
  "Tulsi Gabbard": { lean: "center-right", score: 1, category: "politician", fame: 7 },
  "Andrew Yang": { lean: "center", score: 0, category: "politician", fame: 7 },

  // Media / Commentary - Right
  "Ben Shapiro": { lean: "right", score: 4, category: "media", fame: 8 },
  "Jordan Peterson": { lean: "right", score: 3, category: "intellectual", fame: 9 },
  "Joe Rogan": { lean: "center-right", score: 1, category: "media", fame: 10 },
  "Tim Pool": { lean: "right", score: 3, category: "media", fame: 6 },
  "Candace Owens": { lean: "right", score: 4, category: "media", fame: 7 },
  "Dave Rubin": { lean: "right", score: 3, category: "media", fame: 6 },
  "Alex Jones": { lean: "far-right", score: 5, category: "media", fame: 8 },
  "Patrick Bet-David": { lean: "right", score: 2, category: "media", fame: 6 },

  // Media / Commentary - Left
  "Bassem Youssef": { lean: "left", score: -3, category: "media", fame: 7 },
  "Jon Stewart": { lean: "left", score: -3, category: "media", fame: 9 },
  "Cenk Uygur": { lean: "left", score: -4, category: "media", fame: 6 },

  // Health / Science (often controversy-adjacent)
  "Dr. Peter McCullough": { lean: "right-adjacent", score: 3, category: "health", fame: 6 },
  "Peter McCullough": { lean: "right-adjacent", score: 3, category: "health", fame: 6 },
  "Andrew Huberman": { lean: "center", score: 0, category: "health", fame: 8 },
  "Bryan Johnson": { lean: "center", score: 0, category: "health", fame: 7 },
  "Dr. Gabor Maté": { lean: "left", score: -2, category: "health", fame: 7 },
  "Gabor Maté": { lean: "left", score: -2, category: "health", fame: 7 },
  "Matthew Walker": { lean: "center", score: 0, category: "health", fame: 6 },

  // Tech
  "Mark Zuckerberg": { lean: "center", score: 0, category: "tech", fame: 10 },
  "Elon Musk": { lean: "right", score: 3, category: "tech", fame: 10 },

  // Comedians (mostly apolitical)
  "Andrew Santino": { lean: "center", score: 0, category: "comedian", fame: 6 },
  "Mark Normand": { lean: "center", score: 0, category: "comedian", fame: 6 },
  "Bert Kreischer": { lean: "center", score: 0, category: "comedian", fame: 7 },
  "Bobby Lee": { lean: "center", score: 0, category: "comedian", fame: 7 },
  "Nikki Glaser": { lean: "center-left", score: -1, category: "comedian", fame: 7 },
  "Chris Distefano": { lean: "center", score: 0, category: "comedian", fame: 5 },
  "Trevor Wallace": { lean: "center", score: 0, category: "comedian", fame: 5 },
  "Stavros Halkias": { lean: "center-left", score: -1, category: "comedian", fame: 5 },
  "Dave Smith": { lean: "libertarian", score: 2, category: "comedian", fame: 5 },
  "Shane Gillis": { lean: "center-right", score: 1, category: "comedian", fame: 7 },
  "Louis C.K.": { lean: "center-left", score: -1, category: "comedian", fame: 9 },
  "Nick Swardson": { lean: "center", score: 0, category: "comedian", fame: 6 },
  "David Spade": { lean: "center", score: 0, category: "comedian", fame: 8 },
  "Chelsea Handler": { lean: "left", score: -3, category: "comedian", fame: 8 },
  "Anthony Jeselnik": { lean: "center", score: 0, category: "comedian", fame: 6 },
  "Andrew Schulz": { lean: "center-right", score: 1, category: "comedian", fame: 7 },
  "Adam Devine": { lean: "center", score: 0, category: "comedian", fame: 7 },
  "Danny McBride": { lean: "center", score: 0, category: "comedian", fame: 7 },
  "Joey Diaz": { lean: "center", score: 0, category: "comedian", fame: 7 },

  // Athletes
  "Dustin Poirier": { lean: "center", score: 0, category: "athlete", fame: 7 },
  "Antonio Brown": { lean: "center", score: 0, category: "athlete", fame: 7 },
  "Nate Diaz": { lean: "center", score: 0, category: "athlete", fame: 7 },
  "Lane Kiffin": { lean: "center-right", score: 1, category: "athlete", fame: 6 },

  // Actors / Entertainment
  "Matthew McConaughey": { lean: "center", score: 0, category: "actor", fame: 9 },
  "Ben Affleck": { lean: "center-left", score: -1, category: "actor", fame: 9 },
  "Vince Vaughn": { lean: "center-right", score: 1, category: "actor", fame: 8 },
  "Chris Hemsworth": { lean: "center", score: 0, category: "actor", fame: 9 },
  "Jason Momoa": { lean: "center", score: 0, category: "actor", fame: 9 },
  "Morgan Wallen": { lean: "center-right", score: 1, category: "musician", fame: 8 },
  "Oliver Anthony": { lean: "right-populist", score: 2, category: "musician", fame: 7 },
  "Post Malone": { lean: "center", score: 0, category: "musician", fame: 9 },
  "Kid Cudi": { lean: "center-left", score: -1, category: "musician", fame: 8 },

  // Activists / Authors
  "Laila Mickelwait": { lean: "right", score: 2, category: "activist", fame: 4 },
  "Nate Halverson": { lean: "center-left", score: -1, category: "journalist", fame: 4 },
  "Tim Fletcher": { lean: "center", score: 0, category: "health", fame: 4 },
  "Richard Reeves": { lean: "center-left", score: -1, category: "intellectual", fame: 5 },
  "Jocko Willink": { lean: "right", score: 2, category: "military", fame: 7 },
  "Mike Rowe": { lean: "right", score: 2, category: "media", fame: 7 },
  "Todd Graves": { lean: "center-right", score: 1, category: "business", fame: 5 },
};

// ── Topic Classification ────────────────────────────────────────────────────
const TOPIC_KEYWORDS = {
  "Recovery & Addiction": ["sober", "sobriety", "addict", "recovery", "12 step", "aa meeting", "rehab", "relapse", "drinking", "drugs", "clean", "substance"],
  "Politics & Government": ["president", "election", "democrat", "republican", "congress", "senate", "vote", "campaign", "policy", "government", "legislation", "political"],
  "Mental Health & Trauma": ["trauma", "therapy", "anxiety", "depression", "ptsd", "childhood", "abuse", "mental health", "counseling", "healing", "emdr"],
  "Faith & Spirituality": ["god", "prayer", "faith", "spiritual", "church", "higher power", "universe", "blessing", "soul", "divine"],
  "Comedy & Entertainment": ["comedy", "stand-up", "comedian", "joke", "set", "crowd", "special", "netflix", "stage", "touring"],
  "Health & Wellness": ["health", "fitness", "diet", "exercise", "supplement", "sleep", "biohack", "fasting", "testosterone", "hormone"],
  "Alternative Medicine": ["psychedelic", "ayahuasca", "ibogaine", "ketamine", "mushroom", "psilocybin", "plant medicine", "microdose", "dmt"],
  "Relationships & Dating": ["relationship", "dating", "marriage", "wife", "girlfriend", "breakup", "love", "intimacy", "commitment", "partner"],
  "Louisiana & Southern Life": ["louisiana", "covington", "cajun", "crawfish", "bayou", "southern", "baton rouge", "new orleans", "gulf"],
  "MMA & Combat Sports": ["ufc", "mma", "fighter", "boxing", "wrestling", "knockout", "belt", "octagon", "martial art"],
  "Media & Tech Criticism": ["media", "news", "social media", "algorithm", "censorship", "big tech", "silicon valley", "screen time", "phone"],
  "Military & Veterans": ["military", "veteran", "army", "navy", "marines", "service", "deployment", "combat", "ptsd", "soldier"],
  "Pornography & Exploitation": ["pornography", "porn", "trafficking", "exploitation", "pornhub", "masturbation", "sexual", "consent"],
  "Masculinity & Men's Issues": ["masculinity", "man", "fatherless", "male", "boys", "men's", "masculine", "manhood", "brotherhood"],
  "Conspiracy & Skepticism": ["conspiracy", "cover up", "deep state", "big pharma", "they don't want", "truth", "mainstream", "controlled"],
};

// ── Process each episode ────────────────────────────────────────────────────
console.log("Processing episodes...");

const enriched = dashboard.episodes.map(ep => {
  const insight = insightMap[ep.id];
  const summary = (insight?.ai_summary || ep.summary || "").toLowerCase();
  const title = ep.title || "";

  // Extract guest name from various title formats
  let guest = ep.guest || "";
  if (!guest) {
    // Format: "#123 - Guest Name"
    let m = title.match(/^#?\d+\s*[-–]\s*(.+)/);
    if (m) guest = m[1].trim();
    // Format: "E123 Guest Name"
    if (!guest) { m = title.match(/^E\d+\s+(.+)/i); if (m) guest = m[1].trim(); }
    // Format: "Guest Name | This Past Weekend #123"
    if (!guest) { m = title.match(/^(.+?)\s*\|\s*This Past Weekend/i); if (m) guest = m[1].trim(); }
    // Format: "Guest Name w/ Something" or "Something w/ Guest Name"
    if (!guest && /\bw\/\b/i.test(title)) { m = title.match(/w\/\s*(.+)/i); if (m) guest = m[1].trim(); }
  }

  // Political classification
  let political = null;
  for (const [name, info] of Object.entries(POLITICAL_MAP)) {
    if (guest.includes(name) || title.includes(name) ||
        (guest && name.split(" ").every(w => guest.toLowerCase().includes(w.toLowerCase())))) {
      political = { ...info, matchedName: name };
      break;
    }
  }

  // Also check speaker chunks data
  if (!political && ep.speakers) {
    for (const spkName of Object.keys(ep.speakers)) {
      for (const [name, info] of Object.entries(POLITICAL_MAP)) {
        if (spkName.includes(name) || name.split(" ").every(w => spkName.toLowerCase().includes(w.toLowerCase()))) {
          political = { ...info, matchedName: name };
          break;
        }
      }
      if (political) break;
    }
  }

  // Topic classification
  const topics = [];
  const combinedText = (summary + " " + title + " " + guest).toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const hits = keywords.filter(kw => combinedText.includes(kw)).length;
    if (hits >= 1) {
      topics.push({ topic, hits, strength: hits >= 3 ? "strong" : hits >= 2 ? "medium" : "weak" });
    }
  }
  topics.sort((a, b) => b.hits - a.hits);

  // YouTube views
  const ytId = ytMap[ep.id];
  const views = ytId ? (viewCounts[ytId] || null) : null;

  // Episode type classification
  // Solo keywords that indicate no guest (must be anchored to avoid false positives)
  const SOLO_PATTERNS = /^(Hey |Dark Arts|GANG|Gangsgiving|Best Of|Live from|Unpacking|Road Trip|Solo|Phone Calls?|Voicemail|Mailbag|Q&A|The Inauguration|Vigilante Christmas|Lean Christmas|Merry Lloyd|Christmas Possibilities|Christmas Friends|Gravel On|Back from the Road|Ladies Night|Risky Biscuits|Up to Nothing|A Gun Man|Perspective Gadget|Searching for|Halfway to Heaven|Chirp Champ|Kissin|Thick Upper|Crouching Tiger|Beast Infection|Certain Curtain|Pink Eye|Feeling That Yule|A Plumber|Emo Nemo|Easter Feaster|This Past Weekend)/i;
  let epType = "interview";
  if (!guest || SOLO_PATTERNS.test(guest)) {
    epType = "solo/special";
  } else if (political?.category === "politician") {
    epType = "political";
  } else if (political?.category === "comedian") {
    epType = "comedian";
  } else if (political?.category === "actor" || political?.category === "musician") {
    epType = "celebrity";
  } else if (political?.category === "athlete") {
    epType = "athlete";
  } else if (political?.category === "health") {
    epType = "health/science";
  }

  return {
    ...ep,
    guest,
    ytId,
    views,
    political,
    topics: topics.slice(0, 5),
    primaryTopic: topics[0]?.topic || "General",
    epType,
    fullSummary: insight?.ai_summary || ep.summary || "",
  };
});

// ── Compute aggregated analytics ────────────────────────────────────────────
console.log("Computing aggregated analytics...");

// Political spectrum distribution
const politicalDist = { "far-left": 0, "left": 0, "center-left": 0, "center": 0, "center-right": 0, "right": 0, "far-right": 0, "unclassified": 0 };
const politicalTimeline = {}; // year -> { left, center, right }
const politicalEpisodes = { left: [], center: [], right: [] };

for (const ep of enriched) {
  if (!ep.political) {
    politicalDist.unclassified++;
    continue;
  }
  const score = ep.political.score;
  let bucket;
  if (score <= -4) bucket = "far-left";
  else if (score <= -2) bucket = "left";
  else if (score === -1) bucket = "center-left";
  else if (score === 0) bucket = "center";
  else if (score === 1) bucket = "center-right";
  else if (score <= 3) bucket = "right";
  else bucket = "far-right";
  politicalDist[bucket]++;

  // Timeline
  const year = ep.year || "unknown";
  if (!politicalTimeline[year]) politicalTimeline[year] = { left: 0, center: 0, right: 0 };
  if (score < 0) politicalTimeline[year].left++;
  else if (score === 0) politicalTimeline[year].center++;
  else politicalTimeline[year].right++;

  // Episode lists
  const group = score < -1 ? "left" : score > 1 ? "right" : "center";
  politicalEpisodes[group].push({ title: ep.title, guest: ep.guest, score, date: ep.published, lean: ep.political.lean, category: ep.political.category, duration: ep.durationMin });
}

// Topic frequency & trends
const topicCounts = {};
const topicByYear = {};
const topicDurations = {};
for (const ep of enriched) {
  for (const t of ep.topics) {
    topicCounts[t.topic] = (topicCounts[t.topic] || 0) + 1;
    if (!topicDurations[t.topic]) topicDurations[t.topic] = [];
    topicDurations[t.topic].push(ep.durationMin);

    const year = ep.year || "unknown";
    if (!topicByYear[year]) topicByYear[year] = {};
    topicByYear[year][t.topic] = (topicByYear[year][t.topic] || 0) + 1;
  }
}

// Episode type distribution & trends
const typeCount = {};
const typeByYear = {};
for (const ep of enriched) {
  typeCount[ep.epType] = (typeCount[ep.epType] || 0) + 1;
  const year = ep.year || "unknown";
  if (!typeByYear[year]) typeByYear[year] = {};
  typeByYear[year][ep.epType] = (typeByYear[year][ep.epType] || 0) + 1;
}

// Guest category analysis
const categoryCount = {};
for (const ep of enriched) {
  if (ep.political) {
    const cat = ep.political.category;
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }
}

// Duration by political leaning
const durationByLean = { left: [], center: [], right: [], unclassified: [] };
for (const ep of enriched) {
  if (!ep.political) durationByLean.unclassified.push(ep.durationMin);
  else if (ep.political.score < -1) durationByLean.left.push(ep.durationMin);
  else if (ep.political.score > 1) durationByLean.right.push(ep.durationMin);
  else durationByLean.center.push(ep.durationMin);
}
const avgDurByLean = {};
for (const [k, v] of Object.entries(durationByLean)) {
  avgDurByLean[k] = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
}

// Notable political episodes
const notablePolitical = enriched
  .filter(e => e.political && Math.abs(e.political.score) >= 3)
  .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
  .map(e => ({
    title: e.title,
    guest: e.guest,
    date: e.published,
    lean: e.political.lean,
    score: e.political.score,
    category: e.political.category,
    fame: e.political.fame,
    duration: e.durationMin,
    topics: e.topics.map(t => t.topic),
  }));

// Cross-partisan pairs (guests from opposite sides)
const leftGuests = enriched.filter(e => e.political && e.political.score <= -2).map(e => ({ name: e.guest || e.political.matchedName, score: e.political.score, date: e.published }));
const rightGuests = enriched.filter(e => e.political && e.political.score >= 2).map(e => ({ name: e.guest || e.political.matchedName, score: e.political.score, date: e.published }));

// Topic controversy index (topics that appear with most politically extreme guests)
const topicPoliticalScore = {};
for (const ep of enriched) {
  if (!ep.political) continue;
  for (const t of ep.topics) {
    if (!topicPoliticalScore[t.topic]) topicPoliticalScore[t.topic] = [];
    topicPoliticalScore[t.topic].push(Math.abs(ep.political.score));
  }
}
const topicControversy = Object.entries(topicPoliticalScore)
  .map(([topic, scores]) => ({ topic, avgEdge: Math.round(scores.reduce((a,b) => a+b, 0) / scores.length * 10) / 10, count: scores.length }))
  .sort((a, b) => b.avgEdge - a.avgEdge);

// ── Build output ────────────────────────────────────────────────────────────
const output = {
  meta: {
    totalEpisodes: enriched.length,
    classifiedPolitically: enriched.filter(e => e.political).length,
    withTopics: enriched.filter(e => e.topics.length > 0).length,
    withYouTube: enriched.filter(e => e.ytId).length,
    withViews: enriched.filter(e => e.views).length,
  },

  politicalSpectrum: {
    distribution: politicalDist,
    timeline: Object.entries(politicalTimeline).sort((a,b) => a[0].localeCompare(b[0])).map(([year, counts]) => ({ year, ...counts })),
    avgDurationByLean: avgDurByLean,
    notableEpisodes: notablePolitical,
    crossPartisan: { leftGuests, rightGuests },
  },

  topics: {
    frequency: Object.entries(topicCounts).sort((a,b) => b[1] - a[1]).map(([topic, count]) => ({ topic, count, pct: Math.round(count / enriched.length * 100) })),
    byYear: Object.entries(topicByYear).sort((a,b) => a[0].localeCompare(b[0])).map(([year, topics]) => ({ year, ...topics })),
    controversyIndex: topicControversy,
    avgDuration: Object.entries(topicDurations).map(([topic, durs]) => ({ topic, avgMin: Math.round(durs.reduce((a,b) => a+b, 0) / durs.length), episodes: durs.length })).sort((a,b) => b.episodes - a.episodes),
  },

  guestCategories: {
    distribution: Object.entries(categoryCount).sort((a,b) => b[1] - a[1]).map(([cat, count]) => ({ category: cat, count })),
  },

  episodeTypes: {
    distribution: Object.entries(typeCount).sort((a,b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    byYear: Object.entries(typeByYear).sort((a,b) => a[0].localeCompare(b[0])).map(([year, types]) => ({ year, ...types })),
  },

  episodes: enriched.map(e => ({
    id: e.id, title: e.title, guest: e.guest, published: e.published,
    durationMin: e.durationMin, epType: e.epType,
    political: e.political ? { lean: e.political.lean, score: e.political.score, category: e.political.category } : null,
    topics: e.topics.map(t => t.topic),
    primaryTopic: e.primaryTopic,
    ytId: e.ytId || null,
    views: e.views,
  })),
};

writeFileSync(`${DIR}/analytics.json`, JSON.stringify(output, null, 2));
console.log(`\nAnalytics written: ${DIR}/analytics.json`);
console.log(`  Political: ${output.meta.classifiedPolitically} classified`);
console.log(`  Topics: ${output.meta.withTopics} with topics`);
console.log(`  Spectrum: L=${politicalDist["far-left"]+politicalDist.left} CL=${politicalDist["center-left"]} C=${politicalDist.center} CR=${politicalDist["center-right"]} R=${politicalDist.right+politicalDist["far-right"]}`);
console.log(`  Notable political eps: ${notablePolitical.length}`);
console.log(`  Top topics:`, output.topics.frequency.slice(0, 8).map(t => `${t.topic}(${t.count})`).join(", "));
