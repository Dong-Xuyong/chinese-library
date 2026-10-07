#!/usr/bin/env python3
"""Merge the committed 通用规范汉字表 level-1 supplement into vocab and characters.

Obsidian rebuilds must not drop or overwrite these cards. Supplemental cards live
in data/common-3500.json and are appended after Obsidian ids are assigned.
Existing hanzi entries and existing card ids are left unchanged.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "data" / "common-3500.json"
DEFAULT_VOCAB = REPO_ROOT / "data" / "vocab.json"
DEFAULT_CHARACTERS = REPO_ROOT / "data" / "characters.json"


def load_source(path: Path | None = None) -> dict[str, Any]:
    path = path or DEFAULT_SOURCE
    if not path.is_file():
        return {"cards": [], "characters": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    cards = data.get("cards") if isinstance(data.get("cards"), list) else []
    characters = data.get("characters") if isinstance(data.get("characters"), dict) else {}
    return {"cards": cards, "characters": characters, "raw": data}


def _unique_id(base: str, used: set[str]) -> str:
    if base not in used:
        return base
    n = 2
    while f"{base}-{n}" in used:
        n += 1
    return f"{base}-{n}"


def merge_cards(cards: list[dict[str, Any]], source_cards: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Append supplemental cards whose hanzi is not already a card.

    Does not reorder or rewrite existing cards, so ids assigned from Obsidian
    stay stable. New cards stay in source order (most frequent first).
    """
    if source_cards is None:
        source_cards = load_source()["cards"]
    existing_hanzi = {str(c.get("hanzi") or "") for c in cards}
    used_ids = {str(c.get("id") or "") for c in cards}
    appended: list[dict[str, Any]] = []
    for raw in source_cards:
        if not isinstance(raw, dict):
            continue
        hanzi = str(raw.get("hanzi") or "")
        if not hanzi or hanzi in existing_hanzi:
            continue
        card = dict(raw)
        card["status"] = "learning"
        card["deck"] = card.get("deck") or "common-3500"
        base = str(card.get("id") or "").strip() or f"c3500-u{ord(hanzi[0]):x}"
        card["id"] = _unique_id(base, used_ids)
        used_ids.add(card["id"])
        existing_hanzi.add(hanzi)
        appended.append(card)
    if not appended:
        return cards
    return list(cards) + appended


def refresh_vocab_meta(data: dict[str, Any]) -> dict[str, Any]:
    cards = data.get("cards") or []
    keywords = set(data.get("keywords") or [])
    keywords.add("common-3500")
    for card in cards:
        for kw in card.get("keywords") or []:
            if kw:
                keywords.add(kw)
    data["keywords"] = sorted(keywords)
    learning = sum(1 for c in cards if c.get("status") == "learning")
    known = sum(1 for c in cards if c.get("status") == "known")
    with_audio = sum(1 for c in cards if c.get("audio"))
    data["counts"] = {
        "total": len(cards),
        "learning": learning,
        "known": known,
        "withAudio": with_audio,
    }
    data["generatedAt"] = datetime.now(timezone.utc).isoformat()
    return data


def merge_character_entries(
    characters: dict[str, Any],
    source_characters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Add missing character entries. Never replace an entry that is already there."""
    if source_characters is None:
        source_characters = load_source()["characters"]
    for ch, raw in source_characters.items():
        if not ch or ch in characters or not isinstance(raw, dict):
            continue
        characters[ch] = raw
    return characters


def apply_vocab_file(vocab_path: Path | None = None, source_path: Path | None = None) -> int:
    vocab_path = vocab_path or DEFAULT_VOCAB
    source = load_source(source_path)
    data = json.loads(vocab_path.read_text(encoding="utf-8"))
    before_ids = [(c.get("id"), c.get("hanzi")) for c in data.get("cards") or []]
    data["cards"] = merge_cards(data.get("cards") or [], source["cards"])
    after = {(c.get("id"), c.get("hanzi")) for c in data["cards"]}
    for pair in before_ids:
        if pair not in after:
            raise SystemExit(f"Refusing to write vocab: existing card changed {pair}")
    refresh_vocab_meta(data)
    vocab_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(data["cards"]) - len(before_ids)


def apply_characters_file(
    characters_path: Path | None = None,
    source_path: Path | None = None,
) -> int:
    characters_path = characters_path or DEFAULT_CHARACTERS
    source = load_source(source_path)
    data = json.loads(characters_path.read_text(encoding="utf-8"))
    characters = data.get("characters")
    if not isinstance(characters, dict):
        characters = {}
        data["characters"] = characters
    before = len(characters)
    merge_character_entries(characters, source["characters"])
    data["count"] = len(characters)
    data["generatedAt"] = datetime.now(timezone.utc).isoformat()
    characters_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(characters) - before
