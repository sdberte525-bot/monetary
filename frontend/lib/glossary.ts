/** Finance terminology used by tooltips throughout the terminal. */
export const G = {
  targetRange:
    "The Federal Open Market Committee's target range for the federal funds rate (overnight interbank lending). Source: FRED DFEDTARL/DFEDTARU.",
  effr: "Effective federal funds rate: volume-weighted median of overnight fed funds trades (FRED: DFF).",
  parYield:
    "Treasury par yield (CMT): the coupon at which a hypothetical Treasury of that maturity would price at par, on a semiannual bond-equivalent basis. Not a zero-coupon rate.",
  zeroRate:
    "Spot (zero-coupon) rate bootstrapped from par yields: the yield on a single cash flow at that maturity, semiannually compounded.",
  forward: "6-month forward rate implied by the discount curve between t−0.5y and t.",
  s2s10:
    "10-year minus 2-year Treasury par yield, in basis points. Negative = inverted. A common gauge of the market-implied policy path and term premium.",
  s3m10:
    "10-year minus 3-month Treasury par yield, in basis points. Inversions have historically preceded U.S. recessions (Estrella & Mishkin, 1996) – an empirical regularity, not a forecast.",
  shape:
    "Classification by spread: inverted < 0 bp; flat 0–25 bp; normal ≥ 25 bp. Headline uses 10Y–3M when available.",
  marketValue: "Dirty market value: (clean price + accrued interest) × face / 100, summed across holdings.",
  modDur:
    "Modified duration: approximate % change in price for a 1-percentage-point (100 bp) change in the bond's own yield. Dmod = Macaulay duration / (1 + y/f). Portfolio value is market-value weighted.",
  macDur: "Macaulay duration: present-value-weighted average time to receipt of cash flows, in years.",
  effDur:
    "Effective duration: (P₋ − P₊)/(2·P₀·Δy) from full repricing after ±1 bp parallel shifts of the par curve (re-bootstrapped).",
  convexity:
    "Convexity: second derivative of price w.r.t. yield divided by price (years²). Positive convexity means gains from falling yields exceed losses from equal rises.",
  dv01: "DV01 / PVBP: dollar loss for a +1 bp parallel increase in yields (shown positive). Portfolio DV01 is the sum across holdings.",
  krd: "Key-rate duration: sensitivity to a 1 bp triangular bump of the par curve at one tenor, others fixed (Ho, 1992). KRDs sum to effective duration.",
  krDv01: "Key-rate DV01: dollar loss for a +1 bp bump at a single tenor.",
  cashFlowYield:
    "Cash-flow yield: the single semiannual bond-equivalent rate that discounts the portfolio's aggregated cash flows to its total dirty market value.",
  mvYtm: "Market-value-weighted average of each holding's yield to maturity. A convenient approximation; not the portfolio IRR.",
  accrued: "Accrued interest: coupon earned since the last payment date, paid by the buyer to the seller (ACT/ACT ICMA for Treasuries).",
  ytm: "Yield to maturity: the discount rate equating the present value of cash flows to the dirty price (street convention, compounding at coupon frequency).",
  cleanPrice: "Clean price: quoted price per 100 face, excluding accrued interest.",
  dirtyPrice: "Dirty (full) price: clean price plus accrued interest – what the buyer actually pays.",
  hhi: "Herfindahl–Hirschman index of market-value weights: Σwᵢ². 1/HHI is the effective number of equally-sized positions.",
  pnlFull: "Profit/loss from full cash-flow revaluation on the shocked, re-bootstrapped curve. The authoritative scenario result.",
  pnlApprox: "First-order estimate: −Σ (key-rate DV01 × tenor shock). Ignores convexity, so it overstates losses and understates gains.",
  pnlCvx: "First-order estimate plus ½ × convexity × (Δy_eff)² × MV, where Δy_eff is the KRD-weighted average shock.",
  surprise:
    "The part of a policy move that was not already priced in. Only the surprise moves yields through the pass-through channel; expected moves are already in market prices.",
  passThrough:
    "β(tenor): assumed bp change in that Treasury yield per 1 bp of policy surprise. Illustrative assumption, editable – not an estimate.",
  pathRevision:
    "Shift in the market's expected path of future policy rates (e.g. forward guidance). Loading peaks at 1–3 years.",
  termPremium:
    "Shift in term premium / inflation compensation. Loading rises with maturity, so it mainly moves long yields.",
  dollarDuration: "Dollar duration: Dmod × dirty market value – the dollar price change per 100% change in yield (DV01 × 10,000).",
};
