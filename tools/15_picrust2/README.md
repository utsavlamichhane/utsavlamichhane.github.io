# Step 15 — PICRUSt2 (Functional Prediction)

**Script:** `scripts/mbx_picrust_run.sh`

**Companion files in this folder:**
- `15_picrust2.html` — same content with copy buttons.
- `15_picrust2.pptx` — slide deck for the talk.

---

## Why this step matters

Every step up to now has answered "**what's there**" questions. Step 15
answers a "**what is it doing**" question — at least, predicted from the
phylogenetic placement of each ASV.

16S sequencing tells us identity but nothing direct about function.
**PICRUSt2** (Douglas et al. 2020) fills that gap by exploiting the fact
that closely-related organisms tend to share gene families. The
algorithm places every ASV on a reference phylogenetic tree, looks up the
known gene content of its nearest reference genomes, and infers the
expected gene-family abundance per sample. The output is four functional
abundance tables:

- **KO** (KEGG Orthology) — individual gene families.
- **EC** (Enzyme Commission) — enzymatic activities.
- **COG** (Clusters of Orthologous Groups) — broad functional
  categories.
- **MetaCyc** pathways — high-level metabolic pathways.

Step 15's job is to run PICRUSt2 reliably (it lives in its own conda
env — see "fallbacks"), flag samples whose ASVs are too distantly related
to the reference to trust the prediction, run differential abundance
across treatments on each database, and produce a self-contained HTML
report so the user can read the functional result alongside the
taxonomic ones.

---

## What the script does in one sentence

It runs PICRUSt2 in a pre-baked conda env to predict KO/EC/COG/MetaCyc
abundances per sample, computes per-sample **NSTI** (the
phylogenetic distance from each ASV to its nearest reference genome,
the official trustworthiness metric), runs Kruskal-Wallis + Dunn
differential abundance per categorical variable, optionally correlates
genera × pathways with the Step 14 results, and writes a self-contained
HTML report.

---

## The algorithm, step by step

### 1. Gate on Step 11

**First**, same `READY_FOR_DIVERSITY` gate. PICRUSt2 uses **raw counts**
(non-rarefied) like ANCOMBC2 — it needs absolute count information for
its NSTI weighting.

### 2. Use the pre-baked `mbx_picrust2` conda env

**Then** the script confirms a conda env named `mbx_picrust2` exists. If
the user is running inside the Docker image, the env is baked in at
build time (see Phase 3.3 in `CHANGELOG.md`) — `picrust2=2.6.3` from
bioconda. If running on a fresh host, the script creates the env on first
use (~2 GB download). All `picrust2_*.py` commands are invoked via
`conda run -n mbx_picrust2`, so the script **never modifies the active
QIIME2 env**.

### 3. Export the rep-seqs and feature table to PICRUSt2-friendly formats

**Next** the script converts the Step-4 representative_sequences.qza to a
plain FASTA and the Step-7 filtered feature table to a BIOM/TSV pair. Those
are PICRUSt2's required inputs.

### 4. Run `place_seqs.py`

**Now** PICRUSt2 places every ASV on its reference 20,000-genome tree
using `epa-ng` (placement) + `gappa` (re-formatting):

```
place_seqs.py \
  -s rep_seqs.fasta \
  -o placed_seqs.tre \
  -p $THREADS
```

This is the most computationally expensive sub-step (a few minutes per
1,000 ASVs).

### 5. Compute NSTI per ASV

**Then** PICRUSt2 computes the **Nearest Sequenced Taxon Index** for each
ASV — the phylogenetic distance from the ASV to its closest
reference genome on the tree. A low NSTI (≤ 0.15) means the prediction
is well-grounded in a real reference; a high NSTI (> 1.0) means the ASV
is so distantly related to anything sequenced that the predicted gene
content is essentially a guess.

The script computes the **weighted mean NSTI per sample** (read-count-
weighted, not just ASV-mean) and **flags any sample with weighted NSTI
> 1.0** in the final report. Those samples are excluded from the per-
variable DA analysis by default.

### 6. Predict gene-family abundance — three databases

**For each of KO, EC, COG**:

```
metagenome_pipeline.py \
  -i feature_table.biom \
  -m marker_nsti_predicted.tsv.gz \
  -f <KO|EC|COG>_predicted.tsv.gz \
  --strat_out          \
  -o <KO|EC|COG>_metagenome/
```

Output is per-sample predicted abundance of every KO/EC/COG term.

### 7. Predict MetaCyc pathway abundance

**Then** the script runs `pathway_pipeline.py` to roll the EC predictions
into **MetaCyc pathway** abundances. MetaCyc is the standard
human-readable pathway database — much friendlier than raw KO codes for
biology-focused readers.

### 8. Per-variable Kruskal-Wallis + Dunn on each database

**For every categorical metadata variable** (auto-detected, same as
Steps 9/10) the script runs:

- Kruskal-Wallis on each KO / EC / COG / MetaCyc-pathway abundance.
- Benjamini-Hochberg across the gene families.
- Dunn pairwise on KW hits.
- Compact letter displays on significant pathways.

Outputs: `DA_KO_KW_<Variable>.xlsx`, `DA_EC_KW_<Variable>.xlsx`,
`DA_COG_KW_<Variable>.xlsx`, `DA_metacyc_pathways_KW_<Variable>.xlsx`,
each with the per-term p, p_adj, group means, and Dunn pairs for
significant terms.

### 9. Cross-reference with Step 14 (when available)

**If Step 14 ran**, the script computes Spearman correlations between
every (significant differentially-abundant genus from Step 14) and
every (significant differentially-abundant MetaCyc pathway). The result
is `correlation_DAgenera_x_DApathways_<Variable>.{tsv,png,pdf}` — a
heatmap that lets the reader say *"the increase in pathway X is driven
by the increase in genus Y"*.

### 10. Plots

- **Stacked-bar top-20 MetaCyc pathways** per variable.
- **Heatmap of differentially-abundant pathways** with log-fold-change +
  significance stars.
- **Functional PCoA** based on Bray-Curtis of MetaCyc abundance — the
  functional analogue of Step 13's taxonomic PCoA.
- **Genus × pathway correlation heatmap** (when Step 14 is available).

PNG + SVG always; PDF on `--publication-figures`.

### 11. Self-contained HTML report

**Finally** the script writes `picrust2_report.html`, embedding every
plot as inline `<img src="data:image/...">` so the user can email the
single file. Per-sample NSTI flagging is shown at the top so the reader
can see immediately which samples had unreliable predictions.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Conda env name | **`mbx_picrust2`** | Isolated from the QIIME2 env so we don't pollute the active scientific env. Baked into the Docker image. |
| PICRUSt2 version | **2.6.3** | The bioconda-published latest stable at image build. Pinned in the Dockerfile. |
| NSTI threshold (per-sample flag) | **mean NSTI > 1.0** | PICRUSt2 maintainers' own recommendation — above this the predictions are too unreliable to act on. |
| Databases predicted | **KO, EC, COG, MetaCyc** | The four most-used functional databases in microbiome papers. |
| Test (per-variable) | **Kruskal-Wallis** (or Wilcoxon for 2 groups) | Functional abundances are not normal; same reasoning as Step 10. |
| Multiple-testing correction | **Benjamini-Hochberg** | Standard FDR for the per-database panel. |
| Per-database significance threshold | **p_adj ≤ 0.05** | Field convention; user can re-filter. |
| Cross-reference with Step 14 | always when Step 14 outputs are present | Adds the genus-drives-pathway interpretation for free. |
| Plot formats | **PNG + SVG always; PDF on `--publication-figures`** | Publication-ready by default. |
| Threads | `MBX_THREADS` | Single source of truth. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Refuse to run** | `READY_FOR_DIVERSITY=no` | Same gate. |
| **Skip COG** | Known PICRUSt2 2.6.x bug — COG mapping file uses an HDF5 format that the pathway pipeline can't read | KO + EC + MetaCyc still ship; the report explains the gap. Once PICRUSt2 fixes it, COG will run automatically. |
| **Exclude high-NSTI samples from DA** | Weighted mean NSTI > 1.0 | Their predictions are unreliable; including them would bias the test. They're still in the per-sample table. |
| **Skip genus×pathway correlation** | Step 14 didn't run or had no significant genera | No data; the correlation block is omitted from the report. |
| **Reuse cached intermediates** | A previous run produced placed_seqs.tre + the predicted tables | Saves the most expensive sub-step on re-runs. |
| **First-run env creation** | `mbx_picrust2` env doesn't exist (running outside Docker) | One-time ~2 GB bioconda download. The Docker image avoids this. |

---

## What the output file looks like

`Summary_picrust2_NSTI.xlsx`:

| sample-id | mean_NSTI | weighted_mean_NSTI | flag |
|---|---|---|---|
| SampleA | 0.041 | 0.029 | RELIABLE |
| SampleB | 0.053 | 0.038 | RELIABLE |
| SampleC | 1.214 | 1.142 | UNRELIABLE — excluded from DA |

`DA_metacyc_pathways_KW_<Variable>.xlsx` (per-pathway KW results):

| pathway | description | KW_chi2 | p_value | p_adj | significant |
|---|---|---|---|---|---|
| PWY-7242 | D-fructuronate degradation | 13.92 | 0.0009 | 0.0048 | TRUE |
| PWY-6383 | Mono-trans, poly-cis decaprenyl phosphate biosynthesis | 7.81 | 0.020 | 0.041 | TRUE |
| ... | | | | | |

Plus the cross-referenced `correlation_DAgenera_x_DApathways_<Variable>.tsv`
when Step 14 is present, and the self-contained HTML report.

---

## Takeaway

> Step 15 turns the taxonomic 16S story into a functional story —
> phylogenetic placement + nearest-relative gene lookup + per-sample NSTI
> trust scoring. The script keeps PICRUSt2 in its own conda env so it
> doesn't poison the QIIME2 env, and bakes that env into the Docker image
> so the pipeline is fully offline-capable.

---

## Sources

- The script: `mbXPro/scripts/mbx_picrust_run.sh`
- PICRUSt2: Douglas et al. (2020), *PICRUSt2 for prediction of
  metagenome functions*, Nature Biotechnology 38:685–688.
- NSTI: Langille et al. (2013), *Predictive functional profiling of
  microbial communities using 16S rRNA marker gene sequences*, Nature
  Biotechnology 31:814.
- MetaCyc: Caspi et al. (2020), *The MetaCyc database of metabolic
  pathways and enzymes*, NAR 48:D445.
- KEGG: Kanehisa et al. (2017), *KEGG: new perspectives on genomes,
  pathways, diseases and drugs*, NAR 45:D353.
