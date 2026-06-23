# Step 2 — Artifact Creator

**Script:** `scripts/artifact_creator.sh`

**Companion files in this folder:**
- `2_artifact_creator.html` — same content with copy buttons on every code block.
- `2_artifact_creator.pptx` — slide deck for the talk.

---

## Why this step matters

QIIME2 organises every dataset, every intermediate, and every result inside
**artifacts** — zip-archive `.qza` files with strict provenance,
type-checking, and metadata. The reason the rest of the pipeline (steps 3
through 18) can re-use, re-run, and audit everything is that every blob of
data flows through QIIME2 as a typed artifact.

To get there from raw FASTQ files, exactly one command has to run correctly:
`qiime tools import`. That command needs:

- A type string (`SampleData[PairedEndSequencesWithQuality]` for paired-end,
  `SampleData[SequencesWithQuality]` for single-end).
- A view type (`PairedEndFastqManifestPhred33V2` etc.).
- The manifest path from Step 1.
- An output `.qza` filename.

Getting any one of those wrong produces a confusing error from QIIME2 about
the manifest format. The artifact creator's job is to **detect the right
flavour automatically and never run the wrong import**.

---

## What the script does in one sentence

It reads the header of the Step-1 manifest, detects paired-end vs single-end
from the column count, then runs `qiime tools import` with the matching
type + view, and writes the resulting `.qza` next to the manifest.

---

## The algorithm, step by step

### 1. Verify the manifest

**First**, the script confirms the manifest file exists, is non-empty, and
its first line is a valid header. It refuses to run on an empty file (the
QIIME2 error would be cryptic) or on a file that obviously isn't a manifest
(e.g. the user pointed at a FASTQ by mistake).

### 2. Detect paired-end vs single-end from the header

**Then** it reads only the header line and counts tab-separated columns:

- **Three columns** (`sample-id`, `forward-absolute-filepath`,
  `reverse-absolute-filepath`) → paired-end.
- **Two columns** (`sample-id`, `absolute-filepath`) → single-end.
- **Anything else** is an error.

The script never reads further than the header for the detection — it
trusts Step 1 to have written it correctly, and Step 1 either wrote both
forward and reverse columns or only one.

### 3. Locate the QIIME2 conda environment

**Next** it confirms that `qiime` is on `PATH`. If not, it prints the exact
`conda activate qiime2-amplicon-2025.4` command the user needs to run, then
exits cleanly — much friendlier than a missing-binary error trace.

### 4. Build the matching import command

**Now** it constructs one of two QIIME2 imports:

- **Paired-end:**
  ```
  qiime tools import \
    --type 'SampleData[PairedEndSequencesWithQuality]' \
    --input-path  <manifest> \
    --input-format PairedEndFastqManifestPhred33V2 \
    --output-path Paired_End_artifact.qza
  ```

- **Single-end:**
  ```
  qiime tools import \
    --type 'SampleData[SequencesWithQuality]' \
    --input-path  <manifest> \
    --input-format SingleEndFastqManifestPhred33V2 \
    --output-path Single_End_artifact.qza
  ```

The `Phred33V2` view tells QIIME2: "the FASTQ quality letters are the
standard Phred+33 encoding" (the only encoding any current sequencer
produces) "and the manifest format is version 2" (the manifest format
Step 1 actually wrote).

### 5. Run it (or print it, in --dry-run mode)

**Finally** the script executes `qiime tools import`. In `--dry-run` mode it
just prints the command — useful for showing exactly what QIIME2 will do in
talks like this one.

### 6. Write the output where the next step expects it

The artifact lands in `2_first_artifact_file/Paired_End_artifact.qza`
(or `Single_End_artifact.qza`). Step 3 (the DADA2 parameter finder) reads
from exactly that path with no further configuration.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Import type (paired) | `SampleData[PairedEndSequencesWithQuality]` | The QIIME2-mandated type string for paired-end FASTQ. We don't try to use anything else. |
| Import type (single) | `SampleData[SequencesWithQuality]` | Same, for single-end. |
| Manifest view (paired) | `PairedEndFastqManifestPhred33V2` | V2 is the format Step 1 writes. Phred+33 is the only encoding any current sequencer produces (we don't support Phred+64; that's a 2009 problem). |
| Manifest view (single) | `SingleEndFastqManifestPhred33V2` | Same idea, single-end. |
| Output filename | `Paired_End_artifact.qza` or `Single_End_artifact.qza` | Step 3 looks for these exact names. We never rename. |
| Working directory | `2_first_artifact_file/` next to the manifest | Keeps the artifact in the same `mbX_pro_outputs_<TS>/` tree as everything else. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Detect single-end from header** | Manifest has two columns instead of three. | Step 1 already validated the data is consistently single-end — we just need to use the matching QIIME2 type. |
| **`--dry-run` mode** | User passed `--dry-run`. | Shows the exact `qiime tools import` command without consuming a minute of actual import time — useful for demos and CI gates. |
| **Detect `qiime` not on PATH** | The user is running outside their QIIME2 conda env. | Prints the exact `conda activate qiime2-amplicon-2025.4` command and exits 1 — far friendlier than QIIME2's own error. |

---

## What the output file looks like

Step 2 writes a `.qza` — a zip archive containing the FASTQ files, the
manifest, a UUID, and a `metadata.yaml` describing the type. You can rename
it `.zip` and explore it in Finder:

```
Paired_End_artifact.qza
├── data/                         <- copies of the FASTQ files
│   ├── SampleA_R1.fastq.gz
│   ├── SampleA_R2.fastq.gz
│   ├── ...
│   └── MANIFEST                  <- a copy of Step 1's manifest
├── metadata.yaml                 <- type, format, UUID
└── provenance/                   <- which command produced this artifact
```

The provenance directory is what makes QIIME2 results scientifically
defensible — every downstream artifact carries a chain back to this one.

---

## Takeaway

> Step 2 is a 350-line wrapper around exactly one QIIME2 command. The reason
> it's not a one-liner is that the *correct* one-liner is two different
> one-liners depending on paired vs single-end — and using the wrong one
> produces a cryptic, hours-of-debugging error. The whole script exists to
> detect "which one-liner" automatically, every time, from the manifest
> header.

---

## Sources

- The script: `mbXPro/scripts/artifact_creator.sh`
- QIIME2 import documentation:
  https://docs.qiime2.org/2025.4/tutorials/importing/
- QIIME2 artifact format: Bolyen et al. (2019), *Reproducible, interactive,
  scalable and extensible microbiome data science using QIIME 2*,
  Nature Biotechnology 37:852–857.
