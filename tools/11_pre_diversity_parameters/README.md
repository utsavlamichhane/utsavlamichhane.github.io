# Step 11 — Pre-diversity (phylogeny + depth selection)

**Script:** `scripts/mbx_pre_diversity_parameters.sh`

**Companion files in this folder:**
- `11_pre_diversity_parameters.html` — same content with copy buttons.
- `11_pre_diversity_parameters.pptx` — slide deck for the talk.

---

## Why this step matters

Steps 12 and 13 — alpha and beta diversity — both need two things that
nothing upstream has produced:

1. **A phylogenetic tree** of every ASV in the dataset, because the
   phylogenetic diversity metrics (Faith's PD, weighted/unweighted
   UniFrac) need to know how related the ASVs are.
2. **A scientifically-defensible rarefaction depth** — the number of
   reads we'll subsample every sample down to before computing diversity.
   Picking that number wrong is the **single most common source of
   misleading microbiome results** in the literature.

The depth question is the substantive one. **If the depth is too low**,
we throw away usable read information; samples that started with deep
sequencing end up looking artificially impoverished. **If the depth is
too high**, we lose every sample that didn't reach it — and we lose them
*non-randomly* (the deepest samples are often the easiest libraries to
prepare). Either failure mode biases every downstream comparison.

Step 11's job is to **answer the depth question quantitatively**, using
three concurrent statistical criteria that any reviewer can defend, and
to produce a `STATUS` field that gates the diversity steps from running
if the depth verdict isn't strong enough.

---

## What the script does in one sentence

It builds a rooted phylogenetic tree from the ASV sequences, then
computes the smallest rarefaction depth that simultaneously satisfies
≥ 90 % sample retention, ≥ 0.98 mean Good's coverage, and a flat
analytical rarefaction curve (Hurlbert 1971 closed-form slope <
0.5 features / 1,000 reads).

---

## The algorithm, step by step

### 1. Pre-flight + version logging

**First** the script confirms QIIME2, R, and the input artifacts are all
present, logs every tool version (so the final report can cite them
exactly), and creates the `11_pre_diversity/` output directory.

### 2. QC visualisations

**Then** it produces two QIIME2 QZVs — `metadata_summary.qzv` and
`feature_table_summary.qzv` — useful for the user's sanity check before
they commit hours to diversity computation.

### 3. Build the rooted phylogenetic tree

**Next** the script runs the `align-to-tree-mafft-fasttree` QIIME2 pipeline:

```
qiime phylogeny align-to-tree-mafft-fasttree \
  --i-sequences         representative_sequences.qza \
  --o-alignment         aligned-rep-seqs.qza \
  --o-masked-alignment  masked-aligned-rep-seqs.qza \
  --o-tree              unrooted-tree.qza \
  --o-rooted-tree       rooted-tree.qza \
  --p-n-threads         <MBX_THREADS>
```

Under the hood this runs four sub-steps:

1. **MAFFT** multiple-sequence alignment of every ASV against every other
   ASV. MAFFT is fast and accurate; FFT-NS-2 is the default mode.
2. **Mask** the alignment to remove highly variable positions that confuse
   tree-building (QIIME2 default; based on entropy filtering).
3. **FastTree** builds an approximately-maximum-likelihood tree from the
   masked alignment. Much faster than RAxML for the ~hundreds-to-thousands
   of ASVs we typically have.
4. **Mid-point root** the tree so the diversity metrics have a defined
   root (UniFrac requires it; Faith's PD doesn't strictly but uses one).

### 4. Tabulate per-sample frequencies

**Now** the script exports the feature table to TSV + BIOM and counts the
total non-chimeric ASVs per sample. That distribution is the input to
the depth-selection math.

### 5. The depth-selection algorithm — three concurrent criteria

**This is the heart of the step.** Let `f_i` be the read count in sample
*i*, and let `d` be a candidate rarefaction depth. The algorithm sweeps
`d` from 1,000 up to `max(f_i)` and picks the largest `d` that
simultaneously satisfies:

**(a) Overall sample-retention rule**:
The fraction of samples with `f_i ≥ d` must be `≥ 0.90`
(`MIN_OVERALL`). Equivalently: at most 10 % of samples are allowed to be
dropped by the rarefaction. If a `--group-col` is supplied, an additional
per-group retention check requires `≥ MIN_GROUP` of each group's samples
to survive — otherwise we'd risk wiping out an entire treatment group.

**(b) Coverage rule (Good's coverage)**:
For each retained sample, the analytical **Good's coverage** at depth
`d` is computed:

```
C(d) = 1 − f₁(d) / d
```

where `f₁(d)` is the **expected number of singletons** in a subsample of
size `d` from the sample's count vector. The mean of `C(d)` across
retained samples must be `≥ 0.98` (`GOOD_COV_MIN`) — i.e. on average,
at most 2 % of the community at the rarefied depth would be unobserved
singletons.

**(c) Plateau rule (Hurlbert 1971)**:
The expected number of observed ASVs at depth `d`, given a sample with
`f_i` reads and ASV counts `n_j`, is the **Hurlbert rarefaction**
closed-form:

```
E[S | d, sample i] = Σ_j  [ 1 − C(f_i − n_j, d) / C(f_i, d) ]
```

where `C(a, b)` is the binomial coefficient and the sum is over every
ASV `j` in sample `i`. (This is the exact expectation, not a simulation
approximation — much faster and bit-reproducible.) For each candidate
`d`, the algorithm computes the **mean slope** of that curve in a small
window around `d`, expressed as **features gained per 1,000 additional
reads**. That slope must be `< 0.5` (`PLATEAU_SLOPE_MAX`) — meaning the
curve has effectively flattened, so we're not throwing information away
by stopping here.

**The recommended depth** is the largest `d` satisfying *all three*
criteria. If no `d` does, the algorithm reports which criterion is
binding (the script can then say "criterion (c) was binding — the
curves haven't plateaued at any feasible depth").

### 6. Sample-ID consistency checks

**Then** the script runs three ID-overlap checks:

- Metadata IDs ↔ feature-table IDs.
- Feature-table IDs ↔ representative-sequences IDs.
- Representative-sequences IDs ↔ tree tip IDs.

A mismatch at any of these levels would cause the diversity step to
silently drop samples. The script lists every mismatching ID by name and
sets `OVERALL_STATUS=FAIL`.

### 7. Official QIIME alpha-rarefaction

**For documentation**, the script also runs `qiime diversity
alpha-rarefaction` with `observed_features + shannon + faith_pd`, max
depth = max sample frequency, 10 iterations, 20 steps. The resulting
QZV is what the user actually clicks through in their browser; the
analytical preview (the closed-form Hurlbert plot from step 5) goes into
the final report.

### 8. Decision-supporting visualisations

The script then writes four PNGs:

- `sequencing_depth_distribution.png` — histogram of `f_i`.
- `depth_vs_retention.png` — the (d, retained-fraction) curve, with the
  90 % threshold marked.
- `alpha_rarefaction_curves.png` — mean Hurlbert curve, annotated with
  the chosen depth.
- `group_depth_summary.png` — per-treatment-group depth distributions
  when a `--group-col` is supplied.

### 9. Write the cross-step info file + `STATUS`

**Finally** the script writes `mbx_pre_diversity_info.txt` with every
output path, the recommended depth, the binding criterion (if any), and
one of four `STATUS` values:

- `PASS` — all three criteria met cleanly.
- `PASS_WITH_WARNINGS` — criteria met but borderline; non-blocking
  warnings (e.g. one group at exactly 90 % retention).
- `REVIEW_REQUIRED` — fallback rule used, or a criterion failed; user
  should look at the summary before continuing.
- `FAIL` — pipeline-stopping problem (zero overlap between metadata and
  table; a group entirely wiped out). The next step refuses to run
  unless `--force` is passed.

`READY_FOR_DIVERSITY=yes|no` is also written — Steps 12, 13, 14, 15 all
read it and refuse to run when set to `no`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Tree builder | `align-to-tree-mafft-fasttree` | MAFFT + FastTree is the QIIME2-recommended pipeline; fast + accurate enough for community-level diversity. |
| Alignment mode | MAFFT `FFT-NS-2` (default) | Best speed/accuracy trade-off for ~10²–10³ ASVs. |
| Tree rooting | mid-point | UniFrac requires a rooted tree. Mid-point root is unbiased w.r.t. group structure. |
| Overall sample retention floor | **0.90** (`MIN_OVERALL`) | Microbial ecology convention; losing > 10 % of samples non-randomly is unacceptable. |
| Per-group retention floor (when `--group-col`) | **0.80** (`MIN_GROUP`) | Slightly more permissive — small groups need extra leeway. |
| Good's coverage floor | **0.98** (`GOOD_COV_MIN`) | At most 2 % of the community can be unobserved singletons at the chosen depth. |
| Plateau slope ceiling | **0.5 features / 1,000 reads** (`PLATEAU_SLOPE_MAX`) | Below this slope the curve is statistically flat — additional reads aren't recovering new biology. |
| Depth sweep step size | adaptive (log-linear) | Faster than a constant grid without losing resolution near the candidate depth. |
| Rarefaction iterations (QIIME visualisation) | 10 | QIIME2 default; enough to smooth the curves for visual interpretation. |
| Rarefaction steps (QIIME visualisation) | 20 | Same. |
| Phylogeny threads | `MBX_THREADS` | Single source of truth for parallelism. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **`PASS_WITH_WARNINGS`** | All three criteria met but borderline (e.g. coverage 0.978) | Non-blocking — downstream steps run, but the report flags the concern. |
| **`REVIEW_REQUIRED`** | No `d` satisfies all three; the algorithm uses the largest `d` satisfying any two | The user should inspect the curves; downstream steps run only with the report-issued warning. |
| **`FAIL` (depth-based)** | A `--group-col` group would be entirely wiped at every candidate depth | Continuing would silently drop a treatment group; this must be a hard stop. |
| **`FAIL` (ID-based)** | < 50 % overlap between metadata and feature-table sample IDs | Almost always a metadata-vs-FASTQ-sample-ID mismatch that Step 1 missed. |
| **`READY_FOR_DIVERSITY=no`** | `STATUS ∈ {FAIL, REVIEW_REQUIRED}` (configurable) | Downstream steps 12, 13, 14, 15 all gate on this. |
| **`--force`** flag on downstream steps | User wants to run anyway | The override exists; the report records that it was used. |

---

## What the output file looks like

```
RECOMMENDED_DEPTH=12450
DEPTH_CRITERION_OVERALL=PASS  (94 % of samples ≥ 12,450)
DEPTH_CRITERION_COVERAGE=PASS (mean Good's coverage = 0.987)
DEPTH_CRITERION_PLATEAU=PASS  (slope = 0.31 features / 1,000 reads)
BINDING_CRITERION=none

ROOTED_TREE_QZA=/.../11_pre_diversity/rooted-tree.qza
FEATURE_TABLE_QZA=/.../7_taxonomy_csv/feature_table_filtered.qza
METADATA_TXT=/.../metadata.txt

OVERALL_STATUS=PASS
READY_FOR_DIVERSITY=yes
STATUS=COMPLETE
```

Plus four PNGs that the final report embeds, the official QIIME
rarefaction QZV for interactive inspection, and a plain-language summary
file (`mbx_pre_diversity_summary.txt`) the user can hand to a reviewer.

---

## Takeaway

> Step 11 builds the tree the diversity metrics need, but more importantly
> it **picks the rarefaction depth with three concurrent criteria** so
> the decision is reviewer-defensible. Hurlbert 1971's closed-form
> rarefaction lets us evaluate the plateau analytically — bit-reproducible
> without Monte Carlo. The `STATUS` field gates Steps 12 through 15 from
> running when the depth verdict is too weak.

---

## Sources

- The script: `mbXPro/scripts/mbx_pre_diversity_parameters.sh`
- Hurlbert rarefaction: Hurlbert (1971), *The non-concept of species
  diversity*, Ecology 52:577–586.
- Good's coverage: Good (1953), *The population frequencies of species
  and the estimation of population parameters*, Biometrika 40:237.
- MAFFT: Katoh & Standley (2013), MBE 30:772–780.
- FastTree: Price et al. (2010), PLOS ONE 5:e9490.
- Why depth choice matters: Weiss et al. (2017), Microbiome 5:27.
