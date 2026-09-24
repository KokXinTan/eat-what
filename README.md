# Eat What?

Can't decide where to eat? Tap **Surprise me** and swipe through what's good nearby —
**right** to go, **left** to skip. One painted card at a time, each with a short
"why this, today".

- **One screen, minimal typing.** Distance (walk / nearby / drive) and budget ($–$$$) are
  one-tap chips. Everything else is optional.
- **Real restaurants near you.** Free [OpenStreetMap](https://www.openstreetmap.org) data by
  default; Google Maps data (ratings, prices, open now, photos, review snippets) if you add a key.
- **Never repeats what you just skipped**, brings back 👍 favourites, avoids 👎 ones, and
  prefers a change from your last pick.
- **Dietary needs** (halal, no pork, no beef, vegetarian, vegan): clear clashes are hidden;
  anything map data can't confirm is marked **unverified**, never "safe".
- **Group mode:** add friends' diets and budgets; picks must suit everyone.
- **Private by default:** settings and picks live in this browser only (export/import JSON
  backup in Settings). Your location is sent to the map service to search, and isn't stored.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # ranking, diet, OSM parsing and backup tests
```

Location needs `localhost` or HTTPS. If location is off, the app asks for an area name instead.

## Optional: Google Maps data

Free OpenStreetMap works out of the box. For Google's richer data:

1. In Google Cloud Console, enable **Maps JavaScript API** and **Places API (New)** (needs billing).
2. Create an API key and restrict it:
   - Application restriction → Websites: `http://localhost:5173/*`, `https://<user>.github.io/*`
   - API restriction → only the two APIs above
   - Quotas → set daily caps (e.g. ~30 searches and ~30 photos per day) — your real protection
3. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_MAPS_API_KEY=...`, then restart `npm run dev`.

The key is visible in the built site — that's normal for browser Maps keys. Google notes the
website restriction can be bypassed, so the **daily quota caps are your real protection**.
Requesting ratings, prices and reviews bills searches at the Enterprise tier (1,000 free/month
at the time of writing), and photos have their own 1,000/month allowance — caps of ~30
searches/day and ~30 photos/day keep a shared app inside the free tier. Google results are kept
in memory only (Google's terms restrict storing Places content); photos load only for the card
on screen and the one behind it.

## Deploy to GitHub Pages

1. Push this folder to a **public** GitHub repo (e.g. `eat-what`) on the `main` branch.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. (Optional) **Settings → Secrets and variables → Actions → New secret**
   `VITE_GOOGLE_MAPS_API_KEY`.
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
    places.ts           OpenStreetMap + optional Google Places, 30-min cache
    rank.ts             deterministic scoring → deck + "why this, today"
    diet.ts             dietary rules (conflict / unverified / ok)
    storage.ts          localStorage + validated backup import
```

## Limits

- OpenStreetMap has no ratings, prices or reliable hours, and misses some stalls; tap through
  to Google Maps for those. The free Overpass server can be busy — the app says so and retries.
- Google doesn't provide menus; with a key you get "what they serve" flags, a description and
  a review snippet instead.
- Dietary info from maps is never verified — always check at the shop.
- Data stays in one browser; there's no sync between devices.
