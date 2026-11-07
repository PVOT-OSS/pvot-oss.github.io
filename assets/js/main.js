(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var glass = function () { return window.PvotGlass; };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Header -----------------------------------------------------------------------------
  var header = $('#site-header'), toggle = $('#nav-toggle');
  if (toggle) {
    var setOpen = function (open) {
      header.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open);
      toggle.querySelector('.ms').textContent = open ? 'close' : 'menu';
    };
    toggle.addEventListener('click', function () { setOpen(!header.classList.contains('open')); });
    $$('.nav-links a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  // ---- The nav bends the page under it (Chromium reads SVG filters in backdrop-filter) -----
  (function refractNav() {
    var brands = navigator.userAgentData && navigator.userAgentData.brands;
    var chromium = brands && brands.some(function (b) { return /Chromium/.test(b.brand); });
    var nav = $('.nav-glass'), map = $('#nav-refract-map'), disp = $('#nav-refract-disp');
    if (!chromium || !nav || !map || !disp) return;

    function sdf(px, py, bx, by, r) {
      var qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    }
    var last = '';
    function build() {
      var w = Math.round(nav.offsetWidth), h = Math.round(nav.offsetHeight);
      if (!w || !h || last === w + 'x' + h) return;
      last = w + 'x' + h;
      // PvotGlassStyle for a 46dp glass, scaled to the bar's height.
      var band = 12 / 46 * h, strength = 11 / 46 * h;
      var r = Math.max(h / 2, band);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var px = x + 0.5 - w / 2, py = y + 0.5 - h / 2, i = (y * w + x) * 4;
          var dist = Math.min(sdf(px, py, w / 2, h / 2, r), 0);
          var t = Math.max(0, Math.min(1, 1 + dist / band));
          var dx = 0, dy = 0;
          if (t > 0) {
            var nx = sdf(px + 1, py, w / 2, h / 2, r) - sdf(px - 1, py, w / 2, h / 2, r);
            var ny = sdf(px, py + 1, w / 2, h / 2, r) - sdf(px, py - 1, w / 2, h / 2, r);
            var nl = Math.hypot(nx, ny) || 1, ease = t * t;
            dx = nx / nl * ease; dy = ny / nl * ease;
          }
          d[i] = 128 + 127 * dx; d[i + 1] = 128 + 127 * dy; d[i + 2] = 128; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      map.setAttribute('href', c.toDataURL());
      map.setAttribute('width', w);
      map.setAttribute('height', h);
      disp.setAttribute('scale', (2 * strength).toFixed(2));
      document.documentElement.classList.add('refract');
    }
    build();
    if ('ResizeObserver' in window) new ResizeObserver(build).observe(nav);
  })();

  // ---- Reveal -----------------------------------------------------------------------------
  var rv = $$('.rv');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    rv.forEach(function (el) {
      var sibs = $$(':scope > .rv', el.parentElement);
      el.style.setProperty('--d', Math.min(sibs.indexOf(el), 6) * 0.07 + 's');
      io.observe(el);
    });
  } else {
    rv.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- Statement: words light up as it scrolls by -----------------------------------------
  $$('[data-words]').forEach(function (p) {
    var words = [];
    Array.prototype.slice.call(p.childNodes).forEach(function (node) {
      var hl = node.nodeType === 1;
      node.textContent.split(/\s+/).forEach(function (part) {
        if (!part) return;
        var s = document.createElement('span');
        s.className = 'w' + (hl ? ' hl' : '');
        s.textContent = part;
        words.push(s);
      });
    });
    p.textContent = '';
    words.forEach(function (w, i) {
      if (i) p.appendChild(document.createTextNode(' '));
      p.appendChild(w);
    });
    if (reduceMotion) { words.forEach(function (w) { w.classList.add('on'); }); return; }
    var ticking = false;
    function update() {
      ticking = false;
      var r = p.getBoundingClientRect(), vh = window.innerHeight;
      var prog = (vh * 0.82 - r.top) / (r.height + vh * 0.3);
      var lit = Math.round(Math.max(0, Math.min(1, prog)) * words.length);
      words.forEach(function (w, i) { w.classList.toggle('on', i < lit); });
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  });

  // ---- Segmented controls -----------------------------------------------------------------
  function placeIndicator(seg, instant) {
    var ind = $('.seg-ind', seg), sel = $('[aria-selected="true"]', seg);
    if (!ind || !sel) return;
    if (instant) ind.style.transition = 'none';
    ind.style.left = sel.offsetLeft + 'px';
    ind.style.width = sel.offsetWidth + 'px';
    if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
  }

  function applyFilter(seg, cat) {
    var scope = $(seg.dataset.filter);
    if (!scope) return;
    $$('[data-cat]', scope).forEach(function (el) {
      if (seg.contains(el)) return;
      el.hidden = !(cat === 'all' || el.dataset.cat === cat);
    });
    $$('.dock-wrap', scope).forEach(function (w) {
      w.hidden = !$$('.icon-link:not([hidden])', w).length;
    });
  }

  $$('.seg').forEach(function (seg) {
    var buttons = $$('button', seg);
    buttons.forEach(function (b, i) {
      b.addEventListener('click', function () {
        buttons.forEach(function (o) { o.setAttribute('aria-selected', o === b ? 'true' : 'false'); });
        placeIndicator(seg);
        if (seg.dataset.filter) applyFilter(seg, b.dataset.cat);
        seg.dispatchEvent(new CustomEvent('seg-change', { detail: b.dataset.value || b.dataset.cat || i }));
      });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = buttons[(i + d + buttons.length) % buttons.length];
        n.focus();
        n.click();
      });
    });
    placeIndicator(seg, true);
  });
  var relayout = function () { $$('.seg').forEach(function (s) { placeIndicator(s, true); }); };
  window.addEventListener('resize', relayout);
  if (document.fonts) document.fonts.ready.then(relayout);

  // ---- Navbar demo ------------------------------------------------------------------------
  $$('[data-navbar]').forEach(function (bar) {
    var tabs = $$('button', bar);
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (o) { o.setAttribute('aria-selected', o === t ? 'true' : 'false'); });
      });
    });
  });

  // ---- Switches ---------------------------------------------------------------------------
  $$('.g-switch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });
  });

  // ---- Sliders ----------------------------------------------------------------------------
  $$('.g-slider').forEach(function (sl) {
    var fill = $('.g-slider-fill', sl), knob = $('.g-slider-knob', sl);
    var value = parseFloat(sl.getAttribute('aria-valuenow')) || 0;
    function set(v) {
      value = Math.max(0, Math.min(100, v));
      // The knob's centre travels between its half-widths, so it never leaves the track.
      var w = sl.clientWidth || 240, pad = 19 / w * 100;
      var pos = pad + (100 - 2 * pad) * value / 100;
      fill.style.width = pos + '%';
      knob.style.left = pos + '%';
      sl.setAttribute('aria-valuenow', Math.round(value));
      if (glass() && glass().invalidate) glass().invalidate(fill);
    }
    function fromEvent(e) {
      var r = sl.getBoundingClientRect();
      set((e.clientX - r.left - 19) / (r.width - 38) * 100);
    }
    var dragging = false;
    sl.addEventListener('pointerdown', function (e) {
      dragging = true;
      sl.setPointerCapture(e.pointerId);
      fromEvent(e);
    });
    sl.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e); });
    sl.addEventListener('pointerup', function () { dragging = false; });
    sl.addEventListener('pointercancel', function () { dragging = false; });
    sl.addEventListener('keydown', function (e) {
      var d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, Home: -100, End: 100 }[e.key];
      if (d == null) return;
      e.preventDefault();
      set(value + d);
    });
    set(value);
  });

  // ---- Toggle icons (play and pause) ------------------------------------------------------
  $$('[data-toggle-icon]').forEach(function (b) {
    var pair = b.dataset.toggleIcon.split(' '), on = false;
    b.addEventListener('click', function () {
      on = !on;
      b.querySelector('.ms').textContent = pair[on ? 1 : 0];
      b.setAttribute('aria-label', on ? 'Pause' : 'Play');
    });
  });

  // ---- Copy -------------------------------------------------------------------------------
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var src = $(b.dataset.copy);
      if (!src || !navigator.clipboard) return;
      navigator.clipboard.writeText(src.textContent.trim()).then(function () {
        var ic = b.querySelector('.ms');
        ic.textContent = 'check';
        setTimeout(function () { ic.textContent = 'content_copy'; }, 1600);
      });
    });
  });

  // ---- Lens: hide the hint once it has been picked up -------------------------------------
  $$('.lens').forEach(function (lens) {
    var stage = lens.closest('.stage');
    var done = function () { if (stage) stage.classList.add('lens-touched'); };
    lens.addEventListener('pointerdown', done, { once: true });
    lens.addEventListener('keydown', done, { once: true });
  });

  // ---- The lab ----------------------------------------------------------------------------
  var panel = $('#lab-panel'), lens = $('#lab-lens');
  if (panel && lens) {
    // PvotGlassDefaults: ClearStyle, RegularStyle and ThickStyle.
    var MATERIAL = {
      clear: { strength: 11, aberration: 3, reflection: 0.85, glow: 0.22, blur: 1 },
      regular: { strength: 8, aberration: 3, reflection: 0.85, glow: 0.18, blur: 10 },
      thick: { strength: 5, aberration: 1.5, reflection: 0.5, glow: 0.22, blur: 18 }
    };
    var knobs = $$('input[data-param]', panel), intensity = $('input[data-intensity]', panel);
    var material = 'clear';
    var show = function (input) {
      var out = $('output[data-for="' + input.id + '"]', panel);
      if (out) out.textContent = (+input.value).toFixed(parseFloat(input.step) < 0.1 ? 2 : 1);
    };
    var apply = function () {
      var params = {};
      knobs.forEach(function (k) { params[k.dataset.param] = parseFloat(k.value); show(k); });
      lens.dataset.glass = material;
      if (glass() && glass().setParams) glass().setParams(lens, params);
    };
    var load = function (name) {
      material = name;
      knobs.forEach(function (k) { k.value = MATERIAL[name][k.dataset.param]; });
      apply();
    };
    knobs.forEach(function (k) { k.addEventListener('input', apply); });
    intensity.addEventListener('input', function () {
      show(intensity);
      if (glass() && glass().setIntensity) glass().setIntensity(parseFloat(intensity.value));
    });
    var matSeg = $('[data-material]', panel);
    matSeg.addEventListener('seg-change', function (e) { load(e.detail); });
    $('#lab-reset').addEventListener('click', function () {
      $$('button', matSeg)[0].click();
      intensity.value = 1;
      intensity.dispatchEvent(new Event('input'));
    });
    show(intensity);
    apply();
  }
})();
