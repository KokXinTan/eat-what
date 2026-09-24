# Eat What?

Can't decide where to eat? Tap **Start swiping** and go through what's good nearby —
**right** to go, **left** to skip. One painted card at a time, each with a short
"why this, today".

- **Swipe or Explore.** Swipe one card at a time to decide fast, or switch to **Explore**: a
  photo grid of everything nearby with cuisine chips (with counts), sorting (best match /
  nearest / top rated), local-gem and closed badges, and more places loading as you scroll.
- **One screen, minimal typing.** Distance (walk / nearby / drive) and budget ($–$$$) are
  one-tap chips. Everything else is optional.
- **Real restaurants near you.** Free [OpenStreetMap](https://www.openstreetmap.org) data for
  everyone; Google Maps data (photos, ratings, prices, open now, reviews) for people with an
  access code, served through a private Cloudflare Worker so the key is never public.
- **Never repeats what you just skipped**, brings back 👍 favourites, avoids 👎 ones, and
  prefers a change from your last pick.
- **Dietary needs** (halal, no pork, no beef, vegetarian, vegan): clear clashes are hidden;
  anything map data can't confirm is marked **unverified**, never "safe".
- **Swipe together:** start a session, share the link, and everyone swipes the same places on
  their own phone. When everyone swipes right on one place — *it's a match*. People with an
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
4. `npm run worker:codes` — paste comma-separated codes, e.g. `me-x7k2,aina-p9q3`.
5. `npm run worker:deploy` — note the `https://eat-what-places.<you>.workers.dev` URL.
6. Local dev: put that URL in `.env.local` as `VITE_PLACES_PROXY_URL=...`.
   GitHub: **Settings → Secrets and variables → Actions → Variables** → `PLACES_PROXY_URL`.

**Manage access:** run `npm run worker:codes` again with the new list (e.g. drop `aina-p9q3` to
revoke Aina), or edit the `ACCESS_CODES` secret in the Cloudflare dashboard. No redeploy needed.

**Swipe-together sessions** live in a Cloudflare Durable Object (free plan, SQLite-backed), one
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
  app.tsx               single screen: start → deck → chosen, plus sheets
  components/
    SwipeCard.tsx       drag/keyboard/button swiping and the card face
    Sheets.tsx          Group, History (👍/👎) and Settings (diet, backup)
    FoodArt.tsx         original gouache-style SVG food illustrations
  lib/
    places.ts           OpenStreetMap + Google Places via the Worker, caching
    rank.ts             deterministic scoring → deck + "why this, today"
    diet.ts             dietary rules (conflict / unverified / ok)
    storage.ts          localStorage + validated backup import
worker/src/index.ts     Cloudflare Worker: holds the key, access codes, rate limits, routes
worker/src/room*.ts     swipe-together rooms (Durable Object + pure rules)
```

## Limits

- OpenStreetMap has no ratings, prices or reliable hours, and misses some stalls; tap through
  to Google Maps for those. The free Overpass server can be busy — the app says so and retries.
- Google doesn't provide menus; with a key you get "what they serve" flags, a description and
  a review snippet instead.
- Dietary info from maps is never verified — always check at the shop.
- Data stays in one browser; there's no sync between devices.
