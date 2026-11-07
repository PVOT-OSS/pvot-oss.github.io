# Pvot website

The website for [Pvot](https://github.com/PVOT-OSS): an open-source, AOSP-based
Android ecosystem. Built with [Jekyll](https://jekyllrb.com/).

## Run it locally

```sh
bundle install
bundle exec jekyll serve      # http://127.0.0.1:4000
```

Build the static site into `_site/`:

```sh
JEKYLL_ENV=production bundle exec jekyll build
```

## How it is organised

| Path | What it is |
|------|------------|
| `_apps/*.md` | One file per app. Front matter (title, tagline, category, icon, status, repo, summary, features) is the single source of truth. |
| `_data/categories.yml` | Categories, each with its glyph `color` and the `blobs` that tint its app pages. |
| `_config.yml` | Site metadata, social links, the nav. |
| `_layouts/` | `base.html` (shell) and `app.html` (per-app page). |
| `_includes/` | `head`, `header` (glass nav), `footer`, `logo`, `app-icon`, `controls`. |
| `assets/js/glass.js` | PvotLib's liquid glass (`PvotGlass.kt`) ported from AGSL to WebGL, plus `PvotLiveBackground`. |
| `assets/js/main.js` | Nav, reveals, filters, switches, sliders, the glass lab. |
| `assets/css/main.css` | All styles. PvotLib's dark palette. |
| `index.html`, `apps.html`, `pvotlib.html`, `about.html`, `contribute.html`, `privacy.html` | The pages. |

### The glass

Any section can be a stage the glass sees through:

```html
<section class="stage" data-stage data-live>        <!-- data-live: the drifting PvotLiveBackground -->
  <span data-paint>Headline</span>                   <!-- drawn into the backdrop, so glass bends it -->
  <i data-paint="box" style="--fill:#8577FF"></i>    <!-- a shape drawn into the backdrop -->
  <div data-glass="clear"></div>                     <!-- clear | regular | thick -->
</section>
```

Options: `data-blobs`, `data-seed`, `data-dim` on the stage; `data-glass-ref` (reference size, default 46),
`data-glass-blur`, `data-glass-strength`, `data-glass-lift` (turns to a lens while held),
`data-glass-rest="#fff"` (opaque at rest, like a switch knob), `data-glass-press`, `data-drag`
on glass. `data-paint` text must be a single line. Without WebGL everything falls back to CSS frost.
In Chromium the nav bar also bends the page under it through an SVG displacement filter.

### Adding or updating an app

Create `_apps/<slug>.md`:

```yaml
---
order: 29
title: Camera
tagline: Point and shoot.
category: media          # media | communication | everyday | life | tools | design
icon: photo_camera       # a Material Symbols Rounded name
status: stable           # stable (Available) | beta | soon (In development)
repo: Aperture           # repo under github.com/PVOT-OSS, optional
summary: One sentence describing the app.
features:
  - A feature
---
```

Shipping apps (stable or beta) light up in full color and sit in the home page's dock; the rest
are dark, themed icons. If you use a new icon, add its name to the sorted `icon_names` list in
`_includes/head.html` so the glyph is loaded.

## Deploy

Pushing to `main` builds and deploys automatically via GitHub Actions
(`.github/workflows/jekyll.yml`). In the repo's **Settings → Pages**, set the
source to **GitHub Actions**.
