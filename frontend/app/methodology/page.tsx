import { Card, CardBody, CardHeader } from "@/components/ui/primitives";

function F({ children }: { children: React.ReactNode }) {
  return <pre className="num my-1.5 overflow-x-auto rounded border border-border bg-bg px-3 py-2 text-xs leading-relaxed text-fg">{children}</pre>;
}
function S({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card id={id}>
      <CardHeader title={title} />
      <CardBody className="space-y-2 text-xs leading-relaxed text-fg/90 [&_li]:ml-4 [&_li]:list-disc [&_b]:text-fg">{children}</CardBody>
    </Card>
  );
}

const TOC = [
  ["units", "Units & conventions"], ["data", "Data sources & integrity"], ["pricing", "Bond pricing"], ["risk", "Duration, convexity, DV01"],
  ["curve", "Discount-curve construction"], ["krd", "Key-rate durations"], ["portfolio", "Portfolio analytics"], ["scen", "Curve scenarios"],
  ["policy", "Policy transmission model"], ["hist", "Historical scenarios"], ["opt", "Optimization"], ["macro", "Macro statistics"],
  ["valid", "Validation & tests"], ["limits", "Limitations"], ["refs", "References"],
];

export default function MethodologyPage() {
  return (
    <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-[220px_1fr]">
      <nav className="hidden xl:block">
        <div className="sticky top-16 space-y-0.5 rounded-md border border-border bg-panel p-2">
          {TOC.map(([id, t], i) => (
            <a key={id} href={`#${id}`} className="block rounded px-2 py-1 text-xs text-muted hover:bg-panel2 hover:text-fg">
              {i + 1}. {t}
            </a>
          ))}
        </div>
      </nav>
      <div className="min-w-0 space-y-3">
        <S id="units" title="1 · Units & conventions">
          <ul>
            <li>Yields are entered and displayed in <b>percent</b> and stored internally as decimals: 4.25% = 0.0425. 1 basis point (bp) = 0.01% = 0.0001.</li>
            <li>Prices are per 100 of face value. Position values = price × face / 100. Market value uses the <b>dirty</b> price.</li>
            <li>Treasury par yields are semiannual bond-equivalent. Zero and forward rates are reported with semiannual compounding unless stated.</li>
            <li>DV01 is reported as a <b>positive</b> dollar loss for a +1 bp rise in yields. P&L is green when positive, red when negative.</li>
            <li>Settlement: T+1 business day after the curve date (U.S. federal holidays are not modeled in settlement arithmetic).</li>
          </ul>
        </S>

        <S id="data" title="2 · Data sources & integrity">
          <ul>
            <li><b>U.S. Treasury Daily Par Yield Curve Rates</b> (1M–30Y; 1990–present) — downloaded per year as CSV from home.treasury.gov.</li>
            <li><b>FRED</b> (Federal Reserve Bank of St. Louis): DFEDTARU/DFEDTARL (target range, from 2008-12-16), DFEDTAR (point target, to 2008-12-15), DFF, CPIAUCSL, PCEPILFE, UNRATE, DGS3MO, DGS2, DGS10, T10Y2Y, T10Y3M. Keyless CSV endpoint, or the FRED API when <code>FRED_API_KEY</code> is set.</li>
            <li><b>Federal Reserve Board</b> press releases and testimony — cited for every historical announcement.</li>
            <li>A <b>bundled snapshot</b> of these official data ships with the backend so the app runs offline. In <code>auto</code> mode the backend refreshes from the official source when a source-specific TTL expires (Treasury and daily FRED series 6h; monthly macro 24h) and falls back to the snapshot on failure. Every response carries provenance (source, URL, live/snapshot, retrieval time, last observation); snapshot data are always labeled “not live”.</li>
            <li>Missing observations are <b>never filled</b>. Tenors not published on a date (1M before 2001, 20Y before 1993-10, 30Y 2002-02 → 2006-02) are excluded from that date&apos;s curve and flagged.</li>
            <li>All date lookups use the last observation <b>on or before</b> the requested date (no look-ahead). Values outside [−5%, 30%] are rejected at ingestion.</li>
          </ul>
        </S>

        <S id="pricing" title="3 · Bond pricing">
          <p>Coupon dates are generated backward from maturity in steps of 12/f months (end-of-month rule if maturity is a month-end). Regular schedules are assumed (odd first coupons are not modeled; they do not affect valuation of remaining flows). A coupon falling on the settlement date belongs to the seller.</p>
          <F>{`Accrued interest  AI = (C / f) × accrual fraction
  ACT/ACT-ICMA : days(prev coupon → settlement) / days(prev coupon → next coupon)
  30/360 (US)  : D30(prev → settle) / D30(prev → next)   (SIFMA/ISDA bond basis)
  ACT/360      : days × f / 360        ACT/365F : days × f / 365

Street-convention price (w = fraction of current period remaining):
  Dirty P(y) = Σₖ CFₖ / (1 + y/f)^(w + k − 1)        Clean = Dirty − AI
Zero-coupon bonds: coupon 0, semiannual compounding (STRIPS convention)  →  P = 100 / (1 + y/2)^(2T)`}</F>
          <p>Yield to maturity is solved with <b>Brent&apos;s method</b> (scipy.optimize.brentq, bracket [−50%, 300%], x-tol 1e-14), which is guaranteed to converge because price is strictly decreasing in yield. Custom cash flows use ACT/365F time and user-chosen compounding (including continuous).</p>
          <F>{`Horizon total return (per 100 face, exact identity):
  Total = coupons received + reinvestment income + (AI₁ − AI₀)
        + [Clean(h, y₀) − Clean(0, y₀)]      accretion / roll-down at constant yield
        + [Clean(h, y₁) − Clean(h, y₀)]      rate effect`}</F>
        </S>

        <S id="risk" title="4 · Duration, convexity, DV01">
          <F>{`Macaulay   D_mac = Σ tₖ·PVₖ / P                      (tₖ in years)
Modified   D_mod = D_mac / (1 + y/f)               = −(1/P)·dP/dy
Convexity  C     = Σ PVₖ·tₖ(tₖ + 1/f) / [P (1 + y/f)²] = (1/P)·d²P/dy²
DV01       = D_mod × P_dirty × 0.0001   (per 100 face; × face/100 for a position)
Dollar duration = D_mod × P_dirty

Approximations (Δy in decimals, 100 bp = 0.01):
  ΔP/P ≈ −D_mod·Δy                       first order
  ΔP/P ≈ −D_mod·Δy + ½·C·(Δy)²           second order
Effective (curve) duration / convexity, h = 1 bp parallel par-curve shift, full repricing:
  D_eff = (P₋ − P₊) / (2·P₀·h)           C_eff = (P₋ + P₊ − 2P₀) / (P₀·h²)`}</F>
          <p>The Bond Laboratory always shows approximations next to full repricing, and reports the approximation errors in bp of price.</p>
        </S>

        <S id="curve" title="5 · Discount-curve construction (par → zero)">
          <p>Treasury CMT yields are <b>par yields</b>, not zero rates. MONETARY bootstraps discount factors with these explicit assumptions:</p>
          <F>{`1. Interpolation: par yields linear in maturity between published tenors; flat outside.
2. Bills (t ≤ 1y) are zero-coupon on a bond-equivalent basis:
     t < 0.5 :  DF(t) = 1 / (1 + y·t)            0.5 ≤ t ≤ 1 :  DF(t) = (1 + y/2)^(−2t)
3. Coupon nodes t = 1.5, 2.0, …, 30 are par bonds paying c(t)/2 semiannually:
     DF(t) = (1 − c/2 · Σ_{tⱼ<t} DF(tⱼ)) / (1 + c/2)
4. Between nodes ln DF is linear (piecewise-constant forward rates);
   beyond the last node the final forward is extrapolated flat (flagged).
5. No day-count or settlement lag inside the bootstrap; on-the-run liquidity premia ignored.
Zero rate (s.a.): z = 2·(DF^(−1/(2t)) − 1)        6M forward: f = 2·((DF(t−½)/DF(t)) − 1)`}</F>
          <p>Validated by repricing every par node at exactly 100 (to 1e-12) and by recovering a flat zero curve from a flat par curve. Forward rates magnify interpolation choices; kinks in the par curve (e.g. 20Y above 30Y) appear as jumps in forwards. These are textbook choices, not Treasury&apos;s or the Fed&apos;s production models (Gürkaynak, Sack & Wright fit a smooth Svensson curve). Users may alternatively supply their own spot rates.</p>
        </S>

        <S id="krd" title="6 · Key-rate durations">
          <p>For each published tenor k, the par yield at k is bumped by ±1 bp with all other tenors fixed (a triangular bump under linear interpolation), the discount curve is re-bootstrapped and every cash flow re-discounted (Ho, 1992).</p>
          <F>{`KRDₖ = (P₋ₖ − P₊ₖ) / (2·P₀·0.0001)        KR-DV01ₖ = (P₋ₖ − P₊ₖ) / 2
Σₖ KRDₖ ≈ D_eff  (asserted in tests to 1e-4 relative)
First-order scenario P&L ≈ −Σₖ KR-DV01ₖ × Δyₖ(bp)`}</F>
          <p>Because par-curve bumps reshape the bootstrapped zero curve, a bond can show small negative KRDs at tenors shorter than its maturity — a known property of par-rate key-rate durations.</p>
        </S>

        <S id="portfolio" title="7 · Portfolio analytics">
          <ul>
            <li>Every holding is valued on the bootstrapped Treasury zero curve with zero spread; its YTM is then solved from that model price.</li>
            <li>Weights wᵢ = dirty MVᵢ / Σ dirty MV. Portfolio D_mod, D_eff, convexity and KRDs are MV-weighted; DV01 and KR-DV01 are summed in dollars.</li>
            <li>Duration contribution = wᵢ·D_mod,ᵢ; DV01 share = DV01ᵢ / Σ DV01.</li>
            <li>Portfolio yield is reported two ways: MV-weighted YTM (an approximation) and the <b>cash-flow yield</b> — the IRR of aggregated cash flows against total dirty MV (s.a. basis).</li>
            <li>Concentration: HHI = Σwᵢ², effective N = 1/HHI; warnings when a position exceeds 35% of MV or 50% of DV01 (documented, adjustable thresholds).</li>
            <li>Scenarios are instantaneous with static positions. P&L is <b>full revaluation</b>; KRD and KRD+convexity estimates are shown alongside, where the convexity term uses ½·C_eff·(Δy_eff)²·MV with Δy_eff the KRD-weighted average shock.</li>
          </ul>
        </S>

        <S id="scen" title="8 · Curve scenarios">
          <p>Shape scenarios are defined by anchor shocks at a few tenors, interpolated linearly in maturity and held flat outside the outermost anchors (e.g. bull steepener: 2Y −50 bp, 10Y −15 bp). Shocks are applied to <b>par</b> yields, then the curve is re-bootstrapped. Moves are named by the level and 2Y–10Y slope change: bull = yields fall, bear = yields rise; steepening = 10Y−2Y widens.</p>
          <p>Curve shape (normal / flat / inverted) uses spreads: inverted if &lt; 0 bp, flat if 0–25 bp, normal if ≥ 25 bp; the headline uses 10Y−3M when available, else 10Y−2Y.</p>
        </S>

        <S id="policy" title="9 · Monetary-policy transmission model (scenario tool, not a forecast)">
          <F>{`Δy(t) = β(t)·S  +  L_path(t)·path_bp  +  L_tp(t)·term_premium_bp  +  overlay(t)
S     = policy_move × (1 − priced_in)          (the unexpected part of the decision)`}</F>
          <ul>
            <li><b>β(t)</b> — pass-through of the policy surprise, declining with maturity by default (0.95 at 1M → 0.17 at 30Y). The direction and rough magnitudes are consistent with event-study evidence (Kuttner 2001; Gürkaynak, Sack & Swanson 2005), but the values are <b>illustrative assumptions</b>, editable per tenor, and are not estimated by this application.</li>
            <li><b>L_path</b> — loading of a revision to the expected policy path (peaks at 2Y). <b>L_tp</b> — loading of a term-premium / inflation-compensation shift (rises to 1 at 30Y).</li>
            <li>Interpretation presets (expected, hawkish/dovish surprise, inflation shock, recession shock, higher-for-longer) only set priced_in, path_bp and term_premium_bp — all visible and adjustable.</li>
            <li>Transmission profiles change β(t): front-end led (default), parallel (β = 1, an upper-bound benchmark), steepening, flattening, credibility twist, or custom. An optional overlay adds an explicit parallel/steepening/flattening/twist shock.</li>
            <li>A fully anticipated move (priced_in = 100%) with no path or term-premium change produces <b>no</b> curve shock — the central point that policy-rate changes are not mechanically transmitted to Treasury yields.</li>
            <li>All interpretive text is generated from computed outputs via templates.</li>
          </ul>
        </S>

        <S id="hist" title="10 · Historical scenarios">
          <ul>
            <li><b>Observed:</b> actual Treasury par-yield changes between the last observations on or before the window start and end; the target range is read from FRED; announcement dates cite federalreserve.gov. Windows follow fixed, documented rules (e.g. business day before the first action to year-end) and can be overridden.</li>
            <li><b>Hypothetical:</b> the observed changes are applied as an instantaneous shock to today&apos;s curve and portfolios. This is <b>not a backtest</b>: it ignores the historical curve level, carry, roll-down, reinvestment, and trading over the window.</li>
            <li><b>Assumptions:</b> if a tenor was not published in the window, its shock is linearly interpolated from observed tenors and listed explicitly.</li>
          </ul>
        </S>

        <S id="opt" title="11 · Optimization">
          <F>{`Variables: MV weights w ∈ ℝⁿ, Σw = 1; bounds 0 ≤ wᵢ ≤ w_max (long-only) or −w_max ≤ wᵢ ≤ w_max
Optional: Σ wᵢ·D_mod,ᵢ = D*;  Σ_{i∈bucket} wᵢ ≤ cap
min_concentration : min Σwᵢ²
match_krd / risk_target : min Σₖ ωₖ (Σᵢ wᵢ·KRDᵢₖ − targetₖ)² + 1e-4·Σwᵢ²
max_yield : max Σ wᵢ·YTMᵢ − 1e-4·Σwᵢ²     (yield ≠ expected return)`}</F>
          <p>Solved with SLSQP (ftol 1e-12) after a HiGHS linear feasibility check; status, iterations, objective value and constraint residuals are reported. Face amounts = wᵢ·capital / (dirtyᵢ/100). No transaction costs or expected-return model. Barbell-vs-bullet weights are solved analytically to match the bullet&apos;s modified duration and market value.</p>
        </S>

        <S id="macro" title="12 · Macro statistics">
          <ul>
            <li>Daily series → monthly averages; inflation = 12-month % change of seasonally adjusted price indexes; data indexed by reference month (not release date — CPI/PCE/payroll data are released with a lag).</li>
            <li>Pearson correlations of levels and of k-month changes, rolling correlations over a trailing window, optional lag of the indicator. No p-values are shown because the series are highly persistent (spurious-regression risk, Granger & Newbold 1974). Correlation does not establish causation.</li>
          </ul>
        </S>

        <S id="valid" title="13 · Validation & automated tests (pytest)">
          <ul>
            <li>Textbook prices: 20-year 9% bond at 6% = 134.6722; 20-year 10% at 11% = 91.9770 (Fabozzi); modified duration 10.66. Hull Table 4.6: 3-year 10% bond at 12% continuous → 94.213, duration 2.653.</li>
            <li>50 random bonds match the closed-form annuity price and closed-form Macaulay duration to 1e-9.</li>
            <li>Duration and convexity match finite differences; DV01 equals the actual 1 bp repricing loss; zero-coupon Macaulay duration equals maturity.</li>
            <li>Hand-computed accrued interest under ACT/ACT and 30/360; end-of-month schedules; coupon-on-settlement handling.</li>
            <li>Bootstrap reprices par bonds at 100; flat par → flat zero; KRDs sum to effective duration; shocks beyond a bond&apos;s maturity leave it unchanged.</li>
            <li>Portfolio aggregation identities, linear scaling, parallel & non-parallel shocks, convexity improving approximations, barbell duration matching.</li>
            <li>Optimizer constraints and residuals, infeasibility detection, KRD matching; policy-channel decomposition identities.</li>
            <li>Missing-data handling, no-look-ahead date alignment, and every cited rate-change announcement aligned with a FRED target change.</li>
          </ul>
        </S>

        <S id="limits" title="14 · Limitations">
          <ul>
            <li>Securities are generic Treasury-style bonds valued at zero spread; no credit, liquidity, repo specialness, optionality, inflation-linked or floating-rate instruments.</li>
            <li>The par curve is the on-the-run-based CMT curve; actual off-the-run Treasuries trade at spreads to it. Linear interpolation creates kinks in forwards.</li>
            <li>Scenarios are instantaneous and static; no carry, roll-down or rebalancing in scenario P&L (the Bond Lab horizon tool shows carry separately).</li>
            <li>The policy transmission model is a transparent scenario translator with assumed coefficients, not an estimated or predictive model.</li>
            <li>Settlement ignores holidays; Treasury&apos;s final-period simple-interest yield convention is not used.</li>
          </ul>
        </S>

        <S id="refs" title="15 · References">
          <ul>
            <li>Fabozzi, F. J. <i>Bond Markets, Analysis, and Strategies</i>. Pearson.</li>
            <li>Tuckman, B. & Serrat, A. <i>Fixed Income Securities: Tools for Today&apos;s Markets</i>. Wiley.</li>
            <li>Hull, J. C. <i>Options, Futures, and Other Derivatives</i>. Pearson (Table 4.6).</li>
            <li>Ho, T. S. Y. (1992). Key Rate Durations: Measures of Interest Rate Risks. <i>Journal of Fixed Income</i> 2(2).</li>
            <li>Kuttner, K. N. (2001). Monetary policy surprises and interest rates: Evidence from the Fed funds futures market. <i>Journal of Monetary Economics</i> 47(3).</li>
            <li>Gürkaynak, R. S., Sack, B. & Swanson, E. (2005). Do Actions Speak Louder Than Words? <i>International Journal of Central Banking</i> 1(1).</li>
            <li>Gürkaynak, R. S., Sack, B. & Wright, J. H. (2007). The U.S. Treasury yield curve: 1961 to the present. <i>Journal of Monetary Economics</i> 54(8).</li>
            <li>Estrella, A. & Mishkin, F. S. (1996). The Yield Curve as a Predictor of U.S. Recessions. <i>FRBNY Current Issues</i> 2(7).</li>
            <li>Granger, C. W. J. & Newbold, P. (1974). Spurious regressions in econometrics. <i>Journal of Econometrics</i> 2(2).</li>
          </ul>
        </S>
      </div>
    </div>
  );
}
