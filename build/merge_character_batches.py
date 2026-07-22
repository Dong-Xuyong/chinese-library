#!/usr/bin/env python3
"""Merge data/char_batches/out_XX.json into data/characters.json."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BATCH_DIR = REPO_ROOT / "data" / "char_batches"
DEFAULT_VOCAB = REPO_ROOT / "data" / "vocab.json"
DEFAULT_OUT = REPO_ROOT / "data" / "characters.json"


def expected_chars(vocab_path: Path) -> set[str]:
    data = json.loads(vocab_path.read_text(encoding="utf-8"))
    chars: set[str] = set()
    for card in data.get("cards") or []:
        for ch in card.get("hanzi") or "":
            if "\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf" or "\uf900" <= ch <= "\ufaff":
                chars.add(ch)
    return chars


def normalize_entry(ch: str, raw: dict) -> dict:
    comp = raw.get("composition") if isinstance(raw.get("composition"), dict) else {}
    parts_in = comp.get("parts") if isinstance(comp.get("parts"), list) else []
    parts = []
    for p in parts_in:
        if not isinstance(p, dict):
            continue
        parts.append(
            {
                "char": str(p.get("char") or "")[:8],
                "role": str(p.get("role") or "other")[:40],
                "note": str(p.get("note") or "")[:200],
            }
        )
    return {
        "char": ch,
        "pinyin": str(raw.get("pinyin") or "")[:80],
        "meaning": str(raw.get("meaning") or "")[:200],
        "composition": {
            "type": str(comp.get("type") or "unknown")[:40],
            "parts": parts,
            "formula": str(comp.get("formula") or "")[:120],
        },
        "origin": str(raw.get("origin") or "")[:1200],
        "history": str(raw.get("history") or "")[:800],
        "sources": [
            str(s)[:80]
            for s in (raw.get("sources") if isinstance(raw.get("sources"), list) else ["internal-synthesis"])
        ][:8],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-dir", type=Path, default=DEFAULT_BATCH_DIR)
    parser.add_argument("--vocab", type=Path, default=DEFAULT_VOCAB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()

    expected = expected_chars(args.vocab)
    merged: dict[str, dict] = {}
    files = sorted(args.batch_dir.glob("out_*.json"))
    if not files:
        raise SystemExit(f"No out_*.json files in {args.batch_dir}")

    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        entries = payload.get("characters")
        if isinstance(entries, dict):
            iterable = entries.items()
        elif isinstance(entries, list):
            iterable = ((e.get("char"), e) for e in entries if isinstance(e, dict))
        else:
            raise SystemExit(f"{path.name}: missing characters object/list")
        for ch, raw in iterable:
            if not ch or not isinstance(raw, dict):
                continue
            ch = str(ch)
            if ch not in expected:
                continue
            merged[ch] = normalize_entry(ch, raw)

    missing = sorted(expected - set(merged))
    extra = sorted(set(merged) - expected)
    print(f"Merged {len(merged)} / {len(expected)} characters from {len(files)} files")
    if missing:
        print(f"Missing {len(missing)}: {''.join(missing[:40])}{'…' if len(missing) > 40 else ''}")
    if extra:
        print(f"Extra (ignored already): {len(extra)}")

    if missing and not args.allow_partial:
        raise SystemExit("Refusing to write incomplete characters.json (pass --allow-partial)")

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(merged),
        "characters": {ch: merged[ch] for ch in sorted(merged)},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
