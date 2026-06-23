# Step 0 — Primer Identifier (Pro)

**Script:** `scripts/mbx_primer_identifier_pro.sh` (orchestrator + Detectors B/C/D/E)
+ `scripts/mbx_primer_identifier.sh` (internal helper — Detector A)

**Companion files in this folder:**
- `0_primer_identifier_pro.html` — same content as this README, with copy buttons on every code block.
- `0_primer_identifier_pro.pptx` — slide deck for the talk.

---

## Why this step matters

In a 16S amplicon library, every read starts with a **primer** — a short
synthetic DNA anchor (typically 18–22 bases) that PCR-amplifies the target
region. The primer is **not biological signal**; it's a manufacturing
artifact. If we leave it in, three things go wrong downstream:

- DADA2 (the denoiser, Step 4) treats the synthetic anchor as biology and
  inflates error estimates.
- The taxonomy classifier (Step 6) tries to align the primer against real
  references and confuses the placement.
- The final report can't tell the user what was actually sequenced.

But we can't just "always trim 20 bases off the front", either:

- Some sequencing facilities **already trim** the primer before delivery. In
  that case, trimming 20 more bases deletes 20 bases of real biology.
- Custom labs use **non-standard primers** that aren't in any database.
- A poorly-matched primer might be present in only 50 % of the reads —
  silently trimming half of them is a disaster.

Step 0 has to answer **three** questions simultaneously: *Is a primer there at
all? If so, exactly which one? And how confident are we?*

---

## What the script does in one sentence

It runs **four independent detectors in parallel**, then validates the top
candidates with **cutadapt** — the industry-standard primer-trimming tool —
on the same reads, and only writes a primer down if cutadapt actually trims
it off enough of the data.

---

## The algorithm, step by step

### 1. Open the FASTQ directory and sub-sample reads

**First**, the script finds every paired-end FASTQ file in the directory
(typical layout: one `*_R1.fastq.gz` and one `*_R2.fastq.gz` per sample). It
sub-samples **5,000 reads per orientation** (`--samples`), which is enough to
estimate any 5′-end primer-match distribution within ~1 %.

### 2. Detector A — the IUPAC database matcher

**Then** the script runs the **v2 IUPAC sliding-window matcher** (the
internal `mbx_primer_identifier.sh`). This is the "look it up in the catalog"
detector. It carries a curated database of about **35 published 16S primers**
(515F, 806R, 27F, 1492R, etc.). For each candidate primer:

- It scans the first 25 bases of every sampled read in **three orientations**
  (DIRECT, REVERSE COMPLEMENT, SWAP).
- It compares the candidate against the read using the **IUPAC nucleotide
  code** — so `Y` matches both `C` and `T`, `N` matches anything — and
  tolerates up to 3 mismatches.
- It scores each primer by how many sampled reads "match" it at the 5′ end.
- The primer with the highest match rate above threshold wins.

If nothing in the catalog matches, the matcher falls back to **TIER 2**: it
scans for **conserved 16S V-region anchor motifs** (e.g. V4 starts with
`TACG.AGG` immediately after the 515F landing site). A positive anchor hit
means "primers were already trimmed, but we recognise where on the rRNA we
are" — `DETECTION_STATUS = TRIMMED` + `INFERRED_REGION = V4`.

### 3. Detector B — position-0 k-mer enrichment (de novo)

**At the same time**, the script runs a **database-free** detector. The
logic: if a primer is present, the same short sub-sequence appears at
position 0 of every read in a sample. Random reads almost never do that.

- For each `k` in `{15, 17, 19, 21, 23, 25}` (`--kmer-min` / `--kmer-max`):
  count every distinct `k`-mer that appears at position 0 across the sampled
  reads. Compare it to the **background frequency** of the same `k`-mer at
  *other* positions in the same reads.
- Any `k`-mer with **fold-enrichment ≥ 10×** (`--kmer-min-fold`) is a
  candidate primer.
- If two or three different `k`-lengths agree on overlapping anchors, that's
  a strong de novo discovery.

This is what catches custom-lab primers that aren't in our database.

### 4. Detector C — inline FastQC-equivalent signals

**Independently**, the script computes three FastQC-style signals — but
inline, so we don't need Java/FastQC installed:

- **Per-base sequence-content entropy** in positions 1..30. Primers show up
  as a flat horizontal stripe where the base composition is locked.
- **Overrepresented 5′-anchored sequences** — the top-N most-frequent
  prefixes (these are almost certainly primer + sample-specific
  Index/adapter combinations).
- **Illumina adapter content** (Nextera / TruSeq) for read-through
  diagnostics. If we see adapter near the 3′ end, the amplicon is shorter
  than the read length — a useful side channel.

### 5. Detector D — fastp pair-end overlap detection

**If `fastp` is on PATH** (it's optional), the script runs `fastp`'s
`--detect_adapter_for_pe` mode. That algorithm independently solves the
"infer the insert structure from PE-overlap" problem. The primer falls out
naturally as the part each read has that the other read doesn't.

If `fastp` isn't installed, this detector is gracefully skipped — the
remaining detectors still deliver a verdict.

### 6. Aggregate the candidates

After all four detectors finish, the script **collapses** their candidate
sets, IUPAC-aware (so detections that differ only in degenerate codes are
treated as the same primer). It keeps the top **3 candidates per
orientation** (`--top-candidates`) for validation.

### 7. Detector E — mandatory cutadapt validation

**Now the truth check.** Every candidate goes through `cutadapt -e 0.15`
against a sub-sample of the same reads (`--cutadapt-error`). Cutadapt is
*the* industry-standard primer-trimming tool: it reports the exact percentage
of reads in which the candidate primer was successfully matched and trimmed
at the 5′ end. That percentage is the **ground truth**.

- A candidate that scored well in Detectors A/B/C/D but cutadapt only trims
  off 8 % of reads → false positive, throw it out.
- A candidate cutadapt trims off 85 % → it's real, regardless of which other
  detector flagged it.

### 8. Apply the consensus confidence rubric

**Finally**, the script combines all five detector outputs into one
confidence call:

| Confidence | Rule (any one path qualifies) |
|---|---|
| **HIGH** | cutadapt ≥ 0.75 AND ≥ 2 detectors agree AND (DB-matched OR k-mer fold ≥ 10×)<br>OR cutadapt ≥ 0.95 AND k-mer fold ≥ 50× (de-novo path)<br>OR cutadapt ≥ 0.90 AND DB-matched (single-DB path) |
| **MEDIUM** | cutadapt ≥ 0.50 AND ≥ 1 detector agrees |
| **LOW** | cutadapt ≥ 0.30 |
| **NONE** | cutadapt < 0.30 |

The de-novo path (b) is what lets custom-lab primers reach HIGH even if no
database entry matches — the requirement is that cutadapt *and* the k-mer
detector independently corroborate the same anchor.

### 9. Write the output

The script writes the canonical `mbx_primer_info.txt` (read by every
downstream step), plus `primers.tsv` (drop-in TSV for shell pipelines),
`primers.json` (full per-detector evidence trail for forensic debugging),
and `pro_diagnostics/` (per-detector raw outputs).

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Reads sampled per orientation (`--samples`) | **5,000** | Enough to estimate any 5′-end match distribution within ~1 %; small enough to scan in seconds. |
| k-mer size range (`--kmer-min` / `--kmer-max`) | **15..25** | Covers every published 16S primer length (typically 18–22 bp) plus a defensive cushion above and below. |
| Minimum k-mer fold enrichment (`--kmer-min-fold`) | **10×** | A 10× enrichment at position 0 vs. elsewhere is essentially impossible by chance; a random primer-length k-mer hits any given position once in ~67 million reads. |
| Top candidates to validate (`--top-candidates`) | **3** | Two would miss reverse-direction ties; four wastes cutadapt time on candidates the aggregator already deprioritised. Three is the empirical sweet spot. |
| Cutadapt error rate (`--cutadapt-error`) | **0.15** | Cutadapt's own recommended default for 16S primer trimming. 15 % allows one or two sequencing errors in the primer-landing zone. |
| Cutadapt minimum trim rate (`--cutadapt-min-rate`) | **0.30** | Below 30 % we declare the candidate a false positive even if our internal detectors liked it. |
| HIGH-confidence cutadapt floor | **0.75** | Empirical: real 16S primers in well-prepared libraries trim ≥ 75 % of reads. Below that we don't trust the call. |
| HIGH-confidence detector-agreement requirement | **≥ 2** | One detector can be wrong; two independent detectors agreeing on the same anchor is what we mean by "consensus". |
| Threads for fastp/cutadapt (`--threads`) | **2** | Step 0 is I/O-bound, not CPU-bound. More threads don't help and may starve the rest of the pipeline. |

---

## When and why we fall back to defaults

The pro script is designed to **always return a verdict**, even on adversarial
data, and to be loud about every compromise. There are four fall-back paths:

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Manual primer fast-path** (skip detection entirely) | User supplied `--forward-primer` / `--reverse-primer`. | Some pipelines have already characterised the primers — re-detecting wastes minutes and risks contradicting known truth. We delegate to the v2 IUPAC matcher's manual path, which writes `DETECTION_STATUS = USER_SUPPLIED`. |
| **fastp skipped (Detector D off)** | `fastp` is not on PATH, or `--no-fastp` was passed. | fastp is a nice-to-have signal, not a requirement. Three other detectors plus cutadapt still produce a defensible verdict. We log it visibly as `Detector D: not available`. |
| **TIER 2: V-region anchor** (`DETECTION_STATUS = TRIMMED`) | No primer in the database matched, BUT a known 16S V-region landing motif is present. | Many sequencing facilities pre-trim primers. We can recognise *where on the 16S rRNA* the read starts even without seeing the primer, and that's what downstream needs to know (it tells Step 5 to use the **full-length classifier**). |
| **TIER 3: rich-diagnostic failure** (`DETECTION_STATUS = UNKNOWN`) | None of A/B/C/D/E produced an acceptable candidate. | Cutting nothing risks leaving primer in; cutting 20 bp risks deleting biology. So we write `UNKNOWN`, include the top-3 sub-threshold candidates and a read-length distribution + per-position composition histogram, and let the user (or downstream's defensive 20-bp default) decide. We never silently guess. |

Every fall-back path leaves a clear marker in `mbx_primer_info.txt` and a
human-readable explanation in `pro_diagnostics/`.

---

## What the output file looks like

```
READ_TYPE=paired
DETECTION_STATUS=DETECTED
CONFIDENCE_LEVEL=HIGH
PIPELINE_SAFETY=safe-to-trim
INFERRED_REGION=V4
DETECTION_NOTE=Multi-detector consensus, cutadapt trim rate 92.4%

FORWARD_PRIMER_NAME=515F (GTGYCAGCMGCCGCGGTAA)
FORWARD_PRIMER_SEQUENCE=GTGYCAGCMGCCGCGGTAA
FORWARD_PRIMER_LENGTH=19
FORWARD_PRIMER_TARGET_REGION=V4
FORWARD_PRIMER_MATCH_RATE=0.96
FORWARD_PRIMER_MATCHED_READS=4801/5000

REVERSE_PRIMER_NAME=806R (GGACTACNVGGGTWTCTAAT)
REVERSE_PRIMER_SEQUENCE=GGACTACNVGGGTWTCTAAT
REVERSE_PRIMER_LENGTH=20

STATUS=COMPLETE
```

Plus a structured `primers.json` containing the full per-detector evidence
trail — useful when a reviewer asks "how do you know it's that primer?".

---

## Takeaway

> Step 0 replaces "trust the database" and "trust the user" with **trust no
> single signal**. Four independent detectors propose; cutadapt — the
> industry-standard trimming tool — disposes. A primer reaches HIGH
> confidence only when the database, an information-theoretic enrichment
> test, and an industry-standard trimmer all agree. That's what makes the
> downstream pipeline safe to run unattended.

---

## Sources

- The orchestrator: `mbXPro/scripts/mbx_primer_identifier_pro.sh` (v3.1)
- The internal Detector-A helper: `mbXPro/scripts/mbx_primer_identifier.sh` (v2)
- cutadapt: Martin (2011), *Cutadapt removes adapter sequences from
  high-throughput sequencing reads*, EMBnet Journal 17:10–12.
- fastp: Chen et al. (2018), *fastp: an ultra-fast all-in-one FASTQ
  preprocessor*, Bioinformatics 34:i884.
- IUPAC nucleotide codes: Cornish-Bowden (1985), *Nomenclature for
  incompletely specified bases in nucleic acid sequences*, NAR 13:3021–3030.
