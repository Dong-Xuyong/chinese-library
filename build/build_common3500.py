#!/usr/bin/env python3
"""Build data/common-3500.json from CC-CEDICT, Unihan, and Make Me a Hanzi.

Fills level-1 通用规范汉字表 characters that are missing from the app.
Does not invent etymologies: origin and history stay empty. Structure comes
from Make Me a Hanzi decompositions and, if that is missing, the Unihan
radical. Glosses and example words come from CC-CEDICT.

Download the inputs once (see data/SOURCES.md) and pass --cache.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from parse_vocab import build_keywords, slugify_id  # noqa: E402

HAN_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]")
CEDICT_RE = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+/(.*)/$")
IDC_ARITY = {
    "⿰": 2,
    "⿱": 2,
    "⿴": 2,
    "⿵": 2,
    "⿶": 2,
    "⿷": 2,
    "⿸": 2,
    "⿹": 2,
    "⿺": 2,
    "⿻": 2,
    "⿼": 2,
    "⿽": 2,
    "⿲": 3,
    "⿳": 3,
    "⿾": 1,
    "⿿": 1,
}
IDC_TYPE = {
    "⿰": "left-right",
    "⿱": "top-bottom",
    "⿲": "left-middle-right",
    "⿳": "top-middle-bottom",
    "⿴": "enclosure",
    "⿵": "top-enclosure",
    "⿶": "bottom-enclosure",
    "⿷": "left-enclosure",
    "⿸": "top-left-enclosure",
    "⿹": "top-right-enclosure",
    "⿺": "bottom-left-enclosure",
    "⿻": "overlay",
}
TONE_MARKS = {
    "a": "āáǎàa",
    "e": "ēéěèe",
    "i": "īíǐìi",
    "o": "ōóǒòo",
    "u": "ūúǔùu",
    "ü": "ǖǘǚǜü",
}


def is_han(ch: str) -> bool:
    return bool(ch) and bool(HAN_RE.fullmatch(ch))


def strip_tones(text: str) -> str:
    nfkd = unicodedata.normalize("NFD", text.replace("ü", "u").replace("Ü", "U"))
    return "".join(ch for ch in nfkd if unicodedata.category(ch) != "Mn")


def syllable_to_tone(syllable: str) -> str:
    syl = syllable.strip().lower().replace("u:", "ü").replace("v", "ü")
    if not syl:
        return ""
    tone = 5
    if syl[-1].isdigit():
        tone = int(syl[-1])
        syl = syl[:-1]
    if not syl:
        return ""
    if tone == 5:
        return syl
    if tone < 1 or tone > 4:
        return syl
    idx = None
    if "a" in syl:
        idx = syl.index("a")
    elif "e" in syl:
        idx = syl.index("e")
    elif "ou" in syl:
        idx = syl.index("o")
    else:
        for i, ch in enumerate(syl):
            if ch in "aeiouü":
                idx = i
    if idx is None or syl[idx] not in TONE_MARKS:
        return syl
    marked = TONE_MARKS[syl[idx]][tone - 1]
    return syl[:idx] + marked + syl[idx + 1 :]


def numbered_to_pinyin(numbered: str) -> str:
    parts = [syllable_to_tone(part) for part in numbered.split() if part.strip()]
    text = " ".join(p for p in parts if p)
    if not text:
        return ""
    return text[0].upper() + text[1:]


def reading_key(text: str) -> str:
    """Compare numbered pinyin and tone-mark pinyin on the first syllable."""
    first = (text or "").strip().split()[0] if text else ""
    first = first.split("/")[0]
    if first and first[-1].isdigit():
        first = syllable_to_tone(first)
    return strip_tones(first).lower().replace("ü", "v")


SKIP_SENSE_RE = re.compile(
    r"^(cl:|see\b|variant of\b|used in\b|also pr|taiwan pr|old variant|abbr\.|abbreviation)",
    re.I,
)
VULGAR_RE = re.compile(
    r"\b(fuck|fucker|damn|damned|shit|slut|whore|bastard|wretch|crap|piss|dick|porn)\b",
    re.I,
)


def clean_sense(sense: str) -> str:
    text = sense.strip()
    text = re.sub(r"[\u4e00-\u9fff]+\|[\u4e00-\u9fff]+", " ", text)
    text = re.sub(r"[\u4e00-\u9fff]+", " ", text)
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\s*CL:.*$", "", text)
    text = re.sub(r"\s*\([^)]*\)", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ;,/|")
    return text


def sense_ok(part: str) -> bool:
    if not part or SKIP_SENSE_RE.search(part):
        return False
    low = part.lower()
    if "variant of" in low or low.startswith("see "):
        return False
    if "pr." in low and len(part) < 24:
        return False
    return True


def short_gloss(raw: str, limit: int = 72) -> str:
    parts = [clean_sense(part) for part in (raw or "").split("/")]
    parts = [part for part in parts if sense_ok(part)]
    if not parts:
        return ""
    ordinary = [part for part in parts if not part.lower().startswith("surname")]
    chosen = ordinary or parts
    clauses = [clause.strip() for clause in chosen[0].split(";") if clause.strip()]
    gloss = clauses[0] if clauses else chosen[0]
    if len(clauses) > 1 and len(gloss) < 24:
        nxt = clauses[1]
        if len(nxt) <= 36:
            joined = f"{gloss}; {nxt}"
            if len(joined) <= limit:
                gloss = joined
    elif len(chosen) > 1 and len(gloss) < 18:
        nxt_bits = [bit.strip() for bit in chosen[1].split(";") if bit.strip()]
        nxt = nxt_bits[0] if nxt_bits else ""
        if nxt and not nxt.lower().startswith("surname") and "radical" not in nxt.lower() and len(nxt) <= 32:
            joined = f"{gloss}; {nxt}"
            if len(joined) <= limit:
                gloss = joined
    return gloss[:limit].rstrip(" ;,")


def gloss_overlap(left: str, right: str) -> bool:
    words = {w for w in re.findall(r"[a-z]{3,}", left.lower()) if w not in {"the", "and", "for"}}
    if not words:
        return False
    hay = right.lower()
    return any(word in hay for word in words)


def parse_ids(decomposition: str) -> list[str]:
    text = decomposition or ""
    if not text or text[0] == "？":
        return []
    index = 0

    def read() -> list[str]:
        nonlocal index
        if index >= len(text):
            return []
        ch = text[index]
        index += 1
        arity = IDC_ARITY.get(ch)
        if arity is None:
            if ch == "？" or not is_han(ch):
                return []
            return [ch]
        out: list[str] = []
        for _ in range(arity):
            out.extend(read())
        return out

    return read()


def load_level1(path: Path) -> list[str]:
    chars: list[str] = []
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if len(line) == 1 and is_han(line) and line not in seen:
            seen.add(line)
            chars.append(line)
    return chars


def load_junda(path: Path) -> dict[str, int]:
    text = path.read_bytes().decode("gb18030", errors="replace")
    ranks: dict[str, int] = {}
    for line in text.splitlines():
        if not line or not line[0].isdigit():
            continue
        parts = line.split("\t")
        if len(parts) < 2 or len(parts[1]) != 1:
            continue
        try:
            rank = int(parts[0])
        except ValueError:
            continue
        ranks.setdefault(parts[1], rank)
    return ranks


def load_cedict(path: Path) -> tuple[dict[str, list[tuple[str, str]]], dict[str, list[tuple[str, str, str]]]]:
    singles: dict[str, list[tuple[str, str]]] = {}
    compounds: dict[str, list[tuple[str, str, str]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        match = CEDICT_RE.match(line)
        if not match:
            continue
        simp, numbered, gloss = match.group(2), match.group(3), match.group(4)
        if not simp or not all(is_han(ch) for ch in simp):
            continue
        if len(simp) == 1:
            singles.setdefault(simp, []).append((numbered, gloss))
        elif 2 <= len(simp) <= 4:
            item = (simp, numbered, gloss)
            for ch in set(simp):
                compounds.setdefault(ch, []).append(item)
    return singles, compounds


def load_makemeahanzi(path: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        ch = row.get("character")
        if isinstance(ch, str) and len(ch) == 1:
            out[ch] = row
    return out


def load_unihan(cache: Path) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    mandarin: dict[str, str] = {}
    definition: dict[str, str] = {}
    radical_number: dict[str, str] = {}

    readings = cache / "Unihan_Readings.txt"
    if readings.is_file():
        for line in readings.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#") or "\t" not in line:
                continue
            code, field, value = line.split("\t", 2)
            if not code.startswith("U+"):
                continue
            ch = chr(int(code[2:], 16))
            if field == "kMandarin" and ch not in mandarin:
                mandarin[ch] = value.split()[0]
            elif field == "kDefinition" and ch not in definition:
                definition[ch] = value

    radical_file = cache / "Unihan_IRGSources.txt"
    zip_path = cache / "Unihan.zip"
    lines: list[str] = []
    if radical_file.is_file():
        lines = radical_file.read_text(encoding="utf-8").splitlines()
    elif zip_path.is_file():
        with zipfile.ZipFile(zip_path) as zf:
            lines = zf.read("Unihan_IRGSources.txt").decode("utf-8").splitlines()
    for line in lines:
        if "\tkRSUnicode\t" not in line:
            continue
        code, _field, value = line.split("\t", 2)
        if not code.startswith("U+"):
            continue
        ch = chr(int(code[2:], 16))
        radical_number.setdefault(ch, value.split()[0])

    radicals: dict[str, str] = {}
    radical_map = cache / "CJKRadicals.txt"
    number_to_char: dict[str, str] = {}
    if radical_map.is_file():
        for line in radical_map.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#"):
                continue
            bits = [part.strip() for part in line.split(";")]
            if len(bits) < 3 or not bits[2]:
                continue
            try:
                number_to_char[bits[0]] = chr(int(bits[2], 16))
            except ValueError:
                continue
    for ch, spec in radical_number.items():
        number = spec.split(".", 1)[0].rstrip("'")
        glyph = number_to_char.get(number)
        if glyph:
            radicals[ch] = glyph
    return mandarin, definition, radicals


def app_chars(vocab_path: Path, characters_path: Path) -> tuple[set[str], set[str]]:
    vocab = json.loads(vocab_path.read_text(encoding="utf-8"))
    characters = json.loads(characters_path.read_text(encoding="utf-8"))
    in_vocab: set[str] = set()
    for card in vocab.get("cards") or []:
        for ch in card.get("hanzi") or "":
            if is_han(ch):
                in_vocab.add(ch)
    in_chars: set[str] = set()
    for key, entry in (characters.get("characters") or {}).items():
        if len(key) == 1 and is_han(key):
            in_chars.add(key)
        if isinstance(entry, dict):
            ch = entry.get("char") or ""
            if len(ch) == 1 and is_han(ch):
                in_chars.add(ch)
    return in_vocab, in_chars


def pick_reading(
    ch: str,
    singles: list[tuple[str, str]],
    mandarin: dict[str, str],
    mmh: dict | None,
) -> tuple[str, str]:
    """Return (tone-mark pinyin, cedict gloss raw or '')."""
    preferred = reading_key(mandarin.get(ch, ""))
    mmh_py = ""
    if mmh:
        readings = mmh.get("pinyin") or []
        if readings and isinstance(readings[0], str):
            mmh_py = readings[0]
            if not preferred:
                preferred = reading_key(mmh_py)
    usable = [(numbered, gloss) for numbered, gloss in singles if short_gloss(gloss)]
    pool = usable or singles
    chosen = None
    if preferred:
        for numbered, gloss in pool:
            if reading_key(numbered) == preferred:
                chosen = (numbered, gloss)
                break
    if chosen is None and pool:
        chosen = pool[0]
    if chosen:
        return numbered_to_pinyin(chosen[0]), chosen[1]
    if mandarin.get(ch):
        marked = mandarin[ch]
        if marked and marked[0].islower():
            marked = marked[0].upper() + marked[1:]
        return marked, ""
    if mmh_py:
        if mmh_py[0].islower():
            mmh_py = mmh_py[0].upper() + mmh_py[1:]
        return mmh_py, ""
    return "", ""


def pick_example(
    ch: str,
    compounds: list[tuple[str, str, str]],
    ranks: dict[str, int],
    char_gloss: str = "",
) -> tuple[str, str, str]:
    best: tuple[float, str, str, str] | None = None
    for word, numbered, gloss in compounds:
        if ch not in word:
            continue
        if VULGAR_RE.search(gloss):
            continue
        low = gloss.lower()
        if "variant of" in low or low.strip().startswith("see "):
            continue
        english = short_gloss(gloss, 100)
        if not english or VULGAR_RE.search(english):
            continue
        # Rarest character decides how common the word is, so 人+rare does not
        # beat a balanced compound.
        rarest = max(ranks.get(c, 9000) for c in word)
        score = rarest / 40
        score += {2: 0, 3: 8, 4: 18}.get(len(word), 40)
        score += min(len(english), 80) / 25
        if "surname" in low:
            score += 30
        if "archaic" in low or "(old" in low or "old variant" in low:
            score += 24
        if "species" in low or "latin" in low:
            score += 20
        if "(idiom)" in low or "idiom" in low:
            score += 6
        if gloss_overlap(char_gloss, english):
            score -= 12
        if best is None or score < best[0]:
            best = (score, word, numbered, gloss)
    if best is None:
        return "", "", ""
    _score, word, numbered, gloss = best
    return word, numbered_to_pinyin(numbered), short_gloss(gloss, 100)


def composition_for(
    ch: str,
    mmh: dict | None,
    radical: str,
) -> tuple[dict, list[str]]:
    sources: list[str] = []
    formula = ""
    parts: list[dict[str, str]] = []
    comp_type = "unknown"
    seen: set[str] = set()

    def add_part(glyph: str, role: str) -> None:
        if not glyph or glyph in seen or glyph == "？":
            return
        # A character that is itself the radical is still a real structure fact.
        if glyph == ch and role != "radical":
            return
        if len(glyph) != 1:
            return
        seen.add(glyph)
        parts.append({"char": glyph, "role": role, "note": ""})

    if mmh:
        decomposition = str(mmh.get("decomposition") or "")
        if decomposition and not decomposition.startswith("？"):
            formula = decomposition[:120]
            head = decomposition[0]
            comp_type = IDC_TYPE.get(head, "compound")
            for glyph in parse_ids(decomposition):
                role = "radical" if radical and glyph == radical else "component"
                add_part(glyph, role)
            sources.append("makemeahanzi")
        mmh_radical = str(mmh.get("radical") or "")
        if mmh_radical and mmh_radical != "？":
            radical = radical or mmh_radical
            if "makemeahanzi" not in sources:
                sources.append("makemeahanzi")
    if radical and radical not in seen:
        add_part(radical, "radical")
        if "unihan" not in sources and not mmh:
            sources.append("unihan")
        elif "unihan" not in sources and radical and (not mmh or str(mmh.get("radical") or "") != radical):
            sources.append("unihan")
    if not parts and not formula:
        comp_type = "unknown"
    elif comp_type == "unknown" and parts and all(p["role"] == "radical" for p in parts):
        comp_type = "radical"
    return {
        "type": comp_type,
        "parts": parts[:8],
        "formula": formula,
    }, sources


def card_id(pinyin: str, hanzi: str, used: set[str]) -> str:
    base = "c3500-" + slugify_id(pinyin, hanzi)
    if base not in used:
        used.add(base)
        return base
    n = 2
    while f"{base}-{n}" in used:
        n += 1
    ident = f"{base}-{n}"
    used.add(ident)
    return ident


def build(cache: Path, vocab_path: Path, characters_path: Path) -> dict:
    level1 = load_level1(cache / "level-1.txt")
    if len(level1) != 3500:
        raise SystemExit(f"level-1 list has {len(level1)} characters, expected 3500")
    ranks = load_junda(cache / "junda.tsv")
    singles, compounds = load_cedict(cache / "cedict.txt")
    mmh = load_makemeahanzi(cache / "dictionary.txt")
    mandarin, definitions, radicals = load_unihan(cache)
    in_vocab, in_chars = app_chars(vocab_path, characters_path)
    covered = in_vocab | in_chars

    missing_cards = [ch for ch in level1 if ch not in covered]
    missing_cards.sort(key=lambda ch: (ranks.get(ch, 10**9), ch))
    need_entries = [ch for ch in level1 if ch not in in_chars]

    used_ids: set[str] = set()
    cards = []
    characters: dict[str, dict] = {}
    gaps = {
        "missingPinyin": [],
        "missingGloss": [],
        "missingExample": [],
        "missingStructure": [],
    }

    def fill_character(ch: str, pinyin: str, gloss: str, sources: list[str], comp: dict) -> None:
        entry_sources = list(sources)
        if not comp.get("parts") and not comp.get("formula"):
            gaps["missingStructure"].append(ch)
        characters[ch] = {
            "char": ch,
            "pinyin": pinyin[:80],
            "meaning": gloss[:200],
            "composition": comp,
            "origin": "",
            "history": "",
            "sources": entry_sources or ["unfilled"],
        }

    for ch in need_entries:
        single_rows = singles.get(ch, [])
        pinyin, cedict_raw = pick_reading(ch, single_rows, mandarin, mmh.get(ch))
        gloss = short_gloss(cedict_raw) if cedict_raw else ""
        sources: list[str] = []
        if cedict_raw and gloss:
            sources.append("cc-cedict")
        elif mandarin.get(ch) or definitions.get(ch):
            sources.append("unihan")
        if not gloss and definitions.get(ch):
            gloss = short_gloss(definitions[ch].replace("; ", "/"))
            if "unihan" not in sources:
                sources.append("unihan")
        if not gloss and mmh.get(ch, {}).get("definition"):
            gloss = short_gloss(str(mmh[ch]["definition"]).replace("; ", "/"))
            if "makemeahanzi" not in sources:
                sources.append("makemeahanzi")
        if gloss.lower() in {"phonetic", "radical", "variant"}:
            for numbered, raw in single_rows:
                match = re.search(r"\|([\u4e00-\u9fff]{2,6})\[", raw)
                if not match:
                    continue
                for word, _num, raw_gloss in compounds.get(ch, []):
                    if word != match.group(1):
                        continue
                    better = short_gloss(raw_gloss)
                    if better:
                        gloss = better
                        if numbered:
                            pinyin = numbered_to_pinyin(numbered)
                        if "cc-cedict" not in sources:
                            sources.append("cc-cedict")
                        break
                if gloss.lower() not in {"phonetic", "radical", "variant"}:
                    break
        if not pinyin and mandarin.get(ch):
            pinyin = mandarin[ch]
            if pinyin and pinyin[0].islower():
                pinyin = pinyin[0].upper() + pinyin[1:]
            if "unihan" not in sources:
                sources.append("unihan")
        radical = ""
        if mmh.get(ch) and mmh[ch].get("radical") and mmh[ch]["radical"] != "？":
            radical = str(mmh[ch]["radical"])
        elif radicals.get(ch):
            radical = radicals[ch]
        comp, comp_sources = composition_for(ch, mmh.get(ch), radical or radicals.get(ch, ""))
        for src in comp_sources:
            if src not in sources:
                sources.append(src)
        if not pinyin:
            gaps["missingPinyin"].append(ch)
        if not gloss:
            gaps["missingGloss"].append(ch)
        if ch in missing_cards:
            example, example_py, example_en = pick_example(
                ch, compounds.get(ch, []), ranks, gloss
            )
            if not example:
                gaps["missingExample"].append(ch)
            if example and "cc-cedict" not in sources:
                sources.append("cc-cedict")
            keywords = build_keywords("", "learning", gloss, "")
            if "common-3500" not in keywords:
                keywords.append("common-3500")
                keywords.sort()
            cards.append(
                {
                    "hanzi": ch,
                    "pinyin": pinyin,
                    "pos": "",
                    "gloss": gloss,
                    "status": "learning",
                    "example": example,
                    "examplePinyin": example_py,
                    "exampleEn": example_en,
                    "detailsHtml": "",
                    "audio": "",
                    "keywords": keywords,
                    "deck": "common-3500",
                    "frequencyRank": ranks.get(ch),
                }
            )
        fill_character(ch, pinyin, gloss, sources, comp)

    cards.sort(key=lambda c: (c["frequencyRank"] is None, c["frequencyRank"] or 0, c["hanzi"]))
    for card in cards:
        card["id"] = card_id(card["pinyin"], card["hanzi"], used_ids)
    return {
        "deck": "common-3500",
        "description": (
            "Single-character flashcards for 通用规范汉字表 level-1 characters "
            "missing from the Obsidian vocabulary. Merged by build/parse_vocab.py. "
            "Do not generate this file from Obsidian."
        ),
        "counts": {
            "cards": len(cards),
            "characterEntries": len(characters),
            "level1": len(level1),
            "alreadyInCharacters": len(level1) - len(need_entries),
        },
        "gaps": {key: value for key, value in gaps.items()},
        "cards": cards,
        "characters": characters,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True, help="Directory with level-1, cedict, unihan, makemeahanzi, junda")
    parser.add_argument("--vocab", type=Path, default=REPO_ROOT / "data" / "vocab.json")
    parser.add_argument("--characters", type=Path, default=REPO_ROOT / "data" / "characters.json")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "common-3500.json")
    args = parser.parse_args()
    payload = build(args.cache, args.vocab, args.characters)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    gaps = payload["gaps"]
    print(f"Wrote {args.out}")
    print(
        f"cards={payload['counts']['cards']} "
        f"characterEntries={payload['counts']['characterEntries']} "
        f"level1AlreadyInCharacters={payload['counts']['alreadyInCharacters']}"
    )
    for key, values in gaps.items():
        print(f"{key}: {len(values)}" + (f" {''.join(values[:40])}" if values else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
