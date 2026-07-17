#!/usr/bin/env python3
"""Build data/journey.json from Obsidian vault git snapshots + curated milestones."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VAULT = Path(r"C:/Users/Dong/Desktop/Obsidian")
DEFAULT_OUT = REPO_ROOT / "data" / "journey.json"

LEARNING_REL = "More Life/_040 Chinese Vocabulary.md"
KNOWN_REL = "More Life/_042 Chinese Known Words.md"

ENTRY_RE = re.compile(
    r"([\u4e00-\u9fff][\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]*)\s*;;"
)

# Seed milestones (dates aligned with known vault history). Editable here.
MILESTONES: list[dict[str, str]] = [
    {
        "date": "2024-05-15",
        "title": "Chinese notes in the vault",
        "detail": "Vocabulary tracking starts in Obsidian.",
    },
    {
        "date": "2024-06-17",
        "title": "Learning deck active",
        "detail": "Large learning list established (~1900 entries).",
    },
    {
        "date": "2024-09-15",
        "title": "Known deck grows",
        "detail": "Words move into the known note (~600 known).",
    },
    {
        "date": "2025-03-17",
        "title": "Steady known growth",
        "detail": "Known crosses ~750 while learning consolidates.",
    },
    {
        "date": "2026-05-23",
        "title": "Known near 850",
        "detail": "Known deck reaches ~850 words.",
    },
    {
        "date": "2026-07-17",
        "title": "More Life Chinese site",
        "detail": "Library, Study, and Progress go live on GitHub Pages.",
    },
]


def run_git(vault: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=vault,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout


def extract_hanzi(text: str) -> set[str]:
    return set(ENTRY_RE.findall(text or ""))


def show_file(vault: Path, sha: str, rel: str) -> str | None:
    result = subprocess.run(
        ["git", "show", f"{sha}:{rel}"],
        cwd=vault,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def list_touching_commits(vault: Path) -> list[tuple[str, str]]:
    """Return (date, sha) newest-first for commits touching either vocab note."""
    out = run_git(
        vault,
        "log",
        "--format=%H %ad",
        "--date=short",
        "--",
        LEARNING_REL,
        KNOWN_REL,
    )
    rows: list[tuple[str, str]] = []
    for line in out.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2:
            rows.append((parts[1], parts[0]))
    return rows


def sample_commits(
    commits: list[tuple[str, str]],
    *,
    max_points: int = 36,
) -> list[tuple[str, str]]:
    """Keep roughly monthly samples + first/last, oldest-first for the series."""
    if not commits:
        return []

    by_month: dict[str, tuple[str, str]] = {}
    for date, sha in commits:
        month = date[:7]
        if month not in by_month:
            by_month[month] = (date, sha)

    monthly = sorted(by_month.values(), key=lambda x: x[0])

    oldest = commits[-1]
    newest = commits[0]
    keyed = {d: (d, s) for d, s in monthly}
    keyed[oldest[0]] = oldest
    keyed[newest[0]] = newest

    selected = sorted(keyed.values(), key=lambda x: x[0])
    if len(selected) <= max_points:
        return selected

    step = max(1, (len(selected) - 1) // (max_points - 1))
    thinned = [selected[i] for i in range(0, len(selected), step)]
    if thinned[-1] != selected[-1]:
        thinned.append(selected[-1])
    return thinned[:max_points]


def count_at(vault: Path, sha: str) -> dict[str, int] | None:
    learning_text = show_file(vault, sha, LEARNING_REL)
    known_text = show_file(vault, sha, KNOWN_REL)
    if learning_text is None and known_text is None:
        return None
    learning = extract_hanzi(learning_text or "")
    known = extract_hanzi(known_text or "")
    learning_only = learning - known
    return {
        "learning": len(learning_only),
        "known": len(known),
        "total": len(learning_only | known),
    }


def auto_milestones(series: list[dict[str, Any]]) -> list[dict[str, str]]:
    extras: list[dict[str, str]] = []
    thresholds = [500, 800]
    seen_titles = {m["title"] for m in MILESTONES}
    for thr in thresholds:
        for point in series:
            if int(point["known"]) >= thr:
                title = f"Known reaches {thr}"
                if title not in seen_titles:
                    extras.append(
                        {
                            "date": point["date"],
                            "title": title,
                            "detail": f"Known deck crossed {thr} words.",
                        }
                    )
                    seen_titles.add(title)
                break
    return extras


def build_journey(vault: Path) -> dict[str, Any]:
    if not (vault / ".git").exists():
        raise SystemExit(f"Vault is not a git repo: {vault}")

    commits = list_touching_commits(vault)
    if not commits:
        raise SystemExit("No git history found for vocab notes.")

    samples = sample_commits(commits)
    series: list[dict[str, Any]] = []
    last_counts: tuple[int, int, int] | None = None

    for date, sha in samples:
        counts = count_at(vault, sha)
        if not counts:
            continue
        key = (counts["learning"], counts["known"], counts["total"])
        if last_counts == key and series and date != samples[-1][0]:
            continue
        series.append({"date": date, **counts})
        last_counts = key

    try:
        learning_now = extract_hanzi(
            (vault / LEARNING_REL).read_text(encoding="utf-8")
        )
        known_now = extract_hanzi((vault / KNOWN_REL).read_text(encoding="utf-8"))
        learning_only = learning_now - known_now
        today = datetime.now(timezone.utc).date().isoformat()
        now_point = {
            "date": today,
            "learning": len(learning_only),
            "known": len(known_now),
            "total": len(learning_only | known_now),
        }
        if not series or series[-1]["date"] != today:
            if series and (
                series[-1]["learning"],
                series[-1]["known"],
                series[-1]["total"],
            ) == (now_point["learning"], now_point["known"], now_point["total"]):
                series[-1]["date"] = today
            else:
                series.append(now_point)
        else:
            series[-1] = now_point
    except OSError:
        pass

    milestones = list(MILESTONES) + auto_milestones(series)
    milestones.sort(key=lambda m: m["date"])

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "series": series,
        "milestones": milestones,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build learning-journey series from Obsidian git history"
    )
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    data = build_journey(args.vault)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out}")
    print(f"series points: {len(data['series'])}")
    print(f"milestones: {len(data['milestones'])}")
    if data["series"]:
        first, last = data["series"][0], data["series"][-1]
        print(
            f"range: {first['date']} -> {last['date']} "
            f"(known {first['known']} -> {last['known']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
