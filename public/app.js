'use strict';

// ───────────────────────────────────────────────
// ESTADO
// ───────────────────────────────────────────────
const S = {
  queue: [], idx: -1, playing: false,
  shuffle: false, repeat: 0,   // 0=off 1=all 2=one
  volume: 0.8, muted: false,
  playlists: [], currentPl: null,
  liked: new Set(),
  voiceOn: false,
};

const $ = id => document.getElementById(id);
const audio = $('audio');

// ───────────────────────────────────────────────
// INIT
// ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  renderQuickChips();
  renderPlaylists();
  renderRecent();
  syncVolume(S.volume);
  syncShuffleRepeat();
  initVoice();

  // modal enter key
  $('pl-name-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmCreatePlaylist();
    if (e.key === 'Escape') cancelPlaylist();
  });
});

// ───────────────────────────────────────────────
// STORAGE
// ───────────────────────────────────────────────
function saveStorage() {
  try {
    localStorage.setItem('sp2_pl',      JSON.stringify(S.playlists));
    localStorage.setItem('sp2_liked',   JSON.stringify([...S.liked]));
    localStorage.setItem('sp2_vol',     S.volume);
    localStorage.setItem('sp2_sh',      S.shuffle);
    localStorage.setItem('sp2_rep',     S.repeat);
    // salva fila atual como "recentes"
    if (S.queue.length) {
      const recent = [...S.queue].slice(0, 16);
      localStorage.setItem('sp2_recent', JSON.stringify(recent));
    }
  } catch (_) {}
}
function loadStorage() {
  try {
    const pl = localStorage.getItem('sp2_pl');     if (pl) S.playlists = JSON.parse(pl);
    const lk = localStorage.getItem('sp2_liked');  if (lk) S.liked = new Set(JSON.parse(lk));
    const v  = localStorage.getItem('sp2_vol');    if (v)  S.volume = parseFloat(v);
    const sh = localStorage.getItem('sp2_sh');     if (sh) S.shuffle = sh === 'true';
    const r  = localStorage.getItem('sp2_rep');    if (r)  S.repeat = parseInt(r);
  } catch (_) {}
}

// ───────────────────────────────────────────────
// VIEWS
// ───────────────────────────────────────────────
function showHome() {
  showView('view-home');
  setNavActive('nav-home');
  $('search-input').value = '';
  $('search-clear').classList.add('hidden');
}
function showSearch() {
  showView('view-search');
  setNavActive('nav-search');
}
function showPlaylistView(id) {
  const pl = S.playlists.find(p => p.id === id);
  if (!pl) return;
  S.currentPl = id;
  $('pl-name').textContent = pl.name;
  $('pl-meta').textContent = `${pl.tracks.length} música${pl.tracks.length !== 1 ? 's' : ''}`;
  renderPlaylistTracks(pl.tracks, id);
  showView('view-playlist');
}
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
}
function setNavActive(id) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $(id)?.classList.add('active');
}

// Sidebar mobile
function toggleSidebar() {
  $('sidebar').classList.toggle('open');
  $('sidebar-overlay').classList.toggle('hidden');
}

// Expanded player
function openExpanded() {
  if (!S.queue.length) return;
  $('np-expanded').classList.remove('hidden');
  syncExpandedUI();
}
function closeExpanded() {
  $('np-expanded').classList.add('hidden');
}
function syncExpandedUI() {
  const t = S.queue[S.idx];
  if (!t) return;
  $('np-title-big').textContent   = t.title || '—';
  $('np-artist-big').textContent  = t.channel || '';
  $('np-art-big').src             = t.thumbnail || '';
  $('np-bg').style.backgroundImage = `url(${t.thumbnail || ''})`;
  $('icon-play-big').classList.toggle('hidden', S.playing);
  $('icon-pause-big').classList.toggle('hidden', !S.playing);
  syncVolume(S.volume); // sync big volume bar too
}

// ───────────────────────────────────────────────
// QUICK SEARCHES
// ───────────────────────────────────────────────
const CHIPS = [
  '🎸 Rock','🤠 Sertanejo','🎵 Funk','💃 Pagode',
  '🌙 Lo-fi','🎹 Clássico','🎧 Eletrônico','🎤 Pop',
  '🏋️ Academia','😴 Relaxar','🎉 Forró','🇧🇷 MPB',
];
function renderQuickChips() {
  $('quick-searches').innerHTML = CHIPS.map(c => {
    const term = c.replace(/^[^ ]+ /,'');
    return `<div class="chip" onclick="quickSearch('${esc(term)}')">${c}</div>`;
  }).join('');
}
function quickSearch(term) {
  $('search-input').value = term;
  showSearch();
  doSearch(term);
}
function clearSearch() {
  $('search-input').value = '';
  $('search-clear').classList.add('hidden');
  showHome();
}

// ───────────────────────────────────────────────
// RECENT
// ───────────────────────────────────────────────
function renderRecent() {
  const recent = JSON.parse(localStorage.getItem('sp2_recent') || '[]');
  if (!recent.length) return;
  $('recent-row').style.display = 'flex';
  $('recent-grid').innerHTML = recent.slice(0, 8).map(t => buildCard(t)).join('');
}

// ───────────────────────────────────────────────
// SEARCH
// ───────────────────────────────────────────────
let _searchTimer = null;
function onSearchInput() {
  const q = $('search-input').value.trim();
  $('search-clear').classList.toggle('hidden', !q);
  clearTimeout(_searchTimer);
  if (!q) { showHome(); return; }
  showSearch();
  $('search-title').textContent = `Resultados para "${q}"`;
  $('search-grid').innerHTML = '';
  $('search-empty').classList.add('hidden');
  $('search-loading').classList.remove('hidden');
  _searchTimer = setTimeout(() => doSearch(q), 480);
}
function onSearchKeydown(e) {
  if (e.key === 'Enter') { clearTimeout(_searchTimer); doSearch($('search-input').value.trim()); }
  if (e.key === 'Escape') clearSearch();
}

let _lastSearchResults = [];
async function doSearch(q) {
  if (!q) return;
  $('search-loading').classList.remove('hidden');
  $('search-empty').classList.add('hidden');
  $('search-grid').innerHTML = '';

  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    $('search-loading').classList.add('hidden');

    if (!data.items?.length) { $('search-empty').classList.remove('hidden'); return; }
    _lastSearchResults = data.items;
    $('search-grid').innerHTML = data.items.map(t => buildCard(t)).join('');
  } catch (err) {
    $('search-loading').classList.add('hidden');
    $('search-empty').classList.remove('hidden');
    console.error('[SEARCH]', err);
  }
}

// ───────────────────────────────────────────────
// CARDS
// ───────────────────────────────────────────────
function buildCard(t) {
  const tid = JSON.stringify(t).replace(/'/g, "\\'");
  return `
  <div class="music-card" id="card-${t.id}" data-id="${t.id}" onclick="playFromCard('${encodeURIComponent(JSON.stringify(t))}')">
    <div class="card-img-wrap">
      <img src="${t.thumbnail}" alt="${esc(t.title)}" loading="lazy"
           onerror="this.src='https://i.ytimg.com/vi/${t.id}/hqdefault.jpg'"/>
      <div class="card-overlay">
        <div class="card-play-circle">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <button class="card-add-btn" title="Adicionar à playlist"
                onclick="event.stopPropagation();openAddPl('${encodeURIComponent(JSON.stringify(t))}')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        </button>
      </div>
    </div>
    <div class="card-body">
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-artist">${esc(t.channel || '')}</div>
      ${t.duration ? `<div class="card-dur">${t.duration}</div>` : ''}
    </div>
  </div>`;
}

// Pega a fila correta baseado em qual grid foi clicado
function playFromCard(encodedTrack) {
  const t = JSON.parse(decodeURIComponent(encodedTrack));
  // decide a fila: resultados de busca ou recentes
  const queue = _lastSearchResults.length ? _lastSearchResults : [t];
  playTrack(t, queue);
}

// ───────────────────────────────────────────────
// TRACK LIST (playlists)
// ───────────────────────────────────────────────
function buildTrackRow(t, i, plId) {
  const curr = S.queue[S.idx]?.id === t.id;
  return `
  <div class="track-row ${curr ? 'active' : ''}" id="row-${t.id}"
       onclick="playTrack(${JSON.stringify(JSON.stringify(t))}, null, '${plId}')">
    <div class="trk-num">
      <span class="trk-num-txt">${i + 1}</span>
      <span class="trk-play-ic">
        ${curr && S.playing
          ? '<div style="display:flex;gap:2px;align-items:flex-end;height:14px"><span style="width:3px;border-radius:2px;background:var(--gold);animation:eq .5s ease infinite alternate;height:8px"></span><span style="width:3px;border-radius:2px;background:var(--gold);animation:eq .5s .1s ease infinite alternate;height:14px"></span><span style="width:3px;border-radius:2px;background:var(--gold);animation:eq .55s .05s ease infinite alternate;height:10px"></span></div>'
          : '<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M8 5v14l11-7z"/></svg>'}
      </span>
    </div>
    <img class="trk-img" src="${t.thumbnail}" alt="" loading="lazy"
         onerror="this.src='https://i.ytimg.com/vi/${t.id}/hqdefault.jpg'"/>
    <div class="trk-info">
      <div class="trk-title">${esc(t.title)}</div>
      <div class="trk-artist">${esc(t.channel || '')}</div>
    </div>
    <div class="trk-actions">
      <button class="trk-btn" title="Remover da playlist"
              onclick="event.stopPropagation();removeFromPl('${plId}','${t.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>
      </button>
    </div>
    <div class="trk-dur">${t.duration || ''}</div>
  </div>`;
}

function renderPlaylistTracks(tracks, plId) {
  const el = $('playlist-tracks');
  if (!tracks.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🎵</div><p>Playlist vazia — busque músicas e adicione!</p></div>';
    return;
  }
  el.innerHTML = tracks.map((t, i) => buildTrackRow(t, i, plId)).join('');
}

// ───────────────────────────────────────────────
// PLAYER — REPRODUÇÃO
// ───────────────────────────────────────────────
async function playTrack(trackArg, queueArg, plId) {
  // Aceita objeto direto ou string JSON (vindo do onclick de trackRow)
  const track = typeof trackArg === 'string' ? JSON.parse(trackArg) : trackArg;
  const newQueue = queueArg
    ? (typeof queueArg === 'string' ? JSON.parse(queueArg) : queueArg)
    : null;

  if (plId) {
    // Reprodução a partir de playlist
    const pl = S.playlists.find(p => p.id === plId);
    if (pl) { S.queue = [...pl.tracks]; S.idx = pl.tracks.findIndex(t => t.id === track.id); }
  } else if (newQueue) {
    S.queue = newQueue;
    S.idx = newQueue.findIndex(t => t.id === track.id);
    if (S.idx < 0) { S.queue.unshift(track); S.idx = 0; }
  } else {
    // Adiciona à fila ou vai para a posição existente
    const existing = S.queue.findIndex(t => t.id === track.id);
    if (existing >= 0) { S.idx = existing; }
    else { S.queue.push(track); S.idx = S.queue.length - 1; }
  }

  await loadAudio(S.idx);
}

async function loadAudio(idx) {
  if (idx < 0 || idx >= S.queue.length) return;
  S.idx = idx;
  const t = S.queue[idx];

  showLoad(true);
  updateNowPlayingUI(t);

  audio.src = `/api/stream/${t.id}`;
  audio.volume = S.muted ? 0 : S.volume;

  try {
    await audio.play();
    setPlaying(true);
    showToast(`▶ ${t.title}`);
    saveStorage();
    highlightActiveRow();

    // Se estiver transmitindo para TV, envia a nova faixa automaticamente
    if (Cast.active && Cast.device) {
      setTimeout(() => castCurrentTrack(), 500); // pequeno delay para o stream iniciar
    }
  } catch (err) {
    console.error('[PLAY ERROR]', err);
    showToast('❌ Erro ao reproduzir. Tente outra música.');
    setPlaying(false);
  } finally {
    showLoad(false);
  }
}

function togglePlay() {
  if (!S.queue.length) { showToast('Busque uma música primeiro!'); return; }
  if (audio.paused) {
    audio.play().then(() => setPlaying(true)).catch(e => console.error(e));
  } else {
    audio.pause(); setPlaying(false);
  }
}

function nextTrack() {
  if (!S.queue.length) return;
  let next;
  if (S.repeat === 2) { next = S.idx; }
  else if (S.shuffle) { next = Math.floor(Math.random() * S.queue.length); }
  else { next = S.idx + 1; }
  if (next >= S.queue.length) {
    if (S.repeat === 1) next = 0;
    else { audio.pause(); setPlaying(false); return; }
  }
  loadAudio(next);
}

function prevTrack() {
  if (!S.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prev = S.idx - 1;
  if (prev < 0) prev = S.repeat === 1 ? S.queue.length - 1 : 0;
  loadAudio(prev);
}

function toggleShuffle() {
  S.shuffle = !S.shuffle;
  syncShuffleRepeat();
  showToast(S.shuffle ? '🔀 Aleatório ativado' : '🔀 Aleatório desativado');
  saveStorage();
}

function toggleRepeat() {
  S.repeat = (S.repeat + 1) % 3;
  syncShuffleRepeat();
  showToast(['🔁 Sem repetição','🔁 Repetir tudo','🔂 Repetir esta'][S.repeat]);
  saveStorage();
}

function syncShuffleRepeat() {
  $('btn-shuffle')?.classList.toggle('active', S.shuffle);
  $('btn-shuffle-big')?.classList.toggle('active', S.shuffle);
  $('btn-repeat')?.classList.toggle('active', S.repeat > 0);
  $('btn-repeat-big')?.classList.toggle('active', S.repeat > 0);
}

function playPlaylist() {
  const pl = S.playlists.find(p => p.id === S.currentPl);
  if (!pl?.tracks.length) { showToast('Playlist vazia!'); return; }
  S.queue = [...pl.tracks]; S.idx = 0;
  loadAudio(0);
}

// ───────────────────────────────────────────────
// ÁUDIO — EVENTS
// ───────────────────────────────────────────────
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  // main bar
  setBarProgress('progress-fill', 'progress-thumb', pct);
  $('time-current').textContent = fmt(audio.currentTime);
  // big bar
  setBarProgress('progress-fill-big', 'progress-thumb-big', pct);
  $('np-time-cur').textContent = fmt(audio.currentTime);
});
audio.addEventListener('loadedmetadata', () => {
  $('time-total').textContent = fmt(audio.duration);
  $('np-time-tot').textContent = fmt(audio.duration);
});
audio.addEventListener('ended', nextTrack);
audio.addEventListener('waiting', () => showLoad(true));
audio.addEventListener('canplay', () => showLoad(false));
audio.addEventListener('error', (e) => {
  showLoad(false);
  console.error('[AUDIO ERROR]', e);
  showToast('⚠️ Erro ao carregar áudio — tentando próxima...');
  setTimeout(nextTrack, 1500);
});

function setBarProgress(fillId, thumbId, pct) {
  const f = $(fillId), th = $(thumbId);
  if (f)  f.style.width = `${pct}%`;
  if (th) th.style.left  = `${pct}%`;
}

function seekTo(e, which) {
  const barId = which === 'big' ? 'progress-bar-big' : 'progress-bar';
  const bar = $(barId);
  if (!bar || !audio.duration) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
}

// ───────────────────────────────────────────────
// VOLUME
// ───────────────────────────────────────────────
function setVolume(e, which) {
  let pct;
  if (e === null || typeof e === 'number') {
    pct = typeof e === 'number' ? e : S.volume;
  } else {
    const barId = which === 'big' ? 'volume-bar-big' : 'volume-bar';
    const bar = $(barId);
    const rect = bar.getBoundingClientRect();
    pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }
  S.volume = pct;
  audio.volume = S.muted ? 0 : pct;
  syncVolume(pct);
  if (pct > 0) S.muted = false;
  updateMuteIcon();
  saveStorage();
}

function syncVolume(pct) {
  const p = pct * 100;
  ['volume-fill','volume-fill-big'].forEach(id => { const el=$(id); if(el) el.style.width=`${p}%`; });
  ['volume-thumb','volume-thumb-big'].forEach(id => { const el=$(id); if(el) el.style.left=`${p}%`; });
}

function toggleMute() {
  S.muted = !S.muted;
  audio.volume = S.muted ? 0 : S.volume;
  updateMuteIcon();
}
function updateMuteIcon() {
  $('vol-icon')?.classList.toggle('hidden', S.muted);
  $('mute-icon')?.classList.toggle('hidden', !S.muted);
}

// ───────────────────────────────────────────────
// LIKE
// ───────────────────────────────────────────────
function toggleLike() {
  const t = S.queue[S.idx];
  if (!t) return;
  if (S.liked.has(t.id)) { S.liked.delete(t.id); $('like-btn').classList.remove('liked'); showToast('💔 Removido'); }
  else { S.liked.add(t.id); $('like-btn').classList.add('liked'); showToast('💛 Curtido!'); }
  saveStorage();
}

// ───────────────────────────────────────────────
// UI SYNC
// ───────────────────────────────────────────────
function setPlaying(b) {
  S.playing = b;
  // mini player icons
  $('icon-play')?.classList.toggle('hidden', b);
  $('icon-pause')?.classList.toggle('hidden', !b);
  // big player icons
  $('icon-play-big')?.classList.toggle('hidden', b);
  $('icon-pause-big')?.classList.toggle('hidden', !b);
  // vinyl animation
  $('vinyl-disc')?.classList.toggle('spinning', b);
  $('hero-wolf-img')?.style.setProperty('filter', b
    ? 'drop-shadow(0 0 28px rgba(168,85,247,1)) drop-shadow(0 0 50px rgba(6,182,212,.8))'
    : 'drop-shadow(0 0 20px rgba(168,85,247,.8)) drop-shadow(0 0 40px rgba(6,182,212,.5))');
  // equalizer in thumb
  $('np-playing-anim')?.classList.toggle('hidden', !b);
}

function updateNowPlayingUI(t) {
  $('np-title').textContent   = t.title || '—';
  $('np-artist').textContent  = t.channel || 'Desconhecido';
  $('np-title-big').textContent  = t.title || '—';
  $('np-artist-big').textContent = t.channel || '';
  document.title = `${t.title} — Spot Ágrios`;

  if (t.thumbnail) {
    $('np-thumb').src = t.thumbnail;
    $('np-thumb').classList.remove('hidden');
    $('np-thumb-ph').classList.add('hidden');
    $('np-art-big').src = t.thumbnail;
    // Background dinâmico
    const imgUrl = `url('${t.thumbnail}')`;
    $('player-album-bg').style.backgroundImage = imgUrl;
    $('np-bg').style.backgroundImage = imgUrl;
  }
  $('like-btn').classList.toggle('liked', S.liked.has(t.id));
  $('np-playing-anim').classList.remove('hidden');
}

function highlightActiveRow() {
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('active'));
  const t = S.queue[S.idx];
  if (t) $(`row-${t.id}`)?.classList.add('active');

  document.querySelectorAll('.music-card').forEach(c => c.style.outline = '');
  if (t) {
    const card = $(`card-${t.id}`);
    if (card) card.style.outline = '2px solid var(--gold)';
  }
}

// ───────────────────────────────────────────────
// PLAYLISTS
// ───────────────────────────────────────────────
function createPlaylist() {
  $('modal-pl').classList.remove('hidden');
  $('pl-name-input').value = '';
  setTimeout(() => $('pl-name-input').focus(), 50);
}
function cancelPlaylist() { $('modal-pl').classList.add('hidden'); }
function confirmCreatePlaylist() {
  const name = $('pl-name-input').value.trim();
  if (!name) return;
  S.playlists.push({ id: Date.now().toString(), name, tracks: [] });
  saveStorage(); renderPlaylists(); cancelPlaylist();
  showToast(`🎵 Playlist "${name}" criada!`);
}

function renderPlaylists() {
  $('playlist-list').innerHTML = `
    <div class="playlist-item create-pl" onclick="createPlaylist()">
      <div class="pl-icon plus"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></div>
      <span>Criar playlist</span>
    </div>
  ` + S.playlists.map(pl => `
    <div class="playlist-item" onclick="showPlaylistView('${pl.id}')">
      <div class="pl-icon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z"/></svg>
      </div>
      <span>${esc(pl.name)}</span>
    </div>
  `).join('');
}

// Add to playlist
let _pendingTrack = null;
function openAddPl(encodedTrack) {
  _pendingTrack = JSON.parse(decodeURIComponent(encodedTrack));
  if (!S.playlists.length) { showToast('Crie uma playlist primeiro!'); createPlaylist(); return; }
  $('addpl-select').innerHTML = S.playlists.map(pl => `<option value="${pl.id}">${esc(pl.name)}</option>`).join('');
  $('modal-addpl').classList.remove('hidden');
}
function cancelAddPl() { $('modal-addpl').classList.add('hidden'); _pendingTrack = null; }
function confirmAddPl() {
  const plId = $('addpl-select').value;
  const pl = S.playlists.find(p => p.id === plId);
  if (!pl || !_pendingTrack) return;
  if (!pl.tracks.find(t => t.id === _pendingTrack.id)) {
    pl.tracks.push(_pendingTrack);
    saveStorage();
    showToast(`✅ Adicionada a "${pl.name}"`);
  } else {
    showToast('Música já está nessa playlist');
  }
  cancelAddPl();
}

function removeFromPl(plId, trackId) {
  const pl = S.playlists.find(p => p.id === plId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(t => t.id !== trackId);
  saveStorage();
  renderPlaylistTracks(pl.tracks, plId);
  $('pl-meta').textContent = `${pl.tracks.length} músicas`;
  showToast('Removida da playlist');
}

// ───────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}
function esc(str='') {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
let _toast; function showToast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toast); _toast = setTimeout(() => el.classList.remove('show'), 2800);
}
function showLoad(b) { $('load-overlay').classList.toggle('hidden', !b); }


// ═══════════════════════════════════════════════
// 🎙️ COMANDOS DE VOZ
// ═══════════════════════════════════════════════
let recog = null, voiceTimer = null;

const CMDS = [
  { re: /^palha[,.]?\s+toc[ae]\s+(.+)/i,                   fn: m => vcPlay(m[1]) },
  { re: /^palha[,.]?\s+(?:buscar?|pesquisar?)\s+(.+)/i,    fn: m => vcSearch(m[1]) },
  { re: /^palha[,.]?\s+(?:pause|pausar|parar)/i,           fn: () => vcPause() },
  { re: /^palha[,.]?\s+(?:play|continuar|retomar|tocar)/i, fn: () => vcResume() },
  { re: /^palha[,.]?\s+(?:pr[oó]xim[ao]|avan[çc]ar|skip)/i, fn: () => { nextTrack(); speak('Próxima música'); showToast('🎙️ Próxima'); } },
  { re: /^palha[,.]?\s+(?:anterior|voltar)/i,              fn: () => { prevTrack(); speak('Anterior'); showToast('🎙️ Anterior'); } },
  { re: /^palha[,.]?\s+volume\s+(?:alto|mais|cima)/i,      fn: () => { setVolume(Math.min(1,S.volume+.25),null); speak('Volume aumentado'); showToast('🎙️ Volume +'); } },
  { re: /^palha[,.]?\s+volume\s+(?:baixo|menos|diminuir)/i,fn: () => { setVolume(Math.max(0,S.volume-.25),null); speak('Volume reduzido'); showToast('🎙️ Volume -'); } },
  { re: /^palha[,.]?\s+(?:mudo|silên|mute)/i,              fn: () => { toggleMute(); showToast('🎙️ Mudo'); } },
  { re: /^palha[,.]?\s+aleat[oó]rio/i,                     fn: () => { toggleShuffle(); speak('Aleatório alterado'); } },
  { re: /^palha[,.]?\s+repetir/i,                          fn: () => { toggleRepeat(); speak('Repetição alterada'); } },
  { re: /^palha[,.]?\s+(?:ajuda|help|comandos)/i,          fn: () => vcHelp() },
];

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('[VOZ] Não suportado'); return; }

  recog = new SR();
  recog.lang = 'pt-BR';
  recog.continuous = false;
  recog.interimResults = false;
  recog.maxAlternatives = 3;

  recog.onresult = e => {
    const texts = Array.from(e.results[0]).map(r => r.transcript.trim().toLowerCase());
    let hit = false;
    for (const txt of texts) {
      for (const cmd of CMDS) {
        const m = txt.match(cmd.re);
        if (m) { cmd.fn(m); hit = true; break; }
      }
      if (hit) break;
    }
    if (!hit && texts[0]?.includes('palha')) {
      showToast(`🎙️ Não entendi: "${texts[0]}". Diga "palha, ajuda".`);
      speak('Não entendi. Diga palha, ajuda para ver os comandos.');
    }
    setVoiceState(false);
  };

  recog.onstart = () => {
    setVoiceState(true);
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(() => { try { recog.stop(); } catch(_){} }, 8000);
  };
  recog.onend = () => setVoiceState(false);
  recog.onerror = e => {
    const msgs = { 'no-speech':'Nenhuma voz detectada.','not-allowed':'Permissão negada!','network':'Erro de rede.' };
    showToast(`🎙️ ${msgs[e.error] || e.error}`);
    setVoiceState(false);
  };

  // Hold Space key
  let spHold = null;
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && !spHold) {
      spHold = setTimeout(() => startListening(), 400);
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { clearTimeout(spHold); spHold = null; }
  });
}

function toggleVoice() { S.voiceOn ? stopListening() : startListening(); }

function startListening() {
  if (!recog) { showToast('🎙️ Navegador não suporta voz (use Chrome)'); return; }
  if (S.voiceOn) return;
  try { S.voiceOn = true; recog.start(); showToast('🎙️ Ouvindo... diga "palha, toque [música]"'); }
  catch (e) { S.voiceOn = false; }
}
function stopListening() {
  try { recog?.stop(); } catch(_) {}
  S.voiceOn = false; setVoiceState(false);
}

function setVoiceState(on) {
  S.voiceOn = on;
  $('voice-btn').classList.toggle('on', on);
  $('voice-icon-mic').classList.toggle('hidden', on);
  $('voice-icon-on').classList.toggle('hidden', !on);
  $('voice-indicator').classList.toggle('hidden', !on);
}

// Ações de voz
async function vcPlay(q) {
  showToast(`🎙️ Buscando: "${q}"...`);
  speak(`Buscando ${q}`);
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (d.items?.length) {
      _lastSearchResults = d.items;
      playTrack(d.items[0], d.items);
      speak(`Tocando ${d.items[0].title}`);
    } else { showToast('🎙️ Não encontrei essa música'); speak('Não encontrei'); }
  } catch { showToast('🎙️ Erro na busca'); }
}
async function vcSearch(q) {
  $('search-input').value = q;
  showSearch(); $('search-title').textContent = `Resultados para "${q}"`;
  await doSearch(q);
  speak(`Resultados para ${q}`);
}
function vcPause() { audio.pause(); setPlaying(false); speak('Pausado'); showToast('🎙️ Pausado'); }
function vcResume() {
  if (audio.paused && S.queue.length) { audio.play().then(()=>setPlaying(true)); speak('Reproduzindo'); showToast('🎙️ Reproduzindo'); }
}

function vcHelp() {
  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'voice-help';
  el.innerHTML = `
    <div class="modal" style="max-width:480px">
      <h2>🎙️ Comandos de Voz</h2>
      <p style="color:var(--tx3);font-size:.8rem">Palavra mágica: <strong style="color:var(--gold)">palha</strong></p>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto">
        ${[
          'palha, toque [nome da música]',
          'palha, buscar [nome]',
          'palha, pause / palha, play',
          'palha, próxima / palha, anterior',
          'palha, volume alto / volume baixo',
          'palha, aleatório / palha, repetir',
          'palha, mudo / palha, ajuda',
        ].map(c=>`<div style="background:var(--bg2);padding:8px 14px;border-radius:8px;font-size:.825rem;font-family:monospace;color:var(--gold-light)">${c}</div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn-gold" onclick="document.getElementById('voice-help').remove()">Entendido!</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  speak('Comandos de voz do Spot Ágrios');
}

function speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang='pt-BR'; u.rate=1.1; u.pitch=1; u.volume=0.65;
  speechSynthesis.speak(u);
}


// ═══════════════════════════════════════════════
// 📺 CAST — Modal, Chromecast, AirPlay, DLNA
// ═══════════════════════════════════════════════
const Cast = {
  active: false,
  deviceName: null,
  scanned: false,
};

// Abre o modal de cast
function startCast() {
  $('cast-modal').classList.remove('hidden');
  $('cast-overlay').classList.remove('hidden');
  syncCastStatus();
}

function closeCastModal() {
  $('cast-modal').classList.add('hidden');
  $('cast-overlay').classList.add('hidden');
}

function syncCastStatus() {
  const currentDiv = $('cast-current');
  if (Cast.active && Cast.deviceName) {
    currentDiv.classList.remove('hidden');
    $('cast-current-name').textContent = Cast.deviceName;
    $('cast-btn').classList.add('casting');
  } else {
    currentDiv.classList.add('hidden');
    $('cast-btn').classList.remove('casting');
  }
}

// ── Chromecast via Remote Playback API ──
async function castToChromecast() {
  try {
    if (!audio.remote) {
      showToast('📺 Abra no Chrome para usar Chromecast');
      return;
    }
    await audio.remote.prompt();
    // Eventos de connect/disconnect gerenciados no initCast()
  } catch (e) {
    if (e.name !== 'NotAllowedError') {
      showToast('❌ ' + (e.message || 'Erro ao conectar'));
    }
  }
}

// ── AirPlay via WebKit API ──
function castToAirPlay() {
  if (audio.webkitShowPlaybackTargetPicker) {
    audio.webkitShowPlaybackTargetPicker();
  } else {
    showToast('📺 AirPlay disponível apenas no Safari/iOS');
  }
}

// ── Scan de dispositivos DLNA/UPnP na rede local ──
async function scanDevices() {
  const btn  = $('cast-scan-btn');
  const list = $('cast-device-list');

  btn.classList.add('scanning');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="animation:spin .8s linear infinite"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Escaneando...`;

  list.innerHTML = `
    <div class="cast-scan-progress">
      <div class="dot-anim"><span></span><span></span><span></span></div>
      Varrendo a rede local... isso leva alguns segundos
    </div>`;

  try {
    const controller = new AbortController();
    const res = await fetch('/api/cast/devices', { signal: controller.signal });
    const data = await res.json();

    resetScanBtn();

    if (!data.devices?.length) {
      list.innerHTML = `
        <div class="cast-hint">
          😔 Nenhum dispositivo encontrado automaticamente.<br>
          <strong>Tente inserir o IP da sua TV manualmente abaixo</strong> — veja o IP nas configurações de rede da TV.
        </div>`;
      return;
    }

    Cast.scanned = true;
    renderDeviceList(data.devices);
    showToast(`📺 ${data.devices.length} dispositivo(s) encontrado(s)!`);

  } catch (err) {
    resetScanBtn();
    list.innerHTML = '<div class="cast-hint">❌ Erro ao escanear. Verifique sua conexão e tente o IP manual.</div>';
  }
}

function resetScanBtn() {
  const btn = $('cast-scan-btn');
  btn.classList.remove('scanning');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Procurar dispositivos na rede`;
}

function renderDeviceList(devices) {
  const list = $('cast-device-list');
  list.innerHTML = devices.map(d => `
    <div class="cast-device-item" onclick="connectToDevice('${encodeURIComponent(JSON.stringify(d))}')">
      <div class="cast-device-icon">${deviceIcon(d.type)}</div>
      <div class="cast-device-info">
        <div class="cast-device-name">${esc(d.name)}</div>
        <div class="cast-device-ip">${d.ip}${d.port ? ':' + d.port : ''}</div>
      </div>
      <span class="cast-device-badge">${deviceLabel(d.type)}</span>
    </div>
  `).join('');
}

// IP manual
async function probeManualIP() {
  const input = $('cast-manual-ip');
  const ip    = input.value.trim();
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    showToast('⚠️ Digite um IP válido (ex: 192.168.1.100)');
    input.focus();
    return;
  }

  const btn = input.nextElementSibling;
  btn.textContent = '...';
  btn.disabled    = true;

  try {
    const res  = await fetch(`/api/cast/probe?ip=${ip}`);
    const data = await res.json();

    btn.textContent = 'Conectar';
    btn.disabled    = false;

    if (!data.found) {
      showToast(`❌ ${ip} não respondeu. Verifique o IP e se a TV está ligada.`);
      return;
    }

    // Adiciona à lista e conecta
    const d = data.device;
    const list = $('cast-device-list');
    const existing = list.querySelector(`[data-ip="${ip}"]`);
    if (!existing) {
      const item = document.createElement('div');
      item.className = 'cast-device-item';
      item.dataset.ip = ip;
      item.innerHTML = `
        <div class="cast-device-icon">${deviceIcon(d.type)}</div>
        <div class="cast-device-info">
          <div class="cast-device-name">${esc(d.name)}</div>
          <div class="cast-device-ip">${d.ip}${d.port ? ':' + d.port : ''}</div>
        </div>
        <span class="cast-device-badge">${deviceLabel(d.type)}</span>`;
      item.onclick = () => connectToDevice(encodeURIComponent(JSON.stringify(d)));
      // Limpa o hint se existir
      list.querySelector('.cast-hint')?.remove();
      list.prepend(item);
    }

    connectToDevice(encodeURIComponent(JSON.stringify(d)));
  } catch {
    btn.textContent = 'Conectar';
    btn.disabled    = false;
    showToast('❌ Erro ao verificar o IP');
  }
}

function connectToDevice(deviceEncoded) {
  const d = typeof deviceEncoded === 'string'
    ? JSON.parse(decodeURIComponent(deviceEncoded))
    : deviceEncoded;

  Cast.active     = true;
  Cast.deviceName = d.name;
  Cast.device     = d;  // ← guarda o objeto completo para uso posterior

  // Marca o item como ativo
  document.querySelectorAll('.cast-device-item').forEach(el => el.classList.remove('active'));
  event?.currentTarget?.classList?.add('active');

  syncCastStatus();
  showToast(`📺 Conectado a ${d.name} — enviando áudio...`);

  // Envia o stream atual para a TV
  castCurrentTrack();
}

// Envia a faixa atual para o dispositivo cast via servidor (evita CORS)
async function castCurrentTrack() {
  if (!Cast.active || !Cast.device) return;
  const t = S.queue[S.idx];
  if (!t) return;

  const d = Cast.device;
  // Determina protocolo: AirPlay (RAOP) ou DLNA
  const isAirPlay = d.type === 'airplay' || d.type === 'chromecast' || d.airplayPort;
  const endpoint  = isAirPlay ? '/api/cast/airplay' : '/api/cast/play';

  try {
    showToast(`📺 Conectando a ${d.name} via ${isAirPlay ? 'AirPlay' : 'DLNA'}...`);
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device:  d,
        videoId: t.id,
        title:   t.title,
      }),
    });
    const data = await r.json();
    if (data.ok) {
      showToast(`📺 Transmitindo via ${isAirPlay ? 'AirPlay 🍎' : 'DLNA'}: "${t.title}"`);
    } else {
      // Se AirPlay falhou, tenta DLNA como fallback
      if (isAirPlay && endpoint === '/api/cast/airplay') {
        console.warn('[CAST] AirPlay falhou, tentando DLNA...', data.error);
        const r2 = await fetch('/api/cast/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: d, videoId: t.id, title: t.title }),
        });
        const d2 = await r2.json();
        if (d2.ok) { showToast(`📺 Transmitindo via DLNA: "${t.title}"`); return; }
      }
      showToast(`⚠️ ${data.error || 'Erro ao transmitir. Tente pelo Safari no iPhone.'}`);
      console.warn('[CAST]', data.error);
    }
  } catch (err) {
    showToast('❌ Erro: ' + err.message);
  }
}

// Para reprodução na TV
async function stopCastDevice() {
  if (!Cast.device) return;
  try {
    await fetch('/api/cast/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: Cast.device }),
    });
  } catch {}
}

// Envia comando DLNA SetAVTransportURI (agora feito via servidor — removido do cliente)
async function sendDLNAPlay(device) {
  // Delegado ao servidor via /api/cast/play
  return castCurrentTrack();
}

function disconnectCast() {
  stopCastDevice(); // para a reprodução na TV
  Cast.active     = false;
  Cast.deviceName = null;
  Cast.device     = null;
  syncCastStatus();
  showToast('📺 Transmissão encerrada');
}

function deviceIcon(type) {
  if (type === 'chromecast') return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm18-7H5c-1.1 0-2 .9-2 2v3h2v-3h14v14h-5v2h5c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-18 3v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z"/></svg>`;
  if (type === 'tv')         return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5l-1 1v1h10v-1l-1-1h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
}

function deviceLabel(type) {
  return { chromecast: 'Cast', tv: 'Smart TV', dlna: 'DLNA' }[type] || 'DLNA';
}

// ── Init cast events ──
function initCast() {
  $('cast-btn')?.classList.remove('hidden'); // sempre visível

  // Remote Playback API (Chrome/Chromecast)
  if (audio.remote) {
    audio.remote.watchAvailability(() => {}).catch(() => {});
    audio.remote.addEventListener('connecting', () => {
      Cast.deviceName = 'Chromecast';
      showToast('📺 Conectando ao Chromecast...');
    });
    audio.remote.addEventListener('connect', () => {
      Cast.active = true;
      Cast.deviceName = 'Chromecast';
      syncCastStatus();
      showToast('✅ Transmitindo via Chromecast!');
    });
    audio.remote.addEventListener('disconnect', () => {
      Cast.active = false;
      Cast.deviceName = null;
      syncCastStatus();
      showToast('📺 Chromecast desconectado');
    });
  }

  // AirPlay (Safari/iOS)
  if (typeof window.WebKitPlaybackTargetAvailabilityEvent !== 'undefined') {
    audio.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', e => {
      Cast.active = !!e.value;
      Cast.deviceName = e.value ? 'AirPlay' : null;
      syncCastStatus();
      showToast(e.value ? '✅ AirPlay ativo' : '📺 AirPlay desconectado');
    });
  }
}

document.addEventListener('DOMContentLoaded', initCast);

// ── Fix Firewall do Windows ──
async function fixFirewall() {
  const btn = $('cast-fw-btn');
  btn.classList.add('loading');
  btn.textContent = '⏳ Configurando Firewall...';
  try {
    const r = await fetch('/api/cast/fix-firewall', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      btn.textContent = '✅ Firewall liberado! Procurando agora...';
      setTimeout(() => {
        btn.textContent = '🛡️ Liberar Firewall do Windows (se não encontrar)';
        btn.classList.remove('loading');
        scanDevices();
      }, 1200);
    } else {
      btn.textContent = '❌ ' + d.msg;
      btn.classList.remove('loading');
    }
  } catch {
    btn.textContent = '❌ Erro ao configurar. Execute como Administrador.';
    btn.classList.remove('loading');
  }
}
