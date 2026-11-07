/*
 * Pvot glass for the web.
 *
 * PvotLib's liquid glass (design-system/effects/PvotGlass.kt), ported from AGSL to WebGL. The lens
 * math is the same: a rim that bends what lies behind it in from just outside the edge, splits red
 * from blue, mirrors the edge and catches the light. The backdrop is PvotLiveBackground's drift of
 * color, plus any text or shapes marked [data-paint], drawn into the scene so the glass bends them.
 *
 *   <section data-stage data-live>           a backdrop the glass can see
 *     <h1><span data-paint>Text</span></h1>  painted into the backdrop (single line)
 *     <i data-paint="box"></i>              a shape painted from its --fill and border-radius
 *     <div data-glass="clear"></div>         glass: clear | regular | thick
 *   </section>
 *
 * Without WebGL the page keeps plain CSS frosted glass and its DOM text.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------------------------------------
  // PvotGlassStyle and PvotGlassDefaults, sizes in dp for a glass whose shorter side is 46dp.

  var SURFACE = [0x23 / 255, 0x1f / 255, 0x36 / 255]; // PvotSurfaceVariantDark
  var CLEAR = {
    ref: 46, band: 12, strength: 11, aberration: 3, edgeBlur: 2.5, blur: 5, reflection: 0.85,
    mirrorScale: 1, glow: 0.22, darkGlow: 0.35, vividSpread: 11, vividMix: 1,
    fill: [1, 1, 1, 0x0a / 255], rim: 0.55
  };
  function extend(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  var MATERIALS = {
    clear: CLEAR,
    regular: extend(CLEAR, { blur: 10, strength: 8, glow: 0.18, fill: SURFACE.concat(0.45) }),
    thick: extend(CLEAR, {
      blur: 18, strength: 5, aberration: 1.5, reflection: 0.5, vividMix: 0.5, fill: SURFACE.concat(0.78)
    })
  };
  var FROST_BLUR = 12;      // PvotGlassDefaults.FrostBlur
  var LENS_THRESHOLD = 0.15;
  var PRESSED_FILL = [1, 1, 1, 0x26 / 255];

  // PvotGlassDefaults.style(intensity, base): solid at 0, frosted at 0.1, full glass at 1.
  function styleAt(base, i) {
    i = Math.max(0, Math.min(1, i));
    if (i <= 0) {
      return extend(base, {
        strength: 0, aberration: 0, edgeBlur: 0, vividSpread: 0, reflection: 0, glow: 0,
        darkGlow: 0, vividMix: 0, blur: 0, frostMix: 1, fill: SURFACE.concat(0.94), rim: 0.12
      });
    }
    var lens = i < LENS_THRESHOLD ? 0 : i;
    var frost = SURFACE.concat(0.7);
    var f = base.fill;
    return extend(base, {
      strength: base.strength * lens, aberration: base.aberration * lens,
      edgeBlur: base.edgeBlur * lens, vividSpread: base.vividSpread * lens,
      reflection: base.reflection * lens, glow: base.glow * lens, darkGlow: base.darkGlow * lens,
      vividMix: base.vividMix * lens, frostMix: 1 - i,
      fill: [
        frost[0] + (f[0] - frost[0]) * i, frost[1] + (f[1] - frost[1]) * i,
        frost[2] + (f[2] - frost[2]) * i, frost[3] + (f[3] - frost[3]) * i
      ],
      rim: base.rim * (0.4 + 0.6 * i)
    });
  }

  // PvotBackgroundDefaults.colors() of the dark Pvot palette, over PvotBackgroundDark.
  var DEFAULT_BLOBS = ['#3B2DB8', '#A8104F', '#8577FFB3', '#0F3FA8', '#3B2DB8CC'];
  var BLOB_SPEEDS = [3, -2, 4, -3, 2];
  var LOOP_MS = 30000;

  function hexToRgba(hex) {
    var h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255, a];
  }

  // ---------------------------------------------------------------------------------------------
  // Shaders

  var HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  var VS_QUAD = [
    'attribute vec2 aPos;',
    'uniform vec4 uQuad;', // x, y, w, h in pixels, from the top left
    'uniform vec2 uRes;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 px = uQuad.xy + aPos * uQuad.zw;',
    '  vUv = vec2(px.x / uRes.x, 1.0 - px.y / uRes.y);',
    '  vec2 clip = px / uRes * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  // PvotLiveBackground: soft blobs drifting over the base, then the painted layer on top.
  var FS_SCENE = HEAD + [
    'uniform vec2 uRes;',
    'uniform float uPhase;',
    'uniform float uLive;',
    'uniform float uDim;',
    'uniform vec3 uBase;',
    'uniform vec4 uC[5];',
    'uniform float uSpeed[5];',
    'uniform sampler2D uPaint;',
    'uniform float uTime;',
    'uniform float uSilk;',
    'uniform float uPx;',
    '',
    // Silk: a height field of slow, domain-warped waves, lit by one soft light. Its shadows take
    // the stage's first color, its sheen the third, and a touch of the second drifts through.
    'float silkH(vec2 u, float t) {',
    '  u += 0.42 * vec2(sin(u.y * 1.3 + t * 0.9), cos(u.x * 1.1 - t * 0.7));',
    '  u += 0.18 * vec2(sin(u.y * 2.7 - t * 0.5), cos(u.x * 2.3 + t * 0.4));',
    '  return sin(u.x * 1.9 + u.y * 0.9 + t * 0.35) * 0.62 + sin(-u.x * 0.8 + u.y * 2.1 - t * 0.25) * 0.38;',
    '}',
    'vec3 silk(vec2 p) {',
    '  vec2 u = p / (760.0 * uPx);',
    '  float t = uTime;',
    '  float e = 0.004;',
    '  float h = silkH(u, t);',
    '  float hx = silkH(u + vec2(e, 0.0), t) - h;',
    '  float hy = silkH(u + vec2(0.0, e), t) - h;',
    '  vec3 n = normalize(vec3(-hx / e * 0.9, -hy / e * 0.9, 1.0));',
    '  vec3 L = normalize(vec3(-0.45, -0.7, 0.62));',
    '  float diff = clamp(dot(n, L), 0.0, 1.0);',
    '  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 18.0);',
    '  float fold = smoothstep(0.05, 1.0, diff);',
    '  vec3 shade = uC[0].rgb * 1.05;',
    '  vec3 col = mix(uBase, shade, fold * 0.9);',
    '  float drift = 0.5 + 0.5 * sin(u.x * 0.9 - u.y * 0.6 + t * 0.3);',
    '  col = mix(col, uC[1].rgb * 0.8, fold * drift * 0.4);',
    '  col += uC[2].rgb * spec * 0.6;',
    // Fall to black toward the bottom and the edges, so type always sits on dark.
    '  vec2 q = p / uRes;',
    '  float vig = smoothstep(1.35, 0.15, length((q - vec2(0.55, 0.4)) * vec2(0.9, 1.15)));',
    '  return mix(uBase, col, vig * uDim);',
    '}',
    '',
    'void main() {',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec3 col = uBase;',
    '  if (uLive > 0.5 && uSilk > 0.5) {',
    '    col = silk(p);',
    '  } else if (uLive > 0.5) {',
    '    float R = min(uRes.x, uRes.y * 1.35);',
    '    for (int i = 0; i < 5; i++) {',
    '      float fi = float(i);',
    '      float a = uPhase * uSpeed[i] + fi * 1.3;',
    '      vec2 c = uRes * vec2(0.5 + 0.4 * cos(a), 0.5 + 0.4 * sin(a * 2.0 + fi));',
    '      float r = R * (0.45 + 0.08 * sin(uPhase * 2.0 + fi));',
    '      float t = length(p - c) / r;',
    '      float al = t < 0.5 ? mix(1.0, 0.6, t / 0.5) : mix(0.6, 0.0, (t - 0.5) / 0.5);',
    '      al = clamp(al, 0.0, 1.0) * uC[i].a * uDim;',
    '      col = mix(col, uC[i].rgb, al);',
    '    }',
    '  }',
    '  vec4 pt = texture2D(uPaint, p / uRes);',
    '  col = pt.rgb + col * (1.0 - pt.a);',
    '  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
    '  gl_FragColor = vec4(col + (n - 0.5) / 255.0, 1.0);',
    '}'
  ].join('\n');

  var FS_COPY = HEAD + [
    'uniform sampler2D uTex;',
    'varying vec2 vUv;',
    'void main() { gl_FragColor = texture2D(uTex, vUv); }'
  ].join('\n');

  // Box-filtered downsample: four bilinear taps cover a 4x4 block of the source.
  var FS_DOWN = HEAD + [
    'uniform sampler2D uTex;',
    'uniform vec2 uTexel;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 o = uTexel;',
    '  gl_FragColor = 0.25 * (texture2D(uTex, vUv + vec2(-o.x, -o.y)) + texture2D(uTex, vUv + vec2(o.x, -o.y))',
    '    + texture2D(uTex, vUv + vec2(-o.x, o.y)) + texture2D(uTex, vUv + vec2(o.x, o.y)));',
    '}'
  ].join('\n');

  // Nine-tap Gaussian in five bilinear fetches.
  var FS_BLUR = HEAD + [
    'uniform sampler2D uTex;',
    'uniform vec2 uDir;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUv) * 0.2270270270;',
    '  c += texture2D(uTex, vUv + uDir * 1.3846153846) * 0.3162162162;',
    '  c += texture2D(uTex, vUv - uDir * 1.3846153846) * 0.3162162162;',
    '  c += texture2D(uTex, vUv + uDir * 3.2307692308) * 0.0702702703;',
    '  c += texture2D(uTex, vUv - uDir * 3.2307692308) * 0.0702702703;',
    '  gl_FragColor = c;',
    '}'
  ].join('\n');

  // The lens, line for line from LENS_SHADER in PvotGlass.kt. content.eval() reads the frosted
  // backdrop, the pointer (or the phone's tilt) stands in for the fixed top-left light, and the
  // fill and the rim of light (pvotGlassRim) are drawn here rather than as separate layers.
  var FS_LENS = HEAD + [
    'uniform sampler2D uScene;',
    'uniform sampler2D uSoft;',
    'uniform sampler2D uFrost;',
    'uniform vec2 uRes;',
    'uniform vec4 uRect;',
    'uniform float uRadius;',
    'uniform float uBand;',
    'uniform float uStrength;',
    'uniform float uAberration;',
    'uniform float uEdgeBlur;',
    'uniform float uReflection;',
    'uniform float uMirrorScale;',
    'uniform float uGlow;',
    'uniform float uDarkGlow;',
    'uniform float uVividSpread;',
    'uniform float uVividMix;',
    'uniform float uBlur;',
    'uniform vec2 uSigma;',
    'uniform vec4 uFill;',
    'uniform vec2 uLight;',
    'uniform float uRim;',
    'uniform float uRimWidth;',
    'uniform float uLensOn;',
    '',
    'float roundRect(vec2 p, vec2 b, float r) {',
    '  vec2 q = abs(p) - b + r;',
    '  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    '',
    'vec4 content(vec2 at) {',
    '  vec2 uv = vec2(at.x / uRes.x, 1.0 - at.y / uRes.y);',
    '  vec4 s = texture2D(uScene, uv);',
    '  if (uBlur <= 0.001) return s;',
    '  vec4 l = texture2D(uSoft, uv);',
    '  if (uBlur <= uSigma.x) return mix(s, l, uBlur / uSigma.x);',
    '  vec4 h = texture2D(uFrost, uv);',
    '  return mix(l, h, clamp((uBlur - uSigma.x) / (uSigma.y - uSigma.x), 0.0, 1.0));',
    '}',
    '',
    'vec4 split(vec2 at, vec2 apart) {',
    '  vec4 c = content(at);',
    '  vec4 red = content(at + apart);',
    '  vec4 blue = content(at - apart);',
    '  return vec4(red.r, c.g, blue.b, max(c.a, max(red.a, blue.a)));',
    '}',
    '',
    'float vividness(vec4 c) {',
    '  float hi = max(c.r, max(c.g, c.b));',
    '  float lo = min(c.r, min(c.g, c.b));',
    '  return clamp((hi - lo) / max(hi, 0.25) * c.a, 0.0, 1.0);',
    '}',
    '',
    'vec4 lens(vec2 coord, vec2 p, vec2 hs) {',
    '  float bandRadius = max(uRadius, uBand);',
    '  float d = min(roundRect(p, hs, bandRadius), 0.0);',
    '  float t = clamp(1.0 + d / uBand, 0.0, 1.0);',
    '  if (uLensOn < 0.5 || t <= 0.0) return content(coord);',
    '  vec2 n = vec2(',
    '    roundRect(p + vec2(1.0, 0.0), hs, bandRadius) - roundRect(p - vec2(1.0, 0.0), hs, bandRadius),',
    '    roundRect(p + vec2(0.0, 1.0), hs, bandRadius) - roundRect(p - vec2(0.0, 1.0), hs, bandRadius));',
    '  n = n / max(length(n), 0.0001);',
    '  vec2 tangent = vec2(-n.y, n.x);',
    '  float ease = t * t;',
    '  float ramp = t * t * (3.0 - 2.0 * t);',
    '  vec2 apart = n * (uAberration * ease);',
    '',
    '  vec2 at = coord + n * (uStrength * ease);',
    '  float soft = uEdgeBlur * ramp;',
    '  vec4 bent = split(at, apart) * 0.4',
    '    + split(at + tangent * soft, apart) * 0.15',
    '    + split(at - tangent * soft, apart) * 0.15',
    '    + split(at + n * soft, apart) * 0.15',
    '    + split(at - n * soft, apart) * 0.15;',
    '',
    '  float inside = -d;',
    '  vec4 mirrored = split(coord + n * (inside * (1.0 + uMirrorScale)), apart);',
    '  vec4 c = mix(bent, mirrored, uReflection * ramp);',
    '',
    '  if (uVividMix > 0.0) {',
    '    float reach = uVividSpread * ramp;',
    '    float diag = reach * 0.7071;',
    '    vec4 around = (split(at + tangent * reach, apart)',
    '      + split(at - tangent * reach, apart)',
    '      + split(at + n * reach, apart)',
    '      + split(at - n * reach, apart)',
    '      + split(at + (n + tangent) * diag, apart)',
    '      + split(at + (n - tangent) * diag, apart)',
    '      + split(at - (n + tangent) * diag, apart)',
    '      + split(at - (n - tangent) * diag, apart)) * 0.125;',
    '    c = mix(c, around, clamp(uVividMix * ramp * vividness(around), 0.0, 1.0));',
    '  }',
    '',
    '  float facing = clamp(dot(n, uLight) * 0.5 + 0.5, 0.0, 1.0);',
    '  float seen = max(c.r, max(c.g, c.b));',
    '  float lift = mix(uDarkGlow, 1.0, smoothstep(0.0, 0.5, seen));',
    '  float light = uGlow * lift * pow(t, 2.5) * (0.45 + 0.55 * facing);',
    '  return vec4(light) + c * (1.0 - light);',
    '}',
    '',
    'void main() {',
    '  vec2 coord = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 hs = uRect.zw * 0.5;',
    '  vec2 p = coord - uRect.xy - hs;',
    '  float edge = roundRect(p, hs, uRadius);',
    '  float cover = clamp(0.5 - edge, 0.0, 1.0);',
    '  if (cover <= 0.0) discard;',
    '  vec4 c = lens(coord, p, hs);',
    '  c.rgb = uFill.rgb * uFill.a + c.rgb * (1.0 - uFill.a);',
    '  if (uRim > 0.0 && edge > -uRimWidth - 1.0) {',
    '    vec2 n = vec2(',
    '      roundRect(p + vec2(1.0, 0.0), hs, uRadius) - roundRect(p - vec2(1.0, 0.0), hs, uRadius),',
    '      roundRect(p + vec2(0.0, 1.0), hs, uRadius) - roundRect(p - vec2(0.0, 1.0), hs, uRadius));',
    '    n = n / max(length(n), 0.0001);',
    '    float f = clamp(dot(n, uLight) * 0.5 + 0.5, 0.0, 1.0);',
    '    float line = clamp(1.0 - abs(edge + uRimWidth * 0.5) / (uRimWidth * 0.5 + 0.5), 0.0, 1.0);',
    '    c.rgb = mix(c.rgb, vec3(1.0), uRim * line * mix(0.14, 0.85, f * f));',
    '  }',
    '  gl_FragColor = vec4(c.rgb, cover);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------------------------------------
  // GL helpers

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
    }
    return s;
  }

  function program(gl, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS_QUAD));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      var name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p: p, u: u };
  }

  function texture(gl, w, h) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  function target(gl, w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    var tex = texture(gl, w, h);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex: tex, fb: fb, w: w, h: h };
  }

  function dropTarget(gl, t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------------------------
  // Shared state: the light, the pointer and the global glass intensity.

  var api = {
    intensity: 1,
    stages: [],
    ready: false
  };
  var pointer = { x: -1e5, y: -1e5, active: false, at: 0 };
  var tilt = null;

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    pointer.at = performance.now();
  }, { passive: true });
  document.addEventListener('pointerleave', function () { pointer.active = false; });

  // TiltLight, as on the phone: where the browser hands out orientation without asking.
  if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', function (e) {
      if (e.beta == null || e.gamma == null) return;
      var x = -0.6 + e.gamma / 50;
      var y = -0.6 + (e.beta - 50) / 50;
      var l = Math.hypot(x, y) || 1;
      tilt = [x / l, y / l];
    }, { passive: true });
  }

  // ---------------------------------------------------------------------------------------------
  // A stage: one canvas behind one section.

  function Stage(el) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    el.insertBefore(this.canvas, el.firstChild);

    var gl = this.canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;

    this.progScene = program(gl, FS_SCENE);
    this.progCopy = program(gl, FS_COPY);
    this.progDown = program(gl, FS_DOWN);
    this.progBlur = program(gl, FS_BLUR);
    this.progLens = program(gl, FS_LENS);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.paintCanvas = document.createElement('canvas');
    this.ctx = this.paintCanvas.getContext('2d');
    this.paintTex = texture(gl, 0, 0);
    this.paintDirty = true;
    this.paintRegions = [];
    this.paintUntil = 0;

    this.readConfig();
    this.visible = false;
    this.w = 0;
    this.h = 0;
    this.lost = false;

    var self = this;
    this.canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      self.lost = true;
      el.classList.remove('is-live');
    });

    // Painted things that are mid-animation or mid-transition get repainted every frame.
    this.moving = new Map();
    var painted = function (t) {
      if (!t || t.nodeType !== 1) return [];
      if (t.hasAttribute('data-paint')) return [t];
      return Array.prototype.slice.call(t.querySelectorAll('[data-paint]'));
    };
    var start = function (e) {
      painted(e.target).forEach(function (p) { self.moving.set(p, (self.moving.get(p) || 0) + 1); });
    };
    var stop = function (e) {
      painted(e.target).forEach(function (p) {
        var n = (self.moving.get(p) || 1) - 1;
        if (n <= 0) self.moving.delete(p); else self.moving.set(p, n);
        self.invalidate(p);
      });
    };
    el.addEventListener('animationstart', start);
    el.addEventListener('animationend', stop);
    el.addEventListener('animationcancel', stop);
    el.addEventListener('transitionrun', start);
    el.addEventListener('transitionend', stop);
    el.addEventListener('transitioncancel', stop);

    // Animations that began before this script ran (the hero's entrance) are tracked too.
    if (el.getAnimations) {
      el.getAnimations({ subtree: true }).forEach(function (a) {
        var t = a.effect && a.effect.target;
        if (!painted(t).length) return;
        start({ target: t });
        a.finished.then(function () { stop({ target: t }); }, function () { stop({ target: t }); });
      });
    }

    this.ro = new ResizeObserver(function () { self.resize(); });
    this.ro.observe(el);
    this.io = new IntersectionObserver(function (entries) {
      self.visible = entries[0].isIntersecting;
    }, { rootMargin: '120px 0px' });
    this.io.observe(el);

    this.collect();
    this.resize();
  }

  Stage.prototype.readConfig = function () {
    var d = this.el.dataset;
    this.live = 'live' in d;
    // data-bg="drift" keeps PvotLiveBackground's blobs; silk is the default.
    this.silk = d.bg !== 'drift';
    var blobs = (d.blobs ? d.blobs.split(',') : DEFAULT_BLOBS).map(hexToRgba);
    while (blobs.length < 5) blobs.push(blobs[blobs.length % Math.max(1, blobs.length)] || [0, 0, 0, 0]);
    this.blobs = blobs.slice(0, 5);
    this.base = hexToRgba(d.base || '#000000');
    this.seed = parseFloat(d.seed || '0');
    this.dim = parseFloat(d.dim || '1');
  };

  Stage.prototype.collect = function () {
    this.glasses = Array.prototype.slice.call(this.el.querySelectorAll('[data-glass]')).map(function (el) {
      return el._glass || (el._glass = {
        el: el, lift: 0, liftTarget: 0, light: [-0.7071, -0.7071], radius: null, params: null
      });
    });
    this.paints = Array.prototype.slice.call(this.el.querySelectorAll('[data-paint]'));
    this.paintDirty = true;
  };

  Stage.prototype.resize = function () {
    var gl = this.gl;
    var cssW = this.el.clientWidth, cssH = this.el.clientHeight;
    if (!cssW || !cssH) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Keep the scene to about four megapixels, however tall the section.
    var budget = 4.2e6;
    if (cssW * cssH * dpr * dpr > budget) dpr = Math.max(1, Math.sqrt(budget / (cssW * cssH)));
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    var max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (w > max || h > max) {
      var s = max / Math.max(w, h);
      w = Math.floor(w * s); h = Math.floor(h * s); dpr *= s;
    }
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.dpr = dpr; this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = w; this.canvas.height = h;

    // Blur pyramid: a soft level of about 4px and a frost level of about 11px, in CSS pixels.
    this.softFactor = Math.max(2, Math.round(2 * dpr));
    this.frostFactor = Math.max(4, Math.round(4 * dpr));
    this.sigma = [2 * this.softFactor, 2.83 * this.frostFactor];

    [this.scene, this.soft, this.softTmp, this.frost, this.frostTmp].forEach(function (t) { dropTarget(gl, t); });
    this.scene = target(gl, w, h);
    this.soft = target(gl, w / this.softFactor, h / this.softFactor);
    this.softTmp = target(gl, w / this.softFactor, h / this.softFactor);
    this.frost = target(gl, w / this.frostFactor, h / this.frostFactor);
    this.frostTmp = target(gl, w / this.frostFactor, h / this.frostFactor);

    this.paintCanvas.width = w;
    this.paintCanvas.height = h;
    this.paintDirty = true;
    this.paintRegions.length = 0;
    this.glasses.forEach(function (g) { g.radius = null; });
  };

  // ----- painting --------------------------------------------------------------------------------

  Stage.prototype.paintItem = function (el, base) {
    var ctx = this.ctx;
    if (el.closest('[hidden]') || !el.getClientRects().length) return null;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    var kind = el.dataset.paint || 'text';
    var alpha = parseFloat(cs.opacity);
    var p = el.parentElement;
    while (p && p !== this.el) { alpha *= parseFloat(getComputedStyle(p).opacity); p = p.parentElement; }
    if (alpha <= 0.001) return null;
    ctx.globalAlpha = alpha;

    if (kind === 'box') {
      var r = el.getBoundingClientRect();
      var fill = cs.getPropertyValue('--fill').trim() || cs.backgroundColor;
      var rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
      ctx.fillStyle = fill;
      roundRectPath(ctx, r.left - base.left, r.top - base.top, r.width, r.height, rad);
      ctx.fill();
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    }

    var text = el.textContent.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    var range = document.createRange();
    range.selectNodeContents(el);
    var rr = range.getClientRects()[0] || el.getBoundingClientRect();
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var spacing = parseFloat(cs.letterSpacing) || 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
    ctx.fillStyle = cs.color;
    ctx.textBaseline = 'alphabetic';
    var m = ctx.measureText(text);
    var asc = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : parseFloat(cs.fontSize) * 0.92;
    var x = rr.left - base.left, y = rr.top - base.top + asc;
    if ('letterSpacing' in ctx || !spacing) {
      ctx.fillText(text, x, y);
    } else {
      for (var i = 0; i < text.length; i++) {
        ctx.fillText(text[i], x, y);
        x += ctx.measureText(text[i]).width + spacing;
      }
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    var br = el.getBoundingClientRect();
    return { x: Math.min(br.left, rr.left) - base.left - 8, y: br.top - base.top - 8, w: Math.max(br.width, rr.width) + 16, h: br.height + 16 };
  };

  Stage.prototype.repaint = function () {
    var ctx = this.ctx, s = this.w / this.cssW;
    var base = this.canvas.getBoundingClientRect();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    for (var i = 0; i < this.paints.length; i++) {
      this.paints[i]._paintRect = this.paintItem(this.paints[i], base);
    }
    ctx.globalAlpha = 1;
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.paintTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.paintCanvas);
  };

  // Repaints only where something changed, and uploads only that part.
  Stage.prototype.repaintRegion = function (rects) {
    var s = this.w / this.cssW, base = this.canvas.getBoundingClientRect();
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach(function (r) {
      if (!r) return;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    if (!isFinite(x0)) return;
    var px = Math.max(0, Math.floor((x0 - 2) * s)), py = Math.max(0, Math.floor((y0 - 2) * s));
    var pw = Math.min(this.w, Math.ceil((x1 + 2) * s)) - px, ph = Math.min(this.h, Math.ceil((y1 + 2) * s)) - py;
    if (pw <= 0 || ph <= 0) return;
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.clearRect(px, py, pw, ph);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    var cx0 = px / s, cy0 = py / s, cx1 = (px + pw) / s, cy1 = (py + ph) / s;
    for (var i = 0; i < this.paints.length; i++) {
      var el = this.paints[i];
      var r = el.getBoundingClientRect();
      var rx = r.left - base.left, ry = r.top - base.top;
      if (rx > cx1 + 20 || ry > cy1 + 20 || rx + r.width < cx0 - 20 || ry + r.height < cy0 - 20) continue;
      el._paintRect = this.paintItem(el, base);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    var data = ctx.getImageData(px, py, pw, ph);
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.paintTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, data);
  };

  Stage.prototype.invalidate = function (el) {
    if (!el) { this.paintDirty = true; return; }
    var before = el._paintRect;
    var r = el.getBoundingClientRect(), base = this.canvas.getBoundingClientRect();
    this.paintRegions.push(before, { x: r.left - base.left - 8, y: r.top - base.top - 8, w: r.width + 16, h: r.height + 16 });
  };

  // ----- drawing ---------------------------------------------------------------------------------

  Stage.prototype.draw = function (gl, prog, quad, res) {
    gl.uniform4f(prog.u.uQuad, quad[0], quad[1], quad[2], quad[3]);
    gl.uniform2f(prog.u.uRes, res[0], res[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  Stage.prototype.pass = function (prog, src, dst, setup) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(prog.u.uTex, 0);
    if (setup) setup(prog.u);
    this.draw(gl, prog, [0, 0, dst.w, dst.h], [dst.w, dst.h]);
  };

  Stage.prototype.blur = function (t, tmp, times) {
    var gl = this.gl, self = this;
    for (var i = 0; i < times; i++) {
      this.pass(this.progBlur, t, tmp, function (u) { gl.uniform2f(u.uDir, 1 / t.w, 0); });
      this.pass(this.progBlur, tmp, t, function (u) { gl.uniform2f(u.uDir, 0, 1 / t.h); });
    }
    return self;
  };

  Stage.prototype.render = function (now) {
    if (this.lost || !this.w) return;
    var gl = this.gl;

    if (this.moving.size) {
      var me = this;
      this.moving.forEach(function (_, p) { me.invalidate(p); });
    }
    if (this.paintDirty || now < this.paintUntil) {
      this.paintDirty = false;
      this.paintRegions.length = 0;
      this.repaint();
    } else if (this.paintRegions.length) {
      this.repaintRegion(this.paintRegions);
      this.paintRegions.length = 0;
    }

    // 1. The backdrop.
    var phase = this.seed + (reduceMotion ? 0 : (now % LOOP_MS) / LOOP_MS * Math.PI * 2);
    var ps = this.progScene;
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(ps.p);
    gl.uniform1f(ps.u.uPhase, phase);
    gl.uniform1f(ps.u.uLive, this.live ? 1 : 0);
    gl.uniform1f(ps.u.uDim, this.dim);
    gl.uniform1f(ps.u.uSilk, this.silk ? 1 : 0);
    gl.uniform1f(ps.u.uPx, this.dpr);
    gl.uniform1f(ps.u.uTime, this.seed * 7 + (reduceMotion ? 0 : now / 1000 * 0.11));
    gl.uniform3f(ps.u.uBase, this.base[0], this.base[1], this.base[2]);
    var flat = [];
    this.blobs.forEach(function (c) { flat.push(c[0], c[1], c[2], c[3]); });
    gl.uniform4fv(ps.u.uC, flat);
    gl.uniform1fv(ps.u.uSpeed, BLOB_SPEEDS);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paintTex);
    gl.uniform1i(ps.u.uPaint, 0);
    this.draw(gl, ps, [0, 0, this.w, this.h], [this.w, this.h]);

    // 2. Its frost, only when there is glass to look through it.
    var glasses = this.measure(now);
    if (glasses.length) {
      var self = this;
      this.pass(this.progDown, this.scene, this.soft, function (u) {
        gl.uniform2f(u.uTexel, self.softFactor * 0.25 / self.w, self.softFactor * 0.25 / self.h);
      });
      this.blur(this.soft, this.softTmp, 1);
      this.pass(this.progDown, this.soft, this.frost, function (u) {
        gl.uniform2f(u.uTexel, 0.5 / self.soft.w, 0.5 / self.soft.h);
      });
      this.blur(this.frost, this.frostTmp, 2);
    }

    // 3. The backdrop on screen, then each glass over it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    this.pass(this.progCopy, this.scene, { fb: null, w: this.w, h: this.h });
    if (!glasses.length) return;

    var pl = this.progLens, u = pl.u;
    gl.useProgram(pl.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.soft.tex); gl.uniform1i(u.uSoft, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.frost.tex); gl.uniform1i(u.uFrost, 2);
    gl.uniform2f(u.uSigma, this.sigma[0], this.sigma[1]);

    for (var i = 0; i < glasses.length; i++) {
      var g = glasses[i], st = g.style, k = g.k;
      gl.uniform4f(u.uRect, g.x, g.y, g.w, g.h);
      gl.uniform1f(u.uRadius, g.r);
      gl.uniform1f(u.uBand, Math.max(0.5, st.band * k));
      gl.uniform1f(u.uStrength, st.strength * k);
      gl.uniform1f(u.uAberration, st.aberration * k);
      gl.uniform1f(u.uEdgeBlur, st.edgeBlur * k);
      gl.uniform1f(u.uReflection, st.reflection);
      gl.uniform1f(u.uMirrorScale, st.mirrorScale);
      gl.uniform1f(u.uGlow, st.glow);
      gl.uniform1f(u.uDarkGlow, st.darkGlow);
      gl.uniform1f(u.uVividSpread, st.vividSpread * k);
      gl.uniform1f(u.uVividMix, st.vividMix);
      var blurPx = st.blur * k + (FROST_BLUR * this.dpr - st.blur * k) * (st.frostMix || 0);
      if (st.blur <= 0 && !st.frostMix) blurPx = 0;
      if (st.solid) blurPx = 0;
      gl.uniform1f(u.uBlur, Math.min(blurPx, this.sigma[1]));
      gl.uniform4f(u.uFill, st.fill[0], st.fill[1], st.fill[2], st.fill[3]);
      gl.uniform2f(u.uLight, g.light[0], g.light[1]);
      gl.uniform1f(u.uRim, st.rim);
      gl.uniform1f(u.uRimWidth, Math.max(1, this.dpr));
      gl.uniform1f(u.uLensOn, st.strength > 0 || st.reflection > 0 || st.glow > 0 ? 1 : 0);
      this.draw(gl, pl, [g.x - 1, g.y - 1, g.w + 2, g.h + 2], [this.w, this.h]);
    }
    gl.disable(gl.BLEND);
  };

  // Where each glass is this frame, in canvas pixels, and how it looks.
  Stage.prototype.measure = function (now) {
    var out = [];
    if (!this.glasses.length) return out;
    var base = this.canvas.getBoundingClientRect();
    var s = this.w / this.cssW;
    var usePointer = pointer.active && now - pointer.at < 6000;
    for (var i = 0; i < this.glasses.length; i++) {
      var g = this.glasses[i], el = g.el;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[hidden]')) continue;
      if (r.bottom < base.top || r.top > base.bottom) continue;
      if (g.radius == null || g.radiusFor !== r.width + 'x' + r.height) {
        var cs = getComputedStyle(el);
        g.radiusCss = parseFloat(cs.borderTopLeftRadius) || 0;
        g.radiusFor = r.width + 'x' + r.height;
        // CSS radius is of the untransformed box; held glass is scaled up by its transform.
        var sw = el.offsetWidth ? r.width / el.offsetWidth : 1;
        g.radius = g.radiusCss * sw;
      }

      // Lift: held glass eases into a clear lens, then settles back.
      g.lift += (g.liftTarget - g.lift) * 0.22;

      var mat = MATERIALS[el.dataset.glass] || CLEAR;
      var params = g.params ? extend(mat, g.params) : mat;
      // Per-element tweaks in markup: data-glass-blur="1", data-glass-strength="14", ...
      var ds = el.dataset, over = null;
      ['blur', 'strength', 'aberration', 'reflection', 'glow'].forEach(function (k) {
        var v = ds['glass' + k[0].toUpperCase() + k.slice(1)];
        if (v != null && !(g.params && k in g.params)) { over = over || {}; over[k] = parseFloat(v); }
      });
      if (over) params = extend(params, over);
      var style = styleAt(params, el.hasAttribute('data-glass-fixed') ? 1 : api.intensity);
      if (el.dataset.glassRest) {
        // A control that rests opaque (a switch's knob) and turns to glass while held.
        var rest = hexToRgba(el.dataset.glassRest);
        var f = style.fill, t = g.lift;
        style.fill = [rest[0] + (f[0] - rest[0]) * t, rest[1] + (f[1] - rest[1]) * t,
          rest[2] + (f[2] - rest[2]) * t, rest[3] + (f[3] - rest[3]) * t];
      } else if (g.lift > 0.01 && el.hasAttribute('data-glass-press')) {
        var pf = style.fill, tt = g.lift;
        style.fill = [pf[0] + (PRESSED_FILL[0] - pf[0]) * tt, pf[1] + (PRESSED_FILL[1] - pf[1]) * tt,
          pf[2] + (PRESSED_FILL[2] - pf[2]) * tt, Math.max(pf[3], PRESSED_FILL[3] * tt)];
      }
      if (g.lift > 0.01) style.strength *= 1 + 0.35 * g.lift;

      var x = (r.left - base.left) * s, y = (r.top - base.top) * s, w = r.width * s, h = r.height * s;
      var minSide = Math.min(w, h);
      var refPx = (parseFloat(el.dataset.glassRef) || params.ref || 46) * this.dpr;

      // The light: toward the pointer, or the tilt, or the top left.
      var want = tilt || [-0.7071, -0.7071];
      if (usePointer) {
        var dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2);
        var dl = Math.hypot(dx, dy);
        if (dl > 1) want = [dx / dl, dy / dl];
      }
      g.light[0] += (want[0] - g.light[0]) * 0.12;
      g.light[1] += (want[1] - g.light[1]) * 0.12;
      var ll = Math.hypot(g.light[0], g.light[1]) || 1;

      out.push({
        x: x, y: y, w: w, h: h,
        r: Math.min(g.radius * s, minSide / 2),
        k: (minSide / refPx) * this.dpr,
        style: style,
        light: [g.light[0] / ll, g.light[1] / ll]
      });
    }
    return out;
  };

  // ---------------------------------------------------------------------------------------------
  // Holding and dragging glass.

  function bindLift(root) {
    root.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('[data-glass-lift], [data-glass-press]');
      var host = e.target.closest('[data-lift-host]');
      if (host && !el) el = host.querySelector('[data-glass-lift]');
      if (!el || !el._glass) return;
      el._glass.liftTarget = 1;
      el.classList.add('is-held');
      var up = function () {
        el._glass.liftTarget = 0;
        el.classList.remove('is-held');
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function bindDrag(stage) {
    Array.prototype.forEach.call(stage.el.querySelectorAll('[data-drag]'), function (el) {
      var pos = { x: 0, y: 0 }, start = null;
      el._drag = pos;
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el._touched = true;
        start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
        el.classList.add('is-dragging');
      });
      el.addEventListener('pointermove', function (e) {
        if (!start) return;
        var b = stage.el.getBoundingClientRect();
        var nx = e.clientX - start.x, ny = e.clientY - start.y;
        // Keep the glass inside its section.
        var r = el.getBoundingClientRect();
        var left = r.left - pos.x, top = r.top - pos.y;
        nx = Math.max(b.left - left - r.width * 0.35, Math.min(b.right - left - r.width * 0.65, nx));
        ny = Math.max(b.top - top - r.height * 0.35, Math.min(b.bottom - top - r.height * 0.65, ny));
        pos.x = nx; pos.y = ny;
        el.style.setProperty('--dx', nx + 'px');
        el.style.setProperty('--dy', ny + 'px');
      });
      var end = function () { start = null; el.classList.remove('is-dragging'); };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 40 : 12;
        var k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!k) return;
        e.preventDefault();
        el._touched = true;
        pos.x += k[0]; pos.y += k[1];
        el.style.setProperty('--dx', pos.x + 'px');
        el.style.setProperty('--dy', pos.y + 'px');
      });
    });
  }

  // Before anyone touches it, the hero glass drifts slowly across the headline.
  function idle(stage, now) {
    if (reduceMotion) return;
    Array.prototype.forEach.call(stage.el.querySelectorAll('[data-drag][data-idle]'), function (el) {
      if (el._touched || el._introing) return;
      var t = (now - (el._idleStart || 0)) / 1000;
      var ax = parseFloat(el.dataset.idleX || '0.22') * stage.cssW;
      var ay = parseFloat(el.dataset.idleY || '0.06') * stage.cssH;
      var x = Math.sin(t * 0.32) * ax, y = Math.sin(t * 0.57) * ay;
      el._drag.x = x; el._drag.y = y;
      el.style.setProperty('--dx', x + 'px');
      el.style.setProperty('--dy', y + 'px');
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Boot

  function boot() {
    var els = document.querySelectorAll('[data-stage]');
    if (!els.length) return;
    var probe = document.createElement('canvas');
    if (!(probe.getContext('webgl'))) {
      document.documentElement.classList.add('no-glass');
      return;
    }
    Array.prototype.forEach.call(els, function (el) {
      try {
        var st = new Stage(el);
        api.stages.push(st);
        bindDrag(st);
      } catch (err) {
        if (window.console) console.warn('[pvot-glass]', err);
      }
    });
    bindLift(document);

    var fontsSettled = function () { api.stages.forEach(function (s) { s.paintDirty = true; }); };
    if (document.fonts) {
      document.fonts.ready.then(fontsSettled);
      document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', fontsSettled);
    }

    function frame(now) {
      if (!document.hidden) {
        for (var i = 0; i < api.stages.length; i++) {
          var s = api.stages[i];
          if (!s.visible) continue;
          idle(s, now);
          s.render(now);
          if (!s.shown) {
            s.shown = true;
            s.el.classList.add('is-live');
          }
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    api.ready = true;
    document.documentElement.classList.add('has-glass');
  }

  function stageOf(el) {
    for (var i = 0; i < api.stages.length; i++) if (api.stages[i].el.contains(el)) return api.stages[i];
    return null;
  }

  api.setIntensity = function (v) { api.intensity = Math.max(0, Math.min(1, v)); };
  api.setParams = function (el, params) {
    var s = stageOf(el);
    if (!el._glass && s) s.collect();
    if (el._glass) el._glass.params = params;
  };
  api.invalidate = function (el) { var s = stageOf(el); if (s) s.invalidate(el); };
  api.repaintFor = function (el, ms) {
    var s = stageOf(el);
    if (s) s.paintUntil = Math.max(s.paintUntil, performance.now() + (ms || 0));
  };
  api.refresh = function (el) {
    api.stages.forEach(function (s) { if (!el || s.el.contains(el)) s.collect(); });
  };
  window.PvotGlass = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
