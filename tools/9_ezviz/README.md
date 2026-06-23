# Step 9 — ezviz (stacked-bar visualisations)

**Script:** `scripts/mbx_ezviz_all_levels_all_treatments.sh`
+ the R function `mbX::ezviz()` from CRAN

**Companion files in this folder:**
- `9_ezviz.html` — same content with copy buttons on every code block.
- `9_ezviz.pptx` — slide deck for the talk.

---

## Why this step matters

Step 8 left us with seven clean per-level XLSX files of relative
abundances. Those tables are *correct* but completely opaque to a human
looking at them. The first qualitative question every microbiome
researcher asks is: **"what does the community look like at each
level, in each treatment group?"** The answer is a stacked-bar plot —
the workhorse visual of 16S analysis.

A stacked-bar plot makes three things obvious in seconds:

- **Which taxa dominate** each sample (the visually large blocks).
- **How consistent** the community is within a treatment group
  (parallel bars look similar).
- **Which taxa differ** between treatment groups (block sizes shift).

But there's a craft to it. Too many taxa and the plot becomes a rainbow of
indistinguishable colours. Inconsistent ordering between samples makes
groups impossible to compare. Step 9's job is to produce one **publication-
ready** stacked-bar plot per (taxonomic level × categorical metadata
variable), every time, with the same conventions across every project.

---

## What the script does in one sentence

It calls `mbX::ezviz()` once per combination of (seven taxonomic levels) ×
(every categorical metadata column), producing per-treatment per-level
stacked-bar PNGs that share the same colour palette, the same top-taxa
cutoff, and the same legend ordering.

---

## The algorithm, step by step

### 1. Discover categorical metadata columns

**First** the script reads the metadata file and figures out which columns
are categorical (eligible for a "by group" plot). The rule:

- Drop the first column (`sample-id` — never a grouping variable).
- Drop numeric-only columns (continuous variables — ezviz handles those
  differently, but we don't run them by default).
- Drop columns with only one unique value (no contrast to plot).
- Drop columns whose unique-value count equals the sample count (every
  value is unique — also useless for grouping).
- What remains is the list of categorical variables to plot.

### 2. Read Step 8's contract

**Then** the script reads `8_cleaned_files/mbx_ezclean_info.txt` to find
the seven per-level XLSX paths. Each level becomes one ezviz() call per
metadata variable.

### 3. Loop: 7 levels × N categorical variables

**For every combination**, the script runs:

```
Rscript --vanilla <<RSCRIPT
library(mbX)
setwd("9_visualization_entire")
ezviz(
  microbiome_data    = "mbX_cleaned_<level>_level-7.xlsx",
  metadata           = "metadata.txt",
  level              = "<letter>",
  selected_metadata  = "<column>",
  top_taxa           = 20
)
RSCRIPT
```

Inside ezviz():

1. Read the cleaned XLSX (taxa as columns, samples as rows, plus metadata
   columns).
2. Drop everything that isn't a taxon column or the requested grouping
   column.
3. **Compute the top-20 most abundant taxa** by mean relative abundance
   across all samples. Everything else gets collapsed into a single
   `Other` category. Twenty is the empirical sweet spot — fewer loses too
   much information; more produces unreadable colour soup.
4. **Order the taxa** by mean abundance (largest at the bottom of the
   stack, smallest at the top — standard convention).
5. **Order the samples** within each group by similarity (UPGMA-clustered
   for stacked-bar coherence).
6. **Pick the colour palette**: 20 maximally-distinct colours from a
   pre-computed list. The same colour always means the same taxon across
   different (level × variable) plots in the same project.
7. **Render** the stacked-bar plot as PNG (and SVG via the shared plot
   helpers — see Phase 3.1 of `CHANGELOG.md`).

### 4. Handle empty levels gracefully

**Then** if a particular level's XLSX was empty (typically species, on
low-classification data), the script logs `SKIPPED — no taxa in level`
and continues. It does not fail the whole step.

### 5. Write `mbx_ezviz_info.txt`

**Finally** the cross-step info file records the path of every PNG
produced, the metadata variables actually plotted (so the final report
knows which combinations exist), and `STATUS=COMPLETE`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| `top_taxa` | **20** | Empirical sweet spot — 15 loses signal; 25+ becomes a colour-blob. Twenty is what microbiome papers consistently use. |
| Top-taxa selection | by mean relative abundance | The most fair "what dominates on average?" metric. Median picks too few rare-but-consistent taxa. |
| Other category | collapsed grey | Visually distinct from any real taxon. Always at the top of the stack. |
| Sample ordering | UPGMA-clustered within each treatment | Visually-similar samples sit next to each other, making the within-group consistency obvious. |
| Colour palette | maximally distinct, project-stable | The same taxon gets the same colour across every plot in the same project — comparing across plots is now visual, not memory-intensive. |
| Plot formats | PNG (always) + SVG (always) + PDF (when `--publication-figures`) | SVG is publication-ready out of the box; PDF on demand. |
| Levels | all seven | We never skip a level proactively — if it has data, it gets plotted. |
| Categorical variables | all auto-detected | The script never asks the user to enumerate them. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Skip empty levels** | Level XLSX has 0 taxa (low-classification data) | Not an error — just unusual. Plot whatever has data. |
| **Skip singleton-value variables** | A "Treatment" column where every sample has the same value | Plotting a "group" with one group is pointless. |
| **Skip all-unique variables** | A column that's effectively a per-sample ID | Same reasoning — no contrast to show. |
| **Re-use existing PNGs** | Re-run after a partial failure | Idempotent: if the PNG already exists at the expected path, the script doesn't re-render it. |

---

## What the output file looks like

`9_visualization_entire/mbX_ezviz_<level>_by_<variable>.png` — one
publication-ready stacked-bar PNG per (level × variable) combination, plus
the SVG companion, plus optional PDF.

Each PNG has:

- One vertical bar per sample.
- The 20 most abundant taxa, ordered by mean abundance (largest at the
  bottom).
- All other taxa collapsed into a grey `Other` block at the top.
- A facet per treatment group (samples within a group are clustered for
  visual coherence).
- The same colour for the same taxon across every plot in the project.

---

## Takeaway

> Step 9 produces the first deliverable a microbiome researcher actually
> looks at — the per-level stacked-bar plot. The trick is doing it
> consistently across every (level × variable) combination so the
> reviewer's eye can compare them. The mbX::ezviz() function handles the
> aesthetics; the wrapper handles the discovery of which combinations to
> plot.

---

## Sources

- The wrapper script: `mbXPro/scripts/mbx_ezviz_all_levels_all_treatments.sh`
- The R function: `mbX::ezviz()` on CRAN.
- mbX package: https://cran.r-project.org/package=mbX
