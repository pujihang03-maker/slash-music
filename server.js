const express = require('express');
const cors = require('cors');
const path = require('path');
const { search, song_url, lyric } = require('NeteaseCloudMusicApi');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Source: Netease (网易云 - full songs) ──
async function getNeteaseUrl(id) {
  try {
    const r = await song_url({ id, level: 'exhigh' });
    const data = (r.body.data || [])[0];
    return (data && data.url) ? data.url : null;
  } catch { return null; }
}

function mapNeteaseTrack(s) {
  return {
    id: 'ne_' + s.id,
    source: 'netease',
    srcId: String(s.id),
    name: s.name || 'Unknown',
    artist_name: (s.artists || s.ar || []).map(a => a.name).join(' / ') || 'Unknown Artist',
    image: (s.album || s.al || {}).picUrl || '',
    duration: Math.round((s.duration || s.dt || 0) / 1000),
    audio: null,
    hasLyrics: true,
  };
}

async function searchNetease(query, limit) {
  try {
    const r = await search({ keywords: query, limit: limit || 20, type: 1 });
    const songs = (r.body.result.songs || []).map(mapNeteaseTrack);
    const urlPromises = songs.slice(0, 15).map(async (s) => {
      s.audio = await getNeteaseUrl(s.srcId);
    });
    await Promise.all(urlPromises);
    return songs.filter(s => s.audio);
  } catch { return []; }
}

// ── Source: Kuwo (酷我 - full songs, free) ──
async function getKuwoUrl(mid) {
  try {
    const r = await fetch(`http://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=${mid}&format=aac|mp3&br=128kmp3`, {
      headers: { 'User-Agent': 'okhttp' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    return (data.code === 200 && data.url) ? data.url : null;
  } catch { return null; }
}

function mapKuwoTrack(s) {
  return {
    id: 'kw_' + s.MUSICRID.replace('MUSIC_', ''),
    source: 'kuwo',
    srcId: s.MUSICRID.replace('MUSIC_', ''),
    name: (s.SONGNAME || s.NAME || 'Unknown').replace(/&nbsp;/g, ' '),
    artist_name: (s.ARTIST || 'Unknown Artist').replace(/&nbsp;/g, ' '),
    image: s.web_artistpic_short ? `https://img1.kuwo.cn/star/${s.web_artistpic_short}` : '',
    duration: parseInt(s.DURATION) || 0,
    audio: null,
    hasLyrics: false,
  };
}

async function searchKuwo(query, limit) {
  try {
    const r = await fetch(
      `http://search.kuwo.cn/r.s?all=${encodeURIComponent(query)}&ft=music&pn=0&rn=${limit || 20}&format=json&rformat=json&encoding=utf8`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    const raw = await r.text();
    // Kuwo returns JSON with single quotes; normalize
    const fixed = raw.replace(/'(?=[^"]*?(?::|,|\}|\]))/g, '"').replace(/'/g, '"');
    const data = JSON.parse(fixed);
    const songs = (data.abslist || []).map(mapKuwoTrack);

    // Get play URLs (limit to first 10 to avoid rate limiting)
    const urlPromises = songs.slice(0, 10).map(async (s) => {
      s.audio = await getKuwoUrl(s.srcId);
    });
    await Promise.all(urlPromises);
    return songs.filter(s => s.audio);
  } catch (err) {
    console.error('Kuwo search error:', err.message);
    return [];
  }
}

// ── Source: iTunes (全球曲库 - 30s previews) ──
function mapITunesTrack(t) {
  return {
    id: 'it_' + t.trackId,
    source: 'itunes',
    srcId: String(t.trackId),
    name: t.trackName || 'Unknown',
    artist_name: t.artistName || 'Unknown Artist',
    image: t.artworkUrl100 || t.artworkUrl60 || '',
    duration: Math.round((t.trackTimeMillis || 0) / 1000),
    audio: t.previewUrl || '',
    hasLyrics: false,
  };
}

async function searchITunes(query, limit) {
  try {
    const r = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=${limit || 15}&country=CN`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await r.json();
    return (data.results || []).map(mapITunesTrack);
  } catch { return []; }
}

// ── Aggregator ──
function normKey(name, artist) {
  return `${(name || '').toLowerCase().replace(/\s+/g, '')}|${(artist || '').toLowerCase().replace(/\s+/g, '')}`;
}

async function searchAll(query) {
  const [netease, kuwo, itunes] = await Promise.all([
    searchNetease(query, 20),
    searchKuwo(query, 20),
    searchITunes(query, 15),
  ]);

  // Merge: prefer Netease > Kuwo > iTunes
  const merged = [];
  const keys = new Set();

  for (const src of [netease, kuwo, itunes]) {
    for (const t of src) {
      const k = normKey(t.name, t.artist_name);
      if (!keys.has(k)) { keys.add(k); merged.push(t); }
    }
  }

  return merged;
}

// ── Routes ──
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json({ tracks: [] });
  try {
    const tracks = await searchAll(query);
    res.json({ tracks: tracks.slice(0, 40) });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/recommend', async (req, res) => {
  const { query, exclude } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Query required' });
  if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });

  // Detect user language from query
  const isChinese = /[一-鿿]/.test(query);
  const lang = isChinese ? 'Chinese (zh-CN)' : 'English';
  const systemPrompt = isChinese
    ? '你是 Slash Music，赛博朋克音乐AI。用中文简短回应（1-2句，酷炫语气），然后推荐40首不同的歌曲。必须严格返回JSON：{"message":"你的中文回应","songs":[{"title":"歌名","artist":"歌手","reason":"简短推荐理由15字内"}]}。确保songs数组内没有重复歌曲。只返回JSON。'
    : 'You are Slash Music, a cyberpunk music AI. Give a cool short response (1-2 sentences, edgy tone) reacting to their vibe. Then recommend 40 DIFFERENT songs. Return STRICTLY this JSON: {"message":"your response","songs":[{"title":"Song Title","artist":"Artist","reason":"short reason <15 words"}]}. Ensure NO duplicate songs in the array. No other text.';

  const excludeHint = exclude && exclude.length
    ? (isChinese ? ` 不要推荐这些已推荐的歌曲：${exclude.join('、')}。` : ` Do NOT recommend these already-recommended songs: ${exclude.join(', ')}.`)
    : '';

  try {
    const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 4096,
        messages: [{
          role: 'system',
          content: systemPrompt,
        }, {
          role: 'user',
          content: `Recommend 40 different songs: ${query}${excludeHint}`,
        }],
      }),
    });
    const dsData = await dsRes.json();
    if (!dsRes.ok) return res.status(502).json({ error: 'AI service error' });

    const text = dsData.choices[0].message.content;
    let aiMessage = '';
    let recommendations = [];
    try {
      const parsed = JSON.parse(text);
      aiMessage = parsed.message || '';
      recommendations = parsed.songs || [];
    } catch {
      const m = text.match(/\[[\s\S]*\]/);
      if (m) try { recommendations = JSON.parse(m[0]); } catch {}
    }

    if (!recommendations.length) return res.json({ tracks: [], recommendation_query: query, message: aiMessage });

    // Deduplicate AI recommendations by title+artist
    const seenRecs = new Set();
    const uniqueRecs = [];
    for (const rec of recommendations) {
      const recKey = normKey(rec.title, rec.artist);
      if (!seenRecs.has(recKey)) {
        seenRecs.add(recKey);
        uniqueRecs.push(rec);
      }
    }
    recommendations = uniqueRecs;

    // Search each recommendation, with strong dedup across all results
    const tracks = [];
    const keys = new Set();
    const maxPerRec = 3;
    for (const rec of recommendations.slice(0, 20)) {
      const results = await searchAll(`${rec.title} ${rec.artist}`);
      let added = 0;
      for (const t of results) {
        const k = normKey(t.name, t.artist_name);
        if (!keys.has(k)) {
          keys.add(k);
          tracks.push({ ...t, reason: rec.reason || '' });
          added++;
          if (added >= maxPerRec || tracks.length >= 50) break;
        }
      }
      if (tracks.length >= 50) break;
    }

    // Fill up to 50 with a regular search if AI recs don't yield enough
    if (tracks.length < 50) {
      const extra = await searchAll(query);
      for (const t of extra) {
        const k = normKey(t.name, t.artist_name);
        if (!keys.has(k)) {
          keys.add(k);
          tracks.push(t);
          if (tracks.length >= 50) break;
        }
      }
    }

    // Sort: full songs (netease/kuwo) first, then iTunes previews
    tracks.sort((a, b) => {
      const score = t => (t.source === 'itunes' ? 1 : 0);
      return score(a) - score(b);
    });
    res.json({ tracks: tracks.slice(0, 50), recommendation_query: query, message: aiMessage });
  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({ error: 'Recommendation failed' });
  }
});

app.get('/api/lyrics', async (req, res) => {
  const { id, srcId, source, artist, title } = req.query;
  if (!id && !srcId) return res.json({ lyrics: '' });

  try {
    if (source === 'itunes' || source === 'kuwo' || (id && (id.startsWith('it_') || id.startsWith('kw_')))) {
      // Use lyrics.ovh for non-Netease tracks
      if (!artist && !title) return res.json({ lyrics: '' });
      const r = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const data = await r.json();
      return res.json({ lyrics: data.lyrics || '' });
    }

    const nid = Number(srcId || (id || '').replace('ne_', ''));
    const r = await lyric({ id: nid });
    const lrc = (r.body.lrc || {}).lyric || '';
    res.json({ lyrics: lrc });
  } catch {
    res.json({ lyrics: '' });
  }
});

app.listen(PORT, () => {
  console.log(`Slash Music running at http://localhost:${PORT}`);
  console.log(`DeepSeek AI: ${DEEPSEEK_API_KEY ? 'enabled' : 'disabled'}`);
  console.log('Sources: Netease + Kuwo (full songs) + iTunes (previews)');
});
