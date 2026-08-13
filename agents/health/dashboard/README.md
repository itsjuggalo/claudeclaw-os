# Health OS dashboard

The live web dashboard, the exact look and feel: a dark, premium, self-contained trends board that reads straight from your Supabase project and updates live. Drag-and-resize cards on desktop, a clean stacked view on mobile.

![Health OS system map](../docs/health-os-schematic.png)

The dashboard is the "Live dashboard" output in the map above. It shows weight vs target, the **Sleep & Recovery** card (WHOOP), blood pressure, caffeine, nutrition, body composition, training, supplements, goals, and labs, over a 7 / 30 / 90-day window.

---

## Files

| File | What it is |
|---|---|
| `health-dashboard.ts` | The whole page as one server-rendered HTML string. Dark theme, Chart.js + GridStack from CDN, all the CSS and client JS inline. This **is** the look and feel. Exports `getHealthDashboardHtml(token, defaultRange)`. |
| `health-data.ts` | The data layer. Reads your Supabase project with the service-role key (PostgREST over `fetch`) and aggregates the raw rows into the 7/30/90-day shape the page renders. Exports `getHealthDashboard(range)`. |
| `routes.example.ts` | How to wire the four routes into a Hono server: `/healthdb` (page), `/api/healthdb` (data), and the WHOOP `/whoop/connect` + `/whoop/callback` OAuth. |

---

## How it works

1. The page is served by `GET /healthdb`, gated by a single `DASHBOARD_TOKEN`. The token arrives as `?token=`, gets stashed in an HttpOnly cookie, and the URL is redirected clean so the token never lingers in the address bar.
2. On load, the client JS polls `GET /api/healthdb?range=7|30|90` every minute (and on focus / tab return), so the board stays live.
3. `/api/healthdb` calls `getHealthDashboard(range)` in `health-data.ts`, which reaches into **your** Supabase project with the service-role key and aggregates every table (`weigh_ins`, `food_log`, `vitals`, `lab_results`, `goals`, ...) into one JSON payload.
4. The client renders that payload into cards. On desktop each card is an independent GridStack widget (drag by its header, resize from the edges, layout saved to `localStorage`). On mobile (`< 768px`) it falls back to a single stacked column for clean touch scrolling.

```
browser ──GET /healthdb──► server ──► getHealthDashboardHtml(token) ──► HTML+CSS+JS
   │
   └─poll every 60s─► GET /api/healthdb?range=30 ──► getHealthDashboard(30)
                                                         └─► Supabase (service-role) ─► JSON
```

---

## The look and feel

- **Palette:** near-black `#07080a` with a soft radial glow; mint `#6ee7b7`, teal `#22d3ee`, amber `#fbbf24`, blue `#60a5fa` accents on dark rounded cards with thin glowing borders.
- **Type:** Inter, tabular numbers, tight tracking on the hero figures.
- **Charts:** Chart.js with gradient fills, no point clutter, index-mode tooltips.
- **Layout:** GridStack 12-column on desktop, static stacked on mobile. Cards can be reordered/hidden via an "arrange" sheet.
- **Sleep & Recovery card:** recovery % color-banded (green ≥67, amber 34-66, red <34), HRV, resting HR, last sleep, and a 7-day recovery + sleep trend.

All of it is inline in `health-dashboard.ts`, so there is no build step for the look, just edit the one string.

---

## Make it yours

1. Drop `health-dashboard.ts` + `health-data.ts` next to your server and wire the routes from `routes.example.ts`.
2. Set `DASHBOARD_TOKEN` and your Supabase service-role credentials in `~/.env` (read the same way `scripts/db.py` does).
3. Set your own targets at the top of `health-data.ts` (`TARGET_WEIGHT`, `BASELINE_WEIGHT`, the protein band, the caffeine ceiling), or wire them to your `goals` table.
4. Expose it over a tunnel (e.g. Cloudflare Tunnel) at `https://<your-host>/healthdb` and send yourself the tokened link.

The card subtitles ship generic. Re-add your own mechanism notes (your genotypes, your thresholds) once it is your private instance.

---

## Privacy

The data layer uses the **service-role** key server-side only; the page is gated by `DASHBOARD_TOKEN`; the Supabase project has RLS on with no policies, so a leaked anon key reads nothing. Keep `~/.env` and your real card-subtitle notes out of git.
