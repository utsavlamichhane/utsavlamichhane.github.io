# Step 14 — ANCOMBC2 (Differential Abundance)

**Script:** `scripts/mbx_ancombc2_run.sh`

**Companion files in this folder:**
- `14_ancombc2.html` — same content with copy buttons.
- `14_ancombc2.pptx` — slide deck for the talk.

---

## Why this step matters

Step 10 already gave us a per-taxon "is this taxon different between
groups?" answer via Kruskal-Wallis. That answer is honest as far as it
goes — but microbiome data has a structural problem KW does **not**
correct for: **compositionality**.

The relative abundances of all taxa in a sample sum to 1. So if a single
species — say *Bacteroides* — drops from 30 % to 5 % of a community,
the relative abundances of every *other* taxon *must* mathematically go
up, even when their absolute biomass stayed exactly the same. Naive
per-taxon tests like KW interpret that mechanical increase as biological
"differential abundance" — leading to dozens of false positives in
every microbiome paper that doesn't correct for it.

**ANCOMBC2** (Lin & Peddada 2024) is the current state-of-the-art
correction. It explicitly models the compositional bias, estimates it
from the data, and tests every taxon's abundance after the bias is
removed. It also handles **structural zeros** — taxa absent from an
entire treatment group, which are a fundamentally different statistical
object than "low and noisy".

Step 14's job is to run ANCOMBC2 for every (taxonomic level × categorical
variable) combination, produce the per-taxon log-fold-change tables,
identify structural zeros, generate volcano + heatmap visualisations,
and — thanks to the work we did earlier — apply the ezclean-style taxon
naming so the output is human-readable.

---

## What the script does in one sentence

For every (taxonomic level × categorical metadata variable), it collapses
the filtered feature table to that level via the QIIME2 taxa-collapse
pipeline, runs ANCOMBC2 with the variable as the formula, exports primary
+ pairwise + global + structural-zeros tables to XLSX with our ezclean-
style taxon column simplification, and renders volcano + heatmap plots.

---

## The algorithm, step by step

### 1. Gate on Step 11

**First**, same `READY_FOR_DIVERSITY` gate as Step 12/13. ANCOMBC2 takes
**raw counts** (not rarefied or normalised — it does its own bias
correction), so it reads the **filtered feature table from Step 7**
(post-mitochondria/chloroplast removal), not the rarefied table.

### 2. Collapse the feature table at each level

**Then** for each level the user requested (phylum through species by
default), the script runs:

```
qiime taxa collapse \
  --i-table       feature_table_filtered.qza \
  --i-taxonomy    taxonomy.qza \
  --p-level       <2..7> \
  --o-collapsed-table   collapsed_L<N>.qza
```

…and exports each collapsed table to a BIOM-TSV that R can read.

### 3. Inside R: build the phyloseq object

**Now** the R block loads the collapsed TSV into a matrix (taxa × samples),
joins the metadata as a `phyloseq::sample_data` object, and wraps both into
a `phyloseq` object — ANCOMBC2's expected input.

### 4. Filter taxa with no within-group variance

**Critical step** (and a source of dozens of ANCOMBC crashes if skipped).
ANCOMBC2 errors hard on any taxon whose variance is zero *within* a group
— e.g. all-zero counts in one group and a constant non-zero value in
another. Its built-in `prv_cut = 0.10` only filters by overall
prevalence; it doesn't catch the per-group variance issue. So we
preemptively drop any taxon whose within-group variance is zero in at
least one group of the current variable.

### 5. Run ANCOMBC2

**Now the actual model:**

```r
ANCOMBC::ancombc2(
  data           = phyloseq_object,
  fix_formula    = var,
  group          = var,
  p_adj_method   = "BH",
  pseudo_sens    = TRUE,
  prv_cut        = 0.10,
  lib_cut        = 1,
  struc_zero     = TRUE,
  neg_lb         = TRUE,
  alpha          = 0.05,
  n_cl           = MBX_THREADS,
  global         = TRUE,
  pairwise       = TRUE,
  mdfdr_control  = list(fwer_ctrl_method = "BH", B = 100)
)
```

ANCOMBC2 then:

1. Estimates the **sampling-fraction bias** per sample (the magnitude of
   the compositional distortion).
2. Fits a **bias-corrected linear model** for each taxon: log-relative-
   abundance ~ variable.
3. Returns four tables:
   - `res` — primary effects (each coefficient vs the reference level).
   - `res_pair` — every pairwise comparison.
   - `res_global` — a global F-test (any difference across groups).
   - `zero_ind` — **structural-zero flags** per (taxon × group).
4. Controls **mdFDR** (multiple-testing correction across taxa **and**
   contrasts simultaneously) via B = 100 multivariate permutations.

### 6. Simplify taxon names

**Then** the script applies our `simplify_taxa()` helper (added in
mbX Pro 1.3.0) to the `taxon` column of every results dataframe before
writing. The full GTDB string:

```
d__Bacteria;p__Desulfobacterota_G_459543;c__Desulfovibrionia;
o__Desulfovibrionales;f__Desulfovibrionaceae;g__Bilophila;
s__Bilophila wadsworthia
```

becomes:

```
Bilophila.wadsworthia
```

— the same convention `mbX::ezclean()` uses in Step 8 — so the spreadsheet
columns and the heatmap row labels match the rest of the pipeline.

### 7. Write four XLSX per (level × variable)

- `ancombc2_primary_<Variable>.xlsx` — the main effects.
- `ancombc2_pairwise_<Variable>.xlsx` — every pairwise contrast.
- `ancombc2_global_<Variable>.xlsx` — global F-test results.
- `ancombc2_structural_zeros_<Variable>.xlsx` — taxa flagged as
  structurally absent from at least one group.
- `ancombc2_summary_<Variable>.xlsx` — one row of run-level stats
  (n_samples, n_groups, n_taxa, n_significant, runtime).

### 8. Render volcano + heatmap

**For visualisation**, the script renders one **faceted volcano plot**
per (level × variable), where each panel is one pairwise contrast and
dots are taxa coloured by `q < 0.05 & |lfc| > 1`. It also renders a
**heatmap** showing the bias-corrected log-abundance of all significant
taxa (any test) across samples grouped by the variable.

Both plots get the `simplify_taxa()` treatment for human-readable labels.
PNG + SVG companions (publication-ready); PDF on `--publication-figures`.

### 9. Save the raw RDS

**Finally** the script saves the full ANCOMBC2 output object as an RDS
file in `working_dir_differential_abundance/ancombc2_raw_objects/`.
Advanced users can load it in R for post-hoc analyses without re-running
the model.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Input feature table | **filtered (Step 7), raw counts** | ANCOMBC2 does its own bias correction; rarefying or normalising first throws away signal. |
| Levels | **phylum, class, order, family, genus, species** | Domain is uninformative (it's nearly always all Bacteria); the other six are standard. |
| `p_adj_method` | **Benjamini-Hochberg** | Standard FDR control. |
| `prv_cut` | **0.10** | Drop taxa present in < 10 % of samples — they have no power for the test. |
| `lib_cut` | **1** | No library-size filtering (Step 11 already filtered low-depth samples). |
| `struc_zero` | **TRUE** | Identify structural zeros explicitly; they're a distinct biological signal. |
| `neg_lb` | **TRUE** | Use a negative log-bound when estimating bias — more robust to outliers. |
| `alpha` | **0.05** | Significance threshold. |
| `pairwise` | **TRUE** | We always want the pairwise breakdown. |
| `global` | **TRUE** | We also want the global F-test. |
| `mdfdr_control` | BH, **B = 100** | Multivariate-permutation mdFDR. 100 is the lower end of "enough"; ANCOMBC2 maintainers use this default in their examples. |
| `n_cl` | **MBX_THREADS** | Parallel-pooled across contrasts. |
| Random seed | **MBX_SEED, L'Ecuyer-CMRG kind** | Reproducibility — and the L'Ecuyer stream is required because n_cl > 1 uses `parallel::` under the hood. |
| Per-group variance pre-filter | always-on | Required to prevent ANCOMBC2 crashes. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Refuse to run** | `READY_FOR_DIVERSITY=no` from Step 11 | Same gate as Step 12/13. |
| **Drop zero-within-group-variance taxa** | Always, before each ANCOMBC2 call | Prevents the most common ANCOMBC2 crash. |
| **Skip a `(level × variable)` cell** | < 2 valid groups after NA filter, or < 5 taxa after variance filter | Logged + continued. |
| **Drop singleton-group cells** | A group has only 1 sample | ANCOMBC2 needs ≥ 2 obs per group. |
| **Apply `simplify_taxa()` to plot labels** | always | Our addition (mbX Pro 1.3.0) — replaces the previous "last-two-`;`-segments" truncation with the ezclean-style convention. |
| **Save raw RDS** | always | Advanced users can re-analyse without re-running the model. |

---

## What the output file looks like

`ancombc2_primary_<Variable>.xlsx` (the main-effects table):

| taxon | lfc_Group_B | se_Group_B | W_Group_B | p_Group_B | q_Group_B | diff_Group_B | passed_ss_Group_B |
|---|---|---|---|---|---|---|---|
| Bilophila.wadsworthia | +2.41 | 0.41 | 5.88 | 4e-09 | 8e-08 | TRUE | TRUE |
| Bacteroides | −0.92 | 0.18 | −5.11 | 3e-07 | 2e-06 | TRUE | TRUE |
| ... | | | | | | | |

- `lfc_*` — bias-corrected log-fold-change (positive ⇒ enriched in
  Group_B vs the reference).
- `q_*` — mdFDR-adjusted p-value.
- `diff_*` — boolean: this taxon is differentially abundant for this
  contrast at α = 0.05.
- `passed_ss_*` — boolean: passed the pseudo-count sensitivity analysis.

Plus the volcano (faceted by pairwise contrast) and heatmap (significant
taxa × samples) PNG/SVG.

---

## Takeaway

> Step 14 corrects for what every other "per-taxon" test in microbiome
> analysis gets structurally wrong — compositionality. ANCOMBC2 estimates
> the sampling-fraction bias from the data, fits a bias-corrected linear
> model per taxon, controls multiple testing across both taxa AND
> contrasts (mdFDR), and explicitly flags structural zeros. Our addition
> in mbX Pro 1.3.0 strips the GTDB hierarchy from the `taxon` column and
> heatmap labels so the output reads cleanly.

---

## Sources

- The script: `mbXPro/scripts/mbx_ancombc2_run.sh`
- ANCOMBC2 paper: Lin & Peddada (2024), *Multigroup Analysis of
  Compositions of Microbiomes with Covariate Adjustments and Repeated
  Measures*, Nature Methods 21:83–94.
- ANCOMBC predecessor + the compositionality problem: Lin & Peddada
  (2020), *Analysis of compositions of microbiomes with bias correction*,
  Nature Communications 11:3514.
- Why correction matters: Gloor et al. (2017), *Microbiome datasets are
  compositional*, Frontiers in Microbiology 8:2224.
- mdFDR: Guo et al. (2010), *Controlling false discoveries in multi-
  dimensional directional decisions*, JRSS-B 72:485.
