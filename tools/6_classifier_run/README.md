# Step 6 — Classifier Run

**Script:** `scripts/mbx_classifier_run.sh`

**Companion files in this folder:**
- `6_classifier_run.html` — same content with copy buttons on every code block.
- `6_classifier_run.pptx` — slide deck for the talk.

---

## Why this step matters

Step 5 set the table — decided region-specific vs full-length, downloaded
or staged the reference data, sha256-verified anything that came from
Zenodo. Step 6 is where the actual **taxonomic classification** runs:
given an ASV sequence, *what organism does it come from?*

The answer has to be defensible, reproducible, and **fall back gracefully**
if the Zenodo download Step 5 thought was good turns out to be unloadable
in `classify-sklearn`. That last part is the trick. Zenodo verifies file
integrity by sha256 — but sha256 only proves "the bits are what we
expected", not "the bits are loadable in the user's exact sklearn
build". A subtle pickle incompatibility (sklearn 1.4.0 vs 1.4.2, say) can
slip through the sha check and only fail when `classify-sklearn`
actually tries to load the model.

Step 6's job is to **handle that gracefully** — detect the failure, delete
the bad artifact, train a fresh classifier locally, retry, and only fail
the pipeline if local training also fails. The user shouldn't have to
know any of this happened unless they want to.

---

## What the script does in one sentence

It reads Step 5's run-info to know the mode + source, then runs three
QIIME2 commands (extract-reads → fit-classifier-naive-bayes →
classify-sklearn) — skipping the first two when a pre-trained classifier
was downloaded, and falling back to local training if the downloaded
classifier turns out to be unloadable.

---

## The algorithm, step by step

### 1. Parse the Step 5 info file

**First** the script reads `5_classifier_working_dir/mbx_classifier_run_info.txt`
and pulls out `CLASSIFIER_MODE`, `CLASSIFIER_SOURCE`, and every path it
needs. No CLI arguments — the script gets everything from Step 5's
canonical output.

### 2. Decide which sub-steps to run

**Then** the script decides which of the three QIIME2 commands to actually
execute, based on the source:

| `CLASSIFIER_SOURCE` | extract-reads | fit-classifier | classify-sklearn |
|---|---|---|---|
| `local-training` (region-specific) | RUN | RUN | RUN |
| `local-training` (full-length) | SKIP | RUN | RUN |
| `zenodo` or `cached` | SKIP | SKIP | RUN |

A `zenodo` source skips the two expensive sub-steps entirely — that's where
the 30–90 minutes of saving comes from.

### 3. (region-specific only) Extract-reads from the GG2 backbone

**For region-specific local training**, the script runs:

```
qiime feature-classifier extract-reads \
  --i-sequences   gg2.backbone.full-length.fna.qza \
  --p-f-primer    <forward primer from Step 0> \
  --p-r-primer    <reverse primer from Step 0> \
  --p-min-length  <min ASV length from Step 5> \
  --p-max-length  <max ASV length from Step 5> \
  --o-reads       gg2_extracted_reads.qza
```

This slices the GG2 backbone to **just the V-region the user actually
sequenced**, at the same length distribution Step 4 produced. The
resulting reference is much smaller — training on it is faster and
species-level accuracy goes up a few points.

### 4. (local training only) Fit the Naive Bayes classifier

**Then** the script runs:

```
qiime feature-classifier fit-classifier-naive-bayes \
  --i-reference-reads     <extracted_reads or full-length backbone>.qza \
  --i-reference-taxonomy  gg2.backbone.tax.qza \
  --o-classifier          gg2_trained_classifier.qza
```

This is the expensive step — 30–90 minutes of CPU + ~15 GB RAM peak. We
only run it when we don't have a pre-trained artifact from Zenodo.

### 5. Run classify-sklearn — and handle failure

**Now the actual classification:**

```
qiime feature-classifier classify-sklearn \
  --i-classifier      <pre-trained or freshly-trained>.qza \
  --i-reads           representative_sequences.qza \
  --p-n-jobs          <MBX_THREADS>  \
  --o-classification  taxonomy.qza
```

This is where the **fall-back gets interesting**:

- If the source was `zenodo` AND `classify-sklearn` fails, the script
  catches the failure, **deletes the downloaded artifact**, updates
  `CLASSIFIER_SOURCE` to `local-training-fallback`, **re-runs Step 5's
  local-training prep**, then re-runs `fit-classifier-naive-bayes` and
  `classify-sklearn`. The user sees a single retry message; the pipeline
  keeps going.
- If local training was already the source and `classify-sklearn` fails,
  the script aborts with a detailed error. That failure is almost always a
  GG2 version mismatch or a corrupted reference — nothing the script can
  fix automatically.

### 6. Tabulate

**Finally** the script runs `qiime metadata tabulate` on the classification
result to produce `taxonomy.qzv` — an interactive HTML table the user can
open in a browser. Every ASV gets its assigned taxonomy string and a
confidence score.

### 7. Idempotency

All three QIIME2 commands write to disk; the script checks for those
outputs before running each. So a partial run that died after
extract-reads is safe to re-run — it'll skip the expensive completed
step and pick up where it left off.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| extract-reads `--p-f-primer` / `--p-r-primer` | from Step 0 | We use exactly the primers Step 0 detected. If Step 0 was wrong, we'd rather see that here than mask it. |
| extract-reads `--p-min-length` / `--p-max-length` | from Step 5 (the ASV length distribution) | The trained classifier should see the same length range it'll classify. |
| fit-classifier `--p-classify-with` | Naive Bayes (Multinomial) | The QIIME2-default classifier. Faster than scikit-learn's vanilla MultinomialNB on the same problem, and better calibrated for amplicon data. |
| classify-sklearn `--p-n-jobs` | `MBX_THREADS` (orchestrator-exported) | Scales near-linearly. Single source of truth for parallelism. |
| classify-sklearn `--p-confidence` | **0.7** (QIIME2 default) | Below this confidence the taxonomy string is truncated to the deepest defensible level. |
| classify-sklearn `--p-pre-dispatch` | `'2*n_jobs'` | sklearn's default; balances memory vs throughput. |
| Skip extract-reads | when `CLASSIFIER_MODE = full-length` | Full-length training doesn't need a region extracted. |
| Skip fit-classifier | when `CLASSIFIER_SOURCE ∈ {zenodo, cached}` | A pre-trained classifier already exists; training again would produce the same artifact for 30–90 min of wasted compute. |
| Reuse on existing outputs | always | Step 6 is idempotent — re-running is safe and cheap when outputs already exist. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Skip extract-reads** | `CLASSIFIER_MODE = full-length` | Full-length mode trains on the whole backbone — no slice needed. |
| **Skip fit-classifier** | `CLASSIFIER_SOURCE ∈ {zenodo, cached}` | A pre-trained artifact exists; rebuilding would produce the same result. |
| **Reuse cached intermediate** | A previous run already produced `gg2_extracted_reads.qza` or `gg2_trained_classifier.qza` for the same parameters | Saves wall-clock when the user reruns Step 6 after a downstream failure. |
| **`local-training-fallback`** | `classify-sklearn` failed on a `zenodo` artifact | The bits matched the sha256 but the classifier won't load — usually a subtle scikit-learn pickle issue. Script deletes the bad file, retrains locally, retries. |
| **Use orchestrator `MBX_THREADS`** | `mbXPro --threads N` was set | One source of truth for parallelism. |
| **Hard fail on local-training failure** | Local training fitting failed | This is almost always GG2 corruption or a missing reference — nothing the script can fix automatically. We error loudly so the user can re-download. |

---

## What the output file looks like

`taxonomy.qza` is a zip archive containing one row per ASV:

```
Feature ID        Taxon                                                              Confidence
ASV_001    d__Bacteria;p__Bacillota;c__Bacilli;o__Lactobacillales;f__Lactobacillaceae;g__Lactobacillus  0.9912
ASV_002    d__Bacteria;p__Bacteroidota;c__Bacteroidia;o__Bacteroidales;f__Bacteroidaceae;g__Bacteroides  0.9847
ASV_003    d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales  0.6334
ASV_004    Unassigned                                                                  0.0142
...
```

- The taxonomy string follows the GG2 nomenclature, with `d__` /
  `p__` / `c__` / `o__` / `f__` / `g__` / `s__` prefixes.
- ASVs whose top hit is below the `--p-confidence` cutoff get the
  string truncated to the deepest level above the cutoff.
- Anything that no GG2 reference matched is labelled `Unassigned`.

The companion `taxonomy.qzv` opens this same data in a browser as a
searchable, sortable table.

---

## Takeaway

> Step 6 is the actual classification execution. The interesting part isn't
> the QIIME2 commands — those are standard — it's the **fall-back logic**:
> if a Zenodo-sourced classifier fails to load (subtle sklearn pickle
> mismatch), the script automatically deletes it, regresses to local
> training, retries, and surfaces the whole event in `CLASSIFIER_SOURCE =
> local-training-fallback` so the final report can explain what happened.
> The pipeline doesn't abort because of an upstream cache mismatch.

---

## Sources

- The script: `mbXPro/scripts/mbx_classifier_run.sh`
- QIIME2 `q2-feature-classifier` plugin:
  https://docs.qiime2.org/2025.4/plugins/available/feature-classifier/
- Naive Bayes classifier methodology: Bokulich et al. (2018),
  *Optimizing taxonomic classification of marker-gene amplicon sequences
  with QIIME 2's q2-feature-classifier plugin*, Microbiome 6:90.
- Greengenes2 nomenclature: McDonald et al. (2024), Nature Biotechnology
  42:715–718.
