# Step 16 — Random Forest Biomarker Classifier

**Script:** `scripts/mbx_ml_classifier_run.sh`

**Companion files in this folder:**
- `16_ml_classifier.html` — same content with copy buttons.
- `16_ml_classifier.pptx` — slide deck for the talk.

---

## Why this step matters

Steps 10 and 14 (per-taxon stats and ANCOMBC2) answer a **descriptive**
question: *which taxa differ between groups?* Step 16 answers the
matching **predictive** question: *can we PREDICT the group from the
taxa?*

Both questions matter, and reviewers ask them both:

- A taxon that's statistically different by ANCOMBC2 but doesn't help a
  classifier may be a false positive (the test caught a small mean shift
  but the within-group overlap is large).
- A taxon that's important for a classifier but isn't flagged by ANCOMBC2
  may be a non-linear or interaction effect (it only matters when
  combined with another taxon).

The classifier of choice is **Random Forest** (Breiman 2001), because:

- It handles non-linear relationships out of the box.
- It handles non-normal, compositional, zero-inflated data without
  parametric assumptions.
- It produces honest feature-importance scores via permutation.
- It works well on small-N data (the microbiome reality), unlike most
  deep models.

Step 16's job is to run the classifier *for every (taxonomic level ×
categorical variable)*, report cross-validated accuracy + AUC + F1 +
confusion matrix + ROC, and identify the **taxa that drive the
prediction** via permutation importance + Saabas-style local SHAP-
equivalent contributions.

---

## What the script does in one sentence

For every (taxonomic level × categorical variable), it trains a Random
Forest using `ranger`, with cross-validation auto-selected (5-fold
stratified when N ≥ 20, leave-one-out when N < 20), reports
accuracy/AUC/F1/sens/spec, computes permutation feature importance and
Saabas-style SHAP contributions, and writes per-(level × variable) and
per-variable summary spreadsheets so the user can compare classifiers
across levels.

---

## The algorithm, step by step

### 1. Gate on Steps 7 + 8

**First** the script reads `7_taxonomy_csv/mbx_taxonomy_info.txt` for
the metadata path and `8_cleaned_files/mbx_ezclean_info.txt` for the
seven cleaned XLSX paths. It refuses to run if either contract is
missing.

### 2. Auto-detect categorical variables

**Then** it applies the same categorical-variable detection used by Step
9/10/12 — every column that isn't `sample-id`, numeric-only, singleton,
or all-unique.

### 3. For every (level × variable): one Random Forest run

**For each combination**, the script invokes R:

```r
library(ranger)
set.seed(MBX_SEED)

X <- read.xlsx(level_xlsx)        # samples × taxa wide table
y <- X[[selected_variable]]       # the response

# Drop the response column from features
X[[selected_variable]] <- NULL

# Drop other metadata columns
X <- X[, sapply(X, is.numeric), drop = FALSE]

# Cross-validation strategy
cv <- if (N >= 20) "stratified-5-fold" else "LOOCV"

# Train, predict, aggregate per-fold metrics
rf <- ranger(
  dependent.variable.name = "y",
  data            = data,
  num.trees       = NUM_TREES,             # default 500
  importance      = "permutation",
  probability     = TRUE,
  case.weights    = ...,                   # for class imbalance
  num.threads     = MBX_THREADS
)
```

### 4. Cross-validation auto-selection

**Critical for small-N microbiome data:**

- **N ≥ 20**: 5-fold **stratified** CV. Stratified means each fold has
  roughly the same group proportions as the full sample — important when
  one group is rare.
- **N < 20**: **Leave-one-out** CV. Necessary because 5-fold on N = 12
  would give 2-sample test folds, where the metrics are noisier than
  the model.

### 5. Handle class imbalance

**By default**, the script uses `ranger`'s `case.weights` to weight
samples inversely to their class frequency. This stops the classifier
from getting "high accuracy" by always predicting the majority class —
a known pathology of microbiome classifiers when one treatment group is
twice the size of another.

### 6. Metrics + confusion matrix + ROC

**For each run** the script computes:

- **Accuracy** — the fraction of test-fold predictions that match the
  truth.
- **Macro-averaged AUC** — average of one-vs-rest ROC AUCs across
  classes. Robust to class imbalance.
- **Per-class sensitivity, specificity, F1** — for the per-class table.
- **Confusion matrix** as a PNG heatmap.
- **ROC curves** (one per class for multi-class) as a PNG.

### 7. Permutation feature importance

**For honest variable importance**, the script uses **permutation
importance** instead of Gini importance:

- For each feature, randomly permute its values in the **out-of-bag**
  samples.
- Measure how much the prediction accuracy drops.
- The bigger the drop, the more important the feature.

This is more honest than Gini importance, which is biased toward
high-cardinality features. Output: `feature_importance.xlsx` and a
`top20_importance.png` barplot.

### 8. Saabas-style SHAP-equivalent local contributions

**For per-sample interpretability**, the script computes Saabas
contributions (a per-tree decomposition of each prediction into a sum
of feature contributions). The result is a per-sample × per-feature
matrix saying "this feature pushed this sample's predicted probability
up by 0.04". A heatmap shows the top features driving each sample's
prediction.

Saabas is the computationally-tractable SHAP equivalent for trees —
it gives the same per-sample feature-attribution interpretation without
the (much more expensive) full TreeSHAP algorithm.

### 9. Per-variable summary across the seven levels

**Finally** the script aggregates the (level × variable) runs into
`Summary_RF_<Variable>.xlsx`:

| level | accuracy | macro_AUC | F1 | n_features | n_used | runtime_s |
|---|---|---|---|---|---|---|
| domain | 0.55 | 0.61 | 0.52 | 2 | 2 | 0.4 |
| phylum | 0.71 | 0.74 | 0.69 | 12 | 12 | 0.8 |
| class | 0.78 | 0.82 | 0.77 | 23 | 22 | 1.2 |
| ... | | | | | | |

That summary is the canonical "**which taxonomic level is the most
predictive for this variable?**" answer.

### 10. Save the model

**Then** the script saves the trained model as an RDS file. Advanced
users can load it in R and apply it to a new dataset (e.g. cross-
validation against an independent cohort).

---

## Default parameters and why they are what they are

| Default | Value | Why this default |
|---|---|---|
| Classifier | **Random Forest (ranger)** | Robust to non-linearity, non-normal data, small N. The default microbiome ML choice. |
| Number of trees | **500** | Empirical sweet spot — more trees rarely changes accuracy; fewer increases variance. |
| Cross-validation | **5-fold stratified** when N ≥ 20, else **LOOCV** | Auto-selected per (level × variable). Stratification keeps small groups represented in every fold. |
| Class imbalance handling | **`case.weights` inverse to class frequency** | Stops the classifier from gaming accuracy by always predicting the majority class. |
| Importance metric | **Permutation importance** | Unbiased; Gini importance favours high-cardinality features. |
| Local interpretation | **Saabas SHAP-equivalent** | Per-sample × per-feature contributions; the tree-friendly SHAP approximation. |
| Seed | **`MBX_SEED`** (default 42, L'Ecuyer-CMRG) | Reproducibility — required because `ranger` uses parallel under the hood. |
| Threads | **`MBX_THREADS`** | Single source of truth. |
| Plot formats | **PNG + SVG always; PDF on `--publication-figures`** | Publication-ready by default. |

---

## When and why we fall back to defaults

| Fallback | When it triggers | Why this fallback exists |
|---|---|---|
| **LOOCV instead of 5-fold** | N < 20 samples | 5-fold on N = 12 gives 2-sample test folds — noisier than the model. |
| **Skip a (level × variable) cell** | < 2 valid groups, < 5 samples per group, or no features after filtering | Insufficient data to train. |
| **Class-weight balancing** | One class has ≥ 2× another class's samples | Prevents the majority-class gaming. |
| **Skip SHAP if `--skip-shap`** | Large N + many features makes Saabas slow | Saabas is per-sample × per-feature — quadratic in feature count. User can opt out. |
| **Reuse cached RDS** | Existing trained model at the expected path | Saves the most expensive sub-step on re-runs. |
| **Hard-fail on factor-level mismatch** | The response column has only one level after filtering | Nothing to classify; logged + skipped. |

---

## What the output file looks like

`Summary_RF_<Variable>.xlsx` (the canonical "which level is most
predictive?" answer):

| level | accuracy | macro_AUC | F1 | n_features | n_used | runtime_s |
|---|---|---|---|---|---|---|
| domain | 0.55 | 0.61 | 0.52 | 2 | 2 | 0.4 |
| phylum | 0.71 | 0.74 | 0.69 | 12 | 12 | 0.8 |
| class | 0.78 | 0.82 | 0.77 | 23 | 22 | 1.2 |
| order | 0.83 | 0.87 | 0.82 | 47 | 41 | 2.0 |
| family | 0.86 | 0.90 | 0.85 | 84 | 71 | 2.9 |
| genus | 0.88 | 0.93 | 0.87 | 142 | 109 | 4.1 |
| species | 0.85 | 0.91 | 0.83 | 218 | 178 | 5.3 |

Plus per-(level × variable) `RF_<level>_by_<var>/` directories with:

- `model_metrics.xlsx` — accuracy + AUC + F1 + sens + spec.
- `confusion_matrix.png` / `.svg`.
- `roc_curves.png` / `.svg`.
- `feature_importance.xlsx` — every feature's permutation importance.
- `top20_importance.png` / `.svg`.
- `shap_per_sample.png` / `.svg`.
- `predicted_vs_actual.xlsx`.
- `model.rds`.

---

## Takeaway

> Step 16 is the predictive complement to Steps 10 and 14. A signal that
> shows up in ANCOMBC2 **and** drives a Random Forest classification is
> hard to dismiss. The cross-validation strategy auto-adapts to small-N
> microbiome reality. Permutation importance + Saabas SHAP give a
> reviewer the *which taxa actually drive the prediction* answer.

---

## Sources

- The script: `mbXPro/scripts/mbx_ml_classifier_run.sh`
- Random Forest: Breiman (2001), *Random forests*, Machine Learning
  45:5–32.
- `ranger`: Wright & Ziegler (2017), *ranger: A fast implementation of
  Random Forests for high dimensional data in C++ and R*, JSS 77:1.
- Permutation importance: Strobl et al. (2007), *Bias in random forest
  variable importance measures*, BMC Bioinformatics 8:25.
- Saabas SHAP-equivalent: Saabas (2014),
  http://blog.datadive.net/interpreting-random-forests/
- SHAP for trees: Lundberg et al. (2020), *From local explanations to
  global understanding with explainable AI for trees*, Nat Mach Intell
  2:56–67.
