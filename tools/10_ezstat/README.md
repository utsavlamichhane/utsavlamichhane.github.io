# Step 10 — ezstat (per-taxon group statistics)

**Script:** `scripts/mbx_ezstat_all_levels_all_treatments.sh`
+ the R function `mbX::ezstat()` from CRAN

**Companion files in this folder:**
- `10_ezstat.html` — same content with copy buttons on every code block.
- `10_ezstat.pptx` — slide deck for the talk.

---

## Why this step matters

Step 9's stacked-bar plots show *what's there*. The next question — and
the one every reviewer asks — is **which taxa actually differ between
treatment groups, and is that difference statistically real?**

That's a multi-step inferential job. For every (taxonomic level × every
categorical metadata column × every taxon), you need to:

1. Check whether the abundances follow a normal distribution (most don't).
2. Pick the right test (parametric or non-parametric).
3. Correct for multiple testing across the hundreds of taxa being tested
   simultaneously.
4. When there are more than two groups, follow up with the right
   post-hoc comparison and produce **compact letter displays** (the `a`,
   `b`, `ab` letters that mark which groups differ from which on a
   boxplot).

Doing this by hand for one comparison is tedious. Doing it for *every
combination* — seven levels × N variables × hundreds of taxa — is
error-prone in a way no human should accept. Step 10's job is to
**automate the whole grid**, consistently, with one stat per cell.

Note that Step 10 produces **per-taxon, per-level** statistics
(univariate, taxon-by-taxon). Step 14 (ANCOMBC2) does the same job in a
fundamentally different way — modelling all taxa together and correcting
for compositionality. Both views are useful; reviewers like to see both.

---

## What the script does in one sentence

It calls `mbX::ezstat()` once per (taxonomic level × categorical metadata
column), and ezstat runs Kruskal-Wallis (or pairwise Wilcoxon) per taxon,
adjusts p-values with Benjamini-Hochberg, performs Dunn post-hocs for
multi-group designs, and writes one XLSX per combination.

---

## The algorithm, step by step

### 1. Discover categorical metadata columns

**First**, the script applies the same categorical-variable detection as
Step 9 — drop sample-id, drop numeric-only columns, drop singleton-value
columns, drop all-unique columns. What remains is the set of comparisons
to run.

### 2. Read Step 8's seven level XLSX paths

**Then** it reads `8_cleaned_files/mbx_ezclean_info.txt` to find the per-
level paths. Each `(level × variable)` combination becomes one ezstat()
call.

### 3. For each combination, run ezstat

```
Rscript --vanilla <<RSCRIPT
library(mbX)
setwd("10_stats/<variable>")
ezstat(
  microbiome_data    = "mbX_cleaned_<level>_level-7.xlsx",
  metadata           = "metadata.txt",
  level              = "<letter>",
  selected_metadata  = "<column>"
)
RSCRIPT
```

Inside ezstat():

1. **Reshape** the wide XLSX into long format: one row per (sample × taxon).
2. **For every taxon column**:
   - Group abundances by the metadata variable.
   - If the variable has exactly two groups, run a **Wilcoxon rank-sum
     test** (non-parametric, no normality assumption — appropriate for
     relative-abundance data which is almost never normal).
   - If three or more groups, run a **Kruskal-Wallis test** for global
     significance.
3. **Adjust p-values across taxa** using **Benjamini-Hochberg** (the
   `p.adjust(..., method = "BH")` in R) — the most powerful FDR control
   for univariate microbiome panels.
4. **For Kruskal-Wallis hits** (p_adj ≤ 0.05), run pairwise **Dunn's
   tests** with BH adjustment within each significant taxon to identify
   which specific pairs of groups differ.
5. **Compute compact letter displays** (CLD) from the pairwise results.
   Groups sharing a letter are not significantly different from each
   other; groups with no letter in common are. This is the standard
   way to summarize multi-group post-hocs on a boxplot.
6. **Write the per-taxon results** to an XLSX:
   - `KW_<level>_by_<variable>.xlsx` — the per-taxon KW (or Wilcoxon)
     stats: p, p_adj, test statistic.
   - `Pairwise_<level>_by_<variable>.xlsx` — every significant pairwise
     comparison from Dunn.
   - `CLD_Summary_<level>_by_<variable>.xlsx` — the compact letter display
     per significant taxon (used by the boxplot in Step 12 and the final
     report).
   - `Summary_KW_all_metrics_by_<variable>.xlsx` — one summary row per
     level.

### 4. Skip degenerate cases

**The script handles four edge cases gracefully**:

- Singleton groups (n < 2 in any group) — Wilcoxon / KW need at least
  one observation per group; the test is skipped with a warning.
- All-zero taxa — no signal to test; skipped.
- Variables with only one valid group after filtering NAs — skipped.
- Levels with no remaining taxa after the variability filter — skipped.

### 5. Write `mbx_ezstat_info.txt`

**Finally** the cross-step info file records every XLSX produced, the
metadata variables actually tested, and `STATUS=COMPLETE`. The final
report reads this to know which comparisons to embed.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Test (two groups) | **Wilcoxon rank-sum** | Non-parametric — microbiome relative abundances are almost never normal. Robust to outliers. |
| Test (three or more groups) | **Kruskal-Wallis** | Non-parametric ANOVA equivalent. Same robustness argument. |
| Post-hoc (multi-group, on KW hits) | **Dunn's test** | The standard non-parametric post-hoc; matches the KW assumptions. |
| Multiple-testing correction | **Benjamini-Hochberg (BH) FDR** | Most powerful FDR control for the kind of correlated multi-taxon panel we have. |
| Significance threshold | **p_adj ≤ 0.05** | Field convention; the user can re-filter the XLSX with any threshold downstream. |
| Compact letter display algorithm | **`multcompView::multcompLetters`** | The standard R implementation; widely used + cited. |
| Per-taxon prevalence filter | **none, by default** | Filtering hides genuinely-low-abundance signals. We trust BH FDR to handle the false-positive risk. |
| Levels | all seven | Mirrors Step 9 — every level gets statistics. |
| Variables | all auto-detected | Same as Step 9; no enumeration burden on the user. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Wilcoxon instead of KW** | The variable has exactly two groups | KW reduces to a Wilcoxon equivalent — we use the actual Wilcoxon for the slightly tighter test. |
| **Skip taxa with all-zero rows** | A taxon has zero abundance in every sample | Nothing to test; skipping avoids a spurious p-value. |
| **Skip singleton-group cells** | Any group has only one sample | The non-parametric tests need ≥ 2 observations per group. The cell is logged as `SKIPPED — singleton group`. |
| **Skip variables with one valid group after NA filter** | All but one group's samples were dropped because of NAs | Nothing to compare; logged + continued. |
| **Continue with N<7 levels** | A level's XLSX was empty from Step 8 | We never crash because of a downstream level being thin. |

---

## What the output file looks like

`10_stats/<variable>/KW_<level>_by_<variable>.xlsx` (per-taxon KW results):

| taxon | n_groups | KW_chi2 | p_value | p_adj_BH | significant |
|---|---|---|---|---|---|
| Bacteroides | 3 | 12.41 | 0.0020 | 0.0118 | TRUE |
| Lactobacillus | 3 | 0.84 | 0.6582 | 0.6582 | FALSE |
| Bilophila | 3 | 7.92 | 0.0190 | 0.0451 | TRUE |
| ... | | | | | |

`CLD_Summary_<level>_by_<variable>.xlsx` (compact letter display):

| taxon | group_A | group_B | group_C |
|---|---|---|---|
| Bacteroides | a | ab | b |
| Bilophila | a | b | b |
| ... | | | |

Groups sharing a letter are *not* significantly different. The boxplot in
the final report places these letters on top of each box to summarise
the pairwise comparison in one glance.

---

## Takeaway

> Step 10 turns the Step-8 abundance tables into a defensible
> "which-taxa-differ-where" answer. Wilcoxon for two groups,
> Kruskal-Wallis + Dunn + BH for more, compact letter displays for the
> boxplots. The work is mechanical but only because Step 10 mechanises
> it — done by hand across seven levels × N variables × hundreds of
> taxa, this is the place a human introduces errors.

---

## Sources

- The wrapper: `mbXPro/scripts/mbx_ezstat_all_levels_all_treatments.sh`
- The R function: `mbX::ezstat()` on CRAN.
- Benjamini-Hochberg FDR: Benjamini & Hochberg (1995), *Controlling the
  false discovery rate*, JRSS-B 57:289–300.
- Dunn's test: Dunn (1964), *Multiple comparisons using rank sums*,
  Technometrics 6:241–252.
- Compact letter displays: Piepho (2004), *An algorithm for a letter-
  based representation of all-pairwise comparisons*, JCGS 13:456–466.
- Why non-parametric for microbiome data: Weiss et al. (2017),
  *Normalization and microbial differential abundance strategies depend
  upon data characteristics*, Microbiome 5:27.
