#!/usr/bin/env node
// Builds candidates.json for force.vote — one shot, no deps.
//
// Sources:
//   - OpenFEC /candidates/search (all 2026 House candidates who've filed Form 2)
//   - @unitedstates/congress-legislators (FEC ID -> bioguide -> photo)
//
// Output shape:
//   {
//     generated_at: "...",
//     election_year: 2026,
//     candidates: {
//       "<geoid>": [ { fec_id, name, party, party_full, incumbent, bioguide?, photo_url? }, ... ]
//     }
//   }
//
// Env:
//   FEC_API_KEY  — get a free key at api.data.gov/signup (DEMO_KEY works, slow)

const fs = require("fs");
const path = require("path");

const ELECTION_YEAR = 2026;
const API_KEY = process.env.FEC_API_KEY || "DEMO_KEY";
const OUT = path.join(__dirname, "candidates.json");

// State abbr -> 2-digit FIPS. 50 states only (DC/territories have non-voting delegates).
const STATE_FIPS = {
    AL:"01", AK:"02", AZ:"04", AR:"05", CA:"06", CO:"08", CT:"09", DE:"10",
    FL:"12", GA:"13", HI:"15", ID:"16", IL:"17", IN:"18", IA:"19", KS:"20",
    KY:"21", LA:"22", ME:"23", MD:"24", MA:"25", MI:"26", MN:"27", MS:"28",
    MO:"29", MT:"30", NE:"31", NV:"32", NH:"33", NJ:"34", NM:"35", NY:"36",
    NC:"37", ND:"38", OH:"39", OK:"40", OR:"41", PA:"42", RI:"44", SC:"45",
    SD:"46", TN:"47", TX:"48", UT:"49", VT:"50", VA:"51", WA:"53", WV:"54",
    WI:"55", WY:"56",
};

async function fetchAllFEC() {
    const out = [];
    let page = 1;
    while (true) {
        const url = new URL("https://api.open.fec.gov/v1/candidates/search/");
        url.searchParams.set("api_key", API_KEY);
        url.searchParams.set("election_year", ELECTION_YEAR);
        url.searchParams.set("office", "H");
        url.searchParams.set("candidate_status", "C");
        url.searchParams.set("per_page", "100");
        url.searchParams.set("page", String(page));
        url.searchParams.set("sort", "name");
        const r = await fetch(url);
        if (!r.ok) throw new Error(`FEC page ${page}: ${r.status} ${await r.text()}`);
        const j = await r.json();
        out.push(...j.results);
        process.stderr.write(`  fetched page ${page}/${j.pagination.pages} (${out.length}/${j.pagination.count})\n`);
        if (page >= j.pagination.pages) break;
        page++;
        await new Promise((r) => setTimeout(r, 250)); // be polite
    }
    return out;
}

async function fetchLegislators() {
    const url = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
    const r = await fetch(url);
    if (!r.ok) throw new Error(`legislators: ${r.status}`);
    return r.json();
}

// Load the valid set of district geoids from the per-state topojson files.
// FEC data occasionally has impossible districts (e.g. GA-23, AZ-00) from typos
// or stale exploratory filings — drop them so the UI never references a
// district shape we don't have.
function loadValidGeoids() {
    const valid = new Set();
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith("-districts.json"));
    for (const f of files) {
        const topo = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const layer = topo.objects[Object.keys(topo.objects)[0]];
        for (const g of layer.geometries) valid.add(g.properties.geoid);
    }
    return valid;
}

(async () => {
    const validGeoids = loadValidGeoids();
    process.stderr.write(`loaded ${validGeoids.size} valid district geoids from topojson\n`);

    process.stderr.write(`fetching OpenFEC candidates (${ELECTION_YEAR} House)...\n`);
    const fec = await fetchAllFEC();
    process.stderr.write(`fetching legislators-current.json...\n`);
    const legis = await fetchLegislators();

    // Two maps from legislators-current:
    //   fecToBioguide: any FEC ID a current rep has ever used -> bioguide
    //                  (used for matching photos when a rep moves districts).
    //   geoidToIncumbentBioguide: the CURRENT district's incumbent bioguide
    //                             (the authoritative "is this person THE incumbent
    //                             of this district" check). FEC's incumbent_challenge
    //                             is self-reported and unreliable — multiple
    //                             candidates per district claim it.
    const fecToBioguide = new Map();
    const geoidToIncumbentBioguide = new Map();
    for (const p of legis) {
        const term = p.terms[p.terms.length - 1];
        if (term.type !== "rep") continue;
        const fips = STATE_FIPS[term.state];
        if (!fips) continue;
        const dist = String(term.district == null ? 0 : term.district).padStart(2, "0");
        geoidToIncumbentBioguide.set(fips + dist, p.id.bioguide);
        for (const fid of p.id.fec || []) fecToBioguide.set(fid, p.id.bioguide);
    }
    process.stderr.write(
        `mapped ${fecToBioguide.size} FEC IDs -> bioguide, ${geoidToIncumbentBioguide.size} incumbent districts\n`
    );

    // Bucket by geoid (state FIPS + 2-digit district)
    const byGeoid = {};
    let skippedNonState = 0;
    let droppedOrphan = 0;
    const orphanList = [];
    for (const c of fec) {
        const fips = STATE_FIPS[c.state];
        if (!fips) { skippedNonState++; continue; }
        const dist = String(c.district || "00").padStart(2, "0");
        const geoid = fips + dist;
        if (!validGeoids.has(geoid)) {
            droppedOrphan++;
            orphanList.push(`${c.state}-${dist} (${c.candidate_id} ${c.name})`);
            continue;
        }
        const bioguide = fecToBioguide.get(c.candidate_id);
        const isIncumbent = bioguide && geoidToIncumbentBioguide.get(geoid) === bioguide;
        const entry = {
            fec_id: c.candidate_id,
            name: c.name,
            party: c.party || null,
            party_full: c.party_full || null,
            state: c.state,
            district: dist,
            incumbent: !!isIncumbent,
            first_file_date: c.first_file_date || null,
            has_raised_funds: !!c.has_raised_funds,
        };
        if (bioguide) {
            entry.bioguide = bioguide;
            entry.photo_url = `https://theunitedstates.io/images/congress/450x550/${bioguide}.jpg`;
        }
        (byGeoid[geoid] ||= []).push(entry);
    }

    // Dedupe by bioguide within each district: a single person can have multiple
    // FEC candidate IDs (old committees from prior cycles never closed). Keep the
    // one with the most recent first_file_date — that's their active 2026 filing.
    let deduped = 0;
    for (const g of Object.keys(byGeoid)) {
        const seen = new Map();
        const out = [];
        for (const e of byGeoid[g]) {
            if (!e.bioguide) { out.push(e); continue; }
            const prior = seen.get(e.bioguide);
            if (!prior) {
                seen.set(e.bioguide, e);
                out.push(e);
            } else {
                deduped++;
                // Replace prior if this one is newer
                if ((e.first_file_date || "") > (prior.first_file_date || "")) {
                    const idx = out.indexOf(prior);
                    out[idx] = e;
                    seen.set(e.bioguide, e);
                }
            }
        }
        byGeoid[g] = out;
    }

    // Sort each district: incumbent first, then by name
    for (const g of Object.keys(byGeoid)) {
        byGeoid[g].sort((a, b) => {
            if (a.incumbent !== b.incumbent) return a.incumbent ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    const districtsCovered = Object.keys(byGeoid).length;
    const districtsEmpty = [...validGeoids].filter((g) => !byGeoid[g]);

    const result = {
        generated_at: new Date().toISOString(),
        election_year: ELECTION_YEAR,
        source: "OpenFEC + @unitedstates/congress-legislators",
        candidate_count: Object.values(byGeoid).reduce((a, b) => a + b.length, 0),
        district_count: districtsCovered,
        candidates: byGeoid,
    };

    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    process.stderr.write(`\nwrote ${OUT}\n`);
    process.stderr.write(`  candidates: ${result.candidate_count} across ${districtsCovered}/${validGeoids.size} districts\n`);
    process.stderr.write(`  skipped (non-50-state): ${skippedNonState}\n`);
    process.stderr.write(`  dropped (orphan district): ${droppedOrphan}${orphanList.length ? ' — ' + orphanList.join(', ') : ''}\n`);
    process.stderr.write(`  deduped (same bioguide, multiple FEC IDs): ${deduped}\n`);
    process.stderr.write(`  districts with 0 filed candidates: ${districtsEmpty.length}\n`);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
