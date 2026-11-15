"use client";
/**
 * Bridge to the in-browser analytics engine (static-site build only).
 * The same Python route functions as the FastAPI server run in a Pyodide Web
 * Worker; requests are queued until the engine has booted.
 */

export const BROWSER_ENGINE = process.env.NEXT_PUBLIC_ENGINE === "browser";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type EngineStatus = { stage: string; error?: string; seconds?: number };
type Pending = { resolve: (r: EngineResponse) => void };
export type EngineResponse = { status: number; contentType: string; payload: string; isB64: boolean };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let current: EngineStatus = { stage: "idle" };
const listeners = new Set<(s: EngineStatus) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(`${BASE_PATH}/engine/worker.js`);
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "status") {
      current = { stage: m.stage, error: m.error, seconds: m.seconds };
      listeners.forEach((l) => l(current));
    } else if (m.type === "response") {
      pending.get(m.id)?.resolve(m);
      pending.delete(m.id);
    }
  };
  worker.onerror = (e) => {
    current = { stage: "error", error: e.message || "engine failed to start" };
    listeners.forEach((l) => l(current));
  };
  worker.postMessage({ type: "init", bundleUrl: `${BASE_PATH}/engine/bundle.json` });
  return worker;
}

export function startEngine() {
  if (BROWSER_ENGINE && typeof window !== "undefined") getWorker();
}

export function subscribeEngine(fn: (s: EngineStatus) => void) {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

export function engineRequest(method: string, url: string, body?: string): Promise<EngineResponse> {
  const w = getWorker();
  const u = new URL(url, "http://local");
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    w.postMessage({ type: "request", id, method, path: u.pathname, query: u.search.replace(/^\?/, ""), body: body ?? null });
  });
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
