#!/usr/bin/env ruby
# SPDX-License-Identifier: Apache-2.0
#
# Renders the link-preview images (Open Graph, 1200x630) into assets/og/:
#   default.jpg     the home page and any page without its own
#   pvotlib.jpg     /pvotlib/
#   <app>.jpg       one per app in _apps/
#   icon-180.png, icon-512.png   the logo, for apple-touch-icon and JSON-LD
#
# Uses the Chrome you already have, headless. Run it after adding or renaming an app:
#   ruby scripts/og.rb            (or: CHROME=/path/to/chrome ruby scripts/og.rb)
require 'yaml'
require 'fileutils'
require 'tmpdir'
require 'cgi'

ROOT = File.expand_path('..', __dir__)
OUT = File.join(ROOT, 'assets/og')
FileUtils.mkdir_p(OUT)

CHROME = ENV['CHROME'] || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find { |c| File.exist?(c) } or abort('Chrome not found; set CHROME=/path/to/chrome')

def front_matter(path)
  YAML.safe_load(File.read(path).split(/^---\s*$/)[1], permitted_classes: [Date])
end

CATS = YAML.safe_load(File.read(File.join(ROOT, '_data/categories.yml'))).to_h { |c| [c['id'], c] }
FONTS = "file://#{ROOT}/assets/fonts"
LOGO = <<~SVG
  <svg viewBox="22 23 64 64" class="logo"><rect x="22" y="23" width="64" height="64" rx="15" fill="#6B66FF"/><path fill="#fff" d="M36 34h10v40H36zM46 34h18v10H46zM64 34h8v22h-8zM46 46h18v10H46z"/><path fill="#E5DEFF" d="M56 62h14v14H56z"/></svg>
SVG

def h(s) = CGI.escapeHTML(s.to_s)

def page(body, tint: '#3B2DB8', accent: '#A8104F', w: 1200, ht: 630)
  <<~HTML
    <!doctype html><html><head><meta charset="utf-8"><style>
      @font-face { font-family: Inter; font-weight: 400 800; src: url('#{FONTS}/inter-latin.woff2') format('woff2'); }
      @font-face { font-family: Icons; src: url('#{FONTS}/material-symbols-rounded.woff2') format('woff2'); }
      * { box-sizing: border-box; margin: 0; }
      html, body { width: #{w}px; height: #{ht}px; overflow: hidden; background: #000; }
      body {
        font-family: Inter, sans-serif; color: #f5f5f7; letter-spacing: -0.02em; -webkit-font-smoothing: antialiased;
        background:
          radial-gradient(55% 75% at 88% 18%, #{tint}cc, transparent 70%),
          radial-gradient(40% 55% at 70% 95%, #{accent}55, transparent 70%),
          linear-gradient(115deg, transparent 40%, #{tint}22 60%, transparent 75%),
          #000;
        padding: 64px 72px; display: flex; flex-direction: column; justify-content: space-between;
      }
      .brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 700; letter-spacing: -0.04em; }
      .logo { width: 52px; height: 52px; }
      .row { display: flex; align-items: center; gap: 48px; }
      .icon { width: 176px; height: 176px; border-radius: 48px; display: grid; place-items: center; flex: none;
        background: linear-gradient(180deg, #2a2a30, #141418); box-shadow: inset 0 2px 0 rgba(255,255,255,.1), 0 20px 50px rgba(0,0,0,.5); }
      .icon.on { background: linear-gradient(180deg, var(--c), color-mix(in srgb, var(--c), #000 22%)); }
      .icon i { font-family: Icons; font-style: normal; font-size: 96px; line-height: 1; color: var(--c);
        font-variation-settings: 'FILL' 0, 'wght' 400, 'opsz' 48; }
      .icon.on i { color: #0b0b0e; font-variation-settings: 'FILL' 1, 'wght' 500, 'opsz' 48; }
      h1 { font-size: 112px; font-weight: 750; letter-spacing: -0.055em; line-height: 0.95; }
      h1.big { font-size: 124px; }
      p { font-size: 38px; color: rgba(245,245,247,.68); margin-top: 18px; letter-spacing: -0.025em; line-height: 1.2; }
      .pills { display: flex; gap: 12px; flex-wrap: wrap; }
      .pill { font-size: 24px; font-weight: 600; padding: 10px 22px; border-radius: 999px; background: rgba(255,255,255,.08);
        box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.14); color: rgba(245,245,247,.86); letter-spacing: -0.01em; }
      .pill.good { background: #5fd48a; color: #04210f; box-shadow: none; }
      .pill.dev { background: #f5c451; color: #2a1800; box-shadow: none; }
      .url { font-size: 24px; color: rgba(245,245,247,.5); font-weight: 500; }
      .foot { display: flex; justify-content: space-between; align-items: center; }
    </style></head><body>#{body}</body></html>
  HTML
end

def shoot(name, html, w: 1200, ht: 630)
  Dir.mktmpdir do |dir|
    src = File.join(dir, 'card.html')
    File.write(src, html)
    ext = name.start_with?("icon-") ? "png" : "jpg"
    out = File.join(OUT, "#{name}.#{ext}")
    system(CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
           "--window-size=#{w},#{ht}", '--virtual-time-budget=3000', "--screenshot=#{out}", "file://#{src}",
           out: File::NULL, err: File::NULL) or abort("chrome failed on #{name}")
    puts "  #{File.basename(out)}"
  end
end

brand = %(<div class="brand">#{LOGO}Pvot</div>)
foot = ->(pills) { %(<div class="foot"><div class="pills">#{pills}</div><span class="url">pvot-oss.github.io</span></div>) }

puts 'Rendering link previews into assets/og/'
shoot('default', page(<<~B))
  #{brand}
  <div><h1 class="big">Your phone.<br>Your rules.</h1><p>De-Googled, open-source Android and a full suite of apps.</p></div>
  #{foot.call('<span class="pill">Open source</span><span class="pill">No Google</span><span class="pill good">0 trackers</span>')}
B

shoot('pvotlib', page(<<~B, tint: '#3B2DB8', accent: '#0F3FA8'))
  #{brand}
  <div><h1 class="big">Liquid glass,<br>for Android.</h1><p>PvotLib, the Jetpack Compose design system behind every Pvot app.</p></div>
  #{foot.call('<span class="pill">Jetpack Compose</span><span class="pill">Apache-2.0</span>')}
B

Dir[File.join(ROOT, '_apps/*.md')].sort.each do |path|
  app = front_matter(path)
  slug = File.basename(path, '.md')
  cat = CATS.fetch(app['category'])
  blobs = cat['blobs'].split(',')
  live = app['status'] != 'soon'
  status = live ? '<span class="pill good">Available</span>' : '<span class="pill dev">In development</span>'
  extra = app['package'] ? '<span class="pill">Google Play</span><span class="pill">0 trackers</span>' : '<span class="pill">Open source</span>'
  name = slug == 'whats-in-pvot' ? app['title'] : "Pvot #{app['title']}"
  size = name.length > 16 ? 84 : 112
  shoot(slug, page(<<~B, tint: blobs[0][0, 7], accent: blobs[1][0, 7]))
    #{brand}
    <div class="row">
      <div class="icon#{live ? ' on' : ''}" style="--c:#{cat['color']}"><i>#{h(app['icon'])}</i></div>
      <div><h1 style="font-size:#{size}px">#{h(name)}</h1><p>#{h(app['tagline'])}</p></div>
    </div>
    #{foot.call("#{status}#{extra}<span class=\"pill\">Android</span>")}
  B
end

[180, 512].each do |px|
  icon = <<~HTML
    <!doctype html><html><head><style>*{margin:0}html,body{width:#{px}px;height:#{px}px;background:#6B66FF;overflow:hidden}svg{width:100%;height:100%;display:block}</style></head>
    <body><svg viewBox="22 23 64 64"><rect x="22" y="23" width="64" height="64" fill="#6B66FF"/><path fill="#fff" d="M36 34h10v40H36zM46 34h18v10H46zM64 34h8v22h-8zM46 46h18v10H46z"/><path fill="#E5DEFF" d="M56 62h14v14H56z"/></svg></body></html>
  HTML
  shoot("icon-#{px}", icon, w: px, ht: px)
end
puts 'Done.'
