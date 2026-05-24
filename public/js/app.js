// ── DOM refs ──
const audio = document.getElementById('audio');
const songTitleBig = document.getElementById('songTitleBig');
const songArtistBig = document.getElementById('songArtistBig');
const currentTimeEl = document.getElementById('currentTime');
const durationTimeEl = document.getElementById('durationTime');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const volumeSlider = document.getElementById('volumeSlider');
const playlistList = document.getElementById('playlistList');
const playlistCount = document.getElementById('playlistCount');
const lyricsContent = document.getElementById('lyricsContent');
const lyricsSongName = document.getElementById('lyricsSongName');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatStatus = document.getElementById('chatStatus');
const equalizer = document.getElementById('equalizer');
const songDisplay = document.querySelector('.song-display');

// ── State ──
let playlist = [];
let currentIndex = -1;
let isPlaying = false;
let lyricsLines = [];

// ── Audio events ──
audio.addEventListener('timeupdate', onTimeUpdate);
audio.addEventListener('loadedmetadata', () => {
  durationTimeEl.textContent = formatTime(audio.duration);
  distributeLyrics();
});
audio.addEventListener('ended', playNext);
audio.addEventListener('play', () => {
  isPlaying = true;
  playIcon.style.display = 'none';
  pauseIcon.style.display = '';
  equalizer.classList.add('active');
  songDisplay.classList.add('playing');
});
audio.addEventListener('pause', () => {
  isPlaying = false;
  playIcon.style.display = '';
  pauseIcon.style.display = 'none';
  equalizer.classList.remove('active');
  songDisplay.classList.remove('playing');
});

audio.volume = volumeSlider.value / 100;
volumeSlider.addEventListener('input', () => { audio.volume = volumeSlider.value / 100; });

// ── Controls ──
playBtn.addEventListener('click', () => {
  if (!audio.src) return;
  isPlaying ? audio.pause() : audio.play().catch(() => {});
});
prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);

// ── Progress ──
function onTimeUpdate() {
  const d = audio.duration || 0;
  const c = audio.currentTime || 0;
  if (!d) return;
  const pct = (c / d) * 100;
  progressFill.style.width = pct + '%';
  currentTimeEl.textContent = formatTime(c);
  updateLRCHighlight(c);
}

function seek(e) {
  if (!audio.duration) return;
  const rect = progressBar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
}

progressBar.addEventListener('click', seek);
let dragging = false;
progressBar.addEventListener('mousedown', e => { dragging = true; seek(e); });
document.addEventListener('mousemove', e => { if (dragging) seek(e); });
document.addEventListener('mouseup', () => { dragging = false; });
progressBar.addEventListener('touchstart', e => { dragging = true; seek(e.touches[0]); });
document.addEventListener('touchmove', e => { if (dragging) seek(e.touches[0]); });
document.addEventListener('touchend', () => { dragging = false; });

// ── Playlist ──
function playTrack(index) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  const track = playlist[index];

  audio.src = track.audio;
  songTitleBig.textContent = track.name;
  songArtistBig.textContent = track.artist_name || 'Unknown Artist';
  fitSongTitle();

  renderPlaylist();
  fetchLyrics(track.id, track.name, track.artist_name);
  audio.play().catch(() => {});
}

function playNext() {
  if (!playlist.length) return;
  playTrack((currentIndex + 1) % playlist.length);
}

function playPrev() {
  if (!playlist.length) return;
  playTrack(currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1);
}

const sourceLabels = { netease: 'Netease', kuwo: 'Kuwo', itunes: 'iTunes' };

function renderPlaylist() {
  playlistList.innerHTML = playlist.map((t, i) => `
    <div class="track-item ${i === currentIndex ? 'active' : ''}" onclick="playTrack(${i})">
      <span class="track-index">${String(i + 1).padStart(2, '0')}</span>
      <div class="track-info">
        <div class="track-name">${esc(t.name)} <span class="source-tag source-${t.source || 'itunes'}">${sourceLabels[t.source] || ''}</span></div>
        <div class="track-artist">${esc(t.artist_name)}</div>
      </div>
      <span class="track-duration">${formatTime(t.duration)}</span>
    </div>`).join('');
  playlistCount.textContent = playlist.length ? `${playlist.length} tracks` : '';
}

// ── Lyrics (LRC time-synced) ──
let lrcEntries = []; // [{time: seconds, text: string}, ...]

function parseLRC(raw) {
  const lines = raw.split('\n');
  const entries = [];
  for (const line of lines) {
    // Match LRC timestamp format: [mm:ss.xx] or [mm:ss.xxx]
    const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
    if (match) {
      const mins = parseInt(match[1]);
      const secs = parseInt(match[2]);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) / 1000 : 0;
      // Strip any remaining timestamp tags from text
      const text = match[4].replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
      if (text && !/^(作词|作曲|编曲|制作人|演唱|词|曲|编|制作|混音|录音|和声|吉他|钢琴|鼓|贝斯|键盘)/.test(text)) {
        entries.push({ time: mins * 60 + secs + ms, text });
      }
    }
  }
  return entries;
}

async function fetchLyrics(id, title, artist) {
  lrcEntries = [];
  lyricsContent.innerHTML = '<div class="lyrics-placeholder">[ Loading lyrics... ]</div>';
  lyricsSongName.textContent = `${title} — ${artist}`;

  try {
    const track = playlist[currentIndex];
    const params = new URLSearchParams();
    params.set('id', id);
    if (track) {
      params.set('srcId', track.srcId || '');
      params.set('source', track.source || '');
      params.set('artist', artist);
      params.set('title', title);
    }
    const res = await fetch(`/api/lyrics?${params.toString()}`);
    const data = await res.json();
    const raw = (data.lyrics || '').trim();

    if (!raw) {
      lyricsContent.innerHTML = '<div class="lyrics-placeholder">[ No lyrics available ]</div>';
      return;
    }

    lrcEntries = parseLRC(raw);

    if (!lrcEntries.length) {
      // Fallback: plain text lines without timestamps
      const lines = raw.split('\n').filter(l => {
        const t = l.replace(/\[.*?\]/g, '').trim();
        return t.length > 0;
      });
      if (lines.length) {
        // Treat as untimed, distribute evenly
        lyricsContent.innerHTML = lines.map((l, i) =>
          `<div class="lyrics-line" data-time="${i}">${esc(l.replace(/\[.*?\]/g, '').trim())}</div>`
        ).join('\n');
        lyricsLines = lines;
        updateLyricsHighlightFallback(0);
      }
      return;
    }

    renderLRC();
    updateLRCHighlight(audio.currentTime || 0);
  } catch {
    lyricsContent.innerHTML = '<div class="lyrics-placeholder">[ Lyrics load failed ]</div>';
  }
}

function renderLRC() {
  lyricsContent.innerHTML = lrcEntries.map((entry, i) =>
    `<div class="lyrics-line" data-time="${entry.time}">${esc(entry.text)}</div>`
  ).join('\n');
}

function updateLRCHighlight(currentTime) {
  if (!lrcEntries.length) return;
  let activeIdx = -1;
  for (let i = lrcEntries.length - 1; i >= 0; i--) {
    if (currentTime >= lrcEntries[i].time) {
      activeIdx = i;
      break;
    }
  }
  const lines = lyricsContent.querySelectorAll('.lyrics-line');
  lines.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  const active = lyricsContent.querySelector('.lyrics-line.active');
  if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Fallback for non-LRC lyrics
function updateLyricsHighlightFallback(currentTime) {
  if (!lyricsLines.length || !audio.duration) return;
  const progress = currentTime / audio.duration;
  const idx = Math.min(Math.floor(progress * lyricsLines.length), lyricsLines.length - 1);
  lyricsContent.querySelectorAll('.lyrics-line').forEach((el, i) => el.classList.toggle('active', i === idx));
  const active = lyricsContent.querySelector('.lyrics-line.active');
  if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ── AI Chat ──
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const query = chatInput.value.trim();
  if (!query) return;
  chatInput.value = '';

  addChatMsg('user', query);
  chatSendBtn.disabled = true;
  chatStatus.textContent = 'Processing...';

  const loadingId = 'loading-' + Date.now();
  chatMessages.insertAdjacentHTML('beforeend', `
    <div class="chat-msg assistant" id="${loadingId}">
      <div class="msg-avatar">AI</div>
      <div class="msg-bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div>
    </div>
  `);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();

    document.getElementById(loadingId)?.remove();

    if (data.error) {
      addChatMsg('assistant', `[ERROR] ${data.error}`);
      chatStatus.textContent = '';
      chatSendBtn.disabled = false;
      return;
    }

    const tracks = data.tracks || [];
    const aiMsg = data.message || '';
    const isChinese = /[一-鿿]/.test(query);
    const addedMsg = isChinese ? '已经为您加入到播放列表' : 'Added to your playlist.';

    if (!tracks.length) {
      addChatMsg('assistant', aiMsg ? `${esc(aiMsg)}<br><br>[ No matching tracks. Try another description. ]` : '[ No matching tracks. Try another description. ]');
    } else {
      addChatMsg('assistant', `${esc(aiMsg)}<br><br>[ ${addedMsg} — ${tracks.length} tracks ]`);
      playlist = tracks;
      currentIndex = -1;
      renderPlaylist();
      playTrack(0);
    }
    chatStatus.textContent = '';
  } catch (err) {
    document.getElementById(loadingId)?.remove();
    addChatMsg('assistant', `[CONNECTION ERROR] ${err.message}`);
    chatStatus.textContent = '';
  }
  chatSendBtn.disabled = false;
}

function playRecTrack(idx) {
  const tracks = window._lastRecommendation || [];
  if (!tracks[idx]) return;
  playlist = tracks;
  currentIndex = -1;
  renderPlaylist();
  playTrack(idx);
}

function addChatMsg(role, content) {
  const avatarText = role === 'user' ? 'U' : 'AI';
  chatMessages.insertAdjacentHTML('beforeend', `
    <div class="chat-msg ${role}">
      <div class="msg-avatar">${avatarText}</div>
      <div class="msg-bubble">${content}</div>
    </div>
  `);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Desktop Pet: Cyberpunk Pixel Human ──
const petCanvas = document.getElementById('petCanvas');
const petCtx = petCanvas.getContext('2d');
const PS = 10;
let petHue = 0, petSat = 0, petLit = 100;
let petBlinkTimer = 0, petBlinking = false;
let dancePhase = 0, poseType = 0, poseTimer = 0;

// Body sprite: 10 wide x 26 tall (arms drawn separately)
const CHAR_W = 10, CHAR_H = 26;
const bodySprite = [
  '....GG....',  // 0  head top
  '...GHHG...',  // 1
  '..GHHHHG..',  // 2  hair
  '.GWKWWKWG.',  // 3  eyes (K at col 4,7)
  '.GWWWWWWG.',  // 4
  '.GWWWWWWG.',  // 5  face
  '..GWWWWG..',  // 6
  '...GGGG...',  // 7  chin
  '...GGGG...',  // 8  neck
  '..GCCCCG..',  // 9  shoulders
  '.GCCCCCCG.',  // 10
  '.GCCCCCCG.',  // 11
  '.GCCCCCCG.',  // 12 torso
  '.GCCCCCCG.',  // 13
  '.GCCCCCCG.',  // 14
  '..GCCCCG..',  // 15
  '...GGGG...',  // 16 waist
  '...GG.GG..',  // 17 hips
  '...GC.GC..',  // 18
  '...GC.GC..',  // 19
  '...GC.GC..',  // 20 legs
  '...GC.GC..',  // 21
  '...GC.GC..',  // 22
  '...GC.GC..',  // 23
  '...GC.GC..',  // 24
  '...GG.GG..',  // 25 feet
];

// Arm: 2 wide x 8 tall
const ARM_H = 8;
const armCols = ['GW','GW','GW','GW','GW','GW','GW','GW'];

// Hand: 4 wide x 3 tall
const handSprite = ['.GW.', 'GWWG', '.GG.'];

function bodyColor(ch) {
  switch (ch) {
    case 'W': return `hsl(${petHue}, ${petSat}%, ${petLit}%)`;
    case 'C': return `hsl(${(petHue + 30) % 360}, ${Math.min(petSat + 10, 100)}%, ${Math.max(petLit - 20, 10)}%)`;
    case 'G': return `hsl(${petHue}, 20%, ${petLit * 0.25}%)`;
    case 'H': return `hsl(${petHue}, 30%, ${petLit * 0.18}%)`;
    case 'K': return '#0a0a12';
    default: return '';
  }
}

function drawArm(ox, oy, handOffX, handOffY) {
  for (let row = 0; row < ARM_H; row++) {
    for (let col = 0; col < 2; col++) {
      petCtx.fillStyle = bodyColor(armCols[row][col]);
      petCtx.fillRect(ox + col * PS, oy + row * PS, PS, PS);
    }
  }
  // Hand
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const ch = handSprite[row][col];
      if (ch === '.') continue;
      petCtx.fillStyle = bodyColor(ch);
      petCtx.fillRect(ox + handOffX + col * PS, oy + ARM_H * PS + handOffY + row * PS, PS, PS);
    }
  }
}

function drawPet() {
  const W = petCanvas.width, H = petCanvas.height;
  petCtx.clearRect(0, 0, W, H);

  const now = Date.now() / 1000;
  const playing = audio && !audio.paused;

  // Color — RGB cycle while playing, fade to white when paused
  if (playing) {
    petHue = (petHue + 0.8) % 360;
    petSat += (75 - petSat) * 0.04;
    petLit += (52 - petLit) * 0.04;
  } else {
    petSat += (0 - petSat) * 0.015;
    petLit += (100 - petLit) * 0.015;
  }

  // Gentle dance — always animate when playing, slow decay when paused
  if (playing) {
    dancePhase += 0.08;
  } else {
    dancePhase *= 0.95;
  }

  // Alternate poses
  poseTimer--;
  if (poseTimer <= 0 && playing) {
    poseType = 1 - poseType;
    poseTimer = 80 + Math.random() * 60;
  }
  if (!playing && Math.abs(dancePhase) < 0.01) poseType = 0;

  // Gentle movement — small amplitudes
  const swayX  = playing ? (poseType === 0 ? Math.sin(dancePhase) * 2 : Math.sin(dancePhase * 2) * 1.5) : 0;
  const bounceY = playing ? (poseType === 0 ? Math.abs(Math.sin(dancePhase * 1.5)) * 1.5 : Math.abs(Math.sin(dancePhase * 2.5)) * 3) : 0;
  const twistX  = playing && poseType === 1 ? Math.sin(dancePhase * 1.2) * 1.5 : 0;

  const legSwayL = playing ? (poseType === 0 ? Math.sin(dancePhase) * 1.5 : Math.cos(dancePhase * 1.8) * 2) : 0;
  const legSwayR = playing ? (poseType === 0 ? Math.sin(dancePhase + Math.PI) * 1.5 : Math.cos(dancePhase * 1.8 + Math.PI) * 2) : 0;

  // Gentle hand sway
  const handWaveX = playing ? Math.sin(dancePhase * 1.5) * 3 : 0;
  const handWaveY = playing ? (Math.abs(Math.sin(dancePhase * 2)) * 2 - 1) : 0;

  // Blink
  petBlinkTimer--;
  if (petBlinkTimer <= 0) {
    petBlinking = true;
    petBlinkTimer = 3;
    if (Math.random() > 0.12) { petBlinking = false; petBlinkTimer = 40 + Math.random() * 120; }
  }

  const charX = W - CHAR_W * PS - PS * 2;
  const charY = (H - CHAR_H * PS) / 2 + bounceY;

  // Draw body
  for (let row = 0; row < CHAR_H; row++) {
    for (let col = 0; col < CHAR_W; col++) {
      const ch = bodySprite[row][col];
      if (ch === '.') continue;
      let lx = charX + col * PS + swayX;
      if (row < 16) lx += twistX;
      else lx -= twistX * 0.5;
      if (row >= 17) {
        if (col <= 4) lx += legSwayL;
        else if (col >= 6) lx += legSwayR;
      }
      petCtx.fillStyle = bodyColor(ch);
      petCtx.fillRect(lx, charY + row * PS, PS, PS);
    }
  }

  // Left arm — tight to body at col 1
  drawArm(charX + 1 * PS + swayX + twistX, charY + 9 * PS, -PS + handWaveX, handWaveY);
  // Right arm — tight to body at col 7
  drawArm(charX + 7 * PS + swayX + twistX, charY + 9 * PS, handWaveX, handWaveY);

  // Blink: K at row 3, col 4 (left eye) and col 7 (right eye)
  if (petBlinking) {
    petCtx.fillStyle = `hsl(${petHue}, ${petSat}%, ${petLit}%)`;
    petCtx.fillRect(charX + 3 * PS + swayX + twistX, charY + 3 * PS, 3 * PS, PS);
    petCtx.fillRect(charX + 6 * PS + swayX + twistX, charY + 3 * PS, 3 * PS, PS);
  }

  // Soft ground glow while playing
  if (playing) {
    petCtx.fillStyle = `hsla(${petHue}, 100%, 60%, 0.15)`;
    petCtx.beginPath();
    petCtx.ellipse(charX + CHAR_W * PS / 2 + swayX, charY + CHAR_H * PS + 4, 30, 6, 0, 0, Math.PI * 2);
    petCtx.fill();
  }

  requestAnimationFrame(drawPet);
}

drawPet();

// ── Helpers ──
function fitSongTitle() {
  const text = songTitleBig.textContent || '';
  const len = text.length;
  let size;
  if (len <= 8) size = 2.2;
  else if (len <= 15) size = 1.8;
  else if (len <= 25) size = 1.4;
  else if (len <= 40) size = 1.1;
  else size = 0.85;
  songTitleBig.style.fontSize = size + 'rem';
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
