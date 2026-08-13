#!/usr/bin/env python3
"""EXAMPLE supplement schedule, expanded across the whole week.

Prints two markdown pipe tables (daytime + nighttime), one row per supplement
per day, that the Telegram gateway renders into rich tables. Source of truth is
your own protocol (the boxes you actually run). Static data, zero deps, relayed verbatim by the
/supplements command in agent.yaml, same pattern as state.py --sofar.

Usage:
  supplements.py
"""

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# EXAMPLE stack. Replace with your own supplements, doses, and timing.
# (name, amount, days). days=None means every day; a set restricts to those days.
# Edit here when the stack changes (e.g. confirm the inositol dose off the bottle,
# or re-add zinc if you restart a 5-on/2-off pulse).
DAYTIME = [
    ("Methylated B-complex", "1 cap", None),
    ("Omega-3 fish oil", "2-3 g", None),
    ("CoQ10", "100-200 mg", None),
    ("NAC", "600 mg", None),
    ("Selenium", "100-200 mcg", None),
    ("L-theanine", "100-200 mg", None),
    ("Creatine", "5 g", None),
    ("Vitamin D3 (loading)", "50,000 IU", {"Sunday"}),
    ("Vitamin K2 (MK-7)", "100-200 mcg", {"Sunday"}),
]

NIGHTTIME = [
    ("Magnesium glycinate", "300-400 mg", None),
    ("NAC", "600 mg", None),
    ("Phosphatidylserine", "100-300 mg", None),
    ("Inositol (myo)", "per bottle", None),
]


def table(items):
    rows = ["| Day | Supplement | Amount |", "|---|---|---|"]
    for day in DAYS:
        for name, amt, days in items:
            if days is None or day in days:
                rows.append(f"| {day} | {name} | {amt} |")
    return "\n".join(rows)


def main():
    out = []
    out.append("## ☀️ Daytime supplements")
    out.append("")
    out.append(table(DAYTIME))
    out.append("")
    out.append("## \U0001F319 Nighttime supplements")
    out.append("")
    out.append(table(NIGHTTIME))
    print("\n".join(out))


if __name__ == "__main__":
    main()
