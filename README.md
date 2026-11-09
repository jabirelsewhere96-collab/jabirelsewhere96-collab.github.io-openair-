# Openair — free music streaming website

Openair is a music streaming web app that works without an account, ads or a paywall. Every song is
**free and legal to stream**: it comes from the
[Netlabels collection](https://archive.org/details/netlabels) on the Internet Archive,
where independent labels publish their releases under Creative Commons and other free licenses
(about 77,000 albums).

It's a static site: plain HTML, CSS and JavaScript with no build step, no server and no API keys.

### Malayalam section

The **Malayalam** page (`#/malayalam`) shows Apple Music India's top Malayalam songs and albums,
and lets visitors search by film, singer or composer. It uses Apple's public iTunes catalog
(`js/apple.js`), which needs no key. The songs are copyrighted, so they play as the **official
30-second previews** Apple provides. Every song has a **Full song** button that opens the complete
track on Spotify, YouTube or JioSaavn. Apple allows about 20 searches a minute per visitor, so the
Malayalam search only runs when the visitor presses Search.

## Features

- **Home** has time-of-day greetings, "Trending this week", "All-time favorites" and genre rows
- **Search** across albums, artists and genres, plus a "Browse all" genre grid
- **Genre pages** can be sorted by most played, trending or newest, with "Load more"
- **Album pages** show the cover, tracklist, license badge, tags, description and "More by this artist"
- **Artist pages** list all of an artist's releases
- **Player** with play/pause, next/previous, seek, volume, mute, shuffle, and repeat (off/all/one)
- **Queue** with Play next, Add to queue, jump to a song, remove a song and clear
- **Liked Songs** and **playlists** (create, rename, delete, add and remove songs)
- **Recently played**, and your last queue and position come back after a page reload
- **Full-screen "Now playing" view**
- **Lock-screen and media-key controls** via the Media Session API
- **Light/dark theme** that follows the system and can be toggled
- **Mobile layout** with a bottom tab bar and mini-player; on desktop, a sidebar and queue panel
- **Keyboard shortcuts**: `Space` play/pause, `←/→` seek, `Shift+←/→` previous/next,
  `Shift+↑/↓` volume, `M` mute, `L` like, `Q` queue, `/` search
- Right-click any song for its menu

Likes, playlists and history are saved in the visitor's browser (`localStorage`). Nothing is
sent to a server.

## Run it locally

Any static file server works. From this folder:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

(Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.)

## Put it online (free)

All of these host a static site at no cost:

- **GitHub Pages**: push this folder to a repo, then go to *Settings → Pages → Deploy from branch*.
- **Netlify** or **Cloudflare Pages**: drag and drop the folder, or connect the repo. There's no build command, and the publish directory is `/`.
- **Vercel**: `npx vercel` in this folder.

The app uses hash URLs (`#/album/...`), so you don't need any server rewrite rules.

## Project structure

```
index.html        App shell: sidebar, top bar, player bar, now-playing view, icon sprite
css/styles.css    All styling: theme tokens, layout, components, mobile breakpoints
js/api.js         Internet Archive client: search, album and track parsing, genres, licenses
js/apple.js       Malayalam music from Apple's iTunes catalog: charts, search, albums, previews
js/player.js      Audio engine: queue, shuffle, repeat, media session, session restore
js/store.js       Persistent state: likes, playlists, history, settings
js/app.js         Router, pages, menus, dialogs and player UI
```

## Customizing

- **Name and colors**: change "Openair" in `index.html` and `js/app.js`. Colors are CSS variables
  at the top of `css/styles.css` (`--accent`, `--bg`, `--panel`, …).
- **Genres**: edit the `GENRES` list in `js/api.js`. Each genre is just an Internet Archive subject query.
- **Home rows**: edit `HOME_SHELVES` in `js/app.js`.
- **Catalog filter**: `BASE_QUERY` in `js/api.js` controls what counts as music. It currently
  excludes spoken word, podcasts and label discography dumps.

## Licensing notes

- Each album page shows its license (e.g. *CC BY-NC-SA 3.0*) and links to its source page.
  Streaming and linking are fine under these licenses. Some are **NonCommercial**, so if you
  put ads or a paywall on the site, filter the catalog to licenses that allow commercial use.
- Audio and covers are served directly from archive.org. Openair isn't affiliated with the
  Internet Archive. Please keep the source links and consider
  [donating to them](https://archive.org/donate) if your site gets real traffic.

## Ideas for next steps

- User accounts with cloud sync for playlists (e.g. Supabase or Firebase)
- Let artists upload their own music (needs storage plus a backend)
- Make it an installable PWA with offline caching for liked songs
- Add other free catalogs, e.g. Jamendo (needs a free API key)
