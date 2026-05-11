#!/usr/bin/env node
// Builds zip-to-district.json — ZIP (ZCTA5) -> [geoid, ...] lookup.
//
// Source: Census 2020 ZCTA ↔ CD118 relationship file. There is no CD119 ZCTA
// file published yet, so we use CD118 and drop any ZIP → geoid mapping where
// the geoid no longer exists in our CD119 topojson (catches the states that
// redistricted between cycles: NC, NY, AL, LA, GA, etc — those ZIPs will fall
// through and the UI will show "couldn't find your district").

const fs = require("fs");
const path = require("path");
const https = require("https");

const SRC = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11820_zcta520_natl.txt";
const CACHE = path.join("/tmp", "cd118-zcta.txt");
const OUT = path.join(__dirname, "zip-to-district.json");

function fetchToFile(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) return resolve();
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error("status " + res.statusCode));
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
        }).on("error", reject);
    });
}

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
    process.stderr.write("fetching Census ZCTA↔CD118 file...\n");
    await fetchToFile(SRC, CACHE);

    const valid = loadValidGeoids();
    process.stderr.write(`loaded ${valid.size} valid CD119 geoids\n`);

    const raw = fs.readFileSync(CACHE, "utf8");
    const lines = raw.split(/\r?\n/);
    // Strip BOM from header
    const header = lines[0].replace(/^﻿/, "").split("|");
    const colCdGeoid = header.indexOf("GEOID_CD118_20");
    const colZip = header.indexOf("GEOID_ZCTA5_20");
    if (colCdGeoid < 0 || colZip < 0) throw new Error("unexpected header: " + header.join(","));

    const zipMap = {};
    let staleSkipped = 0;
    let emptyZip = 0;
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("|");
        if (cols.length < header.length) continue;
        const zip = cols[colZip];
        const geoid = cols[colCdGeoid];
        if (!zip) { emptyZip++; continue; }
        if (!valid.has(geoid)) { staleSkipped++; continue; }
        (zipMap[zip] ||= new Set()).add(geoid);
    }

    // Convert Sets to sorted arrays for stable JSON output
    const out = {};
    for (const z of Object.keys(zipMap).sort()) {
        out[z] = [...zipMap[z]].sort();
    }

    const multi = Object.values(out).filter((a) => a.length > 1).length;
    const total = Object.keys(out).length;
    fs.writeFileSync(OUT, JSON.stringify({
        generated_at: new Date().toISOString(),
        source: "Census 2020 ZCTA ↔ CD118 relationship (filtered to CD119 geoids)",
        zip_count: total,
        multi_district_zip_count: multi,
        zips: out,
    }));
    process.stderr.write(
        `wrote ${OUT}\n` +
        `  zips covered: ${total}\n` +
        `  multi-district zips: ${multi}\n` +
        `  rows with empty ZCTA (CD-only rows): ${emptyZip}\n` +
        `  rows dropped (CD118 geoid not in CD119): ${staleSkipped}\n`
    );
})().catch((e) => { console.error(e); process.exit(1); });
