# Step 1 — Manifest Builder

**Script:** `scripts/create_manifest.sh`

**Companion files in this folder:**
- `1_create_manifest.html` — same content with copy buttons on every code block.
- `1_create_manifest.pptx` — slide deck for the talk.

---

## Why this step matters

QIIME2 — the platform we use for everything from denoising to taxonomy — can't
read raw FASTQ files directly. Before it can do anything, it needs an
**import manifest**: a small tab-separated table that says *for every sample,
which FASTQ file on disk is the forward read and which is the reverse*.

That sounds trivial. It is not. Real sequencing data shows up with **five
different naming conventions** depending on which facility delivered it:

- Illumina default: `SampleA_R1_001.fastq.gz` / `SampleA_R2_001.fastq.gz`
- SRA / ENA archives: `SRR123_1.fastq.gz` / `SRR123_2.fastq.gz`
- Some commercial vendors: `gut_READ1.fastq.gz` / `gut_READ2.fastq.gz`
- Older bioinformatics pipelines: `s12.forward.fastq.gz` / `s12.reverse.fastq.gz`
- Single-end runs (no mate at all): `SRR123.fastq.gz`

A mismatch — forward labelled as reverse, two samples merged into one, or a
sample present in the FASTQ folder but missing from the metadata — produces
silent errors that the downstream steps inherit as "weird results" that take
hours to debug. The manifest builder's job is to **never let that happen**.

---

## What the script does in one sentence

It scans a FASTQ directory, classifies every file by direction and sample,
reconciles the sample IDs against the user's metadata file, and produces a
QIIME2-compatible TSV with absolute paths — failing loudly the moment
anything inconsistent appears.

---

## The algorithm, step by step

### 1. Walk the FASTQ directory

**First**, the script finds every file matching `*.fastq.gz`, `*.fq.gz`,
`*.fastq`, or `*.fq` in the directory the user pointed to. By default it
also peeks one level above and one level below, so users who keep their
FASTQs in a subdirectory don't have to know about that.

### 2. Classify each filename

**Then** an embedded Python helper applies a **regex cascade**, in priority
order, to every filename:

- `R1` / `R2` — Illumina default
- `_1` / `_2` — SRA / ENA archive convention
- `READ1` / `READ2` — some commercial vendors
- `forward` / `reverse` — older pipelines
- Anything that matches none of the above is provisionally classified as
  **single-end**.

Both the **classifier and the priority order** are identical to the ones
Step 0 (the primer identifier) uses internally — so Step 0 and Step 1 can
**never disagree** about which file is which.

### 3. Infer the sample ID

**Now** the script strips the direction marker out of each filename to
recover the sample ID. `SampleA_R1_001.fastq.gz` → sample `SampleA_001` →
sample `SampleA`. The stripping rules are conservative: anything that
looks like an Illumina lane or chunk number (`_L001`, `_001`) gets dropped
only if doing so preserves uniqueness.

### 4. Reconcile against the metadata

**Critical step.** If the user supplied a metadata file, the script reads
its first column (`sample-id` / `sampleid` / `id`) and tries to match every
FASTQ sample-id against it:

- **Exact match** wins.
- **Unique case-insensitive match** is accepted, adopting the metadata's
  spelling (so the rest of the pipeline uses the user's preferred casing).
- A FASTQ sample with **no metadata row** is a **hard error** — it would
  silently vanish in any later metadata-aware QIIME2 command, producing
  spooky "missing samples" downstream.
- A metadata row with no FASTQ files is a **warning** — those samples
  simply won't be in the analysis but the user should know.

### 5. Decide paired-end vs single-end at the directory level

**A directory is paired-end** if and only if **every** sample has both a
forward and a reverse file. Mixed directories (some samples paired, some
single) are rejected — they're almost always a mistake (e.g. the reverse
file failed to copy from the sequencer).

### 6. Write the manifest

**Finally**, the script writes the QIIME2-compatible TSV with **absolute
paths** (so QIIME2 can find the files regardless of where the user runs
`qiime tools import` from). Paired-end format:

```
sample-id    forward-absolute-filepath    reverse-absolute-filepath
SampleA      /abs/path/SampleA_R1.fastq.gz    /abs/path/SampleA_R2.fastq.gz
...
```

Single-end format:

```
sample-id    absolute-filepath
SampleA      /abs/path/SampleA.fastq.gz
...
```

The manifest goes into `1_manifest_file/manifest.txt` inside the run's
output tree.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| FASTQ extensions recognised | `.fastq.gz` `.fq.gz` `.fastq` `.fq` | The four spellings every common pipeline produces. We don't try `.bam` or `.cram` — those need a different import path. |
| Search depth | parent + child of given dir | Users often keep FASTQs in a subfolder (e.g. `~/project/FASTQ/`). Searching one level above and below catches both layouts without requiring the user to think about it. |
| Name-pattern priority | R1/R2 → _1/_2 → READ1/READ2 → forward/reverse → single | Most-specific to least-specific so an ambiguous filename can't accidentally match multiple patterns. |
| Sample-ID matching | exact, then unique case-insensitive | Catches the common case-mismatch bug (FASTQ has `Sample01`, metadata has `sample01`) without inviting collisions. |
| Output location | `<parent_of_fastq>/mbX_pro_outputs_<TS>/1_manifest_file/manifest.txt` | We never write inside the FASTQ folder — those should be treated as read-only. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Search siblings + children** | User pointed at a directory that contains only sub-directories of FASTQ files. | Common in shared-storage setups; easier than asking the user to re-aim. |
| **Adopt metadata casing** | FASTQ sample-id matches a metadata row only after case-folding. | Avoids the most common merge-failure mode without inviting silent ambiguity (we require the case-insensitive match to be unique). |
| **Refuse mixed paired + single** | Some samples have both reads, others have only one. | Mixed-mode runs are almost always a delivery error. Continuing would silently drop the broken samples or import them with wrong direction labels. |
| **Hard-fail on missing metadata row** | A FASTQ sample-id has no row in the metadata. | The alternative — silently importing it as an "unknown" sample — would cause it to vanish at every downstream `--m-metadata-file` command, looking like a phantom data loss. |

---

## What the output file looks like

```
sample-id	forward-absolute-filepath	reverse-absolute-filepath
SampleA	/Users/.../FASTQ/SampleA_R1_001.fastq.gz	/Users/.../FASTQ/SampleA_R2_001.fastq.gz
SampleB	/Users/.../FASTQ/SampleB_R1_001.fastq.gz	/Users/.../FASTQ/SampleB_R2_001.fastq.gz
...
```

Plain text, tab-separated, absolute paths. Step 2 reads the header to detect
paired vs single-end and feeds the file straight into `qiime tools import`.

---

## Takeaway

> The manifest builder doesn't sound like an algorithm — but it's the place
> where five vendor naming conventions meet the user's metadata, and where
> silent merge errors are most likely to creep in. The whole script is a
> series of small consistency checks designed to **fail loudly the moment
> anything is wrong**, so the downstream pipeline can trust that the file
> layout actually matches the metadata.

---

## Sources

- The script: `mbXPro/scripts/create_manifest.sh`
- QIIME2 import manifest format:
  https://docs.qiime2.org/2025.4/tutorials/importing/
- Naming conventions: Illumina BCL Convert specification (R1/R2/_001); SRA
  ENA fastq-dump (`_1`/`_2`).
