// Header scroll state + mobile menu, and shared reveal-on-scroll.
(function () {
  var header = document.getElementById('site-header');
  function onScroll() { if (header) header.classList.toggle('scrolled', window.scrollY > 6); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  function closeMenu() {
    if (!links) return;
    links.classList.remove('open');
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.querySelector('.ms').textContent = 'menu'; }
  }
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.ms').textContent = open ? 'close' : 'menu';
    });
    links.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  }

  // Reveal on scroll.
  var els = document.querySelectorAll('.reveal');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var el = e.target;
          var delay = el.dataset.delay ? Number(el.dataset.delay) : 0;
          el.style.transitionDelay = delay + 'ms';
          el.classList.add('in');
          io.unobserve(el);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });

    // Safety net: anything already in the first viewport must show even if the
    // observer's initial callback is delayed (e.g. background/throttled tabs).
    function revealAboveFold() {
      els.forEach(function (el) {
        if (!el.classList.contains('in') && el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('in');
        }
      });
    }
    window.addEventListener('load', function () { setTimeout(revealAboveFold, 250); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }
})();
