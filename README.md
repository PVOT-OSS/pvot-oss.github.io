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
| `_apps/*.md` | One file per app. The front matter (title, tagline, category, icon, accent, status, repo, summary, features) is the single source of truth. Add an app by dropping a new file here. |
| `_data/categories.yml` | The app categories and their blurbs. |
| `_config.yml` | Site metadata, social links, and the nav. |
| `_layouts/` | `base.html` (shell) and `app.html` (per-app page). |
| `_includes/` | `head`, `header`, `footer`, `app-tile`. |
| `assets/css/main.css` | All styles. Dark canvas, indigo to rose, from PvotLib's tokens. |
| `assets/js/main.js` | Header behaviour and reveal-on-scroll. |
| `index.html`, `apps.html`, `about.html`, `contribute.html`, `privacy.html` | The pages. |

### Adding or updating an app

Create `_apps/<slug>.md`:

```yaml
---
order: 17
title: Camera
tagline: Point and shoot.
category: media          # media | communication | everyday | utility
icon: photo_camera       # a Material Symbols Rounded name
accent: "#6B66FF"
status: stable           # stable (Available) | beta | soon (In development)
repo: Aperture           # repo name under github.com/PVOT-OSS, optional
summary: One sentence describing the app.
features:
  - A feature
  - Another feature
---
```

The home grid, the `/apps/` page, and the app's own page at `/apps/<slug>/`
all update automatically. If you use a new icon, add its name to the
`icon_names` list in `_includes/head.html` so the glyph is loaded.

## Deploy

Pushing to `main` builds and deploys automatically via GitHub Actions
(`.github/workflows/jekyll.yml`). In the repo's **Settings → Pages**, set the
source to **GitHub Actions**.
