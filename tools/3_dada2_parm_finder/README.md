# Step 3 — DADA2 Parameter Finder

**Script:** `scripts/mbx_dada2_parameter_finder.sh` (orchestrator)
+ `scripts/create_dada2_parameters_txt.sh` (core algorithm)

**Companion files in this folder:**
- `3_dada2_parm_finder.html` — same content as this README, with copy buttons on every code block.
- `3_dada2_parm_finder.pptx` — slide deck for the talk.

This document is the one-page handout that mirrors the talk. Read top-to-bottom
and it tells the same story the slides do, in the same order.

---

## Why this step matters

Illumina sequencers don't return perfect reads. Every position in every read
comes with a **Phred quality score** (a number from 0–40 that says how
confident the sequencer is about that base). Quality drops off near the back of
every read, and it drops off faster on the reverse read than on the forward
read.

If we feed those raw reads straight into the denoiser (**DADA2** — the algorithm
that turns noisy reads into the actual biological variants, called ASVs), two
bad things can happen:

- **Cut too aggressively** → we throw away real biology and lose the ability to
  match the forward and reverse reads back together (they no longer overlap).
- **Cut too lightly** → too many sequencing errors stay in, DADA2 sees random
  noise as "rare variants", and the species list inflates with junk.

The job of this step is to land on the sweet spot — pick the four numbers that
DADA2 needs (`--p-trim-left-f`, `--p-trim-left-r`, `--p-trunc-len-f`,
`--p-trunc-len-r`) using the data itself, not a hand-waved guess.

---

## What we tell DADA2

| Parameter | What it means in plain English |
|---|---|
| `--p-trim-left-f` | How many bases to chop off the *front* of the forward read (the **primer** — the synthetic anchor used during PCR, not biology). |
| `--p-trim-left-r` | Same, for the *front* of the reverse read. |
| `--p-trunc-len-f` | The length to keep on the forward read (everything past this point is too noisy). |
| `--p-trunc-len-r` | The length to keep on the reverse read. |

Four numbers. The whole step exists to find these four numbers, defensibly,
from the data.

---

## The algorithm, step by step

### 1. Open the QIIME2 artifact

**First**, the script opens the `.qza` file. A QIIME2 artifact is just a zip
archive (rename it `.zip` and macOS would happily unzip it). Inside, two things
matter:

- `metadata.yaml` confirms this is a paired-end demultiplexed file
  (**demultiplexed** = the reads have already been split out by sample).
- `data/MANIFEST` is a small table telling us, for every sample, which FASTQ
  file is the forward read and which is the reverse.

### 2. Sub-sample reads

**Then**, instead of reading every single read (hundreds of millions in a real
run), the script samples up to **1,000 read pairs per sample**
(`READS_PER_SAMPLE`). Quality letters are decoded into integers using
**Phred+33** encoding (the FASTQ standard — the character `'!'` means quality
0, `'I'` means quality 40, etc.).

This sub-sample is enough to estimate every distribution we care about, and it
keeps the whole step under a minute on a normal laptop.

### 3. Figure out how long the biological piece is

**Now the clever part.** DADA2 needs to know the **insert length** (the actual
DNA between the two primers — the molecule the sequencer was reading). For 16S
V4 it's about 253 bases, but every primer pair and every species mix gives a
slightly different answer.

Instead of asking the user, the script figures it out from the reads:

- Take the forward read and the reverse read of the same pair.
- Flip the reverse read into its **reverse complement** (the same molecule read
  the other way around, so the two reads can be laid on top of each other).
- Look for matching **13-letter windows** (**k-mers**, k = 13) shared between
  them. This is **seed-and-extend** alignment — the same shortcut BLAST uses.
- Score each candidate alignment as `identity × overlap-length`; keep
  alignments with **≥ 90 % identity**.
- Do this on about **2,500 pairs** (`INSERT_SAMPLE_PAIRS`), build a
  distribution of insert lengths, throw out outliers using the
  **inter-quartile range rule** (a standard statistical outlier filter), and
  take the **99th percentile** as the "required insert length" — i.e. almost
  every real fragment is at most this long.

This is what lets the script pick a forward-cut and reverse-cut that still
leave enough overlap to merge the two reads back together.

### 4. Decide trim-left (where to chop off the primer)

**Next**, the script decides where each read's biological content actually
starts:

- If a primer sequence is known (passed in by the user, or detected by Step 0),
  trim-left equals the **primer length**.
- If no primer is known, the default is **20 bases** — a defensive guess that
  matches the length of most 16S primers.

It also computes a sanity check: of the reads we sampled, in what fraction did
that primer actually match at the 5′ end? The comparison is **IUPAC-aware**
(so `Y` matches both `C` and `T`, `N` matches anything) and tolerates up to
**15 %** mismatch. That percentage goes straight into the output file so the
user can see at a glance whether the primer was real.

### 5. Walk every read base-by-base — the expected-error trick

**Then comes the heart of the algorithm.** This replaces "look at the quality
plot and guess where to cut".

For every read pair:

- Start at the trim-left position and walk one base at a time toward the end
  of the read.
- At every base, take its Phred score `Q` and compute the
  **expected error contribution**: `10 ^ (−Q / 10)`. That's the actual
  probability the sequencer got that base wrong — it's the definition of the
  Phred score.
- Keep a running sum, called the **expected error** (**EE**).
- Record the furthest position you can reach while keeping `EE ≤ 2.0`
  (`MAX_EE_F` / `MAX_EE_R`). That's "the longest truncation this particular
  read can survive, given DADA2's default quality filter".
- Do this independently for the forward and the reverse read, because they
  have very different quality profiles (reverse reads are always worse on
  Illumina).

### 6. The suffix-sum lookup table

**Now we have a scale problem.** For every possible `(forward-cut,
reverse-cut)` we want to know: how many of my read pairs survive both cuts?
Naively that's millions of look-ups.

So the script builds a **2-D suffix sum** — a cumulative-total table in two
dimensions (the same trick spreadsheets use for running totals, generalized to
a grid). Once built, asking *"how many pairs survive at forward-cut=240 and
reverse-cut=180?"* becomes one array access. That's how it can score hundreds
of candidate truncation pairs in a fraction of a second.

### 7. Apply the quality cutoffs

**Now we filter and rank.** For every candidate cut pair, the script computes
three pass rates:

- **Pair-pass rate** — fraction of read pairs whose forward AND reverse both
  survive at this cut. Must be ≥ **0.80** (`MIN_PAIR_PASS_RATE`).
- **Forward-pass rate** — fraction whose forward read alone survives. Must be
  ≥ **0.90** (`MIN_FORWARD_PASS_RATE`).
- **Reverse-pass rate** — fraction whose reverse read alone survives. Must be
  ≥ **0.84** (`MIN_REVERSE_PASS_RATE`).

It also requires `forward-cut + reverse-cut ≥ insert-length + 12` — that 12 is
the **minimum merge overlap** DADA2 needs to confidently stitch the forward
and reverse reads back together. Without it, the reads don't overlap and the
pair gets thrown away.

### 8. Pick the winner

**Finally**, among the eligible candidates, the script:

1. Keeps the ones within **1 base** (`LENGTH_SLACK`) of the longest total
   trimmed length — so we discard as little real biology as possible.
2. Among those, prefers the candidate with the highest pair-pass rate, then
   the most **balanced** forward and reverse cuts (asymmetric cuts make the
   overlap awkward and can introduce bias), then the longest overlap.

The winner gets written into `dada2_parameters.txt` along with the **top 20**
runners-up, all three pass rates, the insert length it inferred, and the
percentage of reads whose primers actually matched.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Reads sampled per sample (`READS_PER_SAMPLE`) | **1,000** | Enough to estimate the expected-error distribution within ~1 %; small enough that the step finishes in seconds on a laptop. |
| Pairs aligned for insert estimation (`INSERT_SAMPLE_PAIRS`) | **2,500** | Enough overlapping pairs to get a clean P99 of the insert length; covers the typical sequencing-batch heterogeneity. |
| Insert-overlap k-mer size | **13 bases** | Long enough to be specific (a random 13-mer hits any genome by chance ~once per 67 million bases); short enough that one or two sequencing errors don't break every seed. |
| Insert-overlap identity floor | **≥ 90 %** | Below this, the alignment is almost certainly spurious. 90 % is the standard cut for paired-end merge tools (vsearch, fastp, PEAR). |
| Insert length used | **P99 of cleaned distribution** | We need to cover *almost every* real fragment but ignore extreme outliers caused by chimeras. P99 strikes that balance. |
| Trim-left default (no primer known) | **20 bases** | Most published 16S primers are 18–22 bases. Twenty is a defensive guess that's never *too short* on real data. |
| Primer match tolerance | **≤ 15 % mismatch** | IUPAC-aware comparison. 15 % is tight enough to avoid false matches yet loose enough to absorb a couple of sequencing errors in the primer-landing zone. |
| `max-ee` (expected-error cap) | **2.0** | The DADA2 paper's own default. It corresponds to "this read is allowed at most ~2 wrong bases over its entire kept length". |
| Pair-pass rate floor | **0.80** | At least 80 % of read pairs must survive the cut — anything less means we're throwing away a quarter of the data. |
| Forward-pass rate floor | **0.90** | Forward reads are good quality on Illumina — we expect 90 %+ to survive. If they don't, the run itself is suspect. |
| Reverse-pass rate floor | **0.84** | Reverse reads are systematically worse; 0.84 is empirically the lowest floor that still rejects clearly broken runs without being unrealistic. |
| Minimum merge overlap | **12 bases** | DADA2's own default. Anything shorter and the merge call becomes statistically ambiguous. |
| Length slack (winner band) | **1 base** | "Keep candidates within 1 bp of the longest total length, then pick on quality." Tighter than 1 bp loses ties; looser favors shorter reads for no reason. |

These defaults are not magic numbers — they come from the DADA2 paper
(Callahan et al. 2016, Nature Methods) and from empirical sweeps the
maintainers ran on real datasets across multiple 16S regions.

---

## When and why we fall back to defaults

The algorithm is designed to *always* return a recommendation — even on
imperfect data — but it tells you, in plain language, every time it had to
compromise. There are five places it can fall back:

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **trim-left = 20 (no primer)** | The user did not pass `--forward-primer`/`--reverse-primer` AND the Step 0 primer identifier reported `DETECTION_STATUS = UNKNOWN` AND no `--assume-primer-length` was given. | Cutting nothing risks leaving primer in the data, which DADA2 would treat as biological signal. 20 bp is the median 16S primer length — a defensive over-trim that's harmless if the primer was shorter (you lose 1–2 bases of biology) and protective if it was longer. |
| **trim-left = 0 (sequencer already trimmed)** | Step 0 reported `DETECTION_STATUS = TRIMMED` (it scanned the reads and found no primer-like 5′ anchor, just biological signal). | Trimming 20 bp off an already-trimmed read would delete 20 bp of real biology. Better to trust the upstream verdict and not cut. |
| **Use `--amplicon-length` instead of estimating** | The user supplied `--amplicon-length`. | Estimation needs the forward and reverse reads to actually overlap. If they don't (very long amplicons, short reads), estimation fails. The user override skips estimation entirely and uses their hard-coded value. |
| **Relax pass-rate filters to "pair-pass ≥ 0.80 only"** | No candidate meets all three pass-rate floors at once. | A bad run might have a great forward read but a beaten-up reverse read. Rather than fail, the script keeps the most important global cutoff (80 % of pairs survive) and lets the forward/reverse floors slide. It flags the relaxation in the output. |
| **Take any candidate with valid overlap** | Even the relaxed filter leaves zero candidates. | Last-resort. Better to return *something* the user can inspect than to abort the pipeline at step 3. The output file says clearly that the strict filters could not be met — the user is told to investigate. |

Every fallback is recorded in the output file under a section called
`fallback_reasons`, so the user can see exactly what gave way and why. Nothing
is silent.

---

## What the output file looks like

The script writes `3_dada2_parameters/dada2_parameters.txt`. The interesting
keys downstream steps actually consume:

```
--p-trim-left-f             19
--p-trim-left-r             20
--p-trunc-len-f             240
--p-trunc-len-r             180

INSERT_LENGTH_USED          253
FORWARD_PRIMER_MATCH_RATE   97.3%
REVERSE_PRIMER_MATCH_RATE   95.1%
PAIR_PASS_RATE              0.86
FORWARD_PASS_RATE           0.94
REVERSE_PASS_RATE           0.89
FALLBACK_REASONS            (none)
```

Plus a "top-20 leaderboard" of candidate truncation pairs so the user can do a
five-second sanity check before pressing Run on Step 4.

---

## Takeaway (the slide you might end on)

> The DADA2 parameter finder replaces "stare at the quality plot and guess"
> with a small, fast, deterministic algorithm that uses the data itself:
> figure out the real insert length from the reads, walk each read until the
> **expected error** gets too high, then pick the cut that keeps the most
> reads while still leaving enough overlap to merge.
>
> Same logic a careful bioinformatician would apply by hand —
> made reproducible, defensible, and ~60× faster.

---

## Sources

- The actual algorithm: `mbXPro/scripts/create_dada2_parameters_txt.sh`
- The orchestrator that calls it: `mbXPro/scripts/mbx_dada2_parameter_finder.sh`
- DADA2 paper: Callahan et al. (2016), *DADA2: high-resolution sample inference
  from Illumina amplicon data*, Nature Methods.
