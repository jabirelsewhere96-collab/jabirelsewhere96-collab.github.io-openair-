// Malayalam music from Apple's public iTunes catalog (India store).
// Free, no API key, CORS-enabled. Songs are copyrighted, so they play as the
// official 30-second previews Apple provides for promotion; every song also
// links out to the full track on licensed services (Spotify, YouTube, JioSaavn).
//
// Apple allows roughly 20 requests per minute per visitor, so everything is
// cached and searches only run when the visitor submits them.

const API = 'https://itunes.apple.com';
const STORE = 'in';
const GENRE_MALAYALAM = 100035;
// Genres that sometimes hold Malayalam releases that aren't tagged "Malayalam".
const RELATED_GENRES = new Set(['Regional Indian', 'Soundtrack', 'Indian', 'Indian Pop', 'Indian Folk', 'Devotional & Spiritual', 'Indian Classical']);

export const ML_ARTISTS = [
  'Sushin Shyam',
  'Gopi Sundar',
  'K. S. Chithra',
  'K. J. Yesudas',
  'Shaan Rahman',
  'Jakes Bejoy',
  'Vineeth Sreenivasan',
  'Sithara Krishnakumar',
  'Hesham Abdul Wahab',
  'Justin Varghese',
  'Vidyasagar',
  'M. G. Sreekumar',
];

const cache = new Map();
async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const busy = 'Apple’s music catalog is busy (it allows about 20 searches a minute). Wait a minute and try again.';
  const p = fetch(url)
    // When Apple rate-limits, the response lacks CORS headers, so fetch itself fails.
    .catch(() => {
      throw new Error(navigator.onLine === false ? 'You’re offline. Check your connection and try again.' : busy);
    })
    .then((r) => {
      if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? busy : `Request failed (${r.status})`);
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

/** Resize an Apple artwork URL (…/100x100bb.jpg) to the given square size. */
const artwork = (url, size) => String(url || '').replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.jpg`);

function tidyAlbum(name) {
  return String(name || '')
    .replace(/\s*\((Original )?(Motion Picture )?Soundtrack\)/i, '')
    .replace(/\s*-\s*(Single|EP)$/i, '')
    .trim();
}

/** Search link for an artist inside the Malayalam section. */
const mlArtistHref = (name) => `#/malayalam?q=${encodeURIComponent(String(name).split(/,|&/)[0].trim())}`;

function trackFromApi(r) {
  return {
    id: `am:${r.trackId}`,
    title: r.trackName,
    artist: r.artistName,
    album: tidyAlbum(r.collectionName),
    albumId: `am:${r.collectionId}`,
    cover: artwork(r.artworkUrl100, 300),
    coverLarge: artwork(r.artworkUrl100, 600),
    duration: 30,
    src: r.previewUrl,
    preview: true,
    artistHref: mlArtistHref(r.artistName),
  };
}

function albumFromApi(r) {
  return {
    id: `am:${r.collectionId}`,
    title: tidyAlbum(r.collectionName),
    artist: r.artistName,
    year: (r.releaseDate || '').slice(0, 4),
    cover: artwork(r.artworkUrl100, 300),
  };
}

// ----- Charts (Apple Music India, Malayalam genre) -----
const feedUrl = (kind, limit) => `${API}/${STORE}/rss/${kind}/limit=${limit}/genre=${GENRE_MALAYALAM}/json`;
const label = (x) => x?.label || '';
const imgOf = (e) => label((e['im:image'] || []).slice(-1)[0]);

export async function topAlbums(limit = 100) {
  const d = await getJSON(feedUrl('topalbums', limit));
  return (d.feed?.entry || []).map((e) => ({
    id: `am:${e.id.attributes['im:id']}`,
    title: tidyAlbum(label(e['im:name'])),
    artist: label(e['im:artist']),
    year: label(e['im:releaseDate']).slice(0, 4),
    cover: artwork(imgOf(e), 300),
  }));
}

export async function topSongs(limit = 100) {
  const d = await getJSON(feedUrl('topsongs', limit));
  return (d.feed?.entry || [])
    .map((e) => {
      const links = Array.isArray(e.link) ? e.link : [e.link];
      const preview = links.find((l) => l?.attributes?.['im:assetType'] === 'preview');
      const albumLink = e['im:collection']?.link?.attributes?.href || '';
      const collectionId = (albumLink.match(/\/(\d+)(?:\?|$)/) || [])[1];
      const artist = label(e['im:artist']);
      return {
        id: `am:${e.id.attributes['im:id']}`,
        title: label(e['im:name']),
        artist,
        album: tidyAlbum(label(e['im:collection']?.['im:name'])),
        albumId: collectionId ? `am:${collectionId}` : '',
        cover: artwork(imgOf(e), 300),
        coverLarge: artwork(imgOf(e), 600),
        duration: 30,
        src: preview?.attributes?.href || '',
        preview: true,
        artistHref: mlArtistHref(artist),
      };
    })
    .filter((t) => t.src);
}

// ----- Search -----
/**
 * One request per search. Returns Malayalam-tagged songs/albums first, plus
 * "related" Indian results that may be Malayalam but aren't tagged as such.
 */
export async function searchMalayalam(text) {
  const term = encodeURIComponent(String(text).trim());
  const d = await getJSON(`${API}/search?term=${term}&country=${STORE.toUpperCase()}&media=music&entity=song&limit=200`);
  const songs = (d.results || []).filter((r) => r.wrapperType === 'track' && r.previewUrl);
  const ml = songs.filter((r) => r.primaryGenreName === 'Malayalam');
  const related = songs.filter((r) => RELATED_GENRES.has(r.primaryGenreName));
  const albumsOf = (list) => {
    const seen = new Map();
    for (const r of list) if (!seen.has(r.collectionId)) seen.set(r.collectionId, albumFromApi(r));
    return [...seen.values()];
  };
  return {
    songs: ml.map(trackFromApi),
    albums: albumsOf(ml),
    relatedSongs: related.map(trackFromApi),
  };
}

// ----- Album -----
export async function getAppleAlbum(id) {
  const num = String(id).replace(/^am:/, '');
  const d = await getJSON(`${API}/lookup?id=${encodeURIComponent(num)}&entity=song&country=${STORE.toUpperCase()}&limit=200`);
  const coll = (d.results || []).find((r) => r.wrapperType === 'collection');
  if (!coll) throw new Error('Album not found');
  const tracks = (d.results || [])
    .filter((r) => r.wrapperType === 'track' && r.previewUrl)
    .sort((a, b) => (a.discNumber || 0) - (b.discNumber || 0) || (a.trackNumber || 0) - (b.trackNumber || 0))
    .map(trackFromApi);
  return {
    id: `am:${coll.collectionId}`,
    title: tidyAlbum(coll.collectionName),
    artist: coll.artistName,
    year: (coll.releaseDate || '').slice(0, 4),
    cover: artwork(coll.artworkUrl100, 300),
    coverLarge: artwork(coll.artworkUrl100, 600),
    tracks,
    duration: 0,
    license: '',
    description: '',
    tags: [],
    preview: true,
    copyright: coll.copyright || '',
    sourceUrl: coll.collectionViewUrl || '',
    sourceName: 'Apple Music',
    artistHref: mlArtistHref(coll.artistName),
  };
}

/** Links to hear the complete song (or album) on licensed services. */
export function fullSongLinks(title, artist) {
  const q = encodeURIComponent(`${title} ${String(artist).split(/,|&/)[0]}`.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim());
  return [
    { label: 'Spotify', url: `https://open.spotify.com/search/${q}` },
    { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${q}` },
    { label: 'JioSaavn', url: `https://www.jiosaavn.com/search/${q}` },
  ];
}
