# Step 18 — Final Report

**Script:** `scripts/mbx_final_report.sh`

**Companion files in this folder:**
- `18_final_report.html` — same content with copy buttons.
- `18_final_report.pptx` — slide deck for the talk.

---

## Why this step matters

Seventeen steps have produced QZA artifacts, XLSX tables, PNG/SVG/PDF
figures, and per-step `*_info.txt` provenance files. Each is useful on
its own. None of them is what a user actually wants to send to a
collaborator.

That artefact is a **single document** — HTML for browsing, PDF for
archiving — that:

- **Tells the story** of the run from raw FASTQ to ML classifier in a
  narrative a non-bioinformatician can follow.
- **Embeds every key figure** inline (so the recipient doesn't need
  access to the user's filesystem).
- **Surfaces every fall-back the pipeline took** — `local-training-
  fallback` at Step 6, `REVIEW_REQUIRED` at Step 11, `STATUS=PARTIAL`
  anywhere — so reviewers can audit the run.
- **Caveats** the analysis with the things any 16S reviewer would ask
  about (mito/chloro removal rate, NSTI flagging, PERMDISP traps, sample
  retention at the chosen depth, …).
- **Survives missing steps gracefully** — if `--steps` skipped Step 15
  or Step 17, the report renders the available sections instead of
  crashing.

Step 18 produces that document.

---

## What the script does in one sentence

It discovers which of the 18 steps actually ran in this `mbX_pro_outputs_*/`
directory, parses every `*_info.txt` to learn what each step decided,
builds the HTML report section-by-section in R using `htmltools`, wraps
each section in `safe_section()` so a single broken renderer can't kill
the document, and optionally produces a PDF via `chrome` headless or
`weasyprint`.

---

## The algorithm, step by step

### 1. Discover what's actually present

**First** the script walks the `mbX_pro_outputs_*/` directory and
identifies which of the 18 expected step outputs are present. It
categorises each into one of three buckets based on its `*_info.txt`:

- `DONE` — `STATUS=COMPLETE` line is present (or a legacy info file
  with no `STATUS` line at all).
- `PARTIAL` — `STATUS=PARTIAL` line is present (the step ran but some
  inner work failed gracefully — e.g. Step 8 with species level empty).
- `MISSING` — no info file or no expected sentinel file present (the
  step didn't run).

The result is `discovery.json` — the source of truth for which sections
to render.

### 2. Refuse on completely empty runs

If `STEP_MAX_DONE < 0` (nothing ran at all), the script exits cleanly
with a message. There's nothing to report on. Every other state — even
"only Step 0 ran" — produces a document.

### 3. Install / verify R packages

**Then** the script ensures `htmltools`, `base64enc`, `openxlsx`, and
the other R packages the report needs are installed. The unified
`scripts/lib/install_r_deps.R` does this once for the whole pipeline; the
report just checks.

### 4. Build the cover header

**Now** R takes over. The first block builds the **cover header** — logo
+ title + subtitle + run timestamp + per-step status banner showing
which steps ran, which were partial, which were missing.

### 5. Render each section via `safe_section()`

**For each step that has data, build that step's section**. Sections are
modular:

```r
section_step0     <- function() { ... }    # primer identification
section_step12    <- function() { ... }    # manifest + artifact
section_step34    <- function() { ... }    # DADA2 parameters + denoising
section_step56    <- function() { ... }    # classifier arrange + run
section_step7     <- function() { ... }    # taxonomy + mito/chloro
section_step8     <- function() { ... }    # ezclean
section_step9     <- function() { ... }    # ezviz
section_step10    <- function() { ... }    # ezstat
section_step11    <- function() { ... }    # pre-diversity verdict
section_step12    <- function() { ... }    # alpha diversity
section_step13    <- function() { ... }    # beta diversity
section_step14    <- function() { ... }    # ANCOMBC2
section_step15    <- function() { ... }    # PICRUSt2
section_step16    <- function() { ... }    # Random Forest
section_step17    <- function() { ... }    # Networks
section_convergence(...)   # what shows up in ANCOMBC2 AND ML AND networks
section_caveats(...)       # NSTI flagging, PERMDISP traps, mito/chloro %
section_methods()           # the full methods text, citable
section_reproducibility()  # versions, seeds, threads, run_manifest.json link
```

Every section is **wrapped in `safe_section()`** (the wrapper we added
in mbX Pro 1.4.0). If one section's renderer crashes — e.g. an XLSX
file is corrupt — `safe_section()` substitutes an explanatory box and
the report keeps going. Without that wrapper, a single broken XLSX would
take the whole report down.

### 6. Embed every figure inline

**Every PNG referenced** by the report is **base64-encoded into a
`<img src="data:image/png;base64,...">` tag** so the resulting HTML is
**a single file**. The user can email the file; the recipient sees the
plots without needing the directory tree.

### 7. The convergence section

**The most useful synthesis**, after every per-step section, is the
`section_convergence()` block. It cross-references the per-step results
to flag the **taxa that appear significant in multiple ways**:

- Significant in ANCOMBC2 (compositional differential abundance) AND
- Important in Random Forest (predictive) AND
- A hub or module-anchor in the network.

A taxon that hits all three is the closest thing to "robust biomarker"
the pipeline can produce. The convergence section lists them with
inline log-fold-changes, importance scores, and centrality metrics.

### 8. Write the HTML

**Then** R writes the assembled document to `mbXPro_final_report.html`.
Single file, self-contained, ~5–20 MB depending on figure count.

### 9. Optional PDF rendering

**If the user did not pass `--no-pdf`**, the script tries to render the
HTML to PDF using one of three engines, in order:

- `chrome --headless` (most reliable for complex CSS, slow start).
- `weasyprint` (lightweight, works offline if installed).
- `wkhtmltopdf` (legacy fallback).

The PDF is for archiving; the HTML stays canonical (the PDF is
necessarily a flattened representation).

### 10. Write `mbx_final_report_info.txt`

**Finally** the cross-step contract records the HTML + PDF paths, every
step's verdict + sub-status, and `STATUS=COMPLETE`. The orchestrator
runs `scripts/lib/build_run_manifest.py` right after this step to produce
the per-run `run_manifest.json` for publication supplementary materials.

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| HTML format | self-contained (figures inlined as base64) | Single-file shareability is the main UX win over per-step artifacts. |
| Default PDF engine | `chrome --headless` | Best CSS support of the three. |
| PDF engine fallbacks | `weasyprint` → `wkhtmltopdf` | Tried in order; first available wins. |
| Section wrapper | `safe_section()` | Mandatory (mbX Pro 1.4.0+); never let a single broken section kill the report. |
| Convergence threshold | significant in ANCOMBC2 AND in top-20 RF importance AND a network hub | Conservative — taxa that meet all three are robust. |
| Embed figure resolution | PNG (already 300 DPI from the source steps) | We use the existing PNGs; no re-rendering. |
| Methods text | citable, every tool with version + citation | The reviewer can copy the methods straight into a manuscript. |
| `mbXPro_final_report_info.txt` | always written | Final cross-step contract; `run_manifest.json` depends on it. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **Skip section** | A step's data isn't present (it didn't run) | The corresponding section gets a "this step was skipped" box; the rest of the report keeps building. |
| **`safe_section()` substitution** | A section's renderer throws | The whole report would otherwise abort. The user sees an explanation; everything else still renders. |
| **`--no-pdf` mode** | User opts out | PDF rendering can be slow on large reports; HTML is always produced. |
| **Engine fallback** | Chrome not installed | Try `weasyprint`, then `wkhtmltopdf`. |
| **`local-training-fallback` flagged** | Step 6 used the Zenodo-fallback path | The report banner says so. Reviewers can audit which classifier was actually used. |
| **`REVIEW_REQUIRED` flagged** | Step 11's depth verdict was weak | Diversity sections are still rendered but with a warning banner. |
| **`STATUS=PARTIAL` flagged** | Any step finished some but not all sub-work | Section header carries the partial badge; the missing sub-results are noted. |

---

## What the output file looks like

`18_final_report/mbXPro_final_report.html` — a single self-contained
document with this structure:

```
COVER
├── Logo + title + run timestamp
├── Per-step status banner: 0 ✓ · 1 ✓ · 2 ✓ · … · 14 ✓ · 15 ⚠ · 16 ✓ · 17 ✓
└── Reproducibility quick-reference (versions, seed, threads)

INTRO
├── What the pipeline does in two paragraphs
└── How to read the report

PER-STEP SECTIONS  (one per step that ran)
├── Step 0  — primer verdict + confidence + plot
├── Step 1+2 — manifest + artifact
├── Step 3+4 — DADA2 params + per-sample retention
├── Step 5+6 — classifier mode + source + provenance
├── Step 7  — mito/chloro removal rate + barplot embed
├── Step 8  — ezclean per-level table sizes
├── Step 9  — embedded stacked-bar plots, one per (level × variable)
├── Step 10 — KW + CLD per-taxon results
├── Step 11 — depth verdict + rarefaction curve + 3-criterion table
├── Step 12 — alpha boxplots + KW results
├── Step 13 — PCoA + PERMANOVA tables
├── Step 14 — ANCOMBC2 volcano + heatmap + top hits
├── Step 15 — PICRUSt2 functional report excerpt + NSTI flagging
├── Step 16 — RF accuracy/AUC summary + ROC + importance
└── Step 17 — networks + hub taxa

CONVERGENCE  (taxa significant in ≥ 3 of: ANCOMBC2, RF, network hub)
CAVEATS    (NSTI flagging, PERMDISP traps, mito/chloro %, retention)
METHODS    (citable text with every tool + version + reference)
REPRODUCIBILITY  (versions, seeds, threads, link to run_manifest.json)
```

Plus the PDF version when `--no-pdf` wasn't passed.

---

## Takeaway

> Step 18 turns seventeen scattered artifact directories into one
> shareable document. The `safe_section()` wrapper (added in mbX Pro
> 1.4.0) means a single broken renderer can't kill the report.
> Figures are base64-embedded so the HTML is self-contained. The
> convergence section is where the pipeline's claim of "robust
> biomarker" finally gets evidenced — a taxon flagged by ANCOMBC2,
> important to the Random Forest, AND a network hub is hard to dismiss.

---

## Sources

- The script: `mbXPro/scripts/mbx_final_report.sh`
- `htmltools`: Cheng et al., R package on CRAN.
- `safe_section()` wrapper: mbX Pro 1.4.0, see `CHANGELOG.md`.
- The `run_manifest.json` builder (which Step 18 hands off to): `scripts/lib/build_run_manifest.py`.
