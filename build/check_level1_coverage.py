#!/usr/bin/env python3
"""Fail unless characters.json covers all 3,500 通用规范汉字表 level-1 characters.

Coverage is exact: a traditional character already in the file does not count
as its simplified form. Level-1 entries are data/level-1.txt, one character
per line, from the standard table.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LEVEL1 = REPO_ROOT / "data" / "level-1.txt"
CHARACTERS = REPO_ROOT / "data" / "characters.json"
VOCAB = REPO_ROOT / "data" / "vocab.json"


def level1_chars(path: Path) -> list[str]:
    chars: list[str] = []
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if len(line) == 1 and line not in seen:
            seen.add(line)
            chars.append(line)
    return chars


def main() -> int:
    chars = level1_chars(LEVEL1)
    if len(chars) != 3500:
        print(f"level-1 list has {len(chars)} characters, expected 3500", file=sys.stderr)
        return 1

    data = json.loads(CHARACTERS.read_text(encoding="utf-8"))
    keys = data.get("characters") or {}
    missing = [ch for ch in chars if ch not in keys]
    covered = len(chars) - len(missing)
    print(f"characters.json level-1 coverage: {covered}/{len(chars)}")
    if missing:
        print("missing: " + "".join(missing[:80]), file=sys.stderr)
        return 1

    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
    cards = vocab.get("cards") or []
    ids = [card.get("id") for card in cards]
    if len(ids) != len(set(ids)):
        print("duplicate card ids", file=sys.stderr)
        return 1

    by_id = {card.get("id"): card for card in cards}
    anchor = by_id.get("da-shi")
    if not anchor or anchor.get("hanzi") != "大师":
        print("existing card id da-shi no longer maps to 大师", file=sys.stderr)
        return 1

    deck = [card for card in cards if card.get("deck") == "common-3500"]
    bad_status = [card["hanzi"] for card in deck if card.get("status") != "learning"]
    if bad_status:
        print("common-3500 cards must default to learning: " + "".join(bad_status[:40]), file=sys.stderr)
        return 1
    thin = [
        card["hanzi"]
        for card in deck
        if not card.get("hanzi") or not card.get("pinyin") or not card.get("gloss")
    ]
    if thin:
        print("common-3500 cards missing hanzi, pinyin, or gloss: " + "".join(thin[:40]), file=sys.stderr)
        return 1

    ranks = [card.get("frequencyRank") for card in deck]
    ordered = sorted(ranks, key=lambda rank: (rank is None, rank or 0))
    if ranks != ordered:
        print("common-3500 cards are not in frequency order", file=sys.stderr)
        return 1

    print(f"common-3500 cards: {len(deck)} (all learning, frequency order)")
    print(f"vocab cards: {len(cards)}  characters: {len(keys)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
