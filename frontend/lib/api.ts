"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BROWSER_ENGINE, b64ToBytes, engineRequest } from "./engine";

export const TENORS = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"] as const;
export type Tenor = (typeof TENORS)[number];
export const TENOR_YEARS: Record<Tenor, number> = {
  "1M": 1 / 12, "3M": 0.25, "6M": 0.5, "1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, "7Y": 7, "10Y": 10, "20Y": 20, "30Y": 30,
};

export type Position = {
  id: string;
  label: string;
  coupon_pct: number;
  maturity: string;
  face_amount: number;
  frequency: 1 | 2 | 4 | 12;
  day_count: "ACT/ACT-ICMA" | "30/360" | "ACT/360" | "ACT/365F";
};

export type Provenance = {
  source: string;
  url: string | null;
  mode: "live" | "snapshot" | "user";
  retrieved_at_utc: string | null;
  last_observation: string | null;
  note?: string | null;
};

export type Holding = {
  id: string; label: string; coupon_pct: number; maturity: string; years_to_maturity: number; face_amount: number;
  clean_price: number; dirty_price: number; accrued_per_100: number; accrued_amount: number; market_value: number;
  ytm_pct: number; macaulay_duration: number; modified_duration: number; effective_duration: number; convexity: number;
  effective_convexity: number; dv01: number; krd: Record<string, number>; kr_dv01: Record<string, number>;
  weight: number; duration_contribution: number; dv01_share: number; next_coupon: string | null;
};

export type PortfolioAnalytics = {
  settlement: string;
  curve_as_of: string;
  summary: {
    market_value: number; face_amount: number; accrued_interest: number; modified_duration: number;
    effective_duration: number; convexity: number; dv01: number; mv_weighted_ytm_pct: number;
    cash_flow_yield_pct: number; positions: number; weighted_avg_maturity: number;
  };
  key_rate_durations: Record<string, number>;
  key_rate_dv01: Record<string, number>;
  holdings: Holding[];
  maturity_buckets: { bucket: string; market_value: number; weight: number; dv01: number; count: number }[];
  concentration: {
    hhi: number; effective_positions: number; max_weight: number; top3_weight: number; max_dv01_share: number;
    dv01_hhi: number; warnings: string[]; thresholds: { max_weight: number; max_dv01_share: number };
  };
  conventions: Record<string, string>;
  assumptions: string[];
  curve_warnings: string[];
  provenance?: Provenance;
};

export type PnlRow = {
  id: string; label: string; market_value_before: number; market_value_after: number; pnl_full: number;
  return_full: number; pnl_krd_approx: number; pnl_krd_convexity_approx: number; effective_yield_change_bp: number;
  ytm_change_bp: number; price_before: number; price_after: number; duration_before: number; duration_after: number;
  share_of_pnl: number;
};

export type ShapeInfo = {
  spread_2s10s_bp: number | null; spread_3m10y_bp: number | null; shape_2s10s: string | null;
  shape_3m10y: string | null; shape: string | null; flat_threshold_bp: number; definition: string;
};

export type ScenarioResult = {
  shocks_bp: Record<string, number>;
  base_curve_pct: Record<string, number>;
  shocked_curve_pct: Record<string, number>;
  base_zero_pct: Record<string, number>;
  shocked_zero_pct: Record<string, number>;
  base: PortfolioAnalytics;
  shocked: PortfolioAnalytics;
  pnl: PnlRow[];
  totals: {
    pnl_full: number; return_full: number; pnl_krd_approx: number; pnl_krd_convexity_approx: number;
    duration_change: number; dv01_change: number; krd_change: Record<string, number>; pnl_by_key_rate: Record<string, number>;
  };
  curve_shape_before: ShapeInfo;
  curve_shape_after: ShapeInfo;
  assumptions: string[];
  commentary?: string[];
  risk_observations?: string[];
  classification?: string;
  provenance?: Provenance;
};

export class ApiError extends Error {}

function detailToString(d: unknown): string {
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d
      .map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).slice(1).join(".")}: ${e.msg ?? ""}`)
      .join("; ");
  return JSON.stringify(d);
}

async function engineFetch(path: string, method: string, json: unknown): Promise<{ ok: boolean; status: number; text: () => string; bytes: () => Uint8Array; contentType: string }> {
  const r = await engineRequest(method, path, json !== undefined ? JSON.stringify(json) : undefined);
  return {
    ok: r.status < 400,
    status: r.status,
    contentType: r.contentType,
    text: () => (r.isB64 ? "" : r.payload),
    bytes: () => (r.isB64 ? b64ToBytes(r.payload) : new TextEncoder().encode(r.payload)),
  };
}

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  if (BROWSER_ENGINE) {
    const r = await engineFetch(path, json !== undefined ? "POST" : rest.method ?? "GET", json);
    if (rest.signal?.aborted) throw new DOMException("aborted", "AbortError");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.text());
    } catch {
      /* non-JSON */
    }
    if (!r.ok) throw new ApiError(detailToString((parsed as { detail?: unknown })?.detail ?? `${r.status}`));
    return parsed as T;
  }
  const res = await fetch(path, {
    ...rest,
    method: json !== undefined ? "POST" : rest.method ?? "GET",
    headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = detailToString(j.detail);
    } catch {
      /* non-JSON error body */
    }
    if (res.status >= 500 && msg.includes("ECONNREFUSED")) msg = "Analytics backend is not reachable.";
    throw new ApiError(msg);
  }
  return (await res.json()) as T;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function apiDownload(path: string, json: unknown, filename: string) {
  if (BROWSER_ENGINE) {
    const r = await engineFetch(path, "POST", json);
    if (!r.ok) {
      let msg = `${r.status}`;
      try {
        msg = detailToString(JSON.parse(r.text()).detail);
      } catch {}
      throw new ApiError(msg);
    }
    saveBlob(new Blob([r.bytes() as BlobPart], { type: r.contentType }), filename);
    return;
  }
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = detailToString((await res.json()).detail);
    } catch {}
    throw new ApiError(msg);
  }
  saveBlob(await res.blob(), filename);
}

type State<T> = { data: T | null; error: string | null; loading: boolean };

/** GET (or POST when body given) with abort-on-change and optional debounce. Body changes re-trigger. */
export function useApi<T>(path: string | null, body?: unknown, debounceMs = 0) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!path });
  const [nonce, setNonce] = useState(0);
  const key = path ? `${path}|${body === undefined ? "" : JSON.stringify(body)}|${nonce}` : null;
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!key || !path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      apiFetch<T>(path, { signal: c.signal, ...(body !== undefined ? { json: body } : {}) })
        .then((data) => {
          if (!c.signal.aborted) setState({ data, error: null, loading: false });
        })
        .catch((e: Error) => {
          if (e.name === "AbortError" || c.signal.aborted) return;
          setState((s) => ({ data: s.data, error: e.message || "Request failed", loading: false }));
        });
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
