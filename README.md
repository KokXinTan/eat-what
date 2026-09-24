# Eat What?

Can't decide where to eat? Tap **Show me food nearby** and get a photo board of what's good
around you. Tap every place that tempts you (tap again to un-pick), then decide in one tap — or
let 🎲 fate pick from your shortlist.

- **Photo-first board.** Big photos with name, cuisine, rating, distance and price on each tile;
  ⓘ opens more photos, dishes and reviews. Cuisine chips (with counts), sorting (best match /
  nearest / top rated), local-gem and closed badges, and more places — including niche ones like
  kopitiams and hawker stalls — load as you scroll.
- **Decision tray.** Your picks collect at the bottom: **Decide** shows your shortlist to choose
  from, 🎲 picks one at random. **Just pick for me** on the start screen skips straight to it.
- **One screen, minimal typing.** Distance (walk / nearby / drive) and budget ($–$$$) are
  one-tap chips. Everything else is optional.
- **Real restaurants near you.** Free [OpenStreetMap](https://www.openstreetmap.org) data for
  everyone; Google Maps data (photos, ratings, prices, open now, reviews) for people with an
  access code, served through a private Cloudflare Worker so the key is never public.
- **Never repeats what you just skipped**, brings back 👍 favourites, avoids 👎 ones, and
  prefers a change from your last pick.
- **Dietary needs** (halal, no pork, no beef, vegetarian, vegan): clear clashes are hidden;
  anything map data can't confirm is marked **unverified**, never "safe".
- **Pick together, live:** start a session and share the link. Everyone taps places on the same
  board from their own phone and sees everyone else's picks as coloured initials on the photos,
  with a live "🔥 most wanted" leaderboard. If everyone taps the same place — instant match. Or
  the host starts a 60-second countdown: when it ends, the most-wanted place wins. People with an
  access code join instantly; anyone else waits until the host taps **Let in**. Everyone's
  diets apply to the whole group. Sessions delete themselves after 6 hours.
- **Or choose on one phone:** add friends' diets and budgets; picks must suit everyone.
- **Private by default:** settings and picks live in this browser only (export/import JSON
  backup in Settings). Your location is sent to the map service to search, and isn't stored.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # ranking, diet, OSM parsing and backup tests
```

Location needs `localhost` or HTTPS. If location is off, the app asks for an area name instead.

## Hosting, in brief

It's a static site plus an optional Cloudflare Worker. No server to run.

| You want | You need | Cost |
| --- | --- | --- |
| The app with free OpenStreetMap data | Any static host (GitHub Pages, Netlify…) | Free |
| Google photos, ratings, prices, hours | + the Worker in `worker/` holding your Google key | Free tiers¹ |
| Pick together on several phones | + the same Worker (rooms live in it) | Free tier |

¹ Cloudflare's free plan; Google gives a monthly free allowance (see *Protection layers*).

Quick path: fork → enable **GitHub Pages (GitHub Actions)** → push. For Google data and groups,
also do the Worker setup below, set the `PLACES_PROXY_URL` variable, and push again.

## Optional: Google Maps data (via a private Cloudflare Worker)

Free OpenStreetMap works out of the box. For Google photos, ratings, prices and opening hours,
the app talks to a small Cloudflare Worker in `worker/` that holds the Google key — **the key
never reaches the website or the repo**. Visitors need an **access code** (one per person, so you
can revoke anyone); without one they still get the free OpenStreetMap version.

One-time setup (free Cloudflare plan is plenty):

1. Google Cloud: enable **Places API (New)**; create a key with **API restriction → Places API
   (New)** only and **Application restriction → None** (calls come from Cloudflare, not browsers).
   Set daily quota caps (e.g. ~30 searches, ~30 photos) as a final backstop.
2. `npx wrangler login` (opens the browser once).
3. `npx wrangler secret put GOOGLE_MAPS_API_KEY --config worker/wrangler.toml` — paste the key.
4. Set your access codes (see [Access codes](#access-codes)).
5. Add your site's origin to `ALLOWED_ORIGINS` in `worker/wrangler.toml` (e.g.
   `https://<user>.github.io`), then `npm run worker:deploy` and note the
   `https://eat-what-places.<you>.workers.dev` URL.
6. Local dev: put that URL in `.env.local` as `VITE_PLACES_PROXY_URL=...`.
   GitHub: **Settings → Secrets and variables → Actions → Variables** → `PLACES_PROXY_URL`.

### Access codes

A code unlocks Google data on a phone, lets that person start a group, and lets them join
groups without waiting for approval. Give each person their own code so you can revoke one
without affecting the others. Codes are a comma-separated list in the Worker secret
`ACCESS_CODES`. They are never in the repo or the website.

**Set or change them**, either way (no redeploy needed, takes effect in seconds):

- **Cloudflare dashboard:** Workers & Pages → `eat-what-places` → Settings → Variables and
  Secrets → `ACCESS_CODES` → Edit → e.g. `me-x7k2,aina-p9q3,ben-4hd8` → Deploy.
- **Terminal:** `npm run worker:codes`, then paste the list when prompted. Run it in your own
  terminal: it reads from an interactive prompt, so a non-interactive run saves an empty list.

Use something hard to guess (a name plus 4+ random characters is fine; the Worker rate-limits
guesses). **Revoke** someone by saving the list without their code; on their next search the app says the
code is no longer valid and falls back to the free map data.

**Give someone access:** send them their setup link,
`https://<user>.github.io/eat-what/#code=aina-p9q3`. Opening it checks the code with the
Worker, saves it on that phone and removes it from the address bar. They can also type it in
**Settings → Access code**. Treat the link like a password.

Friends without a code can still join your group from the invite link; you tap **Let in**.

**Pick-together sessions** live in a Cloudflare Durable Object (free plan, SQLite-backed), one
per room, auto-deleted after 6 hours. Only people with an access code can start one; joiners
without a code stay "pending" (and see nothing) until the host approves them.

**Protection layers:** the Worker only serves your site's origins, validates inputs, needs a
valid code for searches, issues 1-hour signed passes for photos, and rate-limits each visitor
(10 searches + 90 photos per minute). Google's daily quota caps stay as the final limit.
Searches that request ratings, prices and reviews bill at Google's Enterprise tier (1,000 free
a month at the time of writing); photos have their own 1,000 free a month. Google results are
kept in memory only (Google's terms restrict storing Places content).

## Deploy to GitHub Pages

1. Push this folder to a **public** GitHub repo (e.g. `eat-what`) on the `main` branch.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. (Optional) **Settings → Secrets and variables → Actions → Variables** → `PLACES_PROXY_URL`
   (your Worker URL). It's public — the key stays in Cloudflare.
4. Push — `.github/workflows/deploy.yml` tests, builds with the repo path as the base, and
   publishes to `https://<user>.github.io/<repo>/`.

To check a repo-path build locally: `npm run build:pages && npm run preview:pages`, then open
`http://localhost:4173/eat-what/`.

Other static hosts (e.g. Netlify): `npm run build`, publish `dist/`. The default build uses
relative paths, so it works at a domain root or any sub-path.

## Project layout

```
src/
  app.tsx               single screen: start → board → chosen, plus sheets
  components/
    PickBoard.tsx       photo-first tap-to-pick grid (solo and group)
    PlaceCard.tsx       card face, photo gallery and place details
    RoomScreen.tsx      join + live group board with countdown
    Sheets.tsx          Group, History (👍/👎) and Settings (diet, access code, backup)
    Flair.tsx           loading shuffle and celebration splats
    FoodArt.tsx         original gouache-style SVG food illustrations
  lib/
    places.ts           OpenStreetMap + Google Places via the Worker, caching
    rank.ts             scoring → board order + "why this, today"
    diet.ts             dietary rules (conflict / unverified / ok)
    storage.ts          localStorage + validated backup import
worker/src/index.ts     Cloudflare Worker: holds the key, access codes, rate limits, routes
worker/src/room*.ts     pick-together rooms (Durable Object + pure rules)
```

## Limits

- OpenStreetMap has no ratings, prices or reliable hours, and misses some stalls; tap through
  to Google Maps for those. The free Overpass server can be busy — the app says so and retries.
- Google doesn't provide menus; with a key you get "what they serve" flags, a description and
  a review snippet instead.
- Dietary info from maps is never verified — always check at the shop.
- Data stays in one browser; there's no sync between devices.
