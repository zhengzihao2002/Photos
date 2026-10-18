# Performance at 100,000 items

Measured with `node tools/bench-scale.js` on a synthetic, reproducible library (`tools/make-synthetic-db.js`, 100,000 rows over 20 years: photos and videos, bursts, Live Photos, RAW, favorites, titles, 4,000 distinct keywords, GPS for ~45%, 300 people with faces, tombstones). CI runs the same benchmark with generous limits as a regression alarm (`--check`).

Reference run (Linux, Node 22, SQLite 3.53, warm cache, p95 unless stated):

| Area | Result | Target |
|---|---|---|
| Grid page (first / deep / last), every filter (`video raw gif panorama gps selfie live burst favorite source geo person group ::kind ::search ::fav`) | 0.2 – 4.5 ms | < 100 ms |
| Counts for a filter | 0.1 – 37 ms (search count 124 ms) | < 100 ms |
| Viewer item index at a deep position | 7 ms | < 100 ms |
| Years / Months / Days counts | 9 – 15 ms | < 100 ms |
| Map points (45,000 located items) | 115 ms | < 100 ms (accepted: one query, off the interactive path) |
| Keyword autocomplete (4,000 keywords) | 5 ms | < 100 ms |
| Search over name/title/caption/keywords | 3 ms with a hit, 115 ms with none | < 150 ms |
| Selection summary of Cmd+A | 220 ms | < 1 s |
| Cmd+A then favorite / title / rotate | 0.35 – 0.7 s | < 2 s |
| Cmd+A then add a keyword | 1.1 s (was 4.3 s; set-based statements above 500 items) | < 2 s |
| Place pass incl. landmarks, 100,000 rows | 2.7 s total, 217 MB peak (Node process) | – |
| Place pass when nothing changed | 20 ms (datasets are not even loaded) | – |
| Landmark dataset | 92,733 landmarks, 5.6 MB, loads in ~0.15 s, ~2 µs per lookup | < 20 MB |

No hot-path query does a full table scan (checked with `EXPLAIN QUERY PLAN` in the benchmark). The renderer never receives lists of ids: selections travel as compact tokens (`::sel:`) and are expanded to SQL in the main process.

Run it on your own library: `./dev bench` (works on a **copy** of `.dev-data/library.db`; the live file is never opened).

Not measured here (needs a real Mac and a real library): scan throughput on 100,000 real files, memory of the Electron processes, grid layout at 100,000 items, and unplugged/iCloud/network volumes. The CI smoke test covers the pipeline on a generated library on a macOS runner; see `docs/DECISIONS.md`.
