// Music catalog backed by the Internet Archive's "netlabels" collection:
// tens of thousands of albums released by independent labels under
// Creative Commons / free licenses. No API key needed, CORS enabled.

const IA = 'https://archive.org';
// Skip label back-catalog dumps, spoken-word releases and the (very popular, but not music)
// numbers-station archive so browsing stays focused on music.
const BASE_QUERY = [
  'collection:netlabels',
  'mediatype:audio',
  '-title:(discography)',
  '-identifier:(ird059)',
  '-subject:(podcast OR "spoken word" OR audiobook OR poetry OR reading OR lecture OR interview)',
].join(' AND ');
const FIELDS = ['identifier', 'title', 'creator', 'date', 'year', 'downloads', 'licenseurl', 'subject'];

export const GENRES = [
  { key: 'lofi', name: 'Lo-fi & Beats', q: 'subject:(lofi OR "lo-fi" OR beats)', hue: 18 },
  { key: 'electronic', name: 'Electronic', q: 'subject:(electronic OR electronica OR techno OR house)', hue: 265 },
  { key: 'ambient', name: 'Ambient', q: 'subject:(ambient OR drone)', hue: 195 },
  { key: 'jazz', name: 'Jazz', q: 'subject:(jazz)', hue: 40 },
  { key: 'hiphop', name: 'Hip-Hop', q: 'subject:("hip-hop" OR "hip hop" OR rap)', hue: 335 },
  { key: 'rock', name: 'Rock & Indie', q: 'subject:(rock OR indie OR punk)', hue: 0 },
  { key: 'chill', name: 'Chill & Downtempo', q: 'subject:(downtempo OR chillout OR chill OR trip-hop)', hue: 160 },
  { key: 'experimental', name: 'Experimental', q: 'subject:(experimental OR noise OR idm)', hue: 290 },
  { key: 'chiptune', name: 'Chiptune', q: 'subject:(chiptune OR 8bit OR "8-bit")', hue: 120 },
  { key: 'classical', name: 'Piano & Classical', q: 'subject:(piano OR classical OR "modern classical")', hue: 220 },
  { key: 'folk', name: 'Folk & Acoustic', q: 'subject:(folk OR acoustic OR singer-songwriter)', hue: 80 },
  { key: 'dub', name: 'Dub & Reggae', q: 'subject:(dub OR reggae OR dubstep)', hue: 140 },
];

export const SORTS = {
  popular: { label: 'Most played', sort: 'downloads desc' },
  trending: { label: 'Trending this week', sort: 'week desc' },
  newest: { label: 'Newest', sort: 'publicdate desc' },
};

const cache = new Map();

async function getJSON(url, { signal } = {}) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { signal }).then((r) => {
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    return r.json();
  });
  cache.set(url, p);
  try {
    return await p;
  } catch (err) {
    cache.delete(url);
    throw err;
  }
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const joinNames = (v) => (Array.isArray(v) ? v.join(', ') : v);

/** Strip Lucene syntax from free text so user input can't break the query. */
export function cleanQuery(text) {
  return String(text || '')
    .replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const coverUrl = (id) => `${IA}/services/img/${encodeURIComponent(id)}`;
export const itemUrl = (id) => `${IA}/details/${encodeURIComponent(id)}`;

function normalizeAlbum(doc) {
  const year = first(doc.year) || (first(doc.date) || '').slice(0, 4);
  return {
    id: doc.identifier,
    title: tidyTitle(first(doc.title) || doc.identifier),
    artist: joinNames(doc.creator) || 'Various Artists',
    year: year || '',
    plays: doc.downloads || 0,
    license: doc.licenseurl || '',
    cover: coverUrl(doc.identifier),
  };
}

// Many netlabel titles carry catalog numbers like "[DWK123]" or "(ca200)".
function tidyTitle(t) {
  const cleaned = String(t)
    .replace(/\s*[[(][a-z]{1,8}[\s_-]?\d{1,5}[\])]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(t);
}

/**
 * Search albums.
 * @param {object} o
 * @param {string} [o.text]   free-text query
 * @param {string} [o.genre]  key from GENRES
 * @param {string} [o.artist] exact creator
 * @param {string} [o.sort]   key from SORTS
 */
export async function searchAlbums({ text = '', genre = '', artist = '', sort = 'popular', rows = 24, page = 1, signal } = {}) {
  const parts = [BASE_QUERY];
  const t = cleanQuery(text);
  if (t) parts.push(`(${t})`);
  const g = GENRES.find((x) => x.key === genre);
  if (g) parts.push(g.q);
  if (artist) parts.push(`creator:("${artist.replace(/["\\]/g, '')}")`);

  const params = new URLSearchParams();
  params.set('q', parts.join(' AND '));
  FIELDS.forEach((f) => params.append('fl[]', f));
  params.append('sort[]', (SORTS[sort] || SORTS.popular).sort);
  params.set('rows', String(rows));
  params.set('page', String(page));
  params.set('output', 'json');

  const data = await getJSON(`${IA}/advancedsearch.php?${params}`, { signal });
  const res = data.response || { docs: [], numFound: 0 };
  return { total: res.numFound, albums: res.docs.map(normalizeAlbum) };
}

// ---------- Album details & tracks ----------

function parseDuration(len) {
  if (!len) return 0;
  const s = String(len);
  if (s.includes(':')) return s.split(':').reduce((acc, n) => acc * 60 + (parseFloat(n) || 0), 0);
  return parseFloat(s) || 0;
}

function prettifyName(name) {
  return name
    .split('/').pop()
    .replace(/\.[^.]+$/, '')
    .replace(/_(64kb|128kb|vbr)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/^\s*\d{1,3}\s*[-.)]?\s*/, '')
    .replace(/\s+-\s+/g, ' – ')
    .trim();
}

const encodePath = (name) => name.split('/').map(encodeURIComponent).join('/');

function pickAudioFiles(files) {
  const isMp3 = (f) => /mp3/i.test(f.format || '') || /\.mp3$/i.test(f.name);
  const isOgg = (f) => /ogg/i.test(f.format || '') || /\.ogg$/i.test(f.name);
  let pool = files.filter(isMp3);
  if (!pool.length) pool = files.filter(isOgg);

  // Several encodings of the same song can exist; keep the best one per song.
  const score = (f) =>
    (f.source === 'original' ? 10 : 0) +
    (/vbr|320|256/i.test(f.format || '') ? 3 : /128/.test(f.format || '') ? 2 : 1);
  const bySong = new Map();
  for (const f of pool) {
    const stem = f.name.replace(/\.[^/.]+$/, '').replace(/_(64kb|128kb|vbr)$/i, '').toLowerCase();
    const prev = bySong.get(stem);
    if (!prev || score(f) > score(prev)) bySong.set(stem, f);
  }
  return [...bySong.values()];
}

export async function getAlbum(id, { signal } = {}) {
  const data = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`, { signal });
  if (!data || !data.metadata) throw new Error('Album not found');
  const md = data.metadata;
  const album = normalizeAlbum({ ...md, identifier: md.identifier || id, downloads: data.item?.downloads });
  album.description = stripHtml(first(md.description) || '');
  album.tags = String(joinNames(md.subject) || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  // A larger cover for the album header / now-playing view, if a reasonably sized one exists.
  const img = (data.files || []).find(
    (f) => f.source === 'original' && /^(jpe?g|png)$/i.test(f.format || '') && !/spectrogram|thumb/i.test(f.name) && +f.size < 1_500_000
  );
  if (img) album.coverLarge = `${IA}/download/${encodeURIComponent(album.id)}/${encodePath(img.name)}`;

  const files = pickAudioFiles(data.files || []);
  const tracks = files.map((f, i) => {
    const tn = parseInt(String(f.track || '').split('/')[0], 10);
    return {
      id: `${album.id}/${f.name}`,
      title: (f.title && String(first(f.title)).trim()) || prettifyName(f.name),
      artist: joinNames(f.artist || f.creator) || album.artist,
      album: album.title,
      albumId: album.id,
      cover: album.cover,
      coverLarge: album.coverLarge || '',
      duration: parseDuration(f.length),
      src: `${IA}/download/${encodeURIComponent(album.id)}/${encodePath(f.name)}`,
      _n: Number.isFinite(tn) ? tn : null,
      _name: f.name,
      _i: i,
    };
  });

  const allNumbered = tracks.length && tracks.every((t) => t._n !== null);
  tracks.sort((a, b) =>
    allNumbered && a._n !== b._n
      ? a._n - b._n
      : a._name.localeCompare(b._name, undefined, { numeric: true, sensitivity: 'base' })
  );
  album.tracks = tracks.map(({ _n, _name, _i, ...t }) => t);
  album.duration = album.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return album;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Turn a Creative Commons license URL into a short human label. */
export function licenseLabel(url) {
  if (!url) return '';
  const m = String(url).match(/licenses\/([a-z-]+)\/(\d(?:\.\d)?)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  if (/publicdomain\/zero/i.test(url)) return 'CC0 Public Domain';
  if (/publicdomain/i.test(url)) return 'Public Domain';
  return 'Free license';
}
