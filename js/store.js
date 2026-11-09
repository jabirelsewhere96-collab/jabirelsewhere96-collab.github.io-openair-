// Tiny persistent store: liked songs, playlists, history and preferences.
// Everything lives in the visitor's browser (localStorage) — no account needed.

const KEY = 'openair:v1';

const defaults = () => ({
  liked: [], // tracks, newest first
  playlists: [], // { id, name, created, tracks: [] }
  recentAlbums: [], // album summaries, newest first
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off', // 'off' | 'all' | 'one'
  theme: null, // null = follow system
  session: null, // { tracks, order, pos, time }
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch {
    return defaults();
  }
}

const state = load();
const listeners = new Set();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked — app keeps working in memory */
    }
  }, 150);
}

function emit(type) {
  save();
  listeners.forEach((fn) => fn(type));
}

export const store = {
  get state() {
    return state;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(key, value, silent = false) {
    state[key] = value;
    silent ? save() : emit(key);
  },

  // ----- Liked songs -----
  isLiked(trackId) {
    return state.liked.some((t) => t.id === trackId);
  },
  toggleLike(track) {
    const i = state.liked.findIndex((t) => t.id === track.id);
    if (i >= 0) state.liked.splice(i, 1);
    else state.liked.unshift(slim(track));
    emit('liked');
    return i < 0;
  },

  // ----- Playlists -----
  createPlaylist(name) {
    const pl = { id: Math.random().toString(36).slice(2, 10), name: name || `My Playlist #${state.playlists.length + 1}`, created: Date.now(), tracks: [] };
    state.playlists.unshift(pl);
    emit('playlists');
    return pl;
  },
  getPlaylist(id) {
    return state.playlists.find((p) => p.id === id);
  },
  renamePlaylist(id, name) {
    const pl = this.getPlaylist(id);
    if (pl && name.trim()) {
      pl.name = name.trim();
      emit('playlists');
    }
  },
  deletePlaylist(id) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    emit('playlists');
  },
  addToPlaylist(id, tracks) {
    const pl = this.getPlaylist(id);
    if (!pl) return 0;
    const have = new Set(pl.tracks.map((t) => t.id));
    const fresh = tracks.filter((t) => !have.has(t.id)).map(slim);
    pl.tracks.push(...fresh);
    emit('playlists');
    return fresh.length;
  },
  removeFromPlaylist(id, trackId) {
    const pl = this.getPlaylist(id);
    if (!pl) return;
    pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
    emit('playlists');
  },

  /** Wipe everything this site stored in the browser. */
  reset() {
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    Object.assign(state, defaults());
    listeners.forEach((fn) => fn('reset'));
  },

  // ----- History -----
  rememberAlbum(album) {
    const summary = { id: album.id, title: album.title, artist: album.artist, cover: album.cover, year: album.year };
    state.recentAlbums = [summary, ...state.recentAlbums.filter((a) => a.id !== album.id)].slice(0, 24);
    emit('recent');
  },
};

function slim(t) {
  const { id, title, artist, album, albumId, cover, coverLarge, duration, src } = t;
  return { id, title, artist, album, albumId, cover, coverLarge, duration, src };
}
