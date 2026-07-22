#!/usr/bin/env python3
"""Extract unique CJK characters from vocab.json into 20 research batches."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VOCAB = REPO_ROOT / "data" / "vocab.json"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "char_batches"
BATCH_COUNT = 20

CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]")
# Capture Structure and Origin prose near a bold character heading when present.
CHAR_SECTION_RE = re.compile(
    r"\*\*([^\s(*（]{1,4})\s*(?:\([^)]*\))?\*\*"
    r"(?:(?!\*\*[^\s(*（]{1,4}).){0,800}?"
    r"\*\*Structure and Origin:\*\*\s*(.+?)(?=\s*\*\*[A-Za-z\u4e00-\u9fff]|\s*</|$)",
    re.DOTALL | re.IGNORECASE,
)


def is_cjk(ch: str) -> bool:
    return bool(CJK_RE.fullmatch(ch))


def collect_hints(cards: list[dict]) -> dict[str, str]:
    """Map character -> existing Structure and Origin snippet from detailsHtml."""
    hints: dict[str, list[str]] = {}
    for card in cards:
        html = card.get("detailsHtml") or ""
        if "Structure and Origin" not in html:
            continue
        for m in CHAR_SECTION_RE.finditer(html):
            ch = (m.group(1) or "").strip()
            if len(ch) != 1 or not is_cjk(ch):
                continue
            prose = re.sub(r"<[^>]+>", " ", m.group(2) or "")
            prose = re.sub(r"\s+", " ", prose).strip()
            if len(prose) < 20:
                continue
            hints.setdefault(ch, []).append(prose[:600])
        # Also try single-char cards with Structure and Origin but no per-char heading
        hanzi = card.get("hanzi") or ""
        if len(hanzi) == 1 and is_cjk(hanzi) and hanzi not in hints:
            m2 = re.search(
                r"\*\*Structure and Origin:\*\*\s*(.+?)(?=\s*\*\*|</|$)",
                html,
                re.DOTALL | re.IGNORECASE,
            )
            if m2:
                prose = re.sub(r"<[^>]+>", " ", m2.group(1) or "")
                prose = re.sub(r"\s+", " ", prose).strip()
                if len(prose) >= 20:
                    hints.setdefault(hanzi, []).append(prose[:600])
    return {ch: items[0] for ch, items in hints.items()}


def collect_pinyin_guess(cards: list[dict]) -> dict[str, str]:
    """Best-effort pinyin for single-char cards; for compounds leave empty."""
    out: dict[str, str] = {}
    for card in cards:
        hanzi = card.get("hanzi") or ""
        pinyin = (card.get("pinyin") or "").strip()
        if len(hanzi) == 1 and is_cjk(hanzi) and pinyin and hanzi not in out:
            out[hanzi] = pinyin
    return out


def collect_gloss_guess(cards: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for card in cards:
        hanzi = card.get("hanzi") or ""
        gloss = (card.get("gloss") or "").strip()
        if len(hanzi) == 1 and is_cjk(hanzi) and gloss and hanzi not in out:
            out[hanzi] = gloss[:120]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vocab", type=Path, default=DEFAULT_VOCAB)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--batches", type=int, default=BATCH_COUNT)
    args = parser.parse_args()

    data = json.loads(args.vocab.read_text(encoding="utf-8"))
    cards = data.get("cards") or []

    chars: set[str] = set()
    for card in cards:
        for ch in card.get("hanzi") or "":
            if is_cjk(ch):
                chars.add(ch)

    ordered = sorted(chars)
    hints = collect_hints(cards)
    pinyin_guess = collect_pinyin_guess(cards)
    gloss_guess = collect_gloss_guess(cards)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    # Clear old batch/out files
    for p in args.out_dir.glob("batch_*.json"):
        p.unlink()
    for p in args.out_dir.glob("out_*.json"):
        p.unlink()

    n = max(1, args.batches)
    # Even split
    batches: list[list[str]] = [[] for _ in range(n)]
    for i, ch in enumerate(ordered):
        batches[i % n].append(ch)
    # Rebalance to contiguous slices for clearer agent ownership
    size = (len(ordered) + n - 1) // n
    batches = [ordered[i * size : (i + 1) * size] for i in range(n)]
    batches = [b for b in batches if b]

    manifest = []
    for i, batch_chars in enumerate(batches):
        items = []
        for ch in batch_chars:
            items.append(
                {
                    "char": ch,
                    "pinyinHint": pinyin_guess.get(ch, ""),
                    "meaningHint": gloss_guess.get(ch, ""),
                    "originHint": hints.get(ch, ""),
                }
            )
        payload = {
            "batchIndex": i,
            "batchId": f"{i:02d}",
            "count": len(items),
            "chars": items,
        }
        path = args.out_dir / f"batch_{i:02d}.json"
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest.append({"batchId": f"{i:02d}", "count": len(items), "path": path.name})

    (args.out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "totalChars": len(ordered),
                "batchCount": len(batches),
                "batches": manifest,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(batches)} batches ({len(ordered)} chars) -> {args.out_dir}")
    print(f"Origin hints available for {len(hints)} characters")


if __name__ == "__main__":
    main()
