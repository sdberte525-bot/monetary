/* MONETARY in-browser analytics engine.
 * Runs the project's Python/FastAPI route functions inside Pyodide (CPython
 * compiled to WebAssembly) in a Web Worker so the UI stays responsive. */
const PYODIDE_VERSION = "0.29.5";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
importScripts(PYODIDE_URL + "pyodide.js");

let py = null;
let ready = null;
let reportlabReady = null;

const status = (stage, extra = {}) => postMessage({ type: "status", stage, ...extra });

async function boot(bundleUrl) {
  const t0 = performance.now();
  status("Downloading Python runtime");
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  status("Loading NumPy, pandas, SciPy and FastAPI");
  await py.loadPackage(["numpy", "pandas", "scipy", "pydantic", "fastapi", "httpx", "micropip"]);
  status("Loading MONETARY engine and official data snapshot");
  const res = await fetch(bundleUrl);
  if (!res.ok) throw new Error(`engine bundle unavailable (${res.status})`);
  const bundle = await res.json();
  const base = "/home/pyodide/monetary/";
  for (const [rel, content] of Object.entries(bundle.files)) {
    const parts = (base + rel).split("/");
    for (let i = 2; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      try { py.FS.mkdir(dir); } catch (_) { /* exists */ }
    }
    py.FS.writeFile(base + rel, content);
  }
  py.runPython(`
import sys, base64
sys.path.insert(0, "/home/pyodide/monetary")
from app.browser import handle as _handle
from app.data.store import get_store
get_store()

def _call(method, path, query, body):
    status, ctype, payload = _handle(method, path, query, body)
    if isinstance(payload, (bytes, bytearray)):
        return [status, ctype, base64.b64encode(payload).decode(), True]
    return [status, ctype, payload, False]
`);
  status("ready", { seconds: (performance.now() - t0) / 1000 });
}

async function ensureReportlab() {
  if (!reportlabReady) {
    reportlabReady = (async () => {
      status("Loading PDF library (first export only)");
      const micropip = py.pyimport("micropip");
      await micropip.install("reportlab==5.1.0");
      status("ready");
    })();
  }
  return reportlabReady;
}

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    if (!ready) ready = boot(msg.bundleUrl).catch((err) => { status("error", { error: String(err && err.message || err) }); throw err; });
    return;
  }
  if (msg.type !== "request") return;
  try {
    await ready;
    if (msg.path === "/api/report/pdf") await ensureReportlab();
    const out = py.globals.get("_call")(msg.method, msg.path, msg.query || "", msg.body ?? null);
    const [code, ctype, payload, isB64] = out.toJs();
    out.destroy();
    postMessage({ type: "response", id: msg.id, status: code, contentType: ctype, payload, isB64 });
  } catch (err) {
    postMessage({ type: "response", id: msg.id, status: 500, contentType: "application/json",
      payload: JSON.stringify({ detail: `In-browser engine error: ${String(err && err.message || err).slice(0, 400)}` }), isB64: false });
  }
};
