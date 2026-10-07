# Data sources for the level-1 supplement

`data/common-3500.json` is the committed source for characters from the
通用规范汉字表 (Table of General Standard Chinese Characters) level-1 list that
were missing from this app. `build/parse_vocab.py` appends those cards after
it assigns ids to Obsidian notes, and does not overwrite an Obsidian card that
already uses the same hanzi. `build/merge_character_batches.py` fills any
character entry the batches do not already contain.

`data/level-1.txt` is the level-1 list, one simplified character per line.
`build/check_level1_coverage.py` checks that `data/characters.json` contains
each of those 3,500 characters as its own entry. A traditional form does not
count as the simplified character.

Regenerate the supplement (this does not edit `vocab.json` by itself):

```bash
python build/build_common3500.py --cache /path/to/sources
```

The cache directory needs:

| File | Source |
| --- | --- |
| `level-1.txt` | <https://github.com/shengdoushi/common-standard-chinese-characters-table> `level-1.txt` |
| `cedict.txt` | CC-CEDICT, <https://www.mdbg.net/chinese/dictionary?page=cc-cedict> |
| `dictionary.txt` | Make Me a Hanzi, <https://github.com/skishore/makemeahanzi> |
| `Unihan.zip` | Unicode 17.0.0 Unihan, <https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip> |
| `CJKRadicals.txt` | Unicode 17.0.0, <https://www.unicode.org/Public/17.0.0/ucd/CJKRadicals.txt> |
| `junda.tsv` | Jun Da modern Chinese character frequency list (GB18030), <https://lingua.mtsu.edu/chinese-computing/statistics/char/download.php?Which=MO> |

## What each source is used for

- **CC-CEDICT** (Creative Commons Attribution-ShareAlike 4.0): tone-marked pinyin, the short English gloss, and an example word or phrase with its English gloss. Card glosses and example translations in the supplement are adapted from CC-CEDICT.
- **Unihan** (`kMandarin`, `kDefinition`, `kRSUnicode`; Unicode License, <https://www.unicode.org/license.txt>): fallback reading and gloss, and the Kangxi radical when Make Me a Hanzi has no decomposition.
- **Make Me a Hanzi `dictionary.txt`** (LGPL-3.0-or-later; derived from Unihan and CJKlib): radical and ideographic-description structure. `graphics.txt` is not used.
- **Jun Da frequency list**: `frequencyRank` and most-frequent-first order only. Copyright 2004 Jun Da (笪骏).
- **Level-1 table**: the set of characters. The list republished by shengdoushi follows the PRC standard 通用规范汉字表.

Origin and history are left empty. Nothing in the supplement is an invented etymology.

## Not filled from a dictionary example

These five characters have a gloss and structure, and no CC-CEDICT compound of 2–4 characters to use as an example: 玖, 叁, 柒, 捌, 艘.
