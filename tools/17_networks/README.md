# Step 17 — Co-occurrence Networks

**Script:** `scripts/mbx_network_run.sh`

**Companion files in this folder:**
- `17_networks.html` — same content with copy buttons.
- `17_networks.pptx` — slide deck for the talk.

---

## Why this step matters

Every step up to now has treated taxa **independently** — even ANCOMBC2,
which fits one model per taxon. But communities aren't lists; they're
**networks of co-occurrence and co-exclusion**. Two taxa that consistently
rise and fall together may share a niche, depend on each other's
metabolic byproducts, or compete for the same substrate. Two taxa that
consistently substitute for each other may be ecological alternatives —
where one thrives, the other can't.

Co-occurrence networks make this structure visible. A node is a taxon; an
edge is a statistically supported positive (co-occurrence) or negative
(co-exclusion) correlation. The shape of the graph — its hubs, its
modules, its density — captures community structure that no per-taxon
test can see.

The trick is doing it **compositionally**. The same problem ANCOMBC2 solved
for differential abundance shows up here: raw correlations on relative
abundances are biased toward spurious negative correlations (because if
one taxon goes up, the rest have to go down by the same total). Step 17
solves it the standard way: **CLR transform + Spearman correlation**
(Gloor et al. 2017), which removes the compositional constraint and uses
rank correlation for robustness to the heavy tails microbiome data
carries.

---

## What the script does in one sentence

For every (taxonomic level × categorical variable), it CLR-transforms the
abundance table, computes Spearman correlations between every pair of
taxa, adjusts the resulting p-values with Benjamini-Hochberg, filters
edges by `|ρ| ≥ ρ_threshold AND q ≤ q_threshold`, builds an igraph object,
detects modules via Louvain, identifies hub taxa, and exports per-group
network files plus a multi-panel comparison plot.

---

## The algorithm, step by step

### 1. Gate on Steps 7 + 8

**First**, same gate as Step 16 — read the metadata + the seven cleaned
XLSX paths from `8_cleaned_files/mbx_ezclean_info.txt`. Disk-discovery
fallback if the info file is missing (rare).

### 2. For every (level × variable), build one **global** and N **per-group** networks

**For each level requested** (genus, family, species by default — those
are the levels biologists actually interpret as ecological units):

- One **global** network using all samples — the "ecological backbone".
- One **per-group** network for each level of the categorical variable,
  *only when* the group has at least `--min-group-n` samples (default 5).
  Below that, the correlations are too noisy to be informative.

### 3. Prevalence filter

**Drop taxa present in fewer than `--prevalence-threshold` fraction of
samples** (default 30 %). Rare taxa add noise without contributing signal
to the correlation matrix.

### 4. Pseudocount + CLR transform

**Add a small pseudocount** (`pseudocount = 1`) to handle zeros, then
apply the **Centred Log-Ratio** (CLR) transform per sample:

```
CLR(x_i) = log( x_i / g(x) )
```

where `g(x)` is the geometric mean of the sample's relative abundances.
The CLR transform removes the unit-sum constraint of compositional data:
two CLR values can both go up at the same time. From this point on, the
data behaves like normal continuous variables.

### 5. Spearman correlation matrix

**Compute the Spearman rank correlation** between every pair of taxa.
Rank-based is preferred over Pearson because the CLR transform is
log-distributed and heavy-tailed; Spearman handles that without an
explicit normality assumption.

### 6. Benjamini-Hochberg FDR

**For each pairwise p-value, compute the BH-adjusted q-value across the
entire correlation matrix** (`p × (p − 1) / 2` tests). FDR control is
necessary because we're testing thousands of pairs.

### 7. Edge filtering

**Keep an edge only if BOTH:**

- `|ρ| ≥ --rho-threshold` (default 0.30) — the effect size is large enough
  to mean something biologically.
- `q ≤ --q-threshold` (default 0.05) — the BH-adjusted p-value is
  significant.

Both filters are necessary. A very low |ρ| with a tiny q (because N is
large) is a real but biologically trivial correlation. A high |ρ| with a
non-significant q is suggestive but underpowered.

### 8. Build the graph and compute node metrics

**Construct an undirected igraph** with one node per taxon and one edge
per surviving pair. Compute per-node:

- **Degree** — how many edges this taxon has.
- **Betweenness centrality** — how often this taxon lies on the shortest
  path between two other taxa.
- **Hub score** — eigenvector-based "this taxon is connected to
  well-connected taxa".

### 9. Module detection via Louvain

**Run the Louvain algorithm** (a greedy modularity-maximization heuristic)
to partition the graph into communities. The output `modules.tsv` says
which module each taxon belongs to. Modules often correspond to
ecological guilds.

### 10. Hub identification

**Pick the top 10 % of taxa by combined `degree + betweenness +
hub_score`**, normalised. These are the network's "keystone-suspect"
taxa — taxa whose removal would most disconnect the graph.

### 11. Group comparison

**When per-group networks exist**, the script computes:

- **Number of nodes / edges per group**.
- **Density** (`edges / (n × (n − 1) / 2)`).
- **Modularity** (the Louvain quality score).
- **Hub-overlap Jaccard** across groups — do the same taxa show up as
  hubs in every group, or do hubs change with treatment?

These go into `group_comparison.xlsx` and a multi-panel plot.

### 12. Visualisation

**For each network**:

- **Layout** — Fruchterman-Reingold with a fixed RNG seed
  (`MBX_PLOT_SEED`) so re-runs give identical layouts.
- **Edge colour** — red for negative `ρ` (co-exclusion), blue for positive
  (co-occurrence).
- **Node size** — proportional to degree.
- **Module colour** — one colour per Louvain module.

Exported as **PNG + PDF + GraphML**. The GraphML can be opened in
Cytoscape for interactive exploration.

### 13. Write `mbx_networks_info.txt`

**Finally** the cross-step contract records every graph path + every
metric XLSX, plus `STATUS=COMPLETE`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Approach | **CLR + Spearman** | The standard lightweight compositional-aware approach (Gloor et al. 2017). SparCC is Python-only; SpiecEasi pulls heavy Bioconductor deps. |
| Levels run | **genus, family, species** | The levels biologists interpret as ecological units. Higher levels are too coarse. |
| Per-group minimum N | **5** | Below five, the correlation estimates are too noisy. |
| Prevalence threshold | **0.30** | Drop taxa present in < 30 % of samples; they add noise without signal. |
| Pseudocount | **1** | Standard for CLR on count data; small enough to barely affect the transform but eliminates `log(0)`. |
| ρ threshold | **0.30** | Below this, the effect is biologically negligible even when statistically significant. |
| q threshold | **0.05** | Standard FDR cut. |
| Multiple-testing correction | **Benjamini-Hochberg** | Standard FDR control. |
| Module detection | **Louvain** | Fast, greedy modularity maximisation; widely used. |
| Hub-detection metric | **degree + betweenness + hub_score, top 10 %** | Combines three orthogonal notions of "central". |
| Layout | **Fruchterman-Reingold, seeded** | Reproducible across re-runs (`MBX_PLOT_SEED`). |
| Plot formats | **PNG + PDF + GraphML** | GraphML opens in Cytoscape for interactive exploration. |
| Threads | **`MBX_THREADS`** | Single source of truth. |
| Seed | **`MBX_SEED`** | Single source of truth. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Skip per-group network** | Group has < `--min-group-n` samples | Too noisy to interpret. The global network still runs. |
| **Skip a level** | After prevalence filter, < 5 taxa remain | Nothing to correlate. |
| **Disk-discovery for cleaned XLSX** | Step 8 info file missing | Find the seven cleaned XLSX by their canonical filename pattern. |
| **Hub list = top 5 %** instead of 10 % | User opted in via `--hubs-fraction` | Stricter hub definition for sparse networks. |
| **Re-use cached correlation matrix** | Previous run produced it | Saves the matrix computation on re-runs. |

---

## What the output file looks like

`network_summary.xlsx` per network:

| metric | value |
|---|---|
| n_nodes | 142 |
| n_edges | 487 |
| density | 0.049 |
| n_modules | 6 |
| modularity | 0.418 |
| n_positive_edges | 312 |
| n_negative_edges | 175 |

`hub_taxa.xlsx`:

| taxon | degree | betweenness | hub_score | combined |
|---|---|---|---|---|
| Bacteroides | 24 | 0.082 | 0.81 | 1.00 (rank 1) |
| Faecalibacterium | 19 | 0.067 | 0.74 | 0.83 |
| Bilophila.wadsworthia | 17 | 0.039 | 0.62 | 0.71 |
| ... | | | | |

Plus `edges.tsv`, `nodes.tsv`, `modules.tsv`, `network.graphml`, and the
`network_plot.{png,pdf}`. When per-group networks ran,
`group_comparison.xlsx` + `multi_panel_plot.{png,pdf}` show side-by-side.

---

## Takeaway

> Step 17 is the only step that treats the community as a **network**
> rather than a list. CLR + Spearman handles the compositional problem
> correctly without heavy Bioconductor dependencies. Louvain modules
> often correspond to ecological guilds; hub taxa are the
> keystone-suspect species worth following up on. The group-comparison
> plot is the "did treatment change the network's structure?" answer.

---

## Sources

- The script: `mbXPro/scripts/mbx_network_run.sh`
- CLR + Spearman for microbiome networks: Gloor et al. (2017),
  *Microbiome datasets are compositional: and this is not optional*,
  Front Microbiol 8:2224.
- Louvain modularity: Blondel et al. (2008), *Fast unfolding of
  communities in large networks*, J Stat Mech P10008.
- igraph: Csárdi & Nepusz (2006), *The igraph software package for
  complex network research*, InterJournal 1695.
- Fruchterman-Reingold layout: Fruchterman & Reingold (1991), *Graph
  drawing by force-directed placement*, Softw Pract Exp 21:1129.
- Cytoscape: Shannon et al. (2003), *Cytoscape: a software environment
  for integrated models of biomolecular interaction networks*, Genome
  Res 13:2498.
