"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, type Position } from "./api";

export type StoredPortfolio = { id: string; name: string; positions: Position[]; kind: "sample" | "user"; updated: string };

type SamplesResponse = {
  curve_as_of: string;
  settlement: string;
  portfolios: Record<string, { name: string; positions: Position[] }>;
  note: string;
};

type Ctx = {
  ready: boolean;
  error: string | null;
  portfolios: StoredPortfolio[];
  active: StoredPortfolio | null;
  activeId: string;
  setActiveId: (id: string) => void;
  get: (id: string) => StoredPortfolio | undefined;
  updatePositions: (id: string, positions: Position[]) => void;
  saveAs: (name: string, positions: Position[]) => string;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  reloadSamples: () => Promise<void>;
  samplesNote: string | null;
};

const KEY = "monetary.portfolios.v1";
const ACTIVE_KEY = "monetary.active.v1";
const PortfolioContext = createContext<Ctx | null>(null);

function readLocal<T>(k: string): T | null {
  try {
    const s = window.localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function writeLocal(k: string, v: unknown) {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode) - state remains in memory */
  }
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [portfolios, setPortfolios] = useState<StoredPortfolio[]>([]);
  const [activeId, setActiveIdState] = useState("sample:intermediate");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samplesNote, setSamplesNote] = useState<string | null>(null);

  const loadSamples = useCallback(async (existing: StoredPortfolio[]) => {
    const s = await apiFetch<SamplesResponse>("/api/portfolio/samples");
    setSamplesNote(`${s.note} Curve as of ${s.curve_as_of}; settlement ${s.settlement}.`);
    const samples: StoredPortfolio[] = Object.entries(s.portfolios).map(([k, v]) => ({
      id: `sample:${k}`, name: v.name, positions: v.positions, kind: "sample", updated: s.curve_as_of,
    }));
    const users = existing.filter((p) => p.kind === "user");
    const next = [...samples, ...users];
    setPortfolios(next);
    writeLocal(KEY, next);
  }, []);

  useEffect(() => {
    const stored = readLocal<StoredPortfolio[]>(KEY) ?? [];
    const a = readLocal<string>(ACTIVE_KEY);
    if (a) setActiveIdState(a);
    if (stored.length) setPortfolios(stored);
    // Samples are always regenerated from the latest curve so that they never mature or go stale.
    loadSamples(stored)
      .catch((e: Error) => setError(e.message))
      .finally(() => setReady(true));
  }, [loadSamples]);

  const persist = (next: StoredPortfolio[]) => {
    setPortfolios(next);
    writeLocal(KEY, next);
  };

  const value = useMemo<Ctx>(() => {
    const get = (id: string) => portfolios.find((p) => p.id === id);
    const active = get(activeId) ?? portfolios[0] ?? null;
    return {
      ready, error, portfolios, active, activeId: active?.id ?? activeId, samplesNote,
      setActiveId: (id) => {
        setActiveIdState(id);
        writeLocal(ACTIVE_KEY, id);
      },
      get,
      updatePositions: (id, positions) => {
        const p = get(id);
        if (!p) return;
        if (p.kind === "sample") {
          // Editing a sample creates a user copy so samples stay reproducible.
          const nid = `user:${Date.now().toString(36)}`;
          persist([...portfolios, { id: nid, name: `${p.name} (edited)`, positions, kind: "user", updated: new Date().toISOString() }]);
          setActiveIdState(nid);
          writeLocal(ACTIVE_KEY, nid);
        } else {
          persist(portfolios.map((x) => (x.id === id ? { ...x, positions, updated: new Date().toISOString() } : x)));
        }
      },
      saveAs: (name, positions) => {
        const nid = `user:${Date.now().toString(36)}`;
        persist([...portfolios, { id: nid, name, positions, kind: "user", updated: new Date().toISOString() }]);
        return nid;
      },
      remove: (id) => {
        const next = portfolios.filter((p) => p.id !== id || p.kind === "sample");
        persist(next);
        if (id === activeId) {
          setActiveIdState("sample:intermediate");
          writeLocal(ACTIVE_KEY, "sample:intermediate");
        }
      },
      rename: (id, name) => persist(portfolios.map((x) => (x.id === id && x.kind === "user" ? { ...x, name } : x))),
      reloadSamples: () => loadSamples(portfolios),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios, activeId, ready, error, samplesNote, loadSamples]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolios() {
  const c = useContext(PortfolioContext);
  if (!c) throw new Error("usePortfolios must be used inside PortfolioProvider");
  return c;
}

/** Generic persisted list for saved scenarios. */
export function useSavedList<T extends { name: string }>(key: string) {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => setItems(readLocal<T[]>(key) ?? []), [key]);
  const save = (item: T) => {
    const next = [...items.filter((i) => i.name !== item.name), item];
    setItems(next);
    writeLocal(key, next);
  };
  const remove = (name: string) => {
    const next = items.filter((i) => i.name !== name);
    setItems(next);
    writeLocal(key, next);
  };
  return { items, save, remove };
}
