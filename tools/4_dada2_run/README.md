# Step 4 — DADA2 Denoising

**Script:** `scripts/mbx_dada2_run.sh`

**Companion files in this folder:**
- `4_dada2_run.html` — same content with copy buttons on every code block.
- `4_dada2_run.pptx` — slide deck for the talk.

---

## Why this step matters

By the time we reach Step 4, the data is just *reads* — short DNA strings
from the sequencer, each carrying its own per-base quality scores. Reads
are noisy. Illumina makes about **1 wrong base per 1,000** in the best
part of a read, and worse near the back. If we treated every distinct read
as a separate organism, our results would be hopelessly contaminated by
sequencing errors.

**DADA2** (**D**ivisive **A**mplicon **D**enoising **A**lgorithm) solves
this. Instead of clustering reads at some arbitrary similarity threshold
(the old OTU approach), DADA2 *models the actual error process* and
asks: *given how Illumina makes mistakes, is this distinct read a real
biological variant — or is it just a slightly-corrupted copy of one?*

The output is a list of **Amplicon Sequence Variants** (**ASVs**) —
exactly-resolved DNA sequences that survive the error model. ASVs are
single-nucleotide resolved, comparable across studies, and far more
defensible than OTUs.

This step's job is to actually run DADA2 on our paired-end data, using the
truncation parameters Step 3 already computed, and to produce the three
artifacts every downstream step needs.

---

## What the script does in one sentence

It reads the four `--p-*` numbers from Step 3's `dada2_parameters.txt`,
runs `qiime dada2 denoise-paired` with those numbers and a sensible thread
count, then exports the three QZA outputs as human-readable QZV
visualisations.

---

## The algorithm, step by step

### 1. Validate the metadata file

**First**, the script reads the user's metadata file and confirms it has
the structure DADA2 (and every later step) expects:

- A header row.
- A first column named `sample-id`, `sampleid`, `id`, or one of the QIIME2-
  recognised synonyms.
- Sample IDs that match the artifact (every sample DADA2 will process
  appears in the metadata).

A mismatch here would let DADA2 succeed but produce results no downstream
step could merge against the metadata. So we catch it before DADA2 even
starts.

### 2. Parse the DADA2 parameter file

**Then** the script reads `3_dada2_parameters/dada2_parameters.txt` and
pulls out the four numbers Step 3 picked:

- `--p-trim-left-f` — bases to chop off the front of the forward read.
- `--p-trim-left-r` — bases to chop off the front of the reverse read.
- `--p-trunc-len-f` — length to keep on the forward read.
- `--p-trunc-len-r` — length to keep on the reverse read.

It also reads `INSERT_LENGTH_USED` and any `FALLBACK_REASONS` from the
same file — those don't change DADA2's behaviour, but they're logged so
the final report can show "Step 3 had to relax its filters because …".

### 3. Auto-detect the thread count

**Next** the script decides how many CPU threads to give DADA2:

- If the orchestrator exported `MBX_THREADS` (because the user passed
  `mbXPro --threads N`), use that.
- Otherwise call `nproc` (Linux) or `sysctl -n hw.logicalcpu` (macOS).
- Last-resort fallback: 1 thread.

DADA2 is **embarrassingly parallel across samples** — denoising sample A
doesn't need anything from sample B — so the more threads, the faster.

### 4. Run the denoise-paired plugin

**Now the actual denoising.** The command:

```
qiime dada2 denoise-paired \
  --i-demultiplexed-seqs   Paired_End_artifact.qza \
  --p-trim-left-f          <from step 3> \
  --p-trim-left-r          <from step 3> \
  --p-trunc-len-f          <from step 3> \
  --p-trunc-len-r          <from step 3> \
  --p-n-threads            <auto-detected> \
  --o-table                feature_table.qza \
  --o-representative-sequences  representative_sequences.qza \
  --o-denoising-stats     dada2_stats.qza
```

Inside QIIME2 this triggers the DADA2 R algorithm, which:

1. **Filters and trims** each read to the requested truncation length and
   removes pairs whose expected error exceeds `max_ee` (2.0 by default).
2. **Learns the error model** from the filtered reads themselves — DADA2
   estimates the substitution probabilities `P(true base → observed base
   | quality)` empirically. No assumptions baked in.
3. **Denoises** each sample by asking "is this distinct read more likely a
   real ASV, or a corrupted copy of a more abundant ASV?", iterated until
   stable.
4. **Merges** the forward and reverse reads (using the overlap Step 3
   guaranteed would exist).
5. **Removes chimeras** via the consensus method — sequences that look
   like a PCR-stitched combination of two real ASVs are dropped.

The output is three artifacts:

- `feature_table.qza` — counts of every ASV in every sample.
- `representative_sequences.qza` — the actual DNA sequence of every ASV.
- `dada2_stats.qza` — how many reads each sample lost at each stage
  (input → filtered → denoised → merged → non-chimeric).

### 5. Produce three QZV visualisations

**Finally** the script runs three QIIME2 visualisation commands so the
user can inspect what happened without having to extract the QZAs:

- `qiime metadata tabulate` → `dada2_stats.qzv` — interactive table of the
  per-sample retention numbers.
- `qiime feature-table summarize` → `feature_table.qzv` — per-sample
  read-count distribution, alpha-rarefaction preview, sample frequency
  histogram.
- `qiime feature-table tabulate-seqs` → `representative_sequences.qzv` —
  searchable table of ASV sequences with one-click BLAST links.

All three drop into `4_dada2_outputs/`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| `--p-trim-left-f` / `--p-trim-left-r` | from Step 3 | We never override what Step 3 decided. If the user wants different values they rerun Step 3 with override flags. |
| `--p-trunc-len-f` / `--p-trunc-len-r` | from Step 3 | Same — Step 3 is the single source of truth. |
| `--p-max-ee-f` / `--p-max-ee-r` | **2.0** | DADA2 paper's own default. "At most ~2 wrong bases over the kept length." Anything lower throws away too much data; anything higher lets noise into the error model. |
| `--p-trunc-q` | **2** | Hard cap: truncate any read at the first base with quality ≤ 2 (which means "we have no idea"). Almost never triggers because the max-ee check fires first. |
| `--p-chimera-method` | **consensus** | DADA2's recommended default. Tags an ASV as chimeric only if the consensus across samples says so — more robust than the per-sample `pooled` method. |
| `--p-min-fold-parent-over-abundance` | **1.0** | Chimera detection threshold. A putative parent must be at least as abundant as the chimera to be considered the source. |
| `--p-n-threads` | auto-detect | `MBX_THREADS` → `nproc` → `sysctl` → 1. DADA2 scales near-linearly with threads. |
| `--p-n-reads-learn` | **1,000,000** | QIIME2 default. Enough reads to fit the error model robustly without spending forever on it. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Use the orchestrator's `MBX_THREADS`** | `mbXPro --threads N` was passed. | One source of truth for parallelism across the whole pipeline. |
| **Auto-detect threads** | Step 4 run standalone with no orchestrator. | `nproc` / `sysctl` give a sensible default; 1 thread as last resort. |
| **Skip metadata-only samples** | Metadata has rows that aren't in the artifact. | Warn but continue — those samples just won't be in the analysis. The opposite case (artifact has a sample with no metadata) is a hard error from Step 1, never gets here. |
| **Inherit `DETECTION_STATUS` consequences** | Step 0 said `TRIMMED` → Step 3 set trim-left = 0. | We don't second-guess. DADA2 just uses what Step 3 decided. |

---

## What the output file looks like

`dada2_stats.qzv` (after `qiime metadata tabulate`) shows one row per
sample:

| sample-id | input | filtered | denoised-f | denoised-r | merged | non-chimeric |
|---|---|---|---|---|---|---|
| SampleA | 24,118 | 23,201 | 22,045 | 21,876 | 18,455 | 17,902 |
| SampleB | 19,732 | 19,011 | 18,200 | 18,099 | 14,338 | 13,991 |
| … | | | | | | |

A healthy run typically keeps ≥ 70 % of the input reads through to
non-chimeric. Big drops (≥ 50 %) at any one stage are diagnostic:

- Big drop at `filtered` → truncation lengths too aggressive or
  `max_ee` too strict.
- Big drop at `merged` → forward + reverse cuts don't leave enough overlap
  to merge (Step 3 should have caught this).
- Big drop at `non-chimeric` → PCR was over-cycled, the library has lots
  of chimeras.

The final report (Step 18) flags any sample that drops below 50 %
retention so the user knows where to look.

---

## Takeaway

> Step 4 is the step where reads become biology. DADA2 models the actual
> Illumina error process and resolves single-nucleotide variants instead of
> clustering at an arbitrary threshold. The mbX Pro wrapper just makes sure
> the parameters Step 3 computed actually get used, the metadata matches
> the artifact, and the three follow-up visualisations are produced so the
> user can sanity-check the per-sample retention before the next step
> consumes the result.

---

## Sources

- The script: `mbXPro/scripts/mbx_dada2_run.sh`
- DADA2 paper: Callahan et al. (2016), *DADA2: high-resolution sample
  inference from Illumina amplicon data*, Nature Methods 13:581–583.
- QIIME2 `q2-dada2` plugin:
  https://docs.qiime2.org/2025.4/plugins/available/dada2/
- Why ASVs over OTUs: Callahan et al. (2017), *Exact sequence variants
  should replace operational taxonomic units in marker-gene data analysis*,
  ISME Journal 11:2639–2643.
