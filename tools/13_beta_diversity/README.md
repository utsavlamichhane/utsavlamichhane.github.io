# Step 13 — Beta Diversity

**Script:** `scripts/mbx_beta_diversity_run.sh`

**Companion files in this folder:**
- `13_beta_diversity.html` — same content with copy buttons.
- `13_beta_diversity.pptx` — slide deck for the talk.

---

## Why this step matters

Step 12 told us how diverse each *single* sample is. The complementary
question — and the one most microbiome papers actually lead with — is
**how different are the samples from each other?** That's **beta
diversity**.

Beta diversity matters because researchers usually care about
*comparisons*: did the treatment group's communities shift away from the
control group's communities in a way you wouldn't see by chance? The
answer comes in three pieces:

1. **A distance matrix** — for every pair of samples, a number that says
   how different their communities are.
2. **An ordination** — a 2-D or 3-D projection (PCoA) of that distance
   matrix so a human can see the clustering.
3. **A statistical test** — does the between-group dissimilarity exceed
   the within-group dissimilarity by more than chance allows?

Like Step 12, the algorithm is robust precisely because we report **four
different distance metrics** and **two different significance tests** —
so the finding can't be dismissed as an artifact of metric choice.

---

## What the script does in one sentence

It rarefies the feature table to Step 11's depth, computes four
distance matrices (Bray-Curtis, Jaccard, weighted UniFrac, unweighted
UniFrac), runs PERMANOVA + PERMDISP + pairwise PERMANOVA + Adonis on
each, produces PCoA plots, distance heatmaps, and UPGMA dendrograms, and
writes the results as both QZVs (for interactive inspection) and XLSXs
(for the report).

---

## The algorithm, step by step

### 1. Gate on Step 11

**First**, same gate as Step 12: `READY_FOR_DIVERSITY=yes` or `--force`.
Step 13 also reads `12_alpha_diversity_results/mbx_alpha_diversity_info.txt`
to inherit the rarefied table path (so we don't rarefy twice).

### 2. Compute the four distance matrices

**Then** for each of four metrics, the script runs
`qiime diversity beta` (non-phylogenetic) or `qiime diversity
beta-phylogenetic` (phylogenetic):

- **Bray-Curtis dissimilarity** — `1 − 2 Σ min(a_i, b_i) / Σ (a_i + b_i)`.
  Sensitive to abundance differences; the most-reported metric in
  microbiome papers.
- **Jaccard distance** — `1 − |A ∩ B| / |A ∪ B|`. Presence/absence only;
  asks "do these two samples share the same taxa, ignoring how much?"
- **Weighted UniFrac** — sums the branch lengths of the phylogenetic
  tree weighted by abundance differences between the two samples.
  Phylogeny + abundance.
- **Unweighted UniFrac** — same but binary (presence/absence) — pure
  phylogenetic dissimilarity.

The four metrics span (abundance vs presence) × (non-phylogenetic vs
phylogenetic). A finding consistent across all four is essentially
unambiguous.

### 3. For every categorical variable: PERMANOVA + PERMDISP

**For every categorical metadata variable**, on each of the four
distance matrices, the script runs:

- **PERMANOVA** (`qiime diversity beta-group-significance`) —
  permutational multivariate ANOVA. Tests whether the **centroid** of
  each group's samples differs significantly in the distance space.
  Returns an F statistic, an R², and a p-value computed by permuting
  group labels 999 times.
- **PERMDISP** — tests whether the *dispersion* of each group differs.
  This matters because PERMANOVA can spuriously reject the null when
  groups have different variances (one tight cluster vs one diffuse
  cloud — PERMANOVA sees the centroids as different even when they
  aren't). PERMDISP catches this artifact.
- **Pairwise PERMANOVA** when the variable has > 2 groups — tells the
  user *which* group pairs differ.

### 4. Adonis (multivariable, with covariates)

**Then** the script runs `qiime diversity adonis` once per distance
matrix, modelling the metadata as a formula. The user gets:

- **Type-III sums of squares** so the order of variables doesn't change
  the test.
- **Univariate Adonis** rows per variable (just that variable vs
  distance).
- **Multivariate Adonis** with all variables together — the "after
  controlling for everything else" version.

This catches the common case where a confounder (e.g. sex, age, batch)
drives apparent treatment-group differences.

### 5. PCoAs + distance heatmaps + UPGMA dendrograms

**For visualisation**, the script runs `qiime diversity pcoa` on each
distance matrix and exports both the QIIME2 Emperor 3-D interactive
viewer (`emperor_<Metric>.qzv`) and a 2-D PNG/SVG with samples
colour-coded by treatment group.

It also produces:

- **Distance heatmap** per metric — the full pairwise distance matrix
  shown as a heatmap with samples grouped by treatment.
- **UPGMA dendrogram** per metric — hierarchical-clustering view that
  shows how samples cluster from the distance matrix.
- **Boxplot of distance-to-centroid** per metric per variable — the
  visual version of the PERMDISP test.

### 6. Write `mbx_beta_diversity_info.txt`

**Finally** the cross-step contract records every artifact + result file,
the rarefaction depth used, the four-metric × N-variable combinations
that ran, and `STATUS=COMPLETE`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Distance metrics | **Bray-Curtis, Jaccard, weighted UniFrac, unweighted UniFrac** | The four that span (abundance vs presence) × (non-phylogenetic vs phylogenetic). |
| Rarefaction depth | from Step 11 | Single source of truth; inherited via Step 12's info file. |
| PERMANOVA permutations | **999** | QIIME2 default; gives a stable p-value with reasonable speed. |
| PERMDISP permutations | **999** | Same. |
| PERMANOVA test | **`--p-pairwise`** when > 2 groups | We always want the pairwise breakdown when it's meaningful. |
| Adonis SS type | **Type III** | Order-independent — robust to how the user listed variables in the metadata. |
| PCoA dimensions | top 3 components | Enough for the 2-D PNG + Emperor's 3-D view. |
| Plot formats | PNG + SVG always; PDF on `--publication-figures` | Publication-ready by default. |
| Seed | `MBX_SEED` | Permutation tests are reproducible only with a fixed seed. |
| Threads | `MBX_THREADS` | Single source of truth. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Refuse to run** | `READY_FOR_DIVERSITY=no` from Step 11 | Same gate as Step 12. |
| **Skip UniFrac metrics** | Tree missing | Bray-Curtis and Jaccard still run; UniFrac logged as skipped. |
| **Skip a comparison** | Variable has singleton groups after NA filter | PERMANOVA needs ≥ 2 obs per group. |
| **Flag PERMDISP-significant cells in the report** | PERMDISP p < 0.05 (different variances) | PERMANOVA's null is sensitive to dispersion; the report says "the significant PERMANOVA may reflect dispersion, not centroid difference". |
| **Re-use distance matrices** | A previous run produced them | Caching saves wall-clock on re-runs. |

---

## What the output file looks like

`PERMANOVA_results_<Variable>.xlsx`:

| metric | n_groups | F | R² | p_value | p_adj_BH | significant |
|---|---|---|---|---|---|---|
| Bray-Curtis | 3 | 4.81 | 0.174 | 0.001 | 0.001 | TRUE |
| Jaccard | 3 | 2.92 | 0.118 | 0.014 | 0.018 | TRUE |
| weighted UniFrac | 3 | 5.66 | 0.197 | 0.001 | 0.001 | TRUE |
| unweighted UniFrac | 3 | 3.41 | 0.131 | 0.005 | 0.007 | TRUE |

A finding shared across all four metrics — and supported by Adonis after
adjusting for confounders — is essentially unambiguous.

---

## Takeaway

> Step 13 answers the comparative question (how different are these
> samples from each other?) four times — abundance vs presence,
> phylogenetic vs not — and tests significance two different ways
> (PERMANOVA for centroid; PERMDISP for dispersion). Adonis with Type-III
> SS rules out confounders. PCoA + heatmaps + dendrograms make the
> finding visual. A signal that survives all four metrics and Adonis
> is publication-grade.

---

## Sources

- The script: `mbXPro/scripts/mbx_beta_diversity_run.sh`
- PERMANOVA: Anderson (2001), *A new method for non-parametric
  multivariate analysis of variance*, Austral Ecology 26:32–46.
- PERMDISP: Anderson (2006), *Distance-based tests for homogeneity of
  multivariate dispersions*, Biometrics 62:245–253.
- Bray-Curtis: Bray & Curtis (1957), *An ordination of upland forest
  communities of southern Wisconsin*, Ecol Monogr 27:325.
- UniFrac: Lozupone & Knight (2005), *UniFrac: a new phylogenetic method
  for comparing microbial communities*, AEM 71:8228–8235.
- QIIME2 `q2-diversity` plugin:
  https://docs.qiime2.org/2025.4/plugins/available/diversity/
