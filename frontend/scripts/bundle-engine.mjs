// Packs the Python engine (backend/app) and the bundled official-data snapshot
// into public/engine/bundle.json for the in-browser (Pyodide) build.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../../backend/", import.meta.url).pathname;
const out = new URL("../public/engine/bundle.json", import.meta.url).pathname;
const files = {};
function walk(dir, keep) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__pycache__") continue;
    if (statSync(p).isDirectory()) walk(p, keep);
    else if (keep(name)) files[relative(root, p)] = readFileSync(p, "utf8");
  }
}
walk(join(root, "app"), (n) => n.endsWith(".py"));
walk(join(root, "data", "snapshot"), (n) => n.endsWith(".csv") || n.endsWith(".json"));
const meta = JSON.parse(files["data/snapshot/metadata.json"]);
mkdirSync(new URL("../public/engine/", import.meta.url).pathname, { recursive: true });
writeFileSync(out, JSON.stringify({ snapshot_retrieved_at_utc: meta.retrieved_at_utc, files }));
console.log(`engine bundle: ${Object.keys(files).length} files, ${(statSync(out).size / 1e6).toFixed(2)} MB, snapshot ${meta.retrieved_at_utc}`);
