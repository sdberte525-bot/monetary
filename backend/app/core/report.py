"""One-page research brief (structured JSON) and PDF rendering (ReportLab)."""
from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.narrative import _money, risk_observations, scenario_commentary

LIMITATIONS = [
    "Scenario shocks are user-specified assumptions translated by a transparent, illustrative model; they are not forecasts of Federal Reserve decisions or Treasury yields.",
    "Valuation uses a bootstrapped Treasury par curve with linear par-yield interpolation; securities are Treasury-style bonds with zero spread (no credit, liquidity or optionality).",
    "Shocks are instantaneous with static positions: no carry, roll-down, reinvestment, rebalancing or transaction costs.",
    "Key-rate risk is measured with triangular par-curve bumps; results depend on the choice of key rates and interpolation.",
    "Historical scenarios, if referenced, apply observed yield changes to today's portfolio and are not backtests.",
]


def build_brief(
    sc: dict,
    market: dict,
    scenario_label: str,
    scenario_assumptions: list[str],
    policy: dict | None = None,
    portfolio_name: str = "Portfolio",
) -> dict:
    base = sc["base"]
    summ = base["summary"]
    comp = [
        {"label": h["label"], "weight": h["weight"], "market_value": h["market_value"],
         "modified_duration": h["modified_duration"], "dv01": h["dv01"]}
        for h in base["holdings"]
    ]
    drivers = sorted(sc["pnl"], key=lambda r: abs(r["pnl_full"]), reverse=True)[:5]
    return {
        "title": f"Interest-Rate Scenario Brief - {portfolio_name}",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sections": {
            "market_environment": [
                f"Treasury par curve as of {market['curve_as_of']} ({market['curve_mode']} data, source: U.S. Treasury).",
                f"Fed target range {market['policy_lower']:.2f}-{market['policy_upper']:.2f}% (FRED, as of {market['policy_as_of']}).",
                f"2Y {market['y2']:.2f}%, 10Y {market['y10']:.2f}%; 10Y-2Y spread {market['s2s10']:.0f} bp, "
                f"10Y-3M spread {market['s3m10']:.0f} bp (curve classified {market['shape']}).",
            ],
            "scenario_assumptions": [scenario_label, *scenario_assumptions],
            "portfolio_composition": comp,
            "interest_rate_risk": {
                "market_value": summ["market_value"],
                "modified_duration": summ["modified_duration"],
                "effective_duration": summ["effective_duration"],
                "convexity": summ["convexity"],
                "dv01": summ["dv01"],
                "cash_flow_yield_pct": summ["cash_flow_yield_pct"],
            },
            "key_rate_exposures": {"krd": base["key_rate_durations"], "kr_dv01": base["key_rate_dv01"]},
            "scenario_pnl": sc["totals"],
            "main_drivers": [
                {"label": d["label"], "pnl": d["pnl_full"], "share": d["share_of_pnl"]} for d in drivers
            ],
            "commentary": scenario_commentary(sc, policy, market.get("policy_range")),
            "limitations": LIMITATIONS,
            "implications": risk_observations(sc),
            "sources": market.get("sources", []),
        },
    }


def render_pdf(brief: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            topMargin=0.4 * inch, bottomMargin=0.4 * inch, title=brief["title"],
                            author="MONETARY Fixed Income Research Terminal")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=14, spaceAfter=2, textColor=colors.HexColor("#0b1f3a"))
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=9.5, spaceBefore=4, spaceAfter=1,
                        textColor=colors.HexColor("#0b1f3a"))
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=7.6, leading=9.2, alignment=TA_LEFT, spaceBefore=0, spaceAfter=0.5)
    small = ParagraphStyle("s", parent=body, fontSize=6.3, leading=7.6, textColor=colors.HexColor("#555555"))
    s = brief["sections"]
    el = [Paragraph(brief["title"], h1),
          Paragraph(f"Generated {brief['generated_at_utc']} - calculation-based commentary; not investment advice.", small)]

    def bullets(title, items):
        el.append(Paragraph(title, h2))
        for it in items:
            el.append(Paragraph(f"&bull; {it}", body))

    bullets("Market environment", s["market_environment"])
    bullets("Scenario assumptions", s["scenario_assumptions"])

    el.append(Paragraph("Portfolio composition & risk", h2))
    rows = [["Security", "Weight", "Market value", "Mod. dur", "DV01"]]
    for c in s["portfolio_composition"]:
        rows.append([c["label"], f"{c['weight']*100:.1f}%", _money(c["market_value"]),
                     f"{c['modified_duration']:.2f}", _money(c["dv01"])])
    r = s["interest_rate_risk"]
    rows.append(["Portfolio", "100%", _money(r["market_value"]), f"{r['modified_duration']:.2f}", _money(r["dv01"])])
    el.append(_table(rows))
    el.append(Paragraph(
        f"Effective duration {r['effective_duration']:.2f}y; convexity {r['convexity']:.1f}; cash-flow yield "
        f"{r['cash_flow_yield_pct']:.3f}% (s.a. bond-equivalent).", body))

    el.append(Paragraph("Key-rate exposures and scenario P&L attribution", h2))
    krd = s["key_rate_exposures"]["krd"]
    krdv = s["key_rate_exposures"]["kr_dv01"]
    pk = s["scenario_pnl"]["pnl_by_key_rate"]
    tenors = list(krd)
    el.append(_table([
        ["", *tenors],
        ["KRD (y)", *[f"{krd[t]:.2f}" for t in tenors]],
        ["KR-DV01", *[_money(krdv[t]) for t in tenors]],
        ["P&L (1st ord.)", *[_money(pk[t]) for t in tenors]],
    ], font=6.5))
    t = s["scenario_pnl"]
    el.append(Paragraph(
        f"<b>Scenario P&amp;L (full revaluation): {_money(t['pnl_full'])} ({t['return_full']*100:+.2f}%)</b>; "
        f"KRD approximation {_money(t['pnl_krd_approx'])}; with convexity {_money(t['pnl_krd_convexity_approx'])}.", body))

    bullets("Main drivers & interpretation", s["commentary"])
    bullets("Portfolio management implications (analytical, not recommendations)", s["implications"])
    el.append(Paragraph("Limitations", h2))
    for it in s["limitations"]:
        el.append(Paragraph(f"&bull; {it}", small))
    if s["sources"]:
        el.append(Paragraph("Sources", h2))
        for it in s["sources"]:
            el.append(Paragraph(f"&bull; {it}", small))
    doc.build(el)
    return buf.getvalue()


def _table(rows, font=7.5):
    t = Table(rows, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", font),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", font),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b1f3a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f4f8")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c8cfd9")),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
    ]))
    return t
