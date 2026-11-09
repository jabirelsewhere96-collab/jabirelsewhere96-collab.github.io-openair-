// Audio engine: queue, shuffle, repeat, media-session (lock screen) controls.
import { store } from './store.js';

const audio = new Audio();
audio.preload = 'auto';

let tracks = []; // the queue's tracks, in insertion order
let order = []; // play order: indices into `tracks`
let pos = -1; // position in `order`
let context = null; // { label, href } — what the queue was started from
let errorStreak = 0;

const listeners = new Set();
const emit = (type) => listeners.forEach((fn) => fn(type));

const range = (n) => Array.from({ length: n }, (_, i) => i);
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function current() {
  return pos >= 0 && pos < order.length ? tracks[order[pos]] : null;
}

function persistSession() {
  store.set('session', tracks.length ? { tracks, order, pos, time: audio.currentTime || 0, context } : null, true);
}

function load(autoplay = true, startAt = 0) {
  const t = current();
  if (!t) return;
  audio.src = t.src;
  if (startAt) {
    audio.addEventListener('loadedmetadata', () => (audio.currentTime = startAt), { once: true });
  }
  if (autoplay) audio.play().catch(() => emit('state'));
  updateMediaSession(t);
  emit('track');
  persistSession();
}

function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: [{ src: t.cover, sizes: '300x300', type: 'image/jpeg' }],
  });
}

export const player = {
  audio,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get current() {
    return current();
  },
  get context() {
    return context;
  },
  get playing() {
    return !audio.paused && !audio.ended;
  },
  get upNext() {
    return order.slice(pos + 1).map((i, k) => ({ track: tracks[i], pos: pos + 1 + k }));
  },
  get shuffle() {
    return store.state.shuffle;
  },
  get repeat() {
    return store.state.repeat;
  },

  /** Replace the queue with `list` and start at `index`. */
  playList(list, index = 0, ctx = null) {
    if (!list.length) return;
    tracks = list.slice();
    context = ctx;
    if (store.state.shuffle) {
      const rest = shuffled(range(tracks.length).filter((i) => i !== index));
      order = [index, ...rest];
      pos = 0;
    } else {
      order = range(tracks.length);
      pos = index;
    }
    errorStreak = 0;
    load(true);
    emit('queue');
  },

  /** Is this exact track (optionally within a context) the one loaded? */
  isCurrent(trackId, ctxHref) {
    const t = current();
    if (!t || t.id !== trackId) return false;
    return ctxHref ? context?.href === ctxHref : true;
  },

  toggle() {
    if (!current()) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  },
  play() {
    if (current()) audio.play().catch(() => {});
  },
  pause() {
    audio.pause();
  },

  next(auto = false) {
    if (!order.length) return;
    const repeat = store.state.repeat;
    if (auto && repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (pos < order.length - 1) {
      pos++;
    } else if (repeat === 'all') {
      if (store.state.shuffle) order = shuffled(order);
      pos = 0;
    } else {
      // End of the queue: stop (a manual "next" also rewinds).
      if (!auto) {
        audio.pause();
        audio.currentTime = 0;
      }
      emit('state');
      persistSession();
      return;
    }
    load(true);
    emit('queue');
  },

  prev() {
    if (!order.length) return;
    if (audio.currentTime > 3 || pos === 0) {
      audio.currentTime = 0;
      return;
    }
    pos--;
    load(true);
    emit('queue');
  },

  jumpTo(p) {
    if (p < 0 || p >= order.length) return;
    pos = p;
    load(true);
    emit('queue');
  },

  seek(fraction) {
    if (Number.isFinite(audio.duration)) audio.currentTime = fraction * audio.duration;
  },
  seekBy(sec) {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
  },

  setVolume(v) {
    audio.volume = Math.max(0, Math.min(1, v));
    if (audio.volume > 0 && store.state.muted) this.setMuted(false);
    store.set('volume', audio.volume, true);
    emit('volume');
  },
  setMuted(m) {
    audio.muted = m;
    store.set('muted', m, true);
    emit('volume');
  },

  toggleShuffle() {
    const on = !store.state.shuffle;
    store.set('shuffle', on, true);
    const curIdx = order[pos];
    if (tracks.length) {
      if (on) {
        order = [curIdx, ...shuffled(range(tracks.length).filter((i) => i !== curIdx))];
        pos = 0;
      } else {
        order = range(tracks.length);
        pos = Math.max(0, curIdx);
      }
    }
    emit('mode');
    emit('queue');
    persistSession();
  },
  cycleRepeat() {
    const next = { off: 'all', all: 'one', one: 'off' }[store.state.repeat] || 'off';
    store.set('repeat', next, true);
    emit('mode');
  },

  /** Insert right after the current track. */
  playNext(list) {
    if (!current()) return this.playList(list, 0);
    const start = tracks.length;
    tracks.push(...list);
    order.splice(pos + 1, 0, ...list.map((_, i) => start + i));
    emit('queue');
    persistSession();
  },
  /** Append to the end of the queue. */
  enqueue(list) {
    if (!current()) return this.playList(list, 0);
    const start = tracks.length;
    tracks.push(...list);
    order.push(...list.map((_, i) => start + i));
    emit('queue');
    persistSession();
  },
  removeAt(p) {
    if (p <= pos || p >= order.length) return;
    order.splice(p, 1);
    emit('queue');
    persistSession();
  },
  clearUpNext() {
    order = order.slice(0, pos + 1);
    emit('queue');
    persistSession();
  },

  /** Restore the last session without autoplaying. */
  restore() {
    const s = store.state.session;
    if (!s || !Array.isArray(s.tracks) || !s.tracks.length) return;
    tracks = s.tracks;
    order = Array.isArray(s.order) && s.order.length === tracks.length ? s.order : range(tracks.length);
    pos = Math.min(Math.max(0, s.pos | 0), order.length - 1);
    context = s.context || null;
    load(false, s.time || 0);
    emit('queue');
  },
};

// ----- Wire up audio element -----
audio.volume = store.state.volume ?? 0.8;
audio.muted = !!store.state.muted;

audio.addEventListener('play', () => emit('state'));
audio.addEventListener('pause', () => emit('state'));
audio.addEventListener('playing', () => {
  errorStreak = 0;
  emit('state');
});
audio.addEventListener('waiting', () => emit('buffering'));
audio.addEventListener('ended', () => player.next(true));
audio.addEventListener('loadedmetadata', () => emit('time'));

let lastPersist = 0;
audio.addEventListener('timeupdate', () => {
  emit('time');
  const now = Date.now();
  if (now - lastPersist > 5000) {
    lastPersist = now;
    persistSession();
  }
});

audio.addEventListener('error', () => {
  if (!audio.src || !current()) return;
  errorStreak++;
  emit('error');
  if (errorStreak < 4 && pos < order.length - 1) setTimeout(() => player.next(true), 800);
});

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => {
    try {
      ms.setActionHandler(a, fn);
    } catch {
      /* unsupported action */
    }
  };
  set('play', () => player.play());
  set('pause', () => player.pause());
  set('previoustrack', () => player.prev());
  set('nexttrack', () => player.next());
  set('seekbackward', () => player.seekBy(-10));
  set('seekforward', () => player.seekBy(10));
  set('seekto', (d) => d.seekTime != null && (audio.currentTime = d.seekTime));
}
