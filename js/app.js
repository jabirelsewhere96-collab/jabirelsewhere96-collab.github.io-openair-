import { player } from './player.js';
import { store } from './store.js';
import { searchAlbums, getAlbum, GENRES, SORTS, licenseLabel, itemUrl } from './api.js';
import { topAlbums, topSongs, searchMalayalam, fullSongLinks, ML_ARTISTS } from './apple.js';

// =====================================================================
// Helpers
// =====================================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const main = $('#main');
const mobileMQ = matchMedia('(max-width: 820px)');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const albumHref = (id) => `#/album/${encodeURIComponent(id)}`;
const artistHref = (name) => `#/artist/${encodeURIComponent(name)}`;
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
function fmtLong(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
}
function hueOf(str) {
  let h = 7;
  for (const c of String(str)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % 360;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2400);
  setTimeout(() => el.remove(), 2800);
}

function dialog({ title, body = '', input = null, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `<form method="dialog">
      <h3>${esc(title)}</h3>
      ${body ? `<p>${esc(body)}</p>` : ''}
      ${input !== null ? `<input name="v" value="${esc(input)}" maxlength="80" required autocomplete="off" />` : ''}
      <div class="modal-actions">
        <button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirm)}</button>
        <button value="cancel" class="btn ghost" formnovalidate>Cancel</button>
      </div>
    </form>`;
    document.body.append(d);
    d.showModal();
    const inp = d.querySelector('input');
    inp?.select();
    d.addEventListener('close', () => {
      const ok = d.returnValue === 'ok';
      resolve(ok ? (inp ? inp.value.trim() || null : true) : null);
      d.remove();
    });
  });
}

// Artwork with a colorful fallback (shown if the image is missing or fails).
function art(src, seed, cls = '', extra = '') {
  return `<div class="art ${cls}" style="--h:${hueOf(seed)}"><span class="art-fallback">${icon('music')}</span>${
    src ? `<img loading="lazy" src="${esc(src)}" alt="" />` : ''
  }${extra}</div>`;
}
function mosaic(tracks, seed, cls = '') {
  const covers = [...new Set(tracks.map((t) => t.cover))].slice(0, 4);
  if (covers.length === 4) {
    return `<div class="art mosaic ${cls}" style="--h:${hueOf(seed)}">${covers.map((c) => `<img loading="lazy" src="${esc(c)}" alt="" />`).join('')}</div>`;
  }
  return art(covers[0] || '', seed, cls);
}
document.addEventListener('error', (e) => e.target instanceof HTMLImageElement && e.target.classList.add('broken'), true);

const skeletonCards = (n = 6) =>
  Array.from({ length: n }, () => `<div class="card skeleton"><div class="art"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`).join('');

const errorBlock = (msg = 'Something went wrong loading this.') =>
  `<div class="empty"><p>${esc(msg)}</p><button class="btn ghost" data-action="retry">Try again</button></div>`;

// =====================================================================
// Render state
// =====================================================================
let renderId = 0;
let lists = {}; // key -> tracks currently on screen
let pageCtx = null; // what the main list on this page is: { href, label, album?, playlistId? }
let pageLoadMore = null;

function startRender() {
  const id = ++renderId;
  lists = {};
  pageCtx = null;
  pageLoadMore = null;
  closeMenu();
  return { alive: () => id === renderId };
}

// =====================================================================
// Components
// =====================================================================
function albumCard(a) {
  return `<article class="card" data-album="${esc(a.id)}">
    ${art(a.cover, a.id, '', `<button class="card-play" data-action="play-album" data-id="${esc(a.id)}" aria-label="Play ${esc(a.title)}">${icon('play')}</button>`)}
    <a class="card-title" href="${albumHref(a.id)}" title="${esc(a.title)}">${esc(a.title)}</a>
    <div class="card-sub">${esc([a.year, a.artist].filter(Boolean).join(' • '))}</div>
  </article>`;
}

function shelf(title, href, key, content = skeletonCards(8)) {
  return `<section class="shelf">
    <div class="shelf-head"><h2>${esc(title)}</h2>${href ? `<a class="show-all" href="${href}">Show all</a>` : ''}</div>
    <div class="shelf-row" id="shelf-${key}">${content}</div>
  </section>`;
}

function trackRows(tracks, key, { showAlbum = false, showCover = false } = {}) {
  lists[key] = tracks;
  return `<div class="tracklist ${showAlbum ? 'with-album' : ''}" role="list">
    <div class="tl-head" aria-hidden="true"><span>#</span><span>Title</span>${showAlbum ? '<span>Album</span>' : ''}<span></span><span>${icon('clock')}</span><span></span></div>
    ${tracks.map((t, i) => trackRow(t, i, key, showAlbum, showCover)).join('')}
  </div>`;
}

function trackRow(t, i, key, showAlbum, showCover) {
  const liked = store.isLiked(t.id);
  return `<div class="row" role="listitem" data-list="${key}" data-index="${i}" data-track="${esc(t.id)}" tabindex="0">
    <span class="row-num"><span class="n">${i + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>${icon('play', 'row-play')}</span>
    <span class="row-main">${showCover ? art(t.cover, t.albumId, 'xs') : ''}<span class="row-text"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${
      t.preview ? '<span class="pill tiny" title="Official 30-second preview">Preview</span>' : ''
    }<a class="row-artist" href="${t.artistHref || artistHref(t.artist)}">${esc(t.artist)}</a></span></span></span>
    ${showAlbum ? `<a class="row-album" href="${albumHref(t.albumId)}">${esc(t.album)}</a>` : ''}
    ${likeButton(t.id, liked)}
    <span class="row-dur">${t.duration ? fmtTime(t.duration) : ''}</span>
    <button class="icon-btn row-more" data-action="track-menu" aria-label="More options for ${esc(t.title)}">${icon('more')}</button>
  </div>`;
}

const likeButton = (id, liked) =>
  `<button class="icon-btn like-btn ${liked ? 'liked' : ''}" data-action="like" data-id="${esc(id)}" aria-pressed="${liked}" aria-label="${liked ? 'Remove from' : 'Save to'} Liked Songs">${icon(liked ? 'heart-fill' : 'heart')}</button>`;

function actionsBar({ menu = true } = {}) {
  return `<div class="actions">
    <button class="play-btn lg" data-action="play-list" data-list="main" aria-label="Play">${icon('play')}</button>
    <button class="icon-btn lg" data-action="shuffle-list" data-list="main" title="Shuffle play" aria-label="Shuffle play">${icon('shuffle')}</button>
    ${menu ? `<button class="icon-btn lg" data-action="list-menu" title="More options" aria-label="More options">${icon('more')}</button>` : ''}
  </div>`;
}

function hero({ seed, artHtml, eyebrow, title, line }) {
  const size = title.length > 42 ? 'long' : title.length > 22 ? 'mid' : '';
  return `<section class="hero" style="--h:${hueOf(seed)}">
    ${artHtml}
    <div class="hero-meta">
      <span class="eyebrow">${esc(eyebrow)}</span>
      <h1 class="${size}">${esc(title)}</h1>
      <p class="hero-line">${line}</p>
    </div>
  </section>`;
}

// =====================================================================
// Pages
// =====================================================================
const freeAlbums = (opts) => () => searchAlbums({ ...opts, rows: 14 }).then((r) => r.albums);
const HOME_SHELVES = [
  { key: 'malayalam', title: 'Top Malayalam albums', href: '#/malayalam?tab=albums', load: () => topAlbums(100).then((a) => a.slice(0, 16)) },
  { key: 'trending', title: 'Trending free music this week', href: '#/genre/all?sort=trending', load: freeAlbums({ sort: 'trending' }) },
  { key: 'popular', title: 'All-time favorites', href: '#/genre/all', load: freeAlbums({ sort: 'popular' }) },
  ...['lofi', 'electronic', 'ambient', 'jazz', 'hiphop', 'chill', 'rock'].map((k) => {
    const g = GENRES.find((x) => x.key === k);
    return { key: k, title: g.name, href: `#/genre/${k}`, load: freeAlbums({ genre: k }) };
  }),
];

const malayalamTile = `<article class="quick"><div class="art sq genre-art" style="--h:150"><span class="art-fallback">${icon(
  'music'
)}</span></div><a class="quick-title" href="#/malayalam">Malayalam hits</a></article>`;

function renderHome(r) {
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const recent = store.state.recentAlbums;
  const quick = recent.length
    ? recent.slice(0, 6).map(
        (a) => `<article class="quick">${art(a.cover, a.id, 'sq')}<a class="quick-title" href="${albumHref(a.id)}">${esc(a.title)}</a>
          <button class="card-play quick-play" data-action="play-album" data-id="${esc(a.id)}" aria-label="Play ${esc(a.title)}">${icon('play')}</button></article>`
      )
    : [
        malayalamTile,
        ...GENRES.slice(0, 5).map(
          (g) => `<article class="quick"><div class="art sq genre-art" style="--h:${g.hue}"><span class="art-fallback">${icon('music')}</span></div><a class="quick-title" href="#/genre/${g.key}">${esc(g.name)}</a></article>`
        ),
      ];

  view.innerHTML = `
    <section class="page-head" style="--h:${(hour * 17) % 360}">
      <h1>${greet}</h1>
      <p class="sub">Top Malayalam songs from Kerala, plus thousands of free albums from independent artists.</p>
    </section>
    <div class="quick-grid">${quick.join('')}</div>
    <div class="chips" aria-label="Genres"><a class="chip" href="#/malayalam">Malayalam</a>${GENRES.map((g) => `<a class="chip" href="#/genre/${g.key}" style="--h:${g.hue}">${esc(g.name)}</a>`).join('')}</div>
    ${recent.length > 6 ? shelf('Jump back in', '#/library', 'recent', recent.map(albumCard).join('')) : ''}
    ${HOME_SHELVES.map((s) => shelf(s.title, s.href, s.key)).join('')}
  `;

  // Load shelves as they scroll into view.
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const s = HOME_SHELVES.find((x) => `shelf-${x.key}` === en.target.id);
        if (s) fillShelf(r, en.target, s.load);
      }
    },
    { root: main, rootMargin: '600px 0px' }
  );
  HOME_SHELVES.forEach((s) => io.observe($(`#shelf-${s.key}`)));
}

async function fillShelf(r, el, load) {
  try {
    const albums = await load();
    if (!r.alive()) return;
    el.innerHTML = albums.length ? albums.map(albumCard).join('') : '<p class="muted">Nothing here yet.</p>';
    refreshPlaying();
  } catch {
    if (r.alive()) el.innerHTML = `<p class="muted">Couldn't load this row. <button class="btn link" data-action="retry">Retry</button></p>`;
  }
}

/** A paginated grid of albums with "Load more". */
async function loadGrid(r, opts, onFirst) {
  const grid = $('#grid');
  const more = $('#more');
  let page = 1;
  let loaded = 0;
  const rows = 30;
  const load = async () => {
    if (page > 1) more.innerHTML = '<div class="spinner" aria-label="Loading"></div>';
    try {
      const { total, albums } = await searchAlbums({ ...opts, rows, page });
      if (!r.alive()) return;
      if (page === 1) {
        grid.innerHTML = '';
        onFirst?.(total, albums);
      }
      grid.insertAdjacentHTML('beforeend', albums.map(albumCard).join(''));
      loaded += albums.length;
      page++;
      more.innerHTML = albums.length && loaded < total ? '<button class="btn ghost" data-action="load-more">Load more</button>' : '';
      refreshPlaying();
    } catch {
      if (!r.alive()) return;
      if (page === 1) grid.innerHTML = '';
      more.innerHTML = `<div class="empty"><p>Couldn't load albums.</p><button class="btn ghost" data-action="load-more">Try again</button></div>`;
    }
  };
  pageLoadMore = load;
  await load();
}

function renderSearch(r, q = '') {
  const input = $('#search-input');
  if (document.activeElement !== input) input.value = q;

  if (!q) {
    view.innerHTML = `<h1 class="page-title">Browse all</h1>
      <div class="genre-grid"><a class="genre-tile" href="#/malayalam" style="--h:150"><span>Malayalam</span>${icon('music')}</a>${GENRES.map(
        (g) => `<a class="genre-tile" href="#/genre/${g.key}" style="--h:${g.hue}"><span>${esc(g.name)}</span>${icon('music')}</a>`
      ).join('')}</div>`;
    if (!mobileMQ.matches) input.focus();
    return;
  }

  const mlLink = `<a class="ml-hint" href="#/malayalam?q=${encodeURIComponent(q)}">${icon('search')}<span>Looking for Malayalam songs? Search “${esc(q)}” in <b>Malayalam</b></span>${icon('chevron-right')}</a>`;
  view.innerHTML = `
    ${mlLink}
    <div id="search-top"></div>
    <h2 class="section-title">Free albums</h2>
    <div class="grid" id="grid">${skeletonCards(12)}</div>
    <div class="more-wrap" id="more"></div>`;

  return loadGrid(r, { text: q }, (total, albums) => {
    if (!albums.length) {
      view.innerHTML = `${mlLink}<div class="empty big"><h2>No free albums for “${esc(q)}”</h2><p>Try different words, an artist name or a genre like “ambient”.</p></div>`;
      return;
    }
    const top = albums[0];
    const artists = [...new Set(albums.map((a) => a.artist))].filter((n) => n && !/various/i.test(n)).slice(0, 6);
    $('#search-top').innerHTML = `<div class="search-top">
      <section>
        <h2 class="section-title">Top result</h2>
        <article class="top-result" data-album="${esc(top.id)}">
          ${art(top.cover, top.id, 'md')}
          <a class="top-title" href="${albumHref(top.id)}">${esc(top.title)}</a>
          <p class="card-sub"><span class="pill">Album</span> ${esc(top.artist)}</p>
          <button class="card-play" data-action="play-album" data-id="${esc(top.id)}" aria-label="Play ${esc(top.title)}">${icon('play')}</button>
        </article>
      </section>
      <section>
        <h2 class="section-title">Artists</h2>
        <div class="artist-list">${
          artists.map((n) => `<a class="artist-chip" href="${artistHref(n)}"><span class="avatar sm" style="--h:${hueOf(n)}">${esc(n.trim()[0] || '?')}</span><span>${esc(n)}</span></a>`).join('') ||
          '<p class="muted">No individual artists in these results.</p>'
        }</div>
      </section>
    </div>
    <p class="muted result-count">${plural(total, 'album')} found</p>`;
  });
}

function renderGenre(r, key, params) {
  const g = key === 'all' ? { key: 'all', name: 'All music', hue: 24 } : GENRES.find((x) => x.key === key);
  if (!g) return renderNotFound();
  const sort = SORTS[params.get('sort')] ? params.get('sort') : 'popular';
  view.innerHTML = `
    <section class="banner" style="--h:${g.hue}">
      <span class="eyebrow">${key === 'all' ? 'Browse' : 'Genre'}</span>
      <h1>${esc(g.name)}</h1>
      <p class="sub" id="count">&nbsp;</p>
    </section>
    <div class="tabs" role="tablist">${Object.entries(SORTS)
      .map(([k, s]) => `<a role="tab" aria-selected="${k === sort}" class="tab ${k === sort ? 'active' : ''}" href="#/genre/${g.key}?sort=${k}">${esc(s.label)}</a>`)
      .join('')}</div>
    <div class="grid" id="grid">${skeletonCards(12)}</div>
    <div class="more-wrap" id="more"></div>`;
  return loadGrid(r, { genre: key === 'all' ? '' : key, sort }, (total) => {
    $('#count').textContent = `${plural(total, 'album')}`;
  });
}

async function renderAlbum(r, id) {
  view.innerHTML = `<section class="hero skeleton"><div class="art hero-art"></div><div class="hero-meta"><div class="sk-line"></div><div class="sk-line big"></div><div class="sk-line short"></div></div></section>`;
  let album;
  try {
    album = await getAlbum(id);
  } catch (err) {
    if (r.alive()) view.innerHTML = errorBlock(`Couldn't load this album. ${err.message || ''}`);
    return;
  }
  if (!r.alive()) return;

  const href = albumHref(album.id);
  pageCtx = { href, label: album.title, album };
  const lic = licenseLabel(album.license);
  const n = album.tracks.length;
  const sourceUrl = album.sourceUrl || itemUrl(album.id);
  const sourceName = album.sourceName || 'Internet Archive';
  const line = `<a class="strong" href="${album.artistHref || artistHref(album.artist)}">${esc(album.artist)}</a>${album.year ? ` • ${esc(album.year)}` : ''} • ${plural(n, 'song')}${
    album.duration ? `, ${fmtLong(album.duration)}` : ''
  }`;
  const fullAlbum = album.preview
    ? `<div class="info-line full-links"><span>Hear the full album on</span>${fullSongLinks(album.title, album.artist)
        .map((l) => `<a class="btn ghost sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ${icon('external')}</a>`)
        .join('')}</div>`
    : '';

  view.innerHTML = `
    ${hero({ seed: album.id, artHtml: art(album.coverLarge || album.cover, album.id, 'hero-art'), eyebrow: album.preview ? 'Album · Previews' : 'Album', title: album.title, line })}
    ${n ? actionsBar() : ''}
    ${fullAlbum}
    ${n ? trackRows(album.tracks, 'main') : `<div class="empty"><p>This release has no playable audio.</p><a class="btn ghost" href="${esc(sourceUrl)}" target="_blank" rel="noopener">Open on ${esc(sourceName)}</a></div>`}
    <section class="album-info">
      <div class="info-line">
        ${lic ? `<a class="license" href="${esc(album.license)}" target="_blank" rel="noopener license">${esc(lic)}</a>` : ''}
        ${album.preview ? `<span class="license">Official 30-second previews</span>` : ''}
        ${album.copyright ? `<span>${esc(album.copyright)}</span>` : ''}
        <a class="btn link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">Source: ${esc(sourceName)} ${icon('external')}</a>
      </div>
      ${album.tags.length ? `<div class="chips small">${album.tags.map((t) => `<a class="chip" href="#/search/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
      ${album.description ? `<p class="desc clamp" id="desc">${esc(album.description)}</p><button class="btn link" data-action="expand-desc">Show more</button>` : ''}
    </section>
    <div id="more-by"></div>
  `;

  if (!album.preview && album.artist && !/various/i.test(album.artist)) {
    try {
      const { albums } = await searchAlbums({ artist: album.artist, rows: 13 });
      const others = albums.filter((a) => a.id !== album.id).slice(0, 12);
      if (r.alive() && others.length) {
        $('#more-by').innerHTML = shelf(`More by ${album.artist}`, artistHref(album.artist), 'moreby', others.map(albumCard).join(''));
        refreshPlaying();
      }
    } catch {
      /* optional section */
    }
  }
}

async function renderMalayalam(r, params) {
  const q = (params.get('q') || '').trim();
  const tab = params.get('tab') === 'albums' ? 'albums' : 'songs';
  view.innerHTML = `
    <section class="banner" style="--h:150">
      <span class="eyebrow">Kerala · India</span>
      <h1>Malayalam</h1>
      <p class="sub">The biggest Malayalam film songs and albums. Songs play as official 30-second previews. Tap <b>Full song</b> to hear the whole track on Spotify, YouTube or JioSaavn.</p>
    </section>
    <form class="inline-search" id="ml-search" role="search">
      ${icon('search')}
      <input name="q" type="search" value="${esc(q)}" placeholder="Search Malayalam songs, films or singers…" aria-label="Search Malayalam music" autocomplete="off" />
      <button class="btn primary" type="submit">Search</button>
    </form>
    <div class="chips small scroll" aria-label="Popular Malayalam artists">${ML_ARTISTS.map(
      (n) => `<a class="chip ${n === q ? 'active' : ''}" href="#/malayalam?q=${encodeURIComponent(n)}">${esc(n)}</a>`
    ).join('')}</div>
    ${
      q
        ? ''
        : `<div class="tabs" role="tablist">
            <a role="tab" aria-selected="${tab === 'songs'}" class="tab ${tab === 'songs' ? 'active' : ''}" href="#/malayalam">Top songs</a>
            <a role="tab" aria-selected="${tab === 'albums'}" class="tab ${tab === 'albums' ? 'active' : ''}" href="#/malayalam?tab=albums">Top albums</a>
          </div>`
    }
    <div id="ml-body"><div class="more-wrap"><div class="spinner" aria-label="Loading"></div></div></div>`;

  const body = $('#ml-body');
  try {
    if (q) {
      const res = await searchMalayalam(q);
      if (!r.alive()) return;
      pageCtx = { href: `#/malayalam?q=${encodeURIComponent(q)}`, label: `Malayalam · ${q}` };
      if (!res.songs.length && !res.relatedSongs.length) {
        body.innerHTML = `<div class="empty big"><h2>No Malayalam songs found for “${esc(q)}”</h2><p>Try a film name, a singer or a composer, e.g. “Premam” or “Sushin Shyam”.</p></div>`;
        return;
      }
      body.innerHTML = res.songs.length
        ? `<h2 class="section-title">Songs</h2>${actionsBar({ menu: false })}${trackRows(res.songs.slice(0, 60), 'main', { showAlbum: true, showCover: true })}
           ${res.albums.length ? shelf('Albums', '', 'ml-albums', res.albums.slice(0, 20).map(albumCard).join('')) : ''}`
        : `<div class="empty"><p>Nothing tagged Malayalam for “${esc(q)}”. These related Indian results may still include it.</p></div>
           ${trackRows(res.relatedSongs.slice(0, 40), 'related', { showAlbum: true, showCover: true })}`;
    } else if (tab === 'albums') {
      const albums = await topAlbums(100);
      if (!r.alive()) return;
      body.innerHTML = `<div class="grid">${albums.map(albumCard).join('')}</div>`;
    } else {
      const songs = await topSongs(100);
      if (!r.alive()) return;
      pageCtx = { href: '#/malayalam', label: 'Top Malayalam songs' };
      body.innerHTML = `${actionsBar({ menu: true })}${trackRows(songs, 'main', { showAlbum: true, showCover: true })}`;
    }
    refreshPlaying();
  } catch (err) {
    if (r.alive()) body.innerHTML = errorBlock(err.message || 'Couldn’t load Malayalam music.');
  }
}

function renderArtist(r, name) {
  view.innerHTML = `
    <section class="hero" style="--h:${hueOf(name)}">
      <div class="avatar xl">${esc(name.trim()[0] || '?')}</div>
      <div class="hero-meta">
        <span class="eyebrow">Artist</span>
        <h1 class="${name.length > 22 ? 'mid' : ''}">${esc(name)}</h1>
        <p class="hero-line" id="count">&nbsp;</p>
      </div>
    </section>
    <div class="actions"><button class="play-btn lg" data-action="play-artist" aria-label="Play top release">${icon('play')}</button></div>
    <h2 class="section-title">Releases</h2>
    <div class="grid" id="grid">${skeletonCards(6)}</div>
    <div class="more-wrap" id="more"></div>`;
  return loadGrid(r, { artist: name }, (total) => {
    $('#count').textContent = total ? `${plural(total, 'release')}` : 'No releases found';
  });
}

function renderLibrary() {
  const { liked, playlists, recentAlbums } = store.state;
  view.innerHTML = `
    <h1 class="page-title">Your Library</h1>
    <div class="grid lib-grid">
      <article class="card liked-card">
        <div class="liked-card-body">
          <p class="liked-preview">${esc(liked.slice(0, 5).map((t) => `${t.title} — ${t.artist}`).join(' • ') || 'Tap the heart on any song to save it here.')}</p>
          <a class="card-title" href="#/liked">Liked Songs</a>
          <div class="card-sub">${plural(liked.length, 'liked song')}</div>
        </div>
      </article>
      ${playlists
        .map(
          (pl) => `<article class="card">
            ${mosaic(pl.tracks, pl.id)}
            <a class="card-title" href="#/playlist/${pl.id}">${esc(pl.name)}</a>
            <div class="card-sub">Playlist • ${plural(pl.tracks.length, 'song')}</div>
          </article>`
        )
        .join('')}
      <button class="card new-card" data-action="new-playlist"><span class="art">${icon('plus')}</span><span class="card-title">Create playlist</span></button>
    </div>
    <h2 class="section-title">Recently played</h2>
    ${recentAlbums.length ? `<div class="grid">${recentAlbums.map(albumCard).join('')}</div>` : '<p class="muted">Albums you play will show up here.</p>'}
  `;
}

function renderLiked() {
  const liked = store.state.liked;
  pageCtx = { href: '#/liked', label: 'Liked Songs' };
  const dur = liked.reduce((s, t) => s + (t.duration || 0), 0);
  view.innerHTML = `
    ${hero({
      seed: 'liked',
      artHtml: `<div class="art hero-art liked-art">${icon('heart-fill')}</div>`,
      eyebrow: 'Playlist',
      title: 'Liked Songs',
      line: `${plural(liked.length, 'song')}${dur ? `, ${fmtLong(dur)}` : ''}`,
    })}
    ${liked.length ? actionsBar({ menu: false }) + trackRows(liked, 'main', { showAlbum: true, showCover: true }) : `<div class="empty big"><h2>Songs you like will appear here</h2><p>Save songs by tapping the heart icon.</p><a class="btn primary" href="#/search">Find music</a></div>`}
  `;
}

function renderPlaylist(r, id) {
  const pl = store.getPlaylist(id);
  if (!pl) return renderNotFound('That playlist doesn’t exist (it may have been deleted).');
  pageCtx = { href: `#/playlist/${pl.id}`, label: pl.name, playlistId: pl.id };
  const dur = pl.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  view.innerHTML = `
    ${hero({
      seed: pl.id,
      artHtml: mosaic(pl.tracks, pl.id, 'hero-art'),
      eyebrow: 'Playlist',
      title: pl.name,
      line: `<span class="strong">You</span> • ${plural(pl.tracks.length, 'song')}${dur ? `, ${fmtLong(dur)}` : ''}`,
    })}
    ${
      pl.tracks.length
        ? actionsBar() + trackRows(pl.tracks, 'main', { showAlbum: true, showCover: true })
        : `<div class="actions"><button class="icon-btn lg" data-action="list-menu" aria-label="More options">${icon('more')}</button></div>
           <div class="empty big"><h2>Let’s find something for your playlist</h2><p>Open any album, then use <b>•••</b> → <b>Add to playlist</b> on a song.</p><a class="btn primary" href="#/search">Browse music</a></div>`
    }
  `;
}

function renderAbout() {
  view.innerHTML = `
    <article class="prose">
      <h1 class="page-title">About Openair</h1>
      <p>Openair is a free music streaming site. The free albums come from the <a href="https://archive.org/details/netlabels" target="_blank" rel="noopener">Netlabels collection</a> on the Internet Archive. Independent labels and artists put their music there under Creative Commons and other free licenses, so it can be streamed, shared and downloaded legally.</p>
      <p>Each album page shows its license. Many licenses are <em>non-commercial</em> or require <em>attribution</em>, so check the license before reusing a track in your own work.</p>
      <h2>Malayalam music</h2>
      <p>The <a href="#/malayalam">Malayalam</a> section uses Apple's public iTunes catalog for India. Those songs are copyrighted by their labels, so they play as the official 30-second previews Apple provides. Use <b>Full song</b> on any track to listen to the whole song on Spotify, YouTube or JioSaavn.</p>
      <h2>Your data</h2>
      <p>You don't need an account. Liked songs, playlists and history are saved only in this browser (localStorage), and nothing is sent to a server.</p>
      <p><button class="btn ghost" data-action="clear-data">${icon('trash')} Clear all my data</button></p>
      <h2>Keyboard shortcuts</h2>
      <dl class="shortcuts">
        <dt><kbd>Space</kbd></dt><dd>Play / pause</dd>
        <dt><kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd></dt><dd>Next / previous track</dd>
        <dt><kbd>→</kbd> / <kbd>←</kbd></dt><dd>Seek 5 seconds</dd>
        <dt><kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></dt><dd>Volume</dd>
        <dt><kbd>M</kbd></dt><dd>Mute</dd>
        <dt><kbd>L</kbd></dt><dd>Like current song</dd>
        <dt><kbd>Q</kbd></dt><dd>Show queue</dd>
        <dt><kbd>/</kbd></dt><dd>Search</dd>
      </dl>
    </article>`;
}

function renderNotFound(msg = 'We couldn’t find that page.') {
  view.innerHTML = `<div class="empty big"><h2>${esc(msg)}</h2><a class="btn primary" href="#/">Go home</a></div>`;
}

// =====================================================================
// Router
// =====================================================================
const routes = [
  [/^\/?$/, renderHome],
  [/^\/search(?:\/(.*))?$/, renderSearch],
  [/^\/genre\/([^/]+)$/, renderGenre],
  [/^\/album\/(.+)$/, renderAlbum],
  [/^\/artist\/(.+)$/, renderArtist],
  [/^\/library$/, renderLibrary],
  [/^\/liked$/, renderLiked],
  [/^\/playlist\/(.+)$/, renderPlaylist],
  [/^\/about$/, renderAbout],
  [/^\/malayalam$/, renderMalayalam],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const qi = raw.indexOf('?');
  return { path: qi >= 0 ? raw.slice(0, qi) : raw, params: new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '') };
}

async function route({ keepScroll = false } = {}) {
  const { path, params } = parseHash();
  const r = startRender();
  const scroll = main.scrollTop;
  updateNav(path);
  if (!path.startsWith('/search')) $('#search-input').value = '';
  if (!keepScroll) {
    closeNowPlaying();
    if (mobileMQ.matches) setQueueOpen(false);
  }
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    const args = m.slice(1).map((x) => (x == null ? '' : safeDecode(x)));
    const p = fn(r, ...args, params);
    main.scrollTop = keepScroll ? scroll : 0;
    refreshPlaying();
    await p;
    if (r.alive()) refreshPlaying();
    return;
  }
  renderNotFound();
}

function go(hash) {
  location.hash = hash;
}

function updateNav(path = parseHash().path) {
  const section =
    path === '/' || path === ''
      ? 'home'
      : path.startsWith('/malayalam')
      ? 'malayalam'
      : path.startsWith('/search') || path.startsWith('/genre')
      ? 'search'
      : path === '/liked'
      ? 'liked'
      : /^\/(library|playlist)/.test(path)
      ? 'library'
      : '';
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === section || (a.dataset.nav === 'library' && section === 'liked' && a.closest('.tabbar'));
    a.classList.toggle('active', !!on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  $$('#sidebar-playlists [data-pl]').forEach((a) => a.classList.toggle('active', path === `/playlist/${a.dataset.pl}`));
}

// =====================================================================
// Menus
// =====================================================================
let menuCleanup = null;
let menuAnchor = null;
let justClosed = null;

function openMenu(anchor, items) {
  if (justClosed && justClosed === anchor) {
    justClosed = null;
    return; // clicking the same button again closes the menu
  }
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = items
    .map((it, i) =>
      it.sep
        ? '<hr />'
        : it.heading
        ? `<div class="menu-heading">${esc(it.heading)}</div>`
        : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.sub ? icon('chevron-right', 'sub') : ''}</button>`
    )
    .join('');
  $('#menu-root').append(m);

  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const { offsetWidth: mw, offsetHeight: mh } = m;
  let left = rect.right - mw;
  if (left < 8) left = Math.min(rect.left, innerWidth - mw - 8);
  let top = rect.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
  m.style.left = `${Math.max(8, left)}px`;
  m.style.top = `${top}px`;

  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    e.stopPropagation();
    const it = items[+b.dataset.i];
    if (it.sub) {
      closeMenu();
      openMenu(anchor, it.sub());
    } else {
      closeMenu();
      it.run?.();
    }
  });
  m.addEventListener('keydown', (e) => {
    const btns = $$('button', m);
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') btns[(i + 1) % btns.length]?.focus();
    else if (e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length]?.focus();
    else return;
    e.preventDefault();
  });

  const onDown = (e) => {
    if (m.contains(e.target)) return;
    if (anchor instanceof Element && anchor.contains(e.target)) {
      justClosed = anchor;
      setTimeout(() => (justClosed = null), 500);
    }
    closeMenu();
  };
  const onKey = (e) => e.key === 'Escape' && closeMenu();
  // Close once the page really scrolls (ignore the tiny scroll a focus/click can cause).
  const startTop = main.scrollTop;
  const onScroll = (e) => (e?.type === 'resize' || Math.abs(main.scrollTop - startTop) > 24) && closeMenu();
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  main.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  menuAnchor = anchor;
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    main.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    m.remove();
    if (menuAnchor instanceof Element && m.contains(document.activeElement)) menuAnchor.focus();
  };
  m.querySelector('button')?.focus({ preventScroll: true });
}

function closeMenu() {
  const fn = menuCleanup;
  menuCleanup = null;
  fn?.();
}

function playlistPicker(tracks) {
  return [
    { heading: 'Add to playlist' },
    {
      label: 'New playlist',
      icon: 'plus',
      run: async () => {
        const name = await dialog({ title: 'New playlist', input: `My Playlist #${store.state.playlists.length + 1}`, confirm: 'Create' });
        if (!name) return;
        const pl = store.createPlaylist(name);
        store.addToPlaylist(pl.id, tracks);
        toast(`Added to ${pl.name}`);
      },
    },
    ...store.state.playlists.map((pl) => ({
      label: pl.name,
      icon: 'music',
      run: () => {
        const n = store.addToPlaylist(pl.id, tracks);
        toast(n === 0 ? `Already in ${pl.name}` : n === 1 ? `Added to ${pl.name}` : `Added ${n} songs to ${pl.name}`);
      },
    })),
  ];
}

/** "Hear the full song on …" menu items for preview tracks. */
function fullSongItems(t) {
  return [
    { heading: 'Hear the full song' },
    ...fullSongLinks(t.title, t.artist).map((l) => ({ label: `On ${l.label}`, icon: 'external', run: () => window.open(l.url, '_blank', 'noopener') })),
  ];
}

function trackMenu(track, playlistId) {
  const liked = store.isLiked(track.id);
  return [
    ...(track.preview ? [...fullSongItems(track), { sep: true }] : []),
    { label: 'Play next', icon: 'queue', run: () => (player.playNext([track]), toast('Playing next')) },
    { label: 'Add to queue', icon: 'plus', run: () => (player.enqueue([track]), toast('Added to queue')) },
    { label: 'Add to playlist', icon: 'library', sub: () => playlistPicker([track]) },
    playlistId && {
      label: 'Remove from this playlist',
      icon: 'trash',
      run: () => {
        store.removeFromPlaylist(playlistId, track.id);
        toast('Removed from playlist');
      },
    },
    { sep: true },
    { label: liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: liked ? 'heart-fill' : 'heart', run: () => toggleLike(track) },
    track.albumId && { label: 'Go to album', icon: 'music', run: () => go(albumHref(track.albumId)) },
    { label: 'Go to artist', icon: 'search', run: () => go(track.artistHref || artistHref(track.artist)) },
    !track.preview && { label: 'Open on Internet Archive', icon: 'external', run: () => window.open(itemUrl(track.albumId), '_blank', 'noopener') },
  ].filter(Boolean);
}

function listMenu() {
  const tracks = lists.main || [];
  const items = [];
  if (tracks.length) {
    items.push(
      { label: 'Add to queue', icon: 'queue', run: () => (player.enqueue(tracks), toast(`Added ${plural(tracks.length, 'song')} to queue`)) },
      { label: 'Add all to playlist', icon: 'library', sub: () => playlistPicker(tracks) }
    );
  }
  if (pageCtx?.album) {
    const a = pageCtx.album;
    items.push({ label: 'Go to artist', icon: 'search', run: () => go(a.artistHref || artistHref(a.artist)) });
    items.push({ label: `Open on ${a.sourceName || 'Internet Archive'}`, icon: 'external', run: () => window.open(a.sourceUrl || itemUrl(a.id), '_blank', 'noopener') });
  }
  const plId = pageCtx?.playlistId;
  if (plId) {
    items.push({ sep: true }, { label: 'Rename playlist', icon: 'edit', run: () => renamePlaylist(plId) }, { label: 'Delete playlist', icon: 'trash', danger: true, run: () => deletePlaylist(plId) });
  }
  return items;
}

async function renamePlaylist(id) {
  const pl = store.getPlaylist(id);
  if (!pl) return;
  const name = await dialog({ title: 'Rename playlist', input: pl.name, confirm: 'Save' });
  if (name) store.renamePlaylist(id, name);
}
async function deletePlaylist(id) {
  const pl = store.getPlaylist(id);
  if (!pl) return;
  const ok = await dialog({ title: `Delete “${pl.name}”?`, body: 'This will remove the playlist from your library. This can’t be undone.', confirm: 'Delete', danger: true });
  if (!ok) return;
  store.deletePlaylist(id);
  toast('Playlist deleted');
  if (parseHash().path === `/playlist/${id}`) go('#/library');
}
async function newPlaylist() {
  const name = await dialog({ title: 'New playlist', input: `My Playlist #${store.state.playlists.length + 1}`, confirm: 'Create' });
  if (!name) return;
  const pl = store.createPlaylist(name);
  go(`#/playlist/${pl.id}`);
}

// =====================================================================
// Actions
// =====================================================================
function toggleLike(track) {
  const added = store.toggleLike(track);
  toast(added ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
}

function rowTrack(row) {
  const list = lists[row.dataset.list];
  return list ? list[+row.dataset.index] : null;
}

function playFromList(list, index, key) {
  const ctx = key === 'main' ? pageCtx : null;
  player.playList(list, index, ctx && { href: ctx.href, label: ctx.label });
  if (ctx?.album) store.rememberAlbum(ctx.album);
}

function playRow(row) {
  const t = rowTrack(row);
  if (!t) return;
  if (player.isCurrent(t.id)) return player.toggle();
  playFromList(lists[row.dataset.list], +row.dataset.index, row.dataset.list);
}

async function playAlbum(id, btn) {
  const href = albumHref(id);
  if (player.context?.href === href && player.current) return player.toggle();
  btn?.classList.add('loading');
  try {
    const album = await getAlbum(id);
    if (!album.tracks.length) return toast('This release has no streamable audio');
    player.playList(album.tracks, 0, { href, label: album.title });
    store.rememberAlbum(album);
  } catch {
    toast('Couldn’t load that album. Please try again.');
  } finally {
    btn?.classList.remove('loading');
  }
}

const actions = {
  back: () => history.back(),
  forward: () => history.forward(),
  retry: () => route({ keepScroll: true }),
  'toggle-theme': () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', next, true);
    applyTheme();
  },
  toggle: () => (player.current ? player.toggle() : toast('Pick an album or song to start listening')),
  prev: () => player.prev(),
  next: () => player.next(),
  shuffle: () => {
    player.toggleShuffle();
    toast(player.shuffle ? 'Shuffle on' : 'Shuffle off');
  },
  repeat: () => {
    player.cycleRepeat();
    toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[player.repeat]);
  },
  mute: () => {
    if (player.audio.muted || player.audio.volume === 0) {
      if (player.audio.volume === 0) player.setVolume(0.5);
      player.setMuted(false);
    } else player.setMuted(true);
  },
  'like-current': () => player.current && toggleLike(player.current),
  'full-song': (el) => player.current?.preview && openMenu(el, fullSongItems(player.current)),
  'toggle-queue': () => {
    // On desktop the queue lives beside the page, so leave the full-screen view first.
    if (!mobileMQ.matches) closeNowPlaying();
    setQueueOpen($('#queue-panel').hidden);
  },
  'open-nowplaying': () => player.current && openNowPlaying(),
  'close-nowplaying': () => closeNowPlaying(),
  'new-playlist': () => newPlaylist(),
  'play-album': (el) => playAlbum(el.dataset.id, el),
  'play-artist': () => {
    const first = $('#grid [data-album]');
    if (first) playAlbum(first.dataset.album);
  },
  'play-list': () => {
    const list = lists.main || [];
    if (pageCtx && player.context?.href === pageCtx.href && player.current) return player.toggle();
    if (list.length) playFromList(list, 0, 'main');
  },
  'shuffle-list': () => {
    const list = lists.main || [];
    if (!list.length) return;
    if (!player.shuffle) player.toggleShuffle();
    playFromList(list, Math.floor(Math.random() * list.length), 'main');
  },
  like: (el) => {
    const row = el.closest('.row');
    const t = row ? rowTrack(row) : null;
    if (t) toggleLike(t);
  },
  'track-menu': (el) => {
    const row = el.closest('.row');
    const t = row && rowTrack(row);
    if (t) openMenu(el, trackMenu(t, row.dataset.list === 'main' ? pageCtx?.playlistId : null));
  },
  'list-menu': (el) => {
    const items = listMenu();
    if (items.length) openMenu(el, items);
  },
  'load-more': () => pageLoadMore?.(),
  'expand-desc': (el) => {
    const d = $('#desc');
    const open = d.classList.toggle('clamp');
    el.textContent = open ? 'Show more' : 'Show less';
  },
  'queue-jump': (el) => player.jumpTo(+el.dataset.pos),
  'queue-remove': (el) => player.removeAt(+el.dataset.pos),
  'queue-clear': () => player.clearUpNext(),
  'clear-data': async () => {
    const ok = await dialog({ title: 'Clear all data?', body: 'This deletes your liked songs, playlists and history from this browser.', confirm: 'Clear everything', danger: true });
    if (!ok) return;
    player.pause();
    store.reset();
    location.hash = '#/';
    location.reload();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  const link = e.target.closest('a[href]');
  if (el && link && el.contains(link) && el !== link) return; // a link inside an action area wins
  if (el) {
    e.preventDefault();
    actions[el.dataset.action]?.(el, e);
    return;
  }
  const row = e.target.closest('.row');
  if (row && !link) playRow(row);
});

document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row || e.target.closest('a')) return;
  const t = rowTrack(row);
  if (!t) return;
  e.preventDefault();
  openMenu({ x: e.clientX, y: e.clientY }, trackMenu(t, row.dataset.list === 'main' ? pageCtx?.playlistId : null));
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  if (e.key === 'Escape') {
    if (!$('#nowplaying').hidden) return closeNowPlaying();
    if (!$('#queue-panel').hidden && mobileMQ.matches) return setQueueOpen(false);
    if (typing) t.blur();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || t.closest('dialog') || t.closest('.menu')) return;

  if (e.key === 'Enter' && t.classList.contains('row')) {
    e.preventDefault();
    return playRow(t);
  }
  switch (e.key) {
    case ' ':
      e.preventDefault();
      actions.toggle();
      break;
    case 'ArrowRight':
      e.preventDefault();
      e.shiftKey ? player.next() : player.seekBy(5);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      e.shiftKey ? player.prev() : player.seekBy(-5);
      break;
    case 'ArrowUp':
    case 'ArrowDown':
      if (!e.shiftKey) break; // plain arrows keep scrolling the page
      e.preventDefault();
      player.setVolume(player.audio.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05));
      break;
    case 'm':
    case 'M':
      actions.mute();
      break;
    case 'l':
    case 'L':
      actions['like-current']();
      break;
    case 'q':
    case 'Q':
      actions['toggle-queue']();
      break;
    case '/':
      e.preventDefault();
      $('#search-input').focus();
      break;
  }
});

// Search box
{
  const input = $('#search-input');
  let timer;
  const submit = () => {
    const q = input.value.trim();
    const target = q ? `#/search/${encodeURIComponent(q)}` : '#/search';
    if (location.hash === target) return;
    if (parseHash().path.startsWith('/search')) {
      history.replaceState(null, '', target);
      route();
    } else go(target);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(submit, 380);
  });
  input.addEventListener('focus', () => {
    if (!parseHash().path.startsWith('/search') && !input.value) go('#/search');
  });
  // Malayalam page search (only runs on submit, to respect Apple's rate limit).
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'ml-search') return;
    e.preventDefault();
    const q = new FormData(e.target).get('q')?.toString().trim() || '';
    go(q ? `#/malayalam?q=${encodeURIComponent(q)}` : '#/malayalam');
    if (mobileMQ.matches) document.activeElement?.blur();
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    submit();
    if (mobileMQ.matches) input.blur();
  });
}

// =====================================================================
// Player UI
// =====================================================================
const ui = {
  player: $('#player'),
  npArt: $('#np-art'),
  npTitle: $('#np-title'),
  npArtist: $('#np-artist'),
  npLike: $('#np-like'),
  seek: $('#seek'),
  fsSeek: $('#fs-seek'),
  tCur: $('#t-cur'),
  tDur: $('#t-dur'),
  fsCur: $('#fs-cur'),
  fsDur: $('#fs-dur'),
  mini: $('#progress-mini-fill'),
  vol: $('#volume'),
  mute: $('#btn-mute'),
  queuePanel: $('#queue-panel'),
  queueBody: $('#queue-body'),
  np: $('#nowplaying'),
};
let seeking = false;

function setRange(el, fraction) {
  el.style.setProperty('--p', `${Math.max(0, Math.min(1, fraction)) * 100}%`);
}

function onTrack() {
  const t = player.current;
  ui.player.classList.toggle('empty', !t);
  if (!t) return;
  ui.npArt.innerHTML = art(t.cover, t.albumId);
  ui.npTitle.textContent = t.title;
  ui.npTitle.href = albumHref(t.albumId);
  ui.npArtist.textContent = t.artist;
  ui.npArtist.href = t.artistHref || artistHref(t.artist);
  ui.npLike.hidden = false;
  for (const b of $$('#btn-full, #fs-full')) b.hidden = !t.preview;
  $('#fs-art').innerHTML = art(t.coverLarge || t.cover, t.albumId);
  $('#fs-title').textContent = t.title;
  $('#fs-artist').textContent = t.artist;
  const ctx = player.context;
  $('#fs-context').innerHTML = ctx ? `Playing from <a href="${esc(ctx.href)}">${esc(ctx.label)}</a>` : 'Now playing';
  $('#nowplaying-bg').style.setProperty('--h', hueOf(t.albumId));
  $('#nowplaying-bg').style.backgroundImage = t.cover ? `url("${t.cover.replace(/"/g, '%22')}")` : 'none';
  document.title = `${t.title} · ${t.artist} — Openair`;
  refreshLikes();
  onTime();
}

function onState() {
  const playing = player.playing;
  for (const b of $$('#btn-play, #fs-play, .mobile-play')) {
    b.innerHTML = icon(playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  refreshPlaying();
}

function onTime() {
  if (seeking) return;
  const a = player.audio;
  const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : player.current?.duration || 0;
  const p = d ? a.currentTime / d : 0;
  for (const el of [ui.seek, ui.fsSeek]) {
    el.value = Math.round(p * 1000);
    setRange(el, p);
  }
  ui.tCur.textContent = ui.fsCur.textContent = fmtTime(a.currentTime);
  ui.tDur.textContent = ui.fsDur.textContent = fmtTime(d);
  ui.mini.style.width = `${p * 100}%`;
}

function onMode() {
  const rep = player.repeat;
  for (const b of $$('#btn-shuffle, #fs-shuffle')) {
    b.classList.toggle('on', player.shuffle);
    b.setAttribute('aria-pressed', player.shuffle);
  }
  for (const b of $$('#btn-repeat, #fs-repeat')) {
    b.classList.toggle('on', rep !== 'off');
    b.innerHTML = icon(rep === 'one' ? 'repeat-one' : 'repeat');
    b.title = { off: 'Enable repeat', all: 'Enable repeat one', one: 'Disable repeat' }[rep];
  }
}

function onVolume() {
  const a = player.audio;
  const v = a.muted ? 0 : a.volume;
  ui.vol.value = Math.round(v * 100);
  setRange(ui.vol, v);
  ui.mute.innerHTML = icon(v === 0 ? 'mute' : 'volume');
  ui.mute.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
}

function refreshLikes() {
  const cur = player.current;
  for (const b of [ui.npLike, $('#fs-like')]) {
    const liked = !!cur && store.isLiked(cur.id);
    b.classList.toggle('liked', liked);
    b.innerHTML = icon(liked ? 'heart-fill' : 'heart');
    b.setAttribute('aria-pressed', liked);
  }
  $$('.row .like-btn').forEach((b) => {
    const liked = store.isLiked(b.dataset.id);
    if (b.classList.contains('liked') === liked) return;
    b.classList.toggle('liked', liked);
    b.innerHTML = icon(liked ? 'heart-fill' : 'heart');
    b.setAttribute('aria-pressed', liked);
    b.setAttribute('aria-label', `${liked ? 'Remove from' : 'Save to'} Liked Songs`);
  });
}

/** Update "now playing" markers on rows, cards and big play buttons. */
function refreshPlaying() {
  const cur = player.current;
  const ctx = player.context;
  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);
  $$('.row').forEach((row) => row.classList.toggle('current', !!cur && row.dataset.track === cur.id));
  $$('.card-play').forEach((b) => {
    const on = playing && ctx?.href === albumHref(b.dataset.id);
    if (b.dataset.on === String(on)) return;
    b.dataset.on = String(on);
    b.classList.toggle('active', on);
    b.innerHTML = icon(on ? 'pause' : 'play');
  });
  const pageOn = playing && !!pageCtx && ctx?.href === pageCtx.href;
  $$('[data-action="play-list"]').forEach((b) => {
    b.innerHTML = icon(pageOn ? 'pause' : 'play');
    b.setAttribute('aria-label', pageOn ? 'Pause' : 'Play');
  });
}

function renderQueue() {
  if (ui.queuePanel.hidden) return;
  const cur = player.current;
  if (!cur) {
    ui.queueBody.innerHTML = '<div class="empty"><p>Your queue is empty.</p><p class="muted">Play an album or song and it will show up here.</p></div>';
    return;
  }
  const ctx = player.context;
  const next = player.upNext.slice(0, 200);
  const item = (t, pos, now = false) => `<div class="q-item ${now ? 'now' : ''}" ${now ? '' : `data-action="queue-jump" data-pos="${pos}"`} role="button" tabindex="0">
      ${art(t.cover, t.albumId, 'xs')}
      <span class="row-text"><span class="row-title">${esc(t.title)}</span><span class="row-artist">${esc(t.artist)}</span></span>
      ${now ? '' : `<button class="icon-btn sm" data-action="queue-remove" data-pos="${pos}" aria-label="Remove from queue">${icon('close')}</button>`}
    </div>`;
  ui.queueBody.innerHTML = `
    <h3>Now playing</h3>
    ${item(cur, -1, true)}
    <div class="q-head"><h3>Next ${ctx ? `from <a href="${esc(ctx.href)}">${esc(ctx.label)}</a>` : 'up'}</h3>${next.length ? '<button class="btn link" data-action="queue-clear">Clear</button>' : ''}</div>
    ${next.length ? next.map(({ track, pos }) => item(track, pos)).join('') : '<p class="muted">Nothing else queued. Add songs with ••• → Add to queue.</p>'}`;
}

function setQueueOpen(open) {
  ui.queuePanel.hidden = !open;
  $('#btn-queue').classList.toggle('on', open);
  document.body.classList.toggle('queue-open', open);
  if (open) renderQueue();
}

function openNowPlaying() {
  ui.np.hidden = false;
  document.body.classList.add('np-open');
}
function closeNowPlaying() {
  if (ui.np.hidden) return;
  ui.np.hidden = true;
  document.body.classList.remove('np-open');
}

for (const el of [ui.seek, ui.fsSeek]) {
  el.addEventListener('input', () => {
    seeking = true;
    const p = el.value / 1000;
    setRange(el, p);
    const d = player.audio.duration || player.current?.duration || 0;
    ui.tCur.textContent = ui.fsCur.textContent = fmtTime(p * d);
  });
  el.addEventListener('change', () => {
    player.seek(el.value / 1000);
    seeking = false;
    onTime();
  });
}
ui.vol.addEventListener('input', () => {
  player.setVolume(ui.vol.value / 100);
  if (player.audio.muted && ui.vol.value > 0) player.setMuted(false);
});

player.subscribe((type) => {
  if (type === 'track') onTrack();
  else if (type === 'state') onState();
  else if (type === 'time') onTime();
  else if (type === 'mode') onMode();
  else if (type === 'volume') onVolume();
  else if (type === 'queue') renderQueue();
  else if (type === 'error') toast('Couldn’t play this track — skipping');
  if (type === 'track' || type === 'queue') refreshPlaying();
});

// =====================================================================
// Sidebar, theme & store reactions
// =====================================================================
function renderSidebar() {
  const { liked, playlists } = store.state;
  $('#liked-count').textContent = plural(liked.length, 'song');
  $('#sidebar-playlists').innerHTML =
    playlists
      .map(
        (pl) => `<a class="side-item" href="#/playlist/${pl.id}" data-pl="${pl.id}">${mosaic(pl.tracks, pl.id, 'side-art')}
        <span class="side-text"><b>${esc(pl.name)}</b><small>Playlist • ${plural(pl.tracks.length, 'song')}</small></span></a>`
      )
      .join('') || '<p class="side-empty">Create a playlist to collect your favorite songs.</p>';
  updateNav();
}

function applyTheme() {
  const t = store.state.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === 'light' ? '#f6f4f1' : '#0f1014';
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

store.subscribe((type) => {
  const { path } = parseHash();
  if (type === 'liked') {
    refreshLikes();
    renderSidebar();
    if (path === '/liked' || path === '/library') route({ keepScroll: true });
  } else if (type === 'playlists') {
    renderSidebar();
    if (path === '/library' || path.startsWith('/playlist/')) route({ keepScroll: true });
  }
});

main.addEventListener('scroll', () => main.classList.toggle('scrolled', main.scrollTop > 8), { passive: true });

// =====================================================================
// Boot
// =====================================================================
applyTheme();
renderSidebar();
onMode();
onVolume();
onState();
ui.player.classList.add('empty');
player.restore();
window.addEventListener('hashchange', () => route());
route();
