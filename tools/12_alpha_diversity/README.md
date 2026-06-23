# Step 12 — Alpha Diversity

**Script:** `scripts/mbx_alpha_diversity_run.sh`

**Companion files in this folder:**
- `12_alpha_diversity.html` — same content with copy buttons.
- `12_alpha_diversity.pptx` — slide deck for the talk.

---

## Why this step matters

**Alpha diversity** answers the simplest question we ask of a microbiome
sample: **how diverse is this single community?** Two intuitions go into
the answer:

- **Richness** — how many different things are there?
- **Evenness** — are they all roughly equal, or does one species
  dominate?

Step 12 computes **five** alpha-diversity metrics, each capturing those
two intuitions slightly differently — so a reviewer can see if the
finding is robust to the choice of metric. It then asks the next
question: **are the alpha-diversity differences between treatment groups
statistically significant?** — and produces the boxplots + tests that
answer it.

---

## What the script does in one sentence

It rarefies the feature table to the depth Step 11 chose, computes the
five canonical alpha-diversity vectors (Observed Features, Shannon,
Simpson, Pielou, Faith PD), merges them into one tidy
`alpha_diversity.xlsx` with the metadata, then runs Kruskal-Wallis +
pairwise Dunn + compact letter displays per metric per categorical
variable and produces the boxplots.

---

## The algorithm, step by step

### 1. Gate on Step 11's verdict

**First** the script reads `11_pre_diversity/mbx_pre_diversity_info.txt`
and refuses to run unless `READY_FOR_DIVERSITY=yes` (or the user passes
`--force`). This is the gate; if Step 11 said the depth choice was
unreliable, Step 12 honours that.

### 2. Rarefy the feature table

**Then** it runs `qiime feature-table rarefy` at the depth Step 11
recommended, producing a `rarefied_table.qza`. Every diversity metric
operates on this rarefied table — the same number of reads per sample —
so apples-to-apples comparisons are guaranteed.

### 3. Compute five alpha metrics

**Now** the script runs QIIME2's alpha-diversity plugin five times:

- **Observed Features** — just the count of distinct ASVs per sample
  (pure richness, no evenness contribution).
- **Shannon index** — `H = − Σ p_i log p_i`. Combines richness and
  evenness; sensitive to rare taxa.
- **Simpson diversity** — `1 − Σ p_i²`. Combines richness and evenness;
  weights common taxa more than Shannon does.
- **Pielou's evenness** — `J = H / log(S)`, where `S` is observed
  richness. Pure evenness — how close to the maximum entropy is the
  community?
- **Faith's phylogenetic diversity** — the total branch length of the
  sub-tree spanned by the ASVs present in the sample. The
  phylogenetically-aware richness measure.

Five values per sample, exported to TSV.

### 4. Build the consolidated XLSX

**Then** the script joins the five TSV files with the metadata in R and
writes one tidy table:

| sample-id | Treatment | ASVs_or_Features | Shannon_Index | Simpson_Diversity | Faith_PD | Pielou_Evenness |
|---|---|---|---|---|---|---|
| SampleA | High | 412 | 5.23 | 0.91 | 28.4 | 0.866 |
| SampleB | Low | 367 | 4.92 | 0.88 | 25.1 | 0.834 |

That XLSX is the single source of truth that the rest of Step 12 — and
the final report — reads.

### 5. Statistics per (metric × variable)

**For every categorical variable** discovered in the metadata (same auto-
detection as Step 9/10), the script runs:

- **Kruskal-Wallis** (3+ groups) or **Wilcoxon rank-sum** (2 groups) on
  each metric.
- **Benjamini-Hochberg** correction across the five metrics within each
  variable (the Step 12 statistics report each metric independently, so
  the correction is per-variable, not pipeline-wide).
- **Dunn's pairwise** post-hoc on KW hits.
- **Compact letter display** per metric per variable, written to
  `CLD_Summary_<metric>_by_<variable>.xlsx`.

### 6. Boxplots

**Then** it draws one boxplot per (metric × variable) and a multi-panel
boxplot showing all five metrics next to each other for each variable.
The compact letter display from step 5 is annotated on top of each box
so a reviewer can read significance directly off the figure.

PNG (always) + SVG (always) + PDF (with `--publication-figures`).

### 7. Write `mbx_alpha_diversity_info.txt`

**Finally** the cross-step info file records the rarefaction depth used,
every XLSX produced, the categorical variables actually analysed, and
`STATUS=COMPLETE`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Rarefaction depth | from Step 11 | Step 11 is the single source of truth — never overridden here. |
| Five metrics | Observed Features, Shannon, Simpson, Pielou, Faith PD | The five most commonly reported in microbiome papers, each capturing richness/evenness/phylogeny differently. |
| Test (2 groups) | **Wilcoxon rank-sum** | Non-parametric — alpha-diversity distributions are rarely normal. |
| Test (3+ groups) | **Kruskal-Wallis** | Same reasoning. |
| Post-hoc on KW hits | **Dunn's test** | The standard non-parametric post-hoc. |
| Multiple-testing correction | **Benjamini-Hochberg** across the 5 metrics within each variable | Conservative enough; field-standard. |
| CLD algorithm | `multcompView::multcompLetters` | Standard R implementation. |
| Plot formats | PNG + SVG always; PDF on `--publication-figures` | Publication-ready by default. |
| Threads | `MBX_THREADS` | Single source of truth. |
| Seed | `MBX_SEED` | Single source of truth for reproducibility. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Refuse to run** | `READY_FOR_DIVERSITY=no` from Step 11 | Step 11's verdict gates us; the override is `--force` and is recorded. |
| **Skip a metric** | A required artifact (e.g. tree) is missing | Faith PD needs the rooted tree; if the tree wasn't produced, only the four non-phylogenetic metrics are computed. |
| **Skip a comparison** | A categorical variable has singleton groups after NA filter | Same logic as Step 10; logged + continued. |
| **Re-use rarefied table** | Existing `rarefied_table.qza` at the same depth | Saves a re-rarefaction on re-runs. |

---

## What the output file looks like

`alpha_diversity.xlsx` (the consolidated table):

| sample-id | Treatment | ASVs_or_Features | Shannon_Index | Simpson_Diversity | Faith_PD | Pielou_Evenness |
|---|---|---|---|---|---|---|
| SampleA | High | 412 | 5.23 | 0.91 | 28.4 | 0.866 |
| SampleB | Low | 367 | 4.92 | 0.88 | 25.1 | 0.834 |
| ... | | | | | | |

Plus per-variable subfolders containing the KW/Dunn/CLD XLSX files and
the boxplot PNG/SVG/PDF, plus the `mbx_alpha_diversity_info.txt`
contract for the final report.

---

## Takeaway

> Step 12 answers the simplest microbiome question (how diverse is each
> sample?) five different ways so the answer is robust, then applies
> the same Kruskal-Wallis + Dunn + BH + CLD stack as Step 10 to test
> group differences. The boxplots are annotated with the CLD so
> significance is readable directly off the figure.

---

## Sources

- The script: `mbXPro/scripts/mbx_alpha_diversity_run.sh`
- Shannon index: Shannon (1948), *A mathematical theory of
  communication*, BSTJ 27:379–423.
- Simpson diversity: Simpson (1949), *Measurement of diversity*,
  Nature 163:688.
- Pielou's evenness: Pielou (1966), *The measurement of diversity in
  different types of biological collections*, J Theor Biol 13:131.
- Faith PD: Faith (1992), *Conservation evaluation and phylogenetic
  diversity*, Biol Conserv 61:1–10.
- QIIME2 `q2-diversity` plugin:
  https://docs.qiime2.org/2025.4/plugins/available/diversity/
