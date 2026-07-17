#!/usr/bin/env python3
"""Parse Obsidian Chinese vocab notes into data/vocab.json."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_LEARNING = Path(
    r"C:/Users/Dong/Desktop/Obsidian/More Life/_040 Chinese Vocabulary.md"
)
DEFAULT_KNOWN = Path(
    r"C:/Users/Dong/Desktop/Obsidian/More Life/_042 Chinese Known Words.md"
)
DEFAULT_OUT = REPO_ROOT / "data" / "vocab.json"
DEFAULT_AUDIO_DIRS = [
    Path(r"C:/Users/Dong/Desktop/Obsidian/Journal/attachments"),
]
DEFAULT_AUDIO_OUT = REPO_ROOT / "audio"

HANZI_RE = re.compile(r"[\u4e00-\u9fff]")
ENTRY_RE = re.compile(
    r"^(?P<prefix>.*?)"
    r"(?P<hanzi>[\u4e00-\u9fff][\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]*)"
    r"\s*;;\s*"
    r"(?:\((?P<pinyin>[^)]*)\))?\s*"
    r"(?:-\s*(?P<rest>.+))?$"
)
DETAILS_RE = re.compile(
    r"<details>(.*?)</details>", re.IGNORECASE | re.DOTALL
)
USAGE_RE = re.compile(
    r"\*\*Usage in Sentence:\*\*\s*"
    r"(?P<body>.*?)(?:</details>|$)",
    re.IGNORECASE | re.DOTALL,
)
# Chinese example ending with 。！？… then optional (pinyin) then Translation: english
USAGE_PARTS_RE = re.compile(
    r"(?P<zh>[\u4e00-\u9fff][^()]{0,200}?[。！？…])"
    r"\s*"
    r"(?:\((?P<pinyin>[^)]+)\)\.?)?"
    r"\s*"
    r"(?:Translation:\s*(?P<en>[\"'].*?[\"']|[^.]+(?:\.[^.]+)*\.?))?",
    re.DOTALL,
)
TRAILING_MARKERS_RE = re.compile(
    r"\s*(?:@|\$|#quote|!\[\[[^\]]*\]\])\s*$", re.IGNORECASE
)
AUDIO_EMBED_RE = re.compile(
    r"!\[\[([^\]|]+\.mp3)(?:\|[^\]]*)?\]\]", re.IGNORECASE
)
HAS_AT_RE = re.compile(r"(?:^|[\s>])@\s*(?:<!--|$)|(?:</details>\s*)@\s*$|@\s*$")
POS_SPLIT_RE = re.compile(r"\s+-\s+")
GLOSS_TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?", re.IGNORECASE)
HTML_TAG_RE = re.compile(r"</?(?:script|iframe|object|embed|form)[^>]*>", re.I)
ON_ATTR_RE = re.compile(r"\s+on\w+\s*=\s*(['\"]).*?\1", re.I | re.DOTALL)
JS_HREF_RE = re.compile(r"""\s+(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2""", re.I)

STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "to",
        "of",
        "and",
        "or",
        "for",
        "in",
        "on",
        "with",
        "is",
        "as",
        "by",
        "be",
        "it",
        "its",
        "at",
        "from",
        "into",
        "that",
        "this",
        "one",
        "ones",
        "used",
        "etc",
        "etc.",
    }
)

THEME_BUCKETS: dict[str, tuple[str, ...]] = {
    "food": (
        "food",
        "eat",
        "dish",
        "restaurant",
        "meat",
        "tea",
        "cook",
        "meal",
        "hot pot",
        "mutton",
    ),
    "emotion": (
        "sad",
        "happy",
        "love",
        "regret",
        "feel",
        "heart",
        "emotion",
        "angry",
        "gentle",
        "romantic",
        "sweet",
    ),
    "work": (
        "work",
        "company",
        "business",
        "job",
        "research",
        "client",
        "customer",
        "team",
    ),
    "relationship": (
        "friend",
        "partner",
        "marriage",
        "wedding",
        "family",
        "relationship",
        "couple",
        "engage",
    ),
    "internet": (
        "internet",
        "online",
        "user",
        "software",
        "social media",
        "celebrity",
        "program",
        "show",
    ),
    "travel": ("travel", "trip", "journey", "hotel", "train", "flight"),
    "body": (
        "body",
        "fitness",
        "exercise",
        "health",
        "hair",
        "face",
        "wear",
        "figure",
    ),
    "time": ("time", "season", "year", "day", "future", "sudden", "age"),
    "daily-life": ("daily", "home", "clothes", "window", "house", "life"),
}


def strip_tones(text: str) -> str:
    nfkd = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in nfkd if unicodedata.category(ch) != "Mn")


def slugify_id(pinyin: str, hanzi: str) -> str:
    base = strip_tones(pinyin or "").lower().strip()
    base = re.sub(r"[^a-z0-9\s-]", "", base)
    base = re.sub(r"[\s_]+", "-", base).strip("-")
    if not base:
        # fallback: codepoints of hanzi
        base = "-".join(f"u{ord(ch):x}" for ch in hanzi) if hanzi else "card"
    return base or "card"


def sanitize_details_html(inner: str) -> str:
    if not inner:
        return ""
    text = HTML_TAG_RE.sub("", inner)
    text = ON_ATTR_RE.sub("", text)
    text = JS_HREF_RE.sub("", text)
    return text.strip()


def richness(card: dict[str, Any]) -> tuple:
    return (
        1 if card.get("_audioSrc") else 0,
        1 if card.get("detailsHtml") else 0,
        1 if card.get("example") else 0,
        len(card.get("gloss") or ""),
        len(card.get("pinyin") or ""),
        1 if card.get("pos") else 0,
        # prefer known over learning when richness ties later
        1 if card.get("status") == "known" else 0,
    )


def extract_audio_name(line: str) -> str:
    m = AUDIO_EMBED_RE.search(line)
    return (m.group(1) or "").strip() if m else ""


def extract_usage(details_inner: str) -> tuple[str, str, str]:
    if not details_inner:
        return "", "", ""
    m = USAGE_RE.search(details_inner)
    if not m:
        return "", "", ""
    body = m.group("body").strip()
    # Prefer bold Chinese if present
    bold_zh = re.search(
        r"\*\*(?P<zh>[\u4e00-\u9fff][^*]{0,200}?[。！？…])\*\*", body
    )
    if bold_zh:
        zh = bold_zh.group("zh").strip()
        rest = body[bold_zh.end() :]
        pm = re.match(r"\s*\((?P<pinyin>[^)]+)\)\.?\s*", rest)
        pinyin = pm.group("pinyin").strip() if pm else ""
        after = rest[pm.end() :] if pm else rest
        tm = re.search(
            r"Translation:\s*(?P<en>[\"']([^\"']+)[\"']|([^.]+\.?))",
            after,
            re.I,
        )
        en = ""
        if tm:
            en = (tm.group(2) or tm.group(3) or tm.group("en") or "").strip()
            en = en.strip("\"'")
        return zh, pinyin, en

    parts = USAGE_PARTS_RE.search(body)
    if not parts:
        return "", "", ""
    zh = (parts.group("zh") or "").strip()
    pinyin = (parts.group("pinyin") or "").strip()
    en_raw = (parts.group("en") or "").strip()
    en = en_raw.strip("\"'").strip()
    # Drop trailing explanatory sentence after Translation quote if glued
    if en.startswith('"') or en.startswith("'"):
        en = en.strip("\"'")
    # Keep first sentence-ish for Translation
    if " This sentence" in en:
        en = en.split(" This sentence", 1)[0].strip().rstrip(".")
    return zh, pinyin, en


def parse_pos_gloss(rest: str) -> tuple[str, str, bool]:
    """Return (pos, gloss, has_at_marker)."""
    if not rest:
        return "", "", False

    # Detect trailing @ before we strip markers (also inside near end)
    has_at = bool(re.search(r"(?:</details>\s*)?@\s*(?:<!--|$)", rest)) or bool(
        re.search(r"\s@\s*$", rest.rstrip())
    ) or rest.rstrip().endswith("@")

    # Pull details out for gloss boundary
    details_match = DETAILS_RE.search(rest)
    before = rest[: details_match.start()] if details_match else rest

    # Strip trailing markers and wiki embeds from gloss side
    before = re.sub(r"!\[\[[^\]]*\]\]", "", before)
    before = TRAILING_MARKERS_RE.sub("", before).strip()
    before = re.sub(r"\s*[@$#]\s*$", "", before).strip()
    before = re.sub(r"\s+#quote\s*$", "", before, flags=re.I).strip()

    # Also strip HTML comments that may be glued
    before = re.sub(r"<!--.*?-->", "", before).strip()

    parts = POS_SPLIT_RE.split(before, maxsplit=1)
    if len(parts) == 1:
        # Formats like "therefore, as a result" with no POS
        gloss = parts[0].strip(" -")
        return "", gloss, has_at
    pos = parts[0].strip().lower()
    gloss = parts[1].strip()
    # Clean residual markers in gloss
    gloss = TRAILING_MARKERS_RE.sub("", gloss).strip()
    gloss = re.sub(r"\s*[@$]\s*$", "", gloss).strip()
    return pos, gloss, has_at


def gloss_tokens(gloss: str) -> list[str]:
    if not gloss:
        return []
    # Split on ; , / and spaces
    chunks = re.split(r"[;,/]+|\s+", gloss.lower())
    tokens: list[str] = []
    for chunk in chunks:
        chunk = chunk.strip(" .()[]\"'")
        if not chunk:
            continue
        for tok in GLOSS_TOKEN_RE.findall(chunk):
            t = tok.lower()
            if t in STOPWORDS or len(t) < 2:
                continue
            tokens.append(t)
    return tokens


def theme_keywords(text: str, pos: str, gloss: str) -> list[str]:
    hay = f"{gloss} {text}".lower()
    found: list[str] = []
    for theme, needles in THEME_BUCKETS.items():
        if any(n in hay for n in needles):
            found.append(theme)
    if "idiom" in (pos or "").lower() or "idiom" in hay or "proverb" in hay:
        found.append("idiom")
    return found


def build_keywords(
    pos: str, status: str, gloss: str, details_text: str
) -> list[str]:
    kws: list[str] = []
    if pos:
        # normalize multiword POS to hyphenated token
        pos_norm = re.sub(r"\s+", "-", pos.strip().lower())
        kws.append(pos_norm)
    kws.append(status)
    kws.extend(gloss_tokens(gloss))
    kws.extend(theme_keywords(details_text, pos, gloss))
    # unique preserve order then sort for card? Spec says keywords on card;
    # global keywords list is sorted unique. Per-card: sorted unique is fine.
    seen: set[str] = set()
    out: list[str] = []
    for k in kws:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return sorted(out)


def parse_entry_line(line: str, status: str) -> dict[str, Any] | None:
    if ";;" not in line:
        return None
    # Skip yaml / headers / todos loosely
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or stripped.startswith("- ["):
        return None
    if stripped.startswith("---"):
        return None

    m = ENTRY_RE.search(line)
    if not m:
        return None
    hanzi = m.group("hanzi").strip()
    if not hanzi or not HANZI_RE.search(hanzi):
        return None

    # Ensure the matched hanzi is immediately before ;;
    # (avoid matching Chinese in earlier prose on a corrupt line)
    before_semi = line.split(";;", 1)[0]
    # take last contiguous Chinese run
    runs = re.findall(
        r"[\u4e00-\u9fff][\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]*",
        before_semi,
    )
    if not runs:
        return None
    hanzi = runs[-1]

    pinyin = (m.group("pinyin") or "").strip()
    rest = m.group("rest") or ""
    # If regex didn't capture rest well (no leading -), take after pinyin
    if not rest and ";;" in line:
        after = line.split(";;", 1)[1]
        after = re.sub(r"^\s*\([^)]*\)\s*", "", after)
        after = re.sub(r"^\s*-\s*", "", after)
        rest = after

    details_match = DETAILS_RE.search(rest) or DETAILS_RE.search(line)
    details_inner = details_match.group(1) if details_match else ""
    details_html = sanitize_details_html(details_inner)

    pos, gloss, has_at = parse_pos_gloss(rest if rest else line.split(";;", 1)[1])

    # Re-detect @ on full line (learning @ → known)
    if not has_at:
        has_at = bool(
            re.search(r"(?:</details>\s*)@\s*(?:<!--|$)", line)
            or re.search(r"\s@\s*(?:<!--|$)", line)
            or line.rstrip().endswith("@")
        )

    final_status = status
    if status == "learning" and has_at:
        final_status = "known"

    example, example_pinyin, example_en = extract_usage(details_inner)
    audio_src = extract_audio_name(line)

    card = {
        "id": "",  # filled later
        "hanzi": hanzi,
        "pinyin": pinyin,
        "pos": pos,
        "gloss": gloss,
        "status": final_status,
        "example": example,
        "examplePinyin": example_pinyin,
        "exampleEn": example_en,
        "detailsHtml": details_html,
        "audio": "",
        "keywords": build_keywords(pos, final_status, gloss, details_inner),
        "_audioSrc": audio_src,
    }
    return card


def parse_file(path: Path, status: str) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    cards: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        card = parse_entry_line(raw_line, status)
        if card:
            cards.append(card)
    return cards


def merge_cards(
    learning: list[dict[str, Any]], known: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_hanzi: dict[str, dict[str, Any]] = {}

    def consider(card: dict[str, Any]) -> None:
        key = card["hanzi"]
        existing = by_hanzi.get(key)
        if existing is None:
            by_hanzi[key] = card
            return
        # Prefer known status if either is known
        prefer_known = (
            card["status"] == "known" or existing["status"] == "known"
        )
        # Keep richest entry
        if richness(card) > richness(existing):
            winner = dict(card)
        elif richness(card) < richness(existing):
            winner = dict(existing)
        else:
            # tie: prefer known-sourced status
            winner = dict(card if card["status"] == "known" else existing)
        if prefer_known:
            winner["status"] = "known"
            # refresh keywords status tag
            winner["keywords"] = build_keywords(
                winner.get("pos", ""),
                "known",
                winner.get("gloss", ""),
                winner.get("detailsHtml", ""),
            )
        # Keep audio from either entry
        if not winner.get("_audioSrc"):
            winner["_audioSrc"] = card.get("_audioSrc") or existing.get(
                "_audioSrc", ""
            )
        by_hanzi[key] = winner

    # Process learning first, then known (known preferred on ties via richness/status)
    for c in learning:
        consider(c)
    for c in known:
        consider(c)

    return list(by_hanzi.values())


def assign_ids(cards: list[dict[str, Any]]) -> None:
    used: dict[str, int] = {}
    # Stable-ish order: by hanzi
    cards.sort(key=lambda c: (c.get("pinyin") or "", c["hanzi"]))
    for card in cards:
        base = slugify_id(card.get("pinyin") or "", card["hanzi"])
        n = used.get(base, 0) + 1
        used[base] = n
        card["id"] = base if n == 1 else f"{base}-{n}"


def index_audio_files(audio_dirs: list[Path]) -> dict[str, Path]:
    index: dict[str, Path] = {}
    for directory in audio_dirs:
        if not directory.is_dir():
            continue
        for path in directory.glob("*.mp3"):
            index.setdefault(path.name, path)
    return index


def sync_audio(
    cards: list[dict[str, Any]],
    audio_dirs: list[Path],
    audio_out: Path,
) -> dict[str, int]:
    """Copy matched Obsidian mp3s into audio/{id}.mp3 and set card['audio']."""
    index = index_audio_files(audio_dirs)
    audio_out.mkdir(parents=True, exist_ok=True)

    # Remove stale generated files not referenced this run
    keep: set[str] = set()
    copied = 0
    missing = 0
    with_src = 0

    for card in cards:
        src_name = (card.pop("_audioSrc", None) or "").strip()
        card_id = card["id"]
        dest_name = f"{card_id}.mp3"
        dest = audio_out / dest_name

        if not src_name:
            card["audio"] = ""
            continue

        with_src += 1
        src = index.get(src_name)
        if src is None:
            card["audio"] = ""
            missing += 1
            continue

        shutil.copy2(src, dest)
        card["audio"] = f"./audio/{dest_name}"
        keep.add(dest_name)
        copied += 1

    # Clean orphaned mp3s from previous builds
    removed = 0
    for path in audio_out.glob("*.mp3"):
        if path.name not in keep:
            path.unlink(missing_ok=True)
            removed += 1

    return {
        "with_embed": with_src,
        "copied": copied,
        "missing": missing,
        "removed": removed,
    }


def build_output(
    learning_path: Path,
    known_path: Path,
    audio_dirs: list[Path] | None = None,
    audio_out: Path | None = None,
) -> tuple[dict[str, Any], dict[str, int]]:
    learning_cards = parse_file(learning_path, "learning")
    known_cards = parse_file(known_path, "known")
    merged = merge_cards(learning_cards, known_cards)
    assign_ids(merged)

    audio_stats = sync_audio(
        merged,
        audio_dirs or DEFAULT_AUDIO_DIRS,
        audio_out or DEFAULT_AUDIO_OUT,
    )

    learning_n = sum(1 for c in merged if c["status"] == "learning")
    known_n = sum(1 for c in merged if c["status"] == "known")
    audio_n = sum(1 for c in merged if c.get("audio"))

    all_keywords: set[str] = set()
    all_pos: set[str] = set()
    for c in merged:
        all_keywords.update(c.get("keywords") or [])
        if c.get("pos"):
            all_pos.add(c["pos"])

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "total": len(merged),
            "learning": learning_n,
            "known": known_n,
            "withAudio": audio_n,
        },
        "keywords": sorted(all_keywords),
        "posList": sorted(all_pos),
        "cards": merged,
    }
    stats = {
        "raw_learning": len(learning_cards),
        "raw_known": len(known_cards),
        "total": len(merged),
        "learning": learning_n,
        "known": known_n,
        "with_audio": audio_n,
        **audio_stats,
    }
    return out, stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse Chinese vocab markdown")
    parser.add_argument("--learning", type=Path, default=DEFAULT_LEARNING)
    parser.add_argument("--known", type=Path, default=DEFAULT_KNOWN)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--audio-dir",
        type=Path,
        action="append",
        dest="audio_dirs",
        help="Directory of Obsidian .mp3 attachments (repeatable)",
    )
    parser.add_argument("--audio-out", type=Path, default=DEFAULT_AUDIO_OUT)
    args = parser.parse_args()

    if not args.learning.is_file():
        raise SystemExit(f"Learning file not found: {args.learning}")
    if not args.known.is_file():
        raise SystemExit(f"Known file not found: {args.known}")

    data, stats = build_output(
        args.learning,
        args.known,
        audio_dirs=args.audio_dirs or DEFAULT_AUDIO_DIRS,
        audio_out=args.audio_out,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {args.out}")
    print(
        f"counts: total={stats['total']} learning={stats['learning']} "
        f"known={stats['known']} withAudio={stats['with_audio']}"
    )
    print(
        f"raw parsed: learning={stats['raw_learning']} "
        f"known={stats['raw_known']}"
    )
    print(
        f"audio: embeds={stats['with_embed']} copied={stats['copied']} "
        f"missing={stats['missing']} removed={stats['removed']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
