# Force.Vote — Project Notes

Context that lives outside the code. Read this + `index.html` to catch up on the project.

## What this is

A site that tracks which U.S. House candidates have signed the **Force the Vote pledge**. Domain: `force.vote`. Cross-partisan ("Fix Congress First" framing). The pledge commits a House member to withhold their Speaker vote until a Speaker publicly commits to an immediate yes/no floor vote on three reforms:

1. **Term Limits** (3 House / 2 Senate)
2. **Balanced Budget Amendment**
3. **Congressional Stock Trading Ban**

The leverage mechanic is real — proven by the McCarthy 2023 holdouts and the Freedom Caucus 2015 Speaker fight. The site organizes that leverage in advance.

## The leverage threshold

- **15 signed incumbents in the next House majority** is the working threshold to deny a Speaker vote
- Party-agnostic: doesn't matter if R or D wins the majority — whoever has 15+ signed members in the majority controls the gavel
- Pre-election the count is a leading indicator (signed sitting incumbents); post-election it crystallizes (signed incumbents who landed in the actual new majority)
- The number isn't load-bearing on partisan composition — it's about narrow-margin math, which both recent Congresses have produced

## Verb stack (matters for copy consistency)

| Actor | Verb | Noun in UI |
|---|---|---|
| The document | — | **The Pledge** |
| Candidates | **Sign** | "Signed", `Signed` badge (green) |
| Voters | **Back** | "Voter Backing", "Backed", "Voters Backing" |

Never call candidates "pledged" — they're "Signed." Never call voter contributions "pledges" — they're "backing" or "donations committed." The Pledge itself stays "The Pledge."

## Status taxonomy

- **Signed** — green (`#6ba368`)
- **Declined** — brick red (`#c2503e`) (publicly refused)
- **Pending** — muted gray (`#8e8590`) (no response)
- **Broke Pledge** — brick red, harsher framing (signed then voted for Speaker without securing the floor-vote commitment)

Note: "Decliner in district" was removed from the map legend — we don't summarize declines at the map level, only at candidate detail. Signers ARE shown at the map level (the positive signal is more useful than the negative one).

## Design system

- **Background:** `#3e3740` (dark muted aubergine)
- **Elevated surfaces:** `#4a424d`
- **Accent (amber):** `#f4b942` — CTAs, headline numbers, the brand "torchlight"
- **Text (warm parchment):** `#f4ede4` (not pure white)
- **Text muted:** `#a89fa3`
- **State map gray-purple:** `#7a7180` (matches the panel placeholder/state strokes)
- **Headlines:** **Bitter** (heavy slab serif), 800 weight
- **Body / labels:** **Inter**

The pledge-card pattern (elevated bg + 4px amber left-border, no other border, sharp corners) is the canonical "card" treatment. The map's stats panel uses the same pattern.

## Tracker (3×3 grid)

Top row — **candidate progress**:
1. Candidates Signed (running total)
2. Incumbents Signed (0 / 435)
3. Needed for Leverage (0 / 15) — **highlighted card, amber top border**

Middle row — **voter pressure**:
4. Voter Donations Committed ($0)
5. Voters Backing (count)
6. Races Affected (0 / 435 — districts with at least one **voter donor**, NOT signed candidate)

Bottom row — **leaderboards**:
7. Highest Backed Race (most $ in one district)
8. Highest Backed Candidate — **brick red top border** (the "shame" play, unsigned)
9. Most Recent Signer — **green top border** (recency/momentum)

## Map architecture

- **Custom composite projection** (NOT `d3.geoAlbersUsa`). Lower 48 uses `d3.geoAlbers()` and fits to the available width; Alaska and Hawaii use their own `geoConicEqualArea` projections, manually positioned in the bottom-left. Reason: `geoAlbersUsa`'s hardcoded AK offset wastes a huge chunk off the California coast.
- **State-detail view** uses `d3.geoIdentity().reflectY(true).fitExtent(...)` — gives a true north-up view of any state, no continental tilt (Idaho looks "natural" instead of leaning).
- **Path morphing** between continental and state-detail uses `d3.interpolateString` on the `d` attribute. Works because the same feature drawn with two projections has identical command structure — only the numbers differ.
- **Three view levels:** US (panel 20%) → State (panel 20%) → District (panel 40%, district fits left ~56%).
- **Breadcrumb:** US › State › District. Each parent crumb is clickable with a "← Back to ..." hint underneath when navigable.
- **Tennessee** is the only state with district data wired up so far (`tn-districts.json`).

## Pipeline for adding more state districts

1. Get the source: `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_500k.zip`
2. Filter + simplify with mapshaper (use `npm_config_cache=/tmp/npm-cache npx -y mapshaper` to avoid permission issues):
   ```bash
   npx mapshaper cb_2024_us_cd119_500k.shp \
     -filter "STATEFP==='STATE_FIPS_CODE'" \
     -simplify 12% visvalingam \
     -each 'name = NAMELSAD, district = CD119FP, geoid = GEOID' \
     -filter-fields name,district,geoid \
     -o format=topojson <state>-districts.json
   ```
3. Add to the `STATE_DISTRICT_FILES` map in the JS

Tennessee FIPS code is `47`. Full FIPS list: https://www.census.gov/library/reference/code-lists/ansi.html

## Bug we hit (don't repeat)

The district fade was broken because `showDistricts` set opacity via **inline style** (d3 transition → `style="opacity: 1"`) but my fade code used a CSS class (`.district.faded { opacity: 0 }`). **Inline styles beat class selectors in specificity.** Now both fade-out and fade-in use d3 transitions on inline opacity. Named the transition `"fade"` so it doesn't conflict with the morph transition (which animates the `d` attribute on the same elements).

Lesson: when one part of the codebase establishes inline styles via d3, ALL related state-changes on that property need to go through inline styles too. Mixing inline + CSS class for the same property is a footgun.

## Polling stats in the hero

Verify these before public launch — they're approximations:
- **83% disapprove of Congress** — Gallup, monthly tracker
- **87% support term limits** — Pew Research, 2023
- **74% support a balanced budget amendment** — varies by poll wording (60s–high 70s)
- **86% support a stock trading ban** — Univ. of Maryland Program for Public Consultation, 2023

Even if some come in lower, the narrative survives — the contrast with 83% disapproval is the whole point.

## Backend plan (not built yet)

- **Supabase** — Postgres database with real-time WebSocket subscriptions. Tracker counters auto-update as backings/signatures land.
  - Tables: `candidates`, `backings`, `voters` (derived)
  - Row-level security so the public can only INSERT into `backings`, never read other people's
- **Resend** — transactional email ($0 up to 3K emails/month). Triggered when `candidates.status` flips to `signed` — emails every backer who pledged for that candidate with a one-click ActBlue/WinRed link.
- **Cloudflare Turnstile** captcha + email double opt-in to prevent abuse of the counters.
- **HubSpot Free** for CRM later (1M contacts free) — sync from Supabase via webhook. Or skip HubSpot entirely and use Supabase + Resend.
- **Cost at v1:** ~$15/year (just the domain). At ~10K backers: ~$40–50/month.

User's stance: "won't be collecting money, not at first" — backings are intent-only, no FEC/PAC issues, no money handled. ActBlue integration only when ready.

## Build order from here

1. **Process districts for all 50 states** (same pipeline as Tennessee) — gives the map full coverage.
2. **Candidate page / panel content** — when a district is clicked, the right-side panel should populate with the candidate(s) for that district: name, party, status badge, signed PDF link if applicable, "back this candidate" form.
3. **ZIP code lookup** — input field that geocodes ZIP → state + district, auto-drills the map. ZIP-to-district mapping is non-trivial (a single ZIP can span multiple districts); use Census ZCTA → CD relationship file.
4. **Backend** — Supabase + Resend setup, wire form submissions to real DB, real-time tracker counters.
5. **FAQ + About** — soft pitch territory, address objections.
6. **Polish** — mobile-specific map fallback (heatmap-style territory list since interactive map is desktop-first), accessibility audit, real privacy policy.

## Local dev setup

- Static site in `/Users/chriscobb/Desktop/Force/`
- Files: `index.html`, `Image.png` (Capitol hero), `states-10m.json`, `tn-districts.json`, this file
- **Must serve via HTTP**, not `file://` — browsers block fetch from file:// origins
- Quick start: `cd /Users/chriscobb/Desktop/Force && python3 -m http.server 8000` → http://localhost:8000
- D3 + topojson-client loaded from jsdelivr CDN (pinned to `/dist/...min.js` paths to avoid resolution issues)

## File map

```
Force/
├── index.html         — the entire site (CSS + HTML + JS in one file)
├── Image.png          — Capitol building hero image with silhouettes
├── states-10m.json    — US states TopoJSON (us-atlas, ~112KB)
├── tn-districts.json  — Tennessee 119th Congress districts (~11KB)
└── NOTES.md           — this file
```
