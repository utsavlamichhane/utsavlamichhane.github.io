# Step 8 — ezclean (per-level cleaning)

**Script:** `scripts/mbx_ezclean_all_levels.sh`
+ the R function `mbX::ezclean()` from CRAN

**Companion files in this folder:**
- `8_ezclean.html` — same content with copy buttons on every code block.
- `8_ezclean.pptx` — slide deck for the talk.

---

## Why this step matters

Step 7 gave us seven `level-N.csv` files with the raw GTDB taxonomy strings.
Those strings are precise but ugly to look at and worse to consume:

```
d__Bacteria;p__Bacillota_A_368345;c__Clostridia_258483;o__Lachnospirales;
f__Lachnospiraceae;g__Lachnospira;s__Lachnospira multipara
```

That single feature ID appears at the front of every plot title, every
column header, every report row. Multiply by hundreds of taxa per sample
and the result is unreadable. Worse, two distinct ASVs can share the
*same* taxonomy string with slightly different GTDB cluster suffixes, and
without consolidation they show up as two separate "taxa" in the
analysis.

This is where the **mbX::ezclean()** R function comes in. ezclean()
parses every taxonomy string, **consolidates synonymous taxa** (the same
genus seen as `g__Bacteroides` and `g__Bacteroides_C_123` get merged), and
emits short, human-readable names — `Bilophila.wadsworthia` instead of
the full GTDB hierarchy.

Step 8's job is to run ezclean() for every taxonomic level (domain →
species) and produce seven cleaned XLSX files that downstream steps
(ezviz, ezstat, ANCOMBC2's taxon column, the final report) consume.

---

## What the script does in one sentence

It installs the pinned R + mbX environment, then calls `mbX::ezclean()`
seven times — one per taxonomic level — passing `level-7.csv` (which
holds the full GTDB string) as input, and produces one human-readable
XLSX per level.

---

## The algorithm, step by step

### 1. Locate system R and verify the pinned environment

**First** the script searches for `Rscript` outside the QIIME2 conda env
(the conda env's R has different package versions than the host system R;
mixing them produces "shared object not found" errors that take hours to
debug):

- `/opt/homebrew/bin/Rscript` (Apple Silicon Homebrew)
- `/usr/local/bin/Rscript` (Intel Mac Homebrew or Linux user-install)
- `/Library/Frameworks/R.framework/Resources/bin/Rscript` (macOS CRAN
  installer)
- `/usr/bin/Rscript` (Debian/Ubuntu system R)
- `command -v Rscript` (whatever PATH finds)

It also **strips conda's `R_LIBS_USER`-style env vars** before invoking R,
so the system R doesn't try to load packages from the conda env's library
tree. Then it calls `scripts/lib/install_r_deps.R` to install (or verify)
every package in the pinned `r_packages.lock`.

### 2. Read the Step 7 contract

**Then** the script reads `7_taxonomy_csv/mbx_taxonomy_info.txt` and pulls
out:

- `LEVEL_7_CSV` — the level-7 (species) CSV. The species CSV is special
  because its column headers contain the **full GTDB hierarchy string**,
  not just the species. ezclean parses that string to reconstruct any
  higher level. So we only need one input file for all seven runs.
- `METADATA_TXT` — every step gets the metadata.

### 3. Set the working directory to `8_cleaned_files/`

**Critical step.** `mbX::ezclean()` writes about a dozen intermediate XLSX
files relative to the R working directory, then cleans them up at the end.
If we let R use the user's launching directory, those files would litter
the user's home folder. The script changes R's working directory to
`8_cleaned_files/` so all that ephemeral state is contained.

### 4. Run ezclean once per level

**Now the main work.** The script loops over seven level letters:
`d, p, c, o, f, g, s` (domain through species). For each:

```
Rscript --vanilla <<RSCRIPT
library(mbX)
setwd("8_cleaned_files")
out <- ezclean(
  microbiome_data = "level-7.csv",
  metadata        = "metadata.txt",
  level           = "<letter>"
)
RSCRIPT
```

Inside `ezclean()`, for each row:

1. **Parse** the level-7 taxonomy string into seven components.
2. **Pick** the component at the requested level (e.g. `g__Bilophila` for
   genus level).
3. **Consolidate** entries that differ only in GTDB cluster suffixes
   (`g__Bacteroides_C_123` and `g__Bacteroides_C_456` both collapse to
   `Bacteroides`, but `g__Bacteroides_A` stays separate because the letter
   denotes a real GTDB split).
4. **Handle missing levels** with the unidentified-from-parent convention:
   `unidentified_genus_5_from_Lachnospiraceae_family`. The counter is
   per-level and per-distinct-parent, so two rows missing the same level
   with the same parent share the same counter.
5. **Strip GTDB prefixes** (`g__`, `s__`) and replace spaces with dots
   (so `s__Bilophila wadsworthia` becomes `Bilophila.wadsworthia` —
   safe for use as an R column name).

Each call writes one XLSX into a level-specific subfolder.

### 5. Validate the seven outputs

**Then** the script verifies all seven XLSX files exist and are non-empty.
A common failure is the species level — when classification depth is low
(e.g. short reads, environmental samples), most ASVs don't reach species
and the species-level table can come out empty. The script logs that as
a warning and lets the rest of the pipeline run with the genus level as
its lowest valid resolution.

### 6. Write `mbx_ezclean_info.txt`

**Finally** the cross-step info file records:

- One `LEVEL_<X>_XLSX=<path>` line per level.
- `MBX_PACKAGE_VERSION` — which mbX version produced these files.
- `STATUS=COMPLETE` (or `STATUS=PARTIAL` if some levels failed).

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| R location | system R, NOT conda | Conda's R has different package versions; mixing causes opaque library errors. |
| `R_LIBS_USER` stripping | always | Prevents conda from poisoning system R's library lookup. |
| mbX package version | **CRAN 0.2.0** | The pinned version in `r_packages.lock`. Updates land via the lockfile, not by spontaneous CRAN bumps. |
| Levels run | **d, p, c, o, f, g, s** | All seven, every time. Skipping any of them just defers the failure to a downstream step. |
| Input file | `level-7.csv` | The level-7 column headers contain the full GTDB hierarchy; ezclean reconstructs any level from it. |
| R working directory | `8_cleaned_files/` | Contains the ~12 intermediate XLSX files ezclean writes while it works. |
| Unidentified naming | `unidentified_<level>_<N>_from_<parent>_<parent_level>` | Stable, human-readable, deduplicated by parent so two rows share the same counter. |
| Species-name format | `Genus.species` (dot-joined) | R-column-name-safe. The space in `Genus species` would otherwise be illegal in many downstream contexts. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Continue with N<7 levels** | One level's `ezclean()` call returned empty (usually species, for low-classification data) | Species-level failures are common and not fatal; downstream uses genus or below. The script logs which levels failed. |
| **Per-level retry on transient errors** | A package failed to load on the first try (slow disk, BiocManager just resolved a dependency) | Common in CI environments; the second attempt almost always succeeds. |
| **Bypass install check** | User passed `--skip-install` after a previous successful run | Speeds up reruns when the user knows the env is fine. |
| **`STATUS=PARTIAL`** instead of `COMPLETE` | At least one level failed | Tells `mbXPro --resume` that this step isn't fully done; rerunning will fill the gap. |

---

## What the output file looks like

`8_cleaned_files/mbX_cleaned_genera_level-7/mbX_cleaned_genera_level-7.xlsx`:

| sample-id | Treatment | Bacteroides | Lactobacillus | Bilophila | unidentified_genus_1_from_Lachnospiraceae_family | ... |
|---|---|---|---|---|---|---|
| SampleA | High | 0.0214 | 0.0089 | 0.0034 | 0.0011 | ... |
| SampleB | Low | 0.0142 | 0.0312 | 0.0007 | 0.0089 | ... |

The metadata columns are joined in for convenience (downstream steps don't
have to re-merge), and every taxon column is a clean, short, R-safe name.

---

## Takeaway

> Step 8 turns the precise-but-unreadable GTDB strings into short,
> human-readable names that downstream R steps, the ANCOMBC2 step we
> already simplified, and the final report can all use. It does it
> by delegating to the mbX CRAN package's `ezclean()` function — the
> same function that gives the project its name. From here on, every
> XLSX, every plot, every table reads cleanly.

---

## Sources

- The wrapper script: `mbXPro/scripts/mbx_ezclean_all_levels.sh`
- The R function: `mbX::ezclean()` on CRAN, version pinned in
  `scripts/lib/r_packages.lock`.
- mbX package: https://cran.r-project.org/package=mbX
- Greengenes2 nomenclature: McDonald et al. (2024), Nature Biotechnology
  42:715–718.
