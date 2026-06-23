# utsavlamichhane.com

Personal site for **Utsav Lamichhane** — PhD researcher in Machine Learning &
Bioinformatics, University of Georgia. Static HTML/CSS (vanilla JS only),
designed to be hosted on **GitHub Pages** with the custom domain
`utsavlamichhane.com`.

---

## Project structure

```
website/
├── index.html                      Home
├── applications/
│   ├── index.html                  Applications overview
│   ├── qiime2-code-generator.html  Embedded Shiny app
│   └── mbx-pro-pipeline.html       Gallery of the 19 pipeline steps
├── python-library.html             Python Library (utsav)
├── media.html
├── skills.html
├── certifications.html
├── contact.html
├── recent-db/
│   ├── index.html
│   └── mysql-microbiome-database.html
├── tools/                          The 19 "mbX Pro" step pages (open in the
│                                   "mbXPro" browser tab) + slides + READMEs
├── assets/
│   ├── css/styles.css              The whole theme lives here
│   ├── js/main.js                  Mobile nav, dropdowns, copy buttons
│   └── img/
├── CNAME                           utsavlamichhane.com
├── .nojekyll                       Tell Pages not to run Jekyll
├── robots.txt
├── sitemap.xml
└── 404.html
```

> **One missing file:** the MySQL page links to `recent-db/project_report_2.pdf`.
> Drop that PDF into the `recent-db/` folder and the download button works.

### Editing
- All colors, fonts, and spacing are CSS variables at the top of
  `assets/css/styles.css`.
- The nav and footer are repeated in each page (no build step needed). If you
  add a page, copy the `<header class="nav">…</header>` block from an existing
  page so links stay consistent.

---

## Deploy to GitHub Pages

### 1. Create the repository
1. Sign in to GitHub (your account: **utsavlamichhane**).
2. New repository → name it exactly **`utsavlamichhane.github.io`** →
   Public → Create. (A repo with this name is served at the site root, which is
   what the apex domain expects.)

### 2. Push the site
Put the **contents of this `website/` folder** at the **root** of the repo
(so `index.html` sits at the top level, not inside a `website/` subfolder).

From this folder:
```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/utsavlamichhane/utsavlamichhane.github.io.git
git push -u origin main
```

### 3. Turn on Pages
Repo → **Settings → Pages**:
- **Source:** Deploy from a branch
- **Branch:** `main`  /  **Folder:** `/ (root)` → **Save**

The `CNAME` file already in this repo sets the custom domain to
`utsavlamichhane.com`. You should see it pre-filled under
**Settings → Pages → Custom domain**. Leave **Enforce HTTPS** checked (it
becomes available once DNS verifies — see below).

---

## Point the domain (Squarespace DNS)

Your domain is registered through **Squarespace** (it inherited Google Domains).
You are only changing **DNS records** — you keep the domain at Squarespace.

1. Squarespace → **Domains** → click **utsavlamichhane.com** → **DNS** /
   **DNS Settings**.
2. **Remove** any existing records that point the root (`@`) or `www` at Google
   Sites / Squarespace defaults (old `A`, `CNAME`, or `ALIAS` records). Leave
   `MX`/email records alone.
3. **Add these records:**

   **Apex (`@`) → GitHub Pages — four A records:**

   | Type | Host | Value           |
   |------|------|-----------------|
   | A    | @    | 185.199.108.153 |
   | A    | @    | 185.199.109.153 |
   | A    | @    | 185.199.110.153 |
   | A    | @    | 185.199.111.153 |

   **`www` → your Pages site — one CNAME:**

   | Type  | Host | Value                       |
   |-------|------|-----------------------------|
   | CNAME | www  | utsavlamichhane.github.io   |

   *(Optional, recommended) IPv6 — four AAAA records on `@`:*
   `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`,
   `2606:50c0:8003::153`.

4. Save. DNS can take from a few minutes up to ~24–48 hours to propagate.

### 4. Verify
- In **Settings → Pages**, the custom domain should show a green check once DNS
  resolves. Then tick **Enforce HTTPS** (GitHub provisions the certificate
  automatically; this can take an hour or so after DNS is live).
- Visit `https://utsavlamichhane.com` — and `https://www.utsavlamichhane.com`
  should redirect to it.

That's it. After the first setup, any `git push` to `main` redeploys the site.
