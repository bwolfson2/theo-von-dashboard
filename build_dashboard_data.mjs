import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve("theo_von_podcasts/data");

// ── CSV parser (handles quoted fields with commas/newlines) ─────────────────
function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  // parse header
  const headerLine = [];
  while (i < len) {
    const [val, next] = parseField(text, i);
    headerLine.push(val);
    i = next;
    if (i >= len || text[i] === "\n" || text[i] === "\r") {
      if (text[i] === "\r") i++;
      if (text[i] === "\n") i++;
      break;
    }
    i++; // skip comma
  }

  // parse rows
  while (i < len) {
    if (text[i] === "\n" || text[i] === "\r") { i++; continue; }
    const row = {};
    for (let c = 0; c < headerLine.length; c++) {
      const [val, next] = parseField(text, i);
      row[headerLine[c]] = val;
      i = next;
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
    i++;
    let val = "";
    while (i < text.length) {
      if (text[i] === '"') {
        if (text[i + 1] === '"') { val += '"'; i += 2; }
        else { i++; break; }
      } else { val += text[i]; i++; }
    }
    return [val, i];
  }
  let val = "";
  while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
    val += text[i]; i++;
  }
  return [val, i];
}

// ── Load data ───────────────────────────────────────────────────────────────
console.log("Loading episodes...");
const episodes = parseCsv(readFileSync(`${DIR}/episodes.csv`, "utf-8"));
console.log(`  ${episodes.length} episodes`);

console.log("Loading insights...");
const insights = parseCsv(readFileSync(`${DIR}/insights.csv`, "utf-8"));
console.log(`  ${insights.length} insights`);

console.log("Loading speaker chunks...");
const chunksRaw = readFileSync(`${DIR}/speaker_chunks.csv`, "utf-8");
// For chunks, we'll aggregate without full parse to save memory
const chunkLines = chunksRaw.split("\n");
const chunkHeader = chunkLines[0].split(",");
console.log(`  ${chunkLines.length - 1} chunk lines`);

// ── Build episode map ───────────────────────────────────────────────────────
const insightMap = {};
for (const ins of insights) {
  insightMap[ins.episode_id] = ins;
}

// ── Aggregate speaker chunks per episode ────────────────────────────────────
console.log("Aggregating speaker data...");
const speakerStats = {}; // episode_id -> { speakers: { name: { words, chunks, time } } }
const globalSpeakers = {};

const FILTERED_SPEAKERS = new Set(["Speaker 1", "Speaker 2", "Speaker 3", "Unknown Speaker", "Ad/Promo Voice"]);

for (let i = 1; i < chunkLines.length; i++) {
  if (!chunkLines[i]) continue;
  // Quick parse: episode_id,chunk_index,speaker,text,start_time,end_time,word_count
  const [epId, , speaker, , startTime, endTime, wordCount] = parseChunkLine(chunkLines[i]);
  if (!epId || FILTERED_SPEAKERS.has(speaker)) continue;

  if (!speakerStats[epId]) speakerStats[epId] = {};
  if (!speakerStats[epId][speaker]) speakerStats[epId][speaker] = { words: 0, chunks: 0, time: 0 };
  const wc = parseInt(wordCount) || 0;
  const dur = (parseFloat(endTime) || 0) - (parseFloat(startTime) || 0);
  speakerStats[epId][speaker].words += wc;
  speakerStats[epId][speaker].chunks += 1;
  speakerStats[epId][speaker].time += dur;

  if (!globalSpeakers[speaker]) globalSpeakers[speaker] = { words: 0, episodes: new Set() };
  globalSpeakers[speaker].words += wc;
  globalSpeakers[speaker].episodes.add(epId);
}

function parseChunkLine(line) {
  // Handle quoted text field
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

// ── Build dashboard data ────────────────────────────────────────────────────
console.log("Building dashboard data...");

// Episodes by month
const byMonth = {};
const byYear = {};
const durationByMonth = {};

const episodeList = episodes.map(ep => {
  const pub = ep.published_at ? new Date(ep.published_at) : null;
  const month = pub ? `${pub.getUTCFullYear()}-${String(pub.getUTCMonth() + 1).padStart(2, "0")}` : "unknown";
  const year = pub ? `${pub.getUTCFullYear()}` : "unknown";
  const dur = parseFloat(ep.duration) || 0;

  byMonth[month] = (byMonth[month] || 0) + 1;
  byYear[year] = (byYear[year] || 0) + 1;
  if (!durationByMonth[month]) durationByMonth[month] = [];
  durationByMonth[month].push(dur);

  const insight = insightMap[ep.id];
  let participants = [];
  try { participants = JSON.parse(insight?.participants || "[]"); } catch {}

  let guestName = "";
  let titleMatch = ep.title.match(/^#\d+\s*[-–]\s*(.+)/);
  if (titleMatch) guestName = titleMatch[1].trim();
  // Format: "E123 Guest Name"
  if (!guestName) { titleMatch = ep.title.match(/^E\d+\s+(.+)/i); if (titleMatch) guestName = titleMatch[1].trim(); }
  // Format: "Guest Name | This Past Weekend #123"
  if (!guestName) { titleMatch = ep.title.match(/^(.+?)\s*\|\s*This Past Weekend/i); if (titleMatch) guestName = titleMatch[1].trim(); }
  // Format: "Something w/ Guest"
  if (!guestName && /\bw\/\b/i.test(ep.title)) { titleMatch = ep.title.match(/w\/\s*(.+)/i); if (titleMatch) guestName = titleMatch[1].trim(); }

  const spk = speakerStats[ep.id] || {};

  return {
    id: ep.id,
    title: ep.title,
    published: pub ? pub.toISOString().slice(0, 10) : null,
    month,
    year,
    duration: dur,
    durationMin: Math.round(dur / 60),
    guest: guestName,
    summary: insight?.ai_summary?.slice(0, 300) || ep.summary?.slice(0, 300) || "",
    participants,
    speakers: Object.fromEntries(
      Object.entries(spk).map(([k, v]) => [k, { words: v.words, timeMin: Math.round(v.time / 60) }])
    ),
    hasYoutube: !!ep.youtube_video_id,
  };
});

// Guest frequency
const guestCounts = {};
for (const ep of episodeList) {
  if (ep.guest && !ep.guest.match(/^(Hey |Dark Arts|GANG|Best Of|Live from|Unpacking)/i)) {
    const g = ep.guest.replace(/!+$/, "").trim();
    if (g) {
      guestCounts[g] = (guestCounts[g] || 0) + 1;
    }
  }
}

// Top speakers by total words
const topSpeakers = Object.entries(globalSpeakers)
  .map(([name, s]) => ({ name, words: s.words, episodes: s.episodes.size }))
  .sort((a, b) => b.words - a.words)
  .slice(0, 50);

// Duration stats
const durations = episodeList.filter(e => e.duration > 0).map(e => e.duration);
const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

// Avg duration by month
const avgDurByMonth = {};
for (const [m, durs] of Object.entries(durationByMonth)) {
  avgDurByMonth[m] = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length / 60);
}

// Top guests
const topGuests = Object.entries(guestCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .map(([name, count]) => ({ name, count }));

// Publishing cadence (days between episodes)
const sortedDates = episodeList
  .filter(e => e.published)
  .map(e => new Date(e.published).getTime())
  .sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < sortedDates.length; i++) {
  gaps.push((sortedDates[i] - sortedDates[i - 1]) / 86400000);
}

const dashboard = {
  show: {
    name: "This Past Weekend w/ Theo Von",
    totalEpisodes: episodeList.length,
    firstEpisode: episodeList.find(e => e.published)?.published,
    latestEpisode: episodeList.filter(e => e.published).sort((a, b) => b.published.localeCompare(a.published))[0]?.published,
    avgDurationMin: Math.round(avgDuration / 60),
    totalHours: Math.round(durations.reduce((a, b) => a + b, 0) / 3600),
    avgDaysBetween: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length * 10) / 10,
  },
  episodesByMonth: Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])),
  episodesByYear: Object.entries(byYear).sort((a, b) => a[0].localeCompare(b[0])),
  avgDurationByMonth: Object.entries(avgDurByMonth).sort((a, b) => a[0].localeCompare(b[0])),
  topGuests,
  topSpeakers,
  episodes: episodeList.sort((a, b) => (b.published || "").localeCompare(a.published || "")),
  durationDistribution: {
    "< 30min": durations.filter(d => d < 1800).length,
    "30-60min": durations.filter(d => d >= 1800 && d < 3600).length,
    "60-90min": durations.filter(d => d >= 3600 && d < 5400).length,
    "90-120min": durations.filter(d => d >= 5400 && d < 7200).length,
    "120-150min": durations.filter(d => d >= 7200 && d < 9000).length,
    "150min+": durations.filter(d => d >= 9000).length,
  },
};

writeFileSync(`${DIR}/dashboard.json`, JSON.stringify(dashboard, null, 2));
console.log(`Dashboard data written: ${DIR}/dashboard.json`);
console.log(`  Total hours: ${dashboard.show.totalHours}`);
console.log(`  Avg duration: ${dashboard.show.avgDurationMin} min`);
console.log(`  Top guests: ${topGuests.slice(0, 5).map(g => `${g.name} (${g.count})`).join(", ")}`);
