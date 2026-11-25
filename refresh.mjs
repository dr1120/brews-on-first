// Weekly job: pull Sleeper scores, write Seraphina's script, record her voice with OpenAI TTS.
// Outputs: data/league.json, data/narration.json, audio/slide-N.mp3
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const LEAGUE_ID = (process.env.SLEEPER_LEAGUE_ID || '1399584665517436928').trim(); // new ID each season
const OUT = (process.env.OUT_DIR || '.').replace(/\/$/, '');
const KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const VOICE = process.env.OPENAI_TTS_VOICE || 'coral';
const STYLE = process.env.OPENAI_TTS_INSTRUCTIONS ||
  'Voice: low, smooth, sultry and unhurried, like an enchantress sharing delicious gossip with a room full of friends. ' +
  'Tone: playful, teasing, a little smug. Pacing: slow, with dramatic pauses at commas and full stops. ' +
  'Pronounce the fantasy team names clearly.';

const core = await readFile(new URL('./ledger-core.js', import.meta.url), 'utf8');
const L = new Function(core + '\nreturn {buildLeague,compute,simulate,multiSummary,buildSlides,mulberry,demoRows};')();

const exists = async (f) => { try { await access(f); return true; } catch { return false; } };
const warn = (m) => console.log(`::warning::${m}`);

/* ---------- 1. scores ---------- */
async function sleeperRows() {
  const base = 'https://api.sleeper.app/v1';
  const j = async (u) => { const r = await fetch(base + u); if (!r.ok) throw new Error(`Sleeper ${r.status} for ${u}`); return r.json(); };
  const [league, users, rosters, state] = await Promise.all([
    j(`/league/${LEAGUE_ID}`), j(`/league/${LEAGUE_ID}/users`), j(`/league/${LEAGUE_ID}/rosters`), j('/state/nfl'),
  ]);
  const uName = {};
  users.forEach(u => { uName[u.user_id] = (u.metadata && u.metadata.team_name) || u.display_name; });
  const used = {}, name = {};
  rosters.forEach(r => {
    let n = uName[r.owner_id] || `Roster ${r.roster_id}`;
    if (used[n]) { used[n]++; n += ` (${used[n]})`; } else used[n] = 1;
    name[r.roster_id] = n;
  });
  const playoffStart = (league.settings && league.settings.playoff_week_start) || 15;
  let cap = playoffStart - 1;
  if (String(league.season) === String(state.season) && state.season_type === 'regular') cap = Math.min(cap, Math.max(0, state.week - 1));
  const rows = [];
  for (let w = 1; w <= cap; w++) {
    const m = await j(`/league/${LEAGUE_ID}/matchups/${w}`);
    if (!m || !m.some(x => x.points > 0)) continue;
    const g = {};
    m.forEach(x => { (g[x.matchup_id] = g[x.matchup_id] || []).push(x); });
    Object.values(g).forEach(p => p.forEach(x => {
      const o = p.find(y => y.roster_id !== x.roster_id);
      rows.push({ week: w, team: name[x.roster_id], points: x.points, opp: o ? name[o.roster_id] : '' });
    }));
  }
  return { rows, name: league.name, season: league.season };
}

const demo = process.argv.includes('--demo');
const { rows, name, season } = demo ? { rows: L.demoRows(), name: 'Demo League', season: 'demo' } : await sleeperRows();
if (!rows.length) { console.log('No completed weeks with scores yet; nothing to do.'); process.exit(0); }

await mkdir(`${OUT}/data`, { recursive: true });
await mkdir(`${OUT}/audio`, { recursive: true });
await writeFile(`${OUT}/data/league.json`, JSON.stringify({ generated: new Date().toISOString(), name, season, rows }));
console.log(`Scores: ${rows.length} rows through week ${Math.max(...rows.map(r => r.week))}.`);

/* ---------- 2. script ---------- */
const league = L.buildLeague(rows);
const ST = L.compute(league);
const sim = L.simulate(league, 5000, L.mulberry(2024));
const SM = L.multiSummary(sim, ST);
const slides = L.buildSlides(ST, league, SM, sim);
const hash = createHash('sha256').update(JSON.stringify(slides.map(s => s.say)) + MODEL + VOICE + STYLE).digest('hex').slice(0, 10);

/* ---------- 3. voice ---------- */
let prev = null;
try { prev = JSON.parse(await readFile(`${OUT}/data/narration.json`, 'utf8')); } catch {}
const files = slides.map((_, i) => `${OUT}/audio/slide-${i + 1}.mp3`);
let reuse = false;
if (prev && prev.hash === hash && prev.slides.length === slides.length && prev.slides.every(s => s.audio)) {
  reuse = (await Promise.all(files.map(exists))).every(Boolean);
}

const ok = slides.map(() => false);
if (reuse) {
  console.log('Script unchanged since last run; reusing existing audio (no TTS cost).');
  ok.fill(true);
} else if (!KEY) {
  warn('OPENAI_API_KEY is not set; publishing without recorded audio (the page will use the browser voice).');
} else {
  for (let i = 0; i < slides.length; i++) {
    try {
      const r = await fetch(`${OPENAI}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, voice: VOICE, input: slides[i].say, instructions: STYLE, response_format: 'mp3' }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) throw new Error('Audio came back suspiciously small');
      await writeFile(files[i], buf);
      ok[i] = true;
      console.log(`Recorded slide ${i + 1}/${slides.length} (${Math.round(buf.length / 1024)} KB).`);
    } catch (e) {
      warn(`Slide ${i + 1} voice failed: ${e.message}`);
    }
  }
}

await writeFile(`${OUT}/data/narration.json`, JSON.stringify({
  generated: new Date().toISOString(), hash, voice: VOICE,
  slides: slides.map((s, i) => ({ ...s, audio: ok[i] ? `audio/slide-${i + 1}.mp3?v=${hash}` : null })),
}));
console.log(`Narration written: ${ok.filter(Boolean).length}/${slides.length} slides with recorded voice.`);
