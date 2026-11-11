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

  // ---- Depth ------------------------------------------------------------------------------
  // The site is built in layers, like the OS: the silk at the back, each section's content on a
  // plane in front of it, glass and the bar floating above. Planes slide against each other with
  // the pointer (or the phone's tilt) and with scroll; a section that scrolls away sinks back
  // instead of just leaving. Everything below writes only `translate`, `scale` and `opacity`.
  (function depth() {
    var planes = $$('[data-plane]');
    var receders = $$('[data-recede]');
    if (reduceMotion || (!planes.length && !receders.length)) return;
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var gx = 0, gy = 0, tx = 0, ty = 0, vh = window.innerHeight;
    var clamp = function (v) { return Math.max(-1, Math.min(1, v)); };
    if (fine) {
      window.addEventListener('pointermove', function (e) {
        gx = e.clientX / window.innerWidth * 2 - 1;
        gy = e.clientY / window.innerHeight * 2 - 1;
      }, { passive: true });
    } else if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
      window.addEventListener('deviceorientation', function (e) {
        if (e.gamma == null) return;
        gx = clamp(e.gamma / 25);
        gy = clamp((e.beta - 45) / 25);
      }, { passive: true });
    }
    // Layout positions, untouched by our own transforms.
    var docTop = function (el) { var t = 0; while (el) { t += el.offsetTop; el = el.offsetParent; } return t; };
    var measure = function () {
      vh = window.innerHeight;
      planes.forEach(function (pl) {
        var host = pl.closest('[data-stage]') || pl.parentElement;
        pl._host = host; pl._top = docTop(host); pl._h = host.offsetHeight;
      });
      receders.forEach(function (el) { el._top = docTop(el); el._h = el.offsetHeight; });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    if (document.fonts) document.fonts.ready.then(measure);

    (function tick() {
      tx += (gx - tx) * 0.06;
      ty += (gy - ty) * 0.06;
      var y0 = window.scrollY;
      planes.forEach(function (pl) {
        var top = pl._top - y0;
        if (top > vh + 80 || top + pl._h < -80) return;
        var prog = Math.max(0, Math.min(1, -top / pl._h));
        var k = parseFloat(pl.dataset.plane) || 1;
        // The content plane drifts against the pointer and lags the scroll a little; the silk
        // behind it moves the other way, further.
        var x = Math.round(-tx * 10 * k * 10) / 10;
        var y = Math.round((-ty * 7 * k + prog * pl._h * 0.1) * 10) / 10;
        if (!pl._shift || pl._shift.x !== x || pl._shift.y !== y) {
          pl._shift = { x: x, y: y };
          pl.style.translate = x + 'px ' + y + 'px';
        }
        pl._host._silkShift = { x: tx * 28, y: ty * 18 - prog * pl._h * 0.1 };
      });
      receders.forEach(function (el) {
        var top = el._top - y0;
        var p = top < 0 ? Math.min(1, -top / Math.max(el._h * 0.9, vh * 0.7)) : 0;
        if (top > vh || Math.abs(p - (el._rp || 0)) < 0.002) return;
        el._rp = p;
        el.style.scale = String(1 - 0.06 * p);
        el.style.opacity = String(1 - 0.5 * p);
        // A glass section rounds off like a card being set down.
        if (el.hasAttribute('data-stage')) el.style.borderRadius = (p * 36).toFixed(1) + 'px';
      });
      requestAnimationFrame(tick);
    })();
  })();

  // Touchable things are physical: icons and cards tilt toward the pointer and catch a sheen.
  (function tilt() {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var cur = null;
    var reset = function (el) {
      el.classList.remove('tilting');
      ['--rx', '--ry', '--so'].forEach(function (v) { el.style.removeProperty(v); });
    };
    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest ? e.target.closest('[data-tilt]') : null;
      if (el !== cur) { if (cur) reset(cur); cur = el; if (el) el.classList.add('tilting'); }
      if (!el) return;
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      var max = el.matches('.icon-link, .row') ? 16 : 5;
      el.style.setProperty('--ry', ((x - 0.5) * max).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-(y - 0.5) * max).toFixed(2) + 'deg');
      el.style.setProperty('--sx', (x * 100).toFixed(1) + '%');
      el.style.setProperty('--sy', (y * 100).toFixed(1) + '%');
      el.style.setProperty('--so', '1');
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', function () { if (cur) { reset(cur); cur = null; } });
  })();

  // The bar lifts further off the page once there is page under it.
  if (header) {
    var lifted = false;
    window.addEventListener('scroll', function () {
      var on = window.scrollY > 8;
      if (on !== lifted) { lifted = on; header.classList.toggle('scrolled', on); }
    }, { passive: true });
  }

  // Everything outside the glass sections arrives from depth too, not only what is marked.
  $$('.doc-body > *, .repo-group, .cat, .feature-list li, .note, .app-summary, .related, .install-step, .sponsor-grid, .donate-card, .split > div')
    .forEach(function (el) {
      if (!el.classList.contains('rv') && !el.closest('[data-stage]') && !el.closest('.rv')) el.classList.add('rv');
    });

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

  // Filtering animates instead of popping: leaving icons shrink away, the ones that stay glide
  // to their new places, and new ones grow in once there is room for them.
  var filterRun = 0;
  function syncDocks(scope) {
    $$('.dock-wrap', scope).forEach(function (w) {
      w.hidden = !$$('.icon-link:not([hidden])', w).length;
    });
  }
  function applyFilter(seg, cat) {
    var scope = $(seg.dataset.filter);
    if (!scope) return;
    var run = ++filterRun;
    var items = $$('[data-cat]', scope).filter(function (el) { return !seg.contains(el); });
    items.forEach(function (el) {
      if (el.getAnimations) el.getAnimations().forEach(function (a) { a.cancel(); });
      el.style.opacity = '';
    });
    var want = function (el) { return cat === 'all' || el.dataset.cat === cat; };
    if (reduceMotion || !document.body.animate) {
      items.forEach(function (el) { el.hidden = !want(el); });
      syncDocks(scope);
      return;
    }
    var leaving = items.filter(function (el) { return !el.hidden && !want(el); });
    var entering = items.filter(function (el) { return el.hidden && want(el); });
    var staying = items.filter(function (el) { return !el.hidden && want(el); });
    var first = new Map();
    staying.forEach(function (el) { first.set(el, el.getBoundingClientRect()); });
    // Big blocks (the /apps/ sections) slide; icons shrink.
    var away = function (el) {
      return el.offsetHeight > 160 ? 'translateY(16px)' : 'scale(0.6)';
    };
    var OUT = leaving.length ? 170 : 0;
    leaving.forEach(function (el) {
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: away(el) }],
        { duration: OUT, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    });
    setTimeout(function () {
      if (run !== filterRun) return;
      leaving.forEach(function (el) {
        el.getAnimations().forEach(function (a) { a.cancel(); });
        el.hidden = true;
      });
      entering.forEach(function (el) { el.hidden = false; });
      syncDocks(scope);
      var moved = false;
      staying.forEach(function (el) {
        var a = first.get(el), b = el.getBoundingClientRect();
        var dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        moved = true;
        el.animate([{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }],
          { duration: 520, easing: 'cubic-bezier(0.3, 1.2, 0.5, 1)' });
      });
      var delay = moved ? 240 : 0;
      entering.forEach(function (el, i) {
        el.animate([{ opacity: 0, transform: away(el) }, { opacity: 1, transform: 'none' }],
          { duration: 380, delay: delay + Math.min(i, 14) * 18, easing: 'cubic-bezier(0.3, 1.3, 0.5, 1)', fill: 'backwards' });
      });
    }, OUT);
  }

  // A glass bar's indicator can be dragged, like iOS: it lifts into a lens and snaps to the
  // nearest option when let go. Start the drag on the chosen option (or anywhere with a mouse).
  function bindSegDrag(seg) {
    var ind = $('.seg-ind', seg), buttons = $$('button', seg);
    if (!ind || !buttons.length) return;
    var down = null, dragging = false, swallow = false;
    var nearest = function (x) {
      var best = buttons[0], d = Infinity;
      buttons.forEach(function (b) {
        var c = b.offsetLeft + b.offsetWidth / 2, dd = Math.abs(c - x);
        if (dd < d) { d = dd; best = b; }
      });
      return best;
    };
    var lift = function (on) {
      ind.classList.toggle('is-held', on);
      seg.classList.toggle('dragging', on);
      if (ind._glass) ind._glass.liftTarget = on ? 1 : 0;
      if (window.PvotGlass && PvotGlass.kick) PvotGlass.kick(1500);
    };
    seg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var onChosen = e.target.closest('[aria-selected="true"]');
      if (e.pointerType !== 'mouse' && !onChosen) return;
      down = { x: e.clientX, left: ind.offsetLeft, w: ind.offsetWidth, id: e.pointerId };
      dragging = false;
    });
    seg.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - down.x;
      if (!dragging) {
        if (Math.abs(dx) < 6) return;
        dragging = true;
        try { seg.setPointerCapture(down.id); } catch (err) { /* already released */ }
        lift(true);
      }
      var centre = down.left + down.w / 2 + dx;
      var b = nearest(centre), w = b.offsetWidth;
      var lo = buttons[0].offsetLeft, hi = buttons[buttons.length - 1].offsetLeft + buttons[buttons.length - 1].offsetWidth;
      ind.style.width = w + 'px';
      ind.style.left = Math.max(lo - 6, Math.min(hi - w + 6, centre - w / 2)) + 'px';
    });
    var up = function () {
      if (!down) return;
      if (dragging) {
        var pick = nearest(ind.offsetLeft + ind.offsetWidth / 2);
        lift(false);
        pick.click();
        swallow = true;
        setTimeout(function () { swallow = false; }, 60);
      }
      down = null;
      dragging = false;
    };
    seg.addEventListener('pointerup', up);
    seg.addEventListener('pointercancel', up);
    seg.addEventListener('click', function (e) {
      if (swallow && e.isTrusted) { e.stopPropagation(); e.preventDefault(); swallow = false; }
    }, true);
    // Labels scrolled out of a narrow bar are clipped in the backdrop; repaint as it scrolls.
    seg.addEventListener('scroll', function () {
      if (window.PvotGlass && PvotGlass.invalidate) PvotGlass.invalidate(seg);
    }, { passive: true });
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
    if (seg.classList.contains('seg-glass')) bindSegDrag(seg);
  });
  var relayout = function () { $$('.seg').forEach(function (s) { placeIndicator(s, true); }); };
  window.addEventListener('resize', relayout);
  if (document.fonts) document.fonts.ready.then(relayout);

  // ---- Nav: the glass bubble sits on the current page, follows the mouse, and can be dragged --
  (function navBubble() {
    var nav = $('.nav-links'), bubble = $('.nav-bubble');
    if (!nav || !bubble) return;
    var links = $$('a', nav), current = $('a[aria-current="page"]', nav);
    var down = null, dragging = false, swallow = false;
    var place = function (a, instant) {
      if (!a) { bubble.hidden = true; return; }
      var wasHidden = bubble.hidden;
      bubble.hidden = false;
      if (instant || wasHidden) bubble.style.transition = 'none';
      bubble.style.left = a.offsetLeft + 'px';
      bubble.style.top = a.offsetTop + 'px';
      bubble.style.width = a.offsetWidth + 'px';
      bubble.style.height = a.offsetHeight + 'px';
      if (instant || wasHidden) { void bubble.offsetWidth; bubble.style.transition = ''; }
    };
    var nearest = function (x) {
      var best = links[0], d = Infinity;
      links.forEach(function (a) {
        var c = a.offsetLeft + a.offsetWidth / 2, dd = Math.abs(c - x);
        if (dd < d) { d = dd; best = a; }
      });
      return best;
    };
    var lift = function (on) {
      bubble.classList.toggle('is-held', on);
      bubble.classList.toggle('dragging', on);
      if (bubble._glass) bubble._glass.liftTarget = on ? 1 : 0;
      if (window.PvotGlass && PvotGlass.kick) PvotGlass.kick(1500);
    };
    place(current, true);
    links.forEach(function (a) {
      a.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'mouse' && !dragging) place(a);
      });
      a.addEventListener('focus', function () { if (!dragging) place(a); });
    });
    nav.addEventListener('pointerleave', function () { if (!dragging) place(current); });
    nav.addEventListener('focusout', function (e) { if (!nav.contains(e.relatedTarget)) place(current); });
    // Links are natively draggable, which would cancel our pointer stream: switch that off.
    links.forEach(function (a) { a.setAttribute('draggable', 'false'); });
    nav.addEventListener('dragstart', function (e) { e.preventDefault(); });
    nav.addEventListener('pointerdown', function (e) {
      var a = e.target.closest('a');
      if (!a || e.button !== 0 || window.matchMedia('(max-width: 760px)').matches) return;
      down = { x: e.clientX, id: e.pointerId };
      dragging = false;
    });
    nav.addEventListener('pointermove', function (e) {
      if (!down) return;
      if (!dragging) {
        if (Math.abs(e.clientX - down.x) < 8) return;
        dragging = true;
        try { nav.setPointerCapture(down.id); } catch (err) { /* released */ }
        lift(true);
      }
      var x = e.clientX - nav.getBoundingClientRect().left;
      var a = nearest(x), w = a.offsetWidth;
      var last = links[links.length - 1];
      bubble.hidden = false;
      bubble.style.width = w + 'px';
      bubble.style.top = a.offsetTop + 'px';
      bubble.style.left = Math.max(links[0].offsetLeft - 8, Math.min(last.offsetLeft + last.offsetWidth - w + 8, x - w / 2)) + 'px';
    });
    var up = function () {
      if (!down) return;
      if (dragging) {
        var a = nearest(bubble.offsetLeft + bubble.offsetWidth / 2);
        lift(false);
        swallow = true;
        setTimeout(function () { swallow = false; }, 60);
        place(a);
        // Let it land, then go there.
        if (a !== current) setTimeout(function () { window.location.href = a.href; }, 220);
      }
      down = null;
      dragging = false;
    };
    nav.addEventListener('pointerup', up);
    nav.addEventListener('pointercancel', up);
    nav.addEventListener('click', function (e) {
      if (swallow) { e.preventDefault(); e.stopPropagation(); swallow = false; }
    }, true);
    window.addEventListener('resize', function () { place(current, true); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) place(current, true); });
    if (document.fonts) document.fonts.ready.then(function () { place(current, true); });
  })();

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

  // ---- Intro: once a session, a big lens sweeps across the hero and settles into the small one --
  (function intro() {
    var lens = $('.hero .lens');
    if (!lens || reduceMotion || !lens.animate) return;
    try {
      if (sessionStorage.getItem('pvot-intro')) return;
      sessionStorage.setItem('pvot-intro', '1');
    } catch (e) { /* storage blocked: play it anyway */ }
    var stage = lens.closest('.stage');
    lens._introing = true;
    lens.style.setProperty('--dx', '0px');
    lens.style.setProperty('--dy', '0px');
    var r = lens.getBoundingClientRect();
    var big = Math.min(3.4, (window.innerHeight * 0.92) / r.height);
    var offLeft = -(r.left + r.width / 2) - (r.width * big) / 2 - 40;
    var start = 'translate(' + offLeft + 'px, ' + (-r.height * 0.35) + 'px) scale(' + big + ')';
    lens.style.transform = start; // parked off screen until the stage is ready

    var anim = null;
    var finish = function () {
      if (!lens._introing) return;
      lens._introing = false;
      lens._idleStart = performance.now();
      lens.style.transform = '';
      if (lens._glass) { lens._glass.liftTarget = 0; lens._glass.params = null; }
    };
    lens.addEventListener('pointerdown', function () { if (anim) anim.cancel(); finish(); }, { once: true });

    var go = function () {
      if (!lens._introing) return;
      var mid = 'translate(' + (window.innerWidth * 0.16) + 'px, ' + (-r.height * 0.1) + 'px) scale(' + (1 + (big - 1) * 0.45) + ')';
      if (lens._glass) lens._glass.liftTarget = 1;
      // Keep the big lens clear: the frost grows with the glass, which would fog it mid-sweep.
      if (window.PvotGlass && PvotGlass.setParams) PvotGlass.setParams(lens, { blur: 0.12 });
      if (window.PvotGlass && PvotGlass.kick) PvotGlass.kick(2400);
      anim = lens.animate([
        { transform: start },
        { transform: mid, offset: 0.58 },
        { transform: 'translate(0px, 0px) scale(1)' }
      ], { duration: 2100, easing: 'cubic-bezier(0.55, 0, 0.15, 1)' });
      lens.style.transform = 'translate(0px, 0px) scale(1)';
      anim.onfinish = finish;
      anim.oncancel = finish;
    };

    // Start once the shader has drawn its first frame and the fonts are in, so the
    // headline it bends is the real one. Give up waiting after a few seconds.
    var t0 = performance.now();
    (function wait() {
      var ready = stage && stage.classList.contains('is-live') && (!document.fonts || document.fonts.status === 'loaded');
      if (ready) return setTimeout(go, 250);
      if (performance.now() - t0 > 6000) { finish(); return; }
      requestAnimationFrame(wait);
    })();
  })();

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
