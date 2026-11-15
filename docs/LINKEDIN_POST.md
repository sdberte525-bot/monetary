# LinkedIn launch post (draft)

I've been building something to sharpen the fixed-income side of my Applied Economics work at Boston College: **MONETARY**, an open-source research terminal for Treasury curves, monetary policy and bond-portfolio interest-rate risk.

What it does:
• Pulls official U.S. Treasury par yields and FRED data, and bootstraps a zero-coupon curve from the par curve (par yields are not zero rates, so this matters).
• Prices bonds and portfolios cash flow by cash flow: duration, convexity, DV01, key-rate durations, and full-revaluation scenario P&L alongside the duration approximations, so you can see the approximation error.
• A monetary-policy simulator that translates a hypothetical Fed decision into a curve shock through explicit, editable channels: the policy surprise (only the part not already priced in), revisions to the expected policy path, and term premium. A fully expected cut moves nothing through the surprise channel, which is the point.
• Historical episodes (2008, the 2013 taper tantrum, March 2020, 2022, the 2023 bank stress, 2024–25 easing) using actual yield data, with each Fed action linked to its primary source. In the 2024 window the Fed cut 100 bp while the 10-year rose about 93 bp.
• Barbell-vs-bullet and key-rate-matching optimization (SciPy), with the solver status and constraints shown.

What it is not: a forecasting model. The scenario tools run on assumptions you set and can see, and the historical replays are stress tests, not backtests.

Stack: Python (FastAPI, NumPy, SciPy, pandas) with 96 tests against textbook and closed-form benchmarks, plus a Next.js/TypeScript front end.

I'd welcome feedback from anyone in fixed-income research or portfolio management, especially on the transmission assumptions.

[GitHub link] · [Live demo link]

#FixedIncome #MonetaryPolicy #Treasuries #QuantitativeFinance #Python #Economics
