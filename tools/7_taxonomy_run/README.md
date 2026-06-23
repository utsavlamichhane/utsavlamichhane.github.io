# Step 7 — Taxonomy CSVs + Mito/Chloro Filter

**Script:** `scripts/mbx_taxonomy_run.sh`

**Companion files in this folder:**
- `7_taxonomy_run.html` — same content with copy buttons on every code block.
- `7_taxonomy_run.pptx` — slide deck for the talk.

---

## Why this step matters

Steps 4 and 6 left us with two artifacts:

- **A feature table** (Step 4): how many of each ASV in each sample.
- **A taxonomy table** (Step 6): for each ASV, which organism it is.

The rest of the pipeline — diversity statistics, differential abundance,
machine learning — all needs these two combined into **per-level relative
abundance tables**: a domain table, a phylum table, a class table, …,
down to species. The downstream R steps consume those tables, not the
QIIME2 QZA files.

But there's also **a contamination problem** specific to 16S amplicon
analysis. The 16S rRNA primers also amplify the rRNA from:

- **Mitochondria**, which evolved from an ancient α-proteobacterium and
  still have bacteria-like rRNA.
- **Chloroplasts**, which evolved from an ancient cyanobacterium and
  still have bacteria-like rRNA.

If we leave those reads in, they get classified as plant or animal
mitochondrial / chloroplast lineages and show up as bizarre "bacteria" in
every downstream analysis. Worse, they often **dominate** the read counts
in any sample with plant or animal material — a single bovine mitochondrial
ASV can hijack 30 % of a rumen sample's reads.

Step 7's job is to **remove that contamination** before anyone downstream
ever sees the data, and to produce the seven level CSVs cleanly.

---

## What the script does in one sentence

It filters mitochondrial and chloroplast features out of the Step 4 feature
table using the Step 6 taxonomy strings, builds a QIIME2 taxa barplot from
the filtered data, exports the barplot to seven level-N.csv files (one per
taxonomic level), and writes the cross-step paths Step 8 onwards will read.

---

## The algorithm, step by step

### 1. Read the upstream info files

**First** the script reads `5_classifier_working_dir/mbx_classifier_run_info.txt`
to find the feature-table path and the taxonomy path. It uses Step 5's
canonical paths so a re-run with a different working directory layout still
works.

### 2. Filter mitochondria and chloroplasts

**Then** the script runs:

```
qiime taxa filter-table \
  --i-table        feature_table.qza \
  --i-taxonomy     taxonomy.qza \
  --p-mode         contains \
  --p-exclude      mitochondria,chloroplast \
  --o-filtered-table feature_table_filtered.qza
```

The `--p-mode contains` plus `--p-exclude mitochondria,chloroplast` tells
QIIME2: drop any feature whose taxonomy string mentions either keyword,
case-insensitive. This catches:

- `…;c__Mitochondria` (plant + animal mitochondrial rRNA — the most common
  hit)
- `…;c__Chloroplast` (plant chloroplast rRNA)
- `…;f__Mitochondria` (the family-level alias some classifiers produce)
- Anything weird with `mitochondria` or `chloroplast` deeper in the string.

The script logs **how many features were removed and what fraction of the
total reads they accounted for** — that number is a useful sanity check
(typically 0–5 % in stool / soil; up to 30 % in plant material or rumen
samples).

### 3. Build the taxa barplot

**Next** the script runs:

```
qiime taxa barplot \
  --i-table       feature_table_filtered.qza \
  --i-taxonomy    taxonomy.qza \
  --m-metadata-file metadata.txt \
  --o-visualization taxa_bar_plots.qzv
```

`taxa_bar_plots.qzv` is the interactive HTML the user can open to look at
the stacked-bar composition of every sample at every taxonomic level. It's
the first qualitative result the user actually sees — it tells them
"the data looks right".

### 4. Export the seven level CSVs

**Then** the script unzips the `.qzv` file (a QZV is also a zip archive),
finds the seven `level-N.csv` files inside (one for each of N = 1 through
7 → domain, phylum, class, order, family, genus, species), and copies them
to the output directory.

These seven CSVs are the **single source of truth** that every downstream
analysis step consumes. They're plain CSV — one row per sample, one column
per taxon at that level, plus the metadata columns. No QIIME2 wrapping; any
tool (R, pandas, Excel) can read them.

### 5. Write the cross-step info file

**Finally** the script writes `mbx_taxonomy_info.txt` with:

- `LEVEL_7_CSV=<path>` — Step 8 (`ezclean`) uses this as input. It parses
  the full GTDB hierarchy string in the level-7 column headers to
  reconstruct every higher level.
- `METADATA_TXT=<path>` — every later step reads this.
- The mitochondria / chloroplast removal stats — surfaced in the final
  report.
- `STATUS=COMPLETE` for `mbXPro --resume`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Filter mode | `contains` | Case-insensitive substring match. Catches `c__Mitochondria`, `f__Mitochondria`, `c__Chloroplast`, and anything weird with those keywords. |
| Filter terms | `mitochondria,chloroplast` | The two contamination sources 16S primers always amplify in eukaryotic-containing samples. |
| Levels exported | 1 through 7 (domain → species) | Every taxonomic level downstream R + Python steps need. Level 7 in particular contains the full string from which higher levels can be reconstructed. |
| Barplot output | `taxa_bar_plots.qzv` | QIIME2's interactive HTML viewer — the first place a user spots whether the data looks reasonable. |
| Cross-step contract field | `LEVEL_7_CSV` | The full hierarchy lives in level-7. Step 8 (`ezclean`) parses it to rebuild higher levels with consistent naming. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Re-use cached `feature_table_filtered.qza`** | A previous run already produced it with the same input hashes | Saves a re-filter on repeated runs. |
| **Log + continue when 0 features removed** | Sample is purely microbial (faecal, soil, water) with no eukaryotic host | Not an error — just unusual. The log says "0 mito/chloro features removed". |
| **Log + continue when > 30 % features removed** | Plant or animal-tissue-dominated sample (rumen, root, tongue swab) | Not an error — but the user should know. The final report flags this number. |
| **Skip mitochondria term but keep chloroplast** | Not yet exposed as a flag, but reserved for the rare case of needing mitochondrial rRNA itself (e.g. eDNA studies) | Documented for future extension; default behaviour removes both. |

---

## What the output file looks like

`7_taxonomy_csv/level-7.csv` (example, transposed for readability):

```
sample-id   d__Bacteria;p__Bacillota;...;s__Lactobacillus_acidophilus   d__Bacteria;p__Bacteroidota;...;s__Bacteroides_fragilis   ...
SampleA     0.0214                                                     0.0089                                                   ...
SampleB     0.0142                                                     0.0312                                                   ...
...
```

Plus six analogous files for levels 1 through 6, the filtered QZA, and the
interactive `taxa_bar_plots.qzv` for the user's first sanity check.

---

## Takeaway

> Step 7 is the last QIIME2 step in the pipeline. It's also where the most
> common 16S-data gotcha (mitochondrial and chloroplast contamination) gets
> caught — once, here, for the whole downstream pipeline. The seven
> level CSVs it produces become the single source of truth that every R
> and Python step from Step 8 onwards consumes. From now on we never
> touch QIIME2 again.

---

## Sources

- The script: `mbXPro/scripts/mbx_taxonomy_run.sh`
- QIIME2 `q2-taxa` plugin:
  https://docs.qiime2.org/2025.4/plugins/available/taxa/
- The mito/chloro contamination problem: Hanshew et al. (2013),
  *Minimization of chloroplast contamination in 16S rRNA gene
  pyrosequencing of insect herbivore bacterial communities*,
  J Microbiol Methods 95:149.
