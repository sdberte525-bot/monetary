"""Curated historical monetary-policy episodes.

Every announcement date below links to the primary source on
federalreserve.gov (verified to resolve when this catalog was written).
Target-rate *levels* are never hardcoded here: they are read from FRED
(DFEDTAR / DFEDTARL / DFEDTARU) at runtime. FRED records the date a new target
became effective, which since 2017 is typically the business day after the
FOMC statement.

Analysis windows are fixed, documented choices (not chosen ex post to
maximize the move) and can be overridden by the user.
"""
from __future__ import annotations

FED = "https://www.federalreserve.gov/newsevents"

HISTORICAL_EVENTS: list[dict] = [
    {
        "id": "gfc_2008",
        "name": "2008 Financial Crisis: easing to the zero lower bound",
        "window": {"start": "2008-10-07", "end": "2008-12-31"},
        "window_rule": "Business day before the coordinated Oct-8 cut through year-end, after the move to a 0-1/4% range.",
        "summary": (
            "During the 2008 crisis the FOMC cut rates in a coordinated international action, "
            "announced purchases of agency debt and agency MBS, and on Dec 16 set a 0 to 1/4 percent target range."
        ),
        "announcements": [
            {"date": "2008-10-08", "title": "Coordinated 50bp cut with other central banks", "url": f"{FED}/pressreleases/monetary20081008a.htm"},
            {"date": "2008-10-29", "title": "FOMC cuts target 50bp", "url": f"{FED}/pressreleases/monetary20081029a.htm"},
            {"date": "2008-11-25", "title": "Fed announces purchases of GSE debt and agency MBS", "url": f"{FED}/pressreleases/monetary20081125b.htm"},
            {"date": "2008-12-16", "title": "FOMC establishes 0 to 1/4% target range", "url": f"{FED}/pressreleases/monetary20081216b.htm"},
        ],
    },
    {
        "id": "taper_2013",
        "name": "2013 Taper Tantrum",
        "window": {"start": "2013-05-21", "end": "2013-09-17"},
        "window_rule": "Business day before Chairman Bernanke's May-22 JEC testimony through the day before the Sep-18 FOMC decision not to taper.",
        "summary": (
            "Signals that the pace of asset purchases could be reduced led to a sharp rise in intermediate "
            "and long Treasury yields while the policy rate stayed at the effective lower bound."
        ),
        "announcements": [
            {"date": "2013-05-22", "title": "Bernanke testimony to the Joint Economic Committee", "url": f"{FED}/testimony/bernanke20130522a.htm"},
            {"date": "2013-06-19", "title": "FOMC statement and press conference", "url": f"{FED}/pressreleases/monetary20130619a.htm"},
            {"date": "2013-09-18", "title": "FOMC continues purchases (no taper)", "url": f"{FED}/pressreleases/monetary20130918a.htm"},
        ],
    },
    {
        "id": "covid_2020",
        "name": "March 2020: emergency easing",
        "window": {"start": "2020-03-02", "end": "2020-03-31"},
        "window_rule": "Business day before the Mar-3 inter-meeting cut through month-end.",
        "summary": (
            "Two unscheduled cuts (50bp on Mar 3, 100bp on Mar 15) returned the target to 0-1/4 percent; "
            "on Mar 23 the Fed announced purchases of Treasuries and agency MBS in the amounts needed."
        ),
        "announcements": [
            {"date": "2020-03-03", "title": "Emergency 50bp cut", "url": f"{FED}/pressreleases/monetary20200303a.htm"},
            {"date": "2020-03-15", "title": "Emergency 100bp cut to 0-1/4%", "url": f"{FED}/pressreleases/monetary20200315a.htm"},
            {"date": "2020-03-23", "title": "Extensive new measures incl. open-ended asset purchases", "url": f"{FED}/pressreleases/monetary20200323b.htm"},
        ],
    },
    {
        "id": "tightening_2022",
        "name": "2022 Monetary Tightening",
        "window": {"start": "2022-03-15", "end": "2022-12-30"},
        "window_rule": "Business day before the first hike (Mar-16) through the last business day of 2022.",
        "summary": "The FOMC raised the target range by a cumulative 425bp in 2022, including four consecutive 75bp increases.",
        "announcements": [
            {"date": "2022-03-16", "title": "First hike of the cycle (+25bp)", "url": f"{FED}/pressreleases/monetary20220316a.htm"},
            {"date": "2022-06-15", "title": "+75bp", "url": f"{FED}/pressreleases/monetary20220615a.htm"},
            {"date": "2022-12-14", "title": "+50bp to 4-1/4 to 4-1/2%", "url": f"{FED}/pressreleases/monetary20221214a.htm"},
        ],
    },
    {
        "id": "banking_2023",
        "name": "2023 Regional Banking Stress",
        "window": {"start": "2023-03-08", "end": "2023-03-24"},
        "window_rule": "Two days before Silicon Valley Bank's closure (Mar-10) through the Friday after the Mar-22 FOMC.",
        "summary": (
            "Following bank failures, the Treasury, Fed and FDIC announced measures on Mar 12, including a new "
            "Bank Term Funding Program. Two-year yields fell sharply as markets repriced the policy path; "
            "the FOMC still raised the range by 25bp on Mar 22."
        ),
        "announcements": [
            {"date": "2023-03-12", "title": "Joint statement; Bank Term Funding Program", "url": f"{FED}/pressreleases/monetary20230312a.htm"},
            {"date": "2023-03-22", "title": "FOMC +25bp", "url": f"{FED}/pressreleases/monetary20230322a.htm"},
        ],
    },
    {
        "id": "easing_2024",
        "name": "2024 Monetary Easing",
        "window": {"start": "2024-09-17", "end": "2024-12-31"},
        "window_rule": "Business day before the Sep-18 cut through year-end.",
        "summary": (
            "The FOMC cut 100bp cumulatively (50, 25, 25). Over the same window long-term Treasury yields rose: "
            "a clear illustration that policy-rate cuts need not lower long yields."
        ),
        "announcements": [
            {"date": "2024-09-18", "title": "-50bp", "url": f"{FED}/pressreleases/monetary20240918a.htm"},
            {"date": "2024-11-07", "title": "-25bp", "url": f"{FED}/pressreleases/monetary20241107a.htm"},
            {"date": "2024-12-18", "title": "-25bp", "url": f"{FED}/pressreleases/monetary20241218a.htm"},
        ],
    },
    {
        "id": "easing_2025",
        "name": "2025 Monetary Easing",
        "window": {"start": "2025-09-16", "end": "2025-12-31"},
        "window_rule": "Business day before the Sep-17 cut through year-end.",
        "summary": "The FOMC cut the target range by 25bp at each of its September, October and December 2025 meetings.",
        "announcements": [
            {"date": "2025-09-17", "title": "-25bp", "url": f"{FED}/pressreleases/monetary20250917a.htm"},
            {"date": "2025-10-29", "title": "-25bp", "url": f"{FED}/pressreleases/monetary20251029a.htm"},
            {"date": "2025-12-10", "title": "-25bp", "url": f"{FED}/pressreleases/monetary20251210a.htm"},
        ],
    },
    {
        "id": "hike_2026",
        "name": "September 2026 Rate Increase",
        "window": {"start": "2026-09-15", "end": "2026-10-30"},
        "window_rule": "Business day before the Sep-16 decision through the end of October 2026.",
        "summary": (
            "The FOMC raised the target range by 25bp to 3-3/4 to 4 percent; the statement noted that "
            "inflation remains elevated."
        ),
        "announcements": [
            {"date": "2026-09-16", "title": "+25bp to 3-3/4 to 4%", "url": f"{FED}/pressreleases/monetary20260916a.htm"},
        ],
    },
]

EVENTS_BY_ID = {e["id"]: e for e in HISTORICAL_EVENTS}
