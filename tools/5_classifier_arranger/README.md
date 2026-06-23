# Step 5 — Classifier Arranger

**Script:** `scripts/mbx_classifier_arranger.sh`

**Companion files in this folder:**
- `5_classifier_arranger.html` — same content with copy buttons on every code block.
- `5_classifier_arranger.pptx` — slide deck for the talk.

---

## Why this step matters

Step 4 gave us ASV sequences. The next question is: **what organisms do they
correspond to?** Answering that — **taxonomic classification** — is the
single most computationally expensive job in 16S amplicon analysis.

The standard tool is a **Naive Bayes classifier**, trained on a reference
database of known 16S sequences with known taxonomy. The reference we use is
**Greengenes2** (GG2) — the current state-of-the-art rRNA database,
phylogeny-derived and updated regularly.

Training that classifier on a fresh machine takes **30–90 minutes** of CPU
time per run and **~15 GB of RAM** at the peak. For a research lab running
multiple projects per week, that's hours of wasted time. The classifier
arranger exists to **make that 30 seconds instead of 90 minutes**, by
recognising that the same classifier — trained against the same reference
+ the same QIIME2 version — will produce bit-identical results every time,
so a pre-trained one can be cached.

But there's another decision to make first: **region-specific vs
full-length**.

- If we know which 16S region was sequenced (V4, V3-V4, etc.), we can
  extract just that region from the reference and train on a much smaller
  alphabet — **faster classification + higher accuracy at the species
  level**.
- If we don't know the region (because Step 0 reported
  `DETECTION_STATUS = TRIMMED` or `UNKNOWN`), we have to train against the
  full backbone instead — **slower but works for any region**.

This step makes that decision, then either downloads a pre-trained
classifier from Zenodo or sets up local training for Step 6.

---

## What the script does in one sentence

It picks region-specific vs full-length training based on Step 0's primer
verdict, then for full-length it tries to download a pre-trained classifier
from a curated Zenodo record matching the user's QIIME2 version (sha256-
verified), falling back to local training if anything looks wrong.

---

## The algorithm, step by step

### 1. Detect the user's QIIME2 + scikit-learn versions

**First** the script runs `qiime info` and extracts the QIIME2 version
(e.g. `2025.4`). Then it asks the active conda env's Python for the
**scikit-learn** version. That second number matters because scikit-learn
**pickle compatibility breaks between minor versions** — a classifier
pickled with sklearn 0.24 cannot be loaded by sklearn 1.4 and vice versa.

### 2. Read Step 0's primer verdict

**Then** the script reads
`0_primer_handling/mbx_primer_info.txt` and looks at `DETECTION_STATUS`:

- `DETECTED` or `USER_SUPPLIED` → primers are known → we can do
  **region-specific** training.
- `TRIMMED` → primers were already removed → we lost the region anchor →
  must do **full-length** training.
- `UNKNOWN` → defensive choice: **full-length**.

This is the first big branch point. Region-specific is faster and a bit
more accurate at the species level, but only works if Step 0 succeeded.

### 3. Resolve the Zenodo entry that matches this QIIME2 release

**For full-length mode**, the script consults its **embedded registry** of
pre-trained classifiers hosted at:

```
https://zenodo.org/records/20021035
```

The registry has one row per supported QIIME2 release (2023.2 through
2025.4, eight rows total). Each row holds:

- The QIIME2 version it was built for.
- The Greengenes2 release used (2022.10 or 2024.09).
- The exact filename on Zenodo.
- The **sha256 checksum** of that file.

The script picks the row matching the user's QIIME2 version. If no row
matches, it skips Zenodo and goes straight to local training.

### 4. Download + sha256-verify

**Next** it downloads the matching `.qza` from Zenodo using `curl` (or
`wget`). After the download finishes, the script computes the file's
sha256 using `shasum -a 256` (macOS) or `sha256sum` (Linux), and compares
it against the registry. **A mismatch is treated as the download being
corrupt**: the file is deleted and the script falls back to local
training with a logged warning. We never use a half-downloaded artifact.

### 5. (Region-specific only) Download the GG2 backbone for local training

**If we're in region-specific mode** (or full-length mode without a Zenodo
match), the script downloads two GG2 reference files:

- `<gg2_ver>.backbone.full-length.fna.qza` — the reference sequences.
- `<gg2_ver>.backbone.tax.qza` — the taxonomy strings.

These get cached in `5_classifier_working_dir/` so subsequent projects
re-use them.

### 6. Compute the ASV length distribution

**Then** for region-specific mode, the script exports the representative
sequences from Step 4, measures the minimum and maximum ASV lengths
(usually within a few bp of each other since DADA2 truncates all sequences
to the same length), and writes them to `length_summary.txt`. Step 6 will
use those to tell `qiime feature-classifier extract-reads` exactly which
slice of the GG2 backbone to extract (so the trained classifier sees the
same length distribution it'll classify later).

### 7. Write `mbx_classifier_run_info.txt`

**Finally** the script writes an info file with everything Step 6 needs to
run, including:

- `CLASSIFIER_MODE` — `region-specific` or `full-length`.
- `CLASSIFIER_SOURCE` — `zenodo`, `cached`, `local-training`, or
  `local-training-fallback`.
- All the paths Step 6 will read.
- A `STATUS=COMPLETE` marker for `mbXPro --resume`.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Zenodo record URL | `https://zenodo.org/records/20021035` | Stable DOI-backed URL. The pre-trained classifiers are curated by the mbX Pro maintainers and will be republished there with each major QIIME2 release. |
| Supported QIIME2 versions | 2023.2, 2023.5, 2023.7, 2023.9, 2024.2, 2024.5, 2024.10, 2025.4 | The eight QIIME2 releases for which we maintain a pre-trained artifact. Older or unreleased versions fall through to local training. |
| Greengenes2 release (older QIIME2) | 2022.10 | The GG2 release used by QIIME2 2023.x and 2024.2. |
| Greengenes2 release (newer QIIME2) | 2024.09 | The GG2 release used by QIIME2 2024.5+. |
| Checksum algorithm | sha256 | The same algorithm Zenodo publishes; standard for tamper-evident verification. |
| `CLASSIFIER_MODE` selection | region-specific iff primers known | Region-specific is faster + slightly more accurate, but only safe when Step 0 confirmed the region. |
| `CLASSIFIER_SOURCE` precedence | zenodo → cached → local-training | Try the cheap option first, fall back to local training silently if anything looks wrong. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Force `full-length` mode** | Step 0 reported `TRIMMED` or `UNKNOWN` | Without the primer/region anchor, region-specific extract-reads would mis-align. Full-length is always safe. |
| **Skip Zenodo entirely** | `mbXPro --skip-zenodo`, offline runs, corporate firewall | Some users need to run with no outbound network. Local training takes longer but produces identical results. |
| **No matching Zenodo row** | The user's QIIME2 version is unsupported (e.g. a pre-release or a future version we haven't published for yet) | Local training works for any version; we don't gate on "is your version in our table?" |
| **sha256 mismatch** | Download was corrupt, or the file on Zenodo was replaced unexpectedly | Better to spend an extra 90 minutes training locally than to use an unknown artifact that might produce silently wrong taxonomy. |
| **Reuse cached classifier** | A previous project on this machine already downloaded the same classifier | We avoid re-downloading the same 180 MB file every project. |
| **`local-training-fallback`** | Zenodo succeeded but the downloaded classifier fails to load in `classify-sklearn` (e.g. scikit-learn pickle mismatch we didn't catch) | Step 6 deletes the bad file and falls back to local training automatically. The pipeline never aborts because of a Zenodo problem. |

---

## What the output file looks like

```
CLASSIFIER_MODE=full-length
CLASSIFIER_SOURCE=zenodo
QIIME2_VERSION=2025.4
SCIKIT_LEARN_VERSION=1.4.2
SCIKIT_LEARN_FAMILY=1.4
ZENODO_RECORD_URL=https://zenodo.org/records/20021035
ZENODO_QIIME2_USED=2025.4
ZENODO_GG2_USED=2024.09
ZENODO_FILENAME=gg2-2024.09-full-length-naive-bayes-qiime2-2025.4.qza
ZENODO_SHA256_EXPECTED=612075d9354fecfff7a2513e46891b3d9b0dc79bbcaf29f78de6b3e5d7bff3f8
ZENODO_SHA256_ACTUAL=612075d9354fecfff7a2513e46891b3d9b0dc79bbcaf29f78de6b3e5d7bff3f8
ZENODO_NOTE=Downloaded and sha256-verified successfully.

TRAINED_CLASSIFIER_QZA=/.../5_classifier_working_dir/gg2_full_length_trained_classifier.qza
REPRESENTATIVE_SEQUENCES_QZA=/.../4_dada2_outputs/representative_sequences.qza
FEATURE_TABLE_QZA=/.../4_dada2_outputs/feature_table.qza

STATUS=COMPLETE
```

Every field is read by Step 6 and surfaced verbatim in the final report —
so a reviewer can later look at any analysis and see exactly which
classifier was used, where it came from, and that the bits matched what
we expected.

---

## Takeaway

> Step 5 is where the pipeline decides "can we cheat?". If we have the
> primers, we extract the region — faster and slightly more accurate. If
> we have a matching QIIME2 release, we download a pre-trained classifier
> instead of spending 90 minutes training one — and we sha256-verify it
> so we know nothing was tampered with. If any of that goes wrong, we
> silently fall back to local training. The pipeline never aborts because
> of a Zenodo problem; the worst case is a longer wait.

---

## Sources

- The script: `mbXPro/scripts/mbx_classifier_arranger.sh`
- Greengenes2: McDonald et al. (2024), *Greengenes2 unifies microbial
  data in a single reference tree*, Nature Biotechnology 42:715–718.
- QIIME2 Naive Bayes classifier: Bokulich et al. (2018), *Optimizing
  taxonomic classification of marker-gene amplicon sequences with QIIME 2's
  q2-feature-classifier plugin*, Microbiome 6:90.
- The pre-trained classifier record:
  https://zenodo.org/records/20021035
