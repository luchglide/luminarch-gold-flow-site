/* LuminArch gold flow field
   Method from ThreeUI Community AtTheHorizon:
   bake a grayscale plate (traced filaments + density),
   then render it through a directional coherent dither.
   Plate is LuminArch's arch mark. Grain is gold. Not MengTo's art. */
(function () {
  "use strict";

  var view = document.getElementById("field");
  if (!view) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var visible = true;
  var running = true;

  var S = 1280;
  var N = 80;
  var DRIFT = 3.6;
  var DRIFTMAX = 8.0;
  var COH = 0.97;
  var STRETCH = 2.6;
  var GWIDTH = 2.0;
  var LIFE = 3.4;
  var BLEND = 1.0;
  var FPS = 25;
  var LOCKS = 54;
  var STEP = 2.7;
  var MAXS = 420;

  var FCOS = new Float32Array(N * N);
  var FSIN = new Float32Array(N * N);
  var FD = new Float32Array(N * N);
  var DMAX = 0.001;

  var BW = S;
  var BH = S;
  var OX = 0;
  var OY = 0;
  var STRANDS = [];

  var base = document.createElement("canvas");
  var hairCv = document.createElement("canvas");
  var dirCv = document.createElement("canvas");
  var bctx = base.getContext("2d", { willReadFrequently: true });
  var hctx = hairCv.getContext("2d", { willReadFrequently: true });
  var dctx = dirCv.getContext("2d", { willReadFrequently: true });

  var gl = view.getContext("webgl", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  var fallback = gl ? null : view.getContext("2d", { alpha: false });
  var prog = null;
  var tex = null;
  var uni = {};
  var seed = 1;
  var timeTick = 0;
  var lastDraw = 0;
  var raf = 0;
  var rebuildTimer = 0;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var NT = 256;
  var NTM = NT - 1;
  var NOISE = (function () {
    var r = mulberry32(9187341);
    var a = new Float32Array(NT * NT);
    for (var i = 0; i < NT * NT; i++) a[i] = r();
    return a;
  })();

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function vnoise(x, y) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var xf = x - xi;
    var yf = y - yi;
    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);
    var i0 = xi & NTM;
    var j0 = yi & NTM;
    var i1 = (xi + 1) & NTM;
    var j1 = (yi + 1) & NTM;
    var a = NOISE[j0 * NT + i0];
    var b = NOISE[j0 * NT + i1];
    var c = NOISE[j1 * NT + i0];
    var d = NOISE[j1 * NT + i1];
    return a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v;
  }

  function fbm(x, y, oct) {
    var v = 0;
    var amp = 0.5;
    var f = 1;
    for (var i = 0; i < (oct || 4); i++) {
      v += amp * vnoise(x * f + i * 37.3, y * f + i * 61.7);
      f *= 2;
      amp *= 0.5;
    }
    return v;
  }

  function fsample(arr, x, y) {
    var fx = (x / S) * N - 0.5;
    var fy = (y / S) * N - 0.5;
    var x0 = Math.floor(fx);
    var y0 = Math.floor(fy);
    var tx = fx - x0;
    var ty = fy - y0;
    var i0 = clamp(x0, 0, N - 1);
    var j0 = clamp(y0, 0, N - 1);
    var i1 = clamp(x0 + 1, 0, N - 1);
    var j1 = clamp(y0 + 1, 0, N - 1);
    var a = arr[j0 * N + i0];
    var b = arr[j0 * N + i1];
    var c = arr[j1 * N + i0];
    var d = arr[j1 * N + i1];
    return a + (b - a) * tx + (c + (d - c) * tx - (a + (b - a) * tx)) * ty;
  }

  function density(x, y) {
    return fsample(FD, x, y);
  }

  function flowAngle(x, y) {
    return Math.atan2(fsample(FSIN, x, y), fsample(FCOS, x, y)) * 0.5;
  }

  function markTransform(ctx, w, h) {
    var scale = Math.min(w, h) * 0.72;
    var ox = (w - scale) / 2;
    var oy = (h - scale * (360 / 400)) / 2 - h * 0.02;
    ctx.translate(ox, oy);
    ctx.scale(scale / 400, scale / 400);
  }

  function strokeMark(ctx, widthScale, alpha) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255," + alpha + ")";

    function rect(x, y, w, h, r, sw) {
      ctx.lineWidth = sw * widthScale;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
      ctx.stroke();
    }

    function path(d, sw) {
      ctx.lineWidth = sw * widthScale;
      ctx.stroke(new Path2D(d));
    }

    rect(60, 20, 280, 340, 2, 2.5);
    rect(80, 40, 240, 300, 2, 1.8);
    path("M100 340 L100 160 Q100 80 200 20 Q300 80 300 160 L300 340", 2.5);
    path("M125 340 L125 175 Q125 105 200 50 Q275 105 275 175 L275 340", 1.8);
    path("M150 340 L150 190 Q150 130 200 80 Q250 130 250 190 L250 340", 1.5);
    path("M170 340 L170 210 Q170 155 200 115 Q230 155 230 210 L230 340", 1.2);
    ctx.lineWidth = 1.2 * widthScale;
    ctx.beginPath();
    ctx.moveTo(100, 200);
    ctx.lineTo(150, 200);
    ctx.moveTo(250, 200);
    ctx.lineTo(300, 200);
    ctx.stroke();
    ctx.lineWidth = 1.0 * widthScale;
    ctx.beginPath();
    ctx.moveTo(100, 260);
    ctx.lineTo(150, 260);
    ctx.moveTo(250, 260);
    ctx.lineTo(300, 260);
    ctx.stroke();
    path("M155 170 L155 290 L195 290", 5);
    path("M210 290 L235 170 L260 290 M216 265 L254 265", 5);
    ctx.restore();
  }

  function bakeDensity() {
    var src = document.createElement("canvas");
    src.width = S;
    src.height = S;
    var c = src.getContext("2d", { willReadFrequently: true });
    c.fillStyle = "#000";
    c.fillRect(0, 0, S, S);

    c.save();
    markTransform(c, S, S);
    c.filter = "blur(4.5px)";
    strokeMark(c, 2.4, 0.42);
    c.filter = "blur(1.1px)";
    strokeMark(c, 1.6, 0.8);
    c.filter = "none";
    strokeMark(c, 1.05, 1);
    c.restore();

    var img = c.getImageData(0, 0, S, S).data;
    var cell = S / N;
    DMAX = 0.001;
    var y;
    var x;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        var sx0 = Math.floor(x * cell);
        var sy0 = Math.floor(y * cell);
        var sx1 = Math.min(S, Math.floor((x + 1) * cell));
        var sy1 = Math.min(S, Math.floor((y + 1) * cell));
        var sum = 0;
        var count = 0;
        var yy;
        var xx;
        for (yy = sy0; yy < sy1; yy += 2) {
          for (xx = sx0; xx < sx1; xx += 2) {
            sum += img[(yy * S + xx) << 2];
            count++;
          }
        }
        var den = count ? sum / count / 255 : 0;
        FD[y * N + x] = den;
        if (den > DMAX) DMAX = den;
      }
    }

    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        var x0 = clamp(x - 1, 0, N - 1);
        var x1 = clamp(x + 1, 0, N - 1);
        var y0 = clamp(y - 1, 0, N - 1);
        var y1 = clamp(y + 1, 0, N - 1);
        var gx = FD[y * N + x1] - FD[y * N + x0];
        var gy = FD[y1 * N + x] - FD[y0 * N + x];
        var nx = x / (N - 1);
        var ny = y / (N - 1);
        var cx = (nx - 0.5) * 1.15;
        var cy = ny - 0.38;
        var arch = Math.atan2(cy, cx) + Math.PI * 0.5;
        var n1 = fbm(nx * 2.1, ny * 2.1, 4);
        var n2 = fbm(nx * 2.1 + 18, ny * 2.1 + 7, 4);
        var swirl = Math.atan2(n2 - 0.5, n1 - 0.5);
        var gl = Math.hypot(gx, gy);
        var tang = gl > 1e-5 ? Math.atan2(gx, -gy) : arch;
        var mass = clamp(FD[y * N + x] / Math.max(DMAX, 0.08), 0, 1);
        var ang = tang;
        ang += (arch - ang) * (0.18 + 0.22 * (1 - mass));
        ang += (swirl - ang) * (0.12 + 0.18 * (1 - mass));
        if (ny > 0.78) ang += (0 - ang) * 0.35;
        var dx = Math.cos(ang);
        var dy = Math.sin(ang);
        if (dx < 0) {
          dx = -dx;
          dy = -dy;
        }
        var a = Math.atan2(dy, dx);
        FCOS[y * N + x] = Math.cos(2 * a);
        FSIN[y * N + x] = Math.sin(2 * a);
      }
    }
  }

  function buildStrands() {
    var mobile = Math.min(window.innerWidth, window.innerHeight) < 720;
    var locks = mobile ? 34 : LOCKS;
    var rnd = mulberry32(20260822);
    var out = [];
    var guard = 0;
    while (guard < 1600000) {
      guard++;
      if (out.length >= locks * 7) break;
      var sx = rnd() * S;
      var sy = rnd() * S * 0.9;
      var d = density(sx, sy);
      if (d < 0.028) continue;
      if (rnd() > Math.max(0.22, Math.pow(d / DMAX, 0.5))) continue;
      var jit = rnd() * 997;
      var wig = 0.05 + rnd() * 0.16;
      var bias = (rnd() - 0.5) * 0.12;
      var cb = Math.cos(bias);
      var sb = Math.sin(bias);
      var arms = [[], []];
      var dir;
      for (dir = 0; dir < 2; dir++) {
        var x = sx;
        var y = sy;
        var sgn = dir ? -1 : 1;
        var a = arms[dir];
        var s;
        for (s = 0; s < MAXS; s++) {
          a.push(x, y);
          var th = flowAngle(x, y);
          var dx = Math.cos(th);
          var dy = Math.sin(th);
          if (dx < 0) {
            dx = -dx;
            dy = -dy;
          }
          var ax = dx * cb - dy * sb;
          var ay = dx * sb + dy * cb;
          var w = (fbm(x * 0.0055 + jit, y * 0.0055 + jit, 3) - 0.5) * wig;
          var ct = Math.cos(w);
          var st = Math.sin(w);
          x += (ax * ct - ay * st) * STEP * sgn;
          y += (ax * st + ay * ct) * STEP * sgn;
          if (x < -40 || x > S + 40 || y < -40 || y > S + 40) break;
          if (density(x, y) < 0.004) break;
        }
      }
      var back = arms[1];
      var fwd = arms[0];
      var g = [];
      var i;
      for (i = back.length - 2; i >= 0; i -= 2) g.push(back[i], back[i + 1]);
      for (i = 2; i < fwd.length; i += 2) g.push(fwd[i], fwd[i + 1]);
      var gn = g.length >> 1;
      if (gn < 14) continue;
      var nxs = new Float32Array(gn);
      var nys = new Float32Array(gn);
      for (i = 0; i < gn; i++) {
        var ia = Math.max(0, i - 1);
        var ib = Math.min(gn - 1, i + 1);
        var tx = g[ib * 2] - g[ia * 2];
        var ty = g[ib * 2 + 1] - g[ia * 2 + 1];
        var L = Math.hypot(tx, ty) || 1;
        nxs[i] = -ty / L;
        nys[i] = tx / L;
      }
      var m = 3 + ((rnd() * 8) | 0);
      var spread = 2.4 + rnd() * 4.0;
      var drift = (rnd() - 0.5) * 0.02;
      var f;
      for (f = 0; f < m; f++) {
        var baseOff = (f - (m - 1) / 2) * spread + (rnd() - 0.5) * 1.5;
        var ph = rnd() * 99;
        var amp = 0.28 + rnd() * 0.8;
        var pts = new Float64Array(gn * 2);
        for (i = 0; i < gn; i++) {
          var o = baseOff * (1 + amp * (fbm(i * 0.035 + ph, ph * 0.7, 2) - 0.5)) + drift * i;
          pts[i * 2] = g[i * 2] + nxs[i] * o;
          pts[i * 2 + 1] = g[i * 2 + 1] + nys[i] * o;
        }
        out.push({
          p: pts,
          k: 0.28 + rnd() * rnd() * 2.6,
          w: 1.05 + rnd() * 1.2,
          seed: rnd() * 1000,
        });
      }
    }
    return out;
  }

  function strokeStrands(ctx, strands, style) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    var CH = 5;
    var si;
    for (si = 0; si < strands.length; si++) {
      var st = strands[si];
      var p = st.p;
      var n = p.length >> 1;
      var i;
      for (i = 0; i < n - 1; i += CH) {
        var j = Math.min(i + CH, n - 1);
        var m = (i + j) >> 1;
        var mx = p[m * 2];
        var my = p[m * 2 + 1];
        var a = density(mx, my) / DMAX;
        a = Math.pow(clamp(a, 0, 1), 0.45) * st.k;
        var gg = clamp((fbm(mx * 0.045 + st.seed, my * 0.045, 3) - 0.34) * 2.6, 0, 1);
        a *= 0.62 + 1.25 * gg;
        a *= style.gain;
        if (a < 0.003) continue;
        ctx.beginPath();
        ctx.moveTo(p[i * 2], p[i * 2 + 1]);
        var t;
        for (t = i + 1; t <= j; t++) ctx.lineTo(p[t * 2], p[t * 2 + 1]);
        ctx.lineWidth = st.w * style.wmul;
        ctx.strokeStyle = style.color + Math.min(a, 1).toFixed(3) + ")";
        ctx.stroke();
      }
    }
  }

  function strokeTangents(ctx, strands) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    var CH = 5;
    var si;
    for (si = 0; si < strands.length; si++) {
      var st = strands[si];
      var p = st.p;
      var n = p.length >> 1;
      var i;
      for (i = 0; i < n - 1; i += CH) {
        var j = Math.min(i + CH, n - 1);
        var tx = p[j * 2] - p[i * 2];
        var ty = p[j * 2 + 1] - p[i * 2 + 1];
        var L = Math.hypot(tx, ty) || 1;
        tx /= L;
        ty /= L;
        if (tx < 0) {
          tx = -tx;
          ty = -ty;
        }
        ctx.beginPath();
        ctx.moveTo(p[i * 2], p[i * 2 + 1]);
        var t;
        for (t = i + 1; t <= j; t++) ctx.lineTo(p[t * 2], p[t * 2 + 1]);
        ctx.lineWidth = Math.max(2.4, st.w * 2.1);
        ctx.strokeStyle =
          "rgb(" +
          Math.round((tx * 0.5 + 0.5) * 255) +
          "," +
          Math.round((ty * 0.5 + 0.5) * 255) +
          ",255)";
        ctx.stroke();
      }
    }
  }

  function normaliseHair() {
    var img = hctx.getImageData(0, 0, BW, BH);
    var D = img.data;
    var sum = new Float64Array(N * N);
    var cnt = new Float64Array(N * N);
    var inv = N / S;
    var y;
    var x;
    for (y = 0; y < BH; y++) {
      var ay = y - OY;
      if (ay < 0 || ay >= S) continue;
      var j = Math.min(N - 1, (ay * inv) | 0);
      for (x = 0; x < BW; x++) {
        var ax = x - OX;
        if (ax < 0 || ax >= S) continue;
        var i = Math.min(N - 1, (ax * inv) | 0);
        sum[j * N + i] += D[(y * BW + x) << 2];
        cnt[j * N + i]++;
      }
    }
    var gainF = new Float32Array(N * N);
    var k;
    for (k = 0; k < N * N; k++) {
      var mine = cnt[k] ? sum[k] / cnt[k] / 255 : 0;
      gainF[k] = clamp(FD[k] / (mine + 1e-4), 0.12, 6.0);
    }
    for (y = 0; y < BH; y++) {
      ay = y - OY;
      for (x = 0; x < BW; x++) {
        var ii = (y * BW + x) << 2;
        var v = D[ii];
        if (!v) continue;
        var g = fsample(gainF, clamp(x - OX, 0, S - 1), clamp(ay, 0, S - 1));
        var nv = v * g;
        D[ii] = D[ii + 1] = D[ii + 2] = nv > 255 ? 255 : nv;
      }
    }
    hctx.putImageData(img, 0, 0);
  }

  function encodeDrift() {
    var img = bctx.getImageData(0, 0, BW, BH);
    var D = img.data;
    var T = dctx.getImageData(0, 0, BW, BH).data;
    var y;
    var x;
    for (y = 0; y < BH; y++) {
      for (x = 0; x < BW; x++) {
        var i = (y * BW + x) << 2;
        var ax = x - OX;
        var ay = y - OY;
        var fx;
        var fy;
        if (T[i + 2] > 150) {
          fx = (T[i] / 255) * 2 - 1;
          fy = (T[i + 1] / 255) * 2 - 1;
          var L = Math.hypot(fx, fy) || 1;
          fx /= L;
          fy /= L;
        } else {
          var th = flowAngle(clamp(ax, 0, S - 1), clamp(ay, 0, S - 1));
          fx = Math.cos(th);
          fy = Math.sin(th);
          if (fx < 0) {
            fx = -fx;
            fy = -fy;
          }
        }
        var sp = DRIFT;
        if (ay / S > 0.78) sp *= 0.55;
        var tone = D[i] / 255;
        if (tone < 0.04) sp *= 0.35;
        D[i + 1] = clamp((fx * sp) / DRIFTMAX * 0.5 + 0.5, 0, 1) * 255;
        D[i + 2] = clamp((fy * sp) / DRIFTMAX * 0.5 + 0.5, 0, 1) * 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }

  function buildPlate() {
    bakeDensity();
    STRANDS = buildStrands();

    base.width = BW;
    base.height = BH;
    hairCv.width = BW;
    hairCv.height = BH;
    dirCv.width = BW;
    dirCv.height = BH;

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = "#000";
    bctx.fillRect(0, 0, BW, BH);

    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.clearRect(0, 0, BW, BH);
    hctx.save();
    hctx.translate(OX, OY);
    strokeStrands(hctx, STRANDS, {
      gain: 0.48,
      wmul: 0.95,
      color: "rgba(255,255,255,",
    });
    hctx.restore();
    normaliseHair();
    normaliseHair();

    bctx.globalCompositeOperation = "lighter";
    bctx.drawImage(hairCv, 0, 0);
    bctx.globalCompositeOperation = "source-over";

    bctx.save();
    bctx.translate(OX, OY);
    bctx.globalAlpha = 0.58;
    markTransform(bctx, S, S);
    strokeMark(bctx, 1.08, 1);
    bctx.restore();

    var plate = bctx.getImageData(0, 0, BW, BH);
    var P = plate.data;
    var pi;
    for (pi = 0; pi < P.length; pi += 4) {
      var px = ((pi >> 2) % BW) - OX;
      var py = Math.floor((pi >> 2) / BW) - OY;
      var den = density(clamp(px, 0, S - 1), clamp(py, 0, S - 1));
      var keep = clamp((den / Math.max(DMAX, 0.08) - 0.04) / 0.22, 0, 1);
      var tone = P[pi] / 255;
      tone *= 0.08 + 0.92 * keep;
      var dx = px / S - 0.5;
      var dy = py / S - 0.42;
      var fall = clamp(1 - (dx * dx * 2.4 + dy * dy * 2.1), 0, 1);
      tone *= 0.22 + 0.78 * fall;
      P[pi] = Math.round(tone * 255);
    }
    bctx.putImageData(plate, 0, 0);

    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.fillStyle = "#000";
    dctx.fillRect(0, 0, BW, BH);
    dctx.save();
    dctx.translate(OX, OY);
    strokeTangents(dctx, STRANDS);
    dctx.restore();
    encodeDrift();
  }

  var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var FSHADER = [
    "precision highp float;",
    "uniform sampler2D uBase;uniform vec2 uSize;",
    "uniform vec2 uTrans;",
    "uniform float uUnit,uSeed,uTime,uDriftMax,uCoh,uStretch,uWidth,uLife,uBlend;",
    "const float DGRAIN=1280.0/1440.0;",
    "const vec3 ink=vec3(0.039,0.039,0.039);",
    "const vec3 goldLo=vec3(0.722,0.580,0.176);",
    "const vec3 goldHi=vec3(0.961,0.816,0.376);",
    "float hash(vec3 p){p=fract(p*vec3(443.8975,441.4232,437.1951));p+=dot(p,p.yzx+19.19);return fract((p.x+p.y)*p.z);}",
    "void main(){",
    "  float DCELL=max(DGRAIN,1.0/uUnit);",
    "  vec2 fc=gl_FragCoord.xy-uTrans;",
    "  if(fc.x<0.0||fc.y<0.0||fc.x>=uSize.x*uUnit||fc.y>=uSize.y*uUnit){",
    "    gl_FragColor=vec4(ink,1.0); return;",
    "  }",
    "  vec2 cell=floor(fc/(uUnit*DCELL));",
    "  vec2 c=(cell+0.5)*DCELL, o=vec2(0.30*DCELL);",
    "  float v=0.25*(texture2D(uBase,vec2(c.x-o.x,uSize.y-c.y+o.y)/uSize).r",
    "               +texture2D(uBase,vec2(c.x+o.x,uSize.y-c.y+o.y)/uSize).r",
    "               +texture2D(uBase,vec2(c.x-o.x,uSize.y-c.y-o.y)/uSize).r",
    "               +texture2D(uBase,vec2(c.x+o.x,uSize.y-c.y-o.y)/uSize).r);",
    "  vec2 ap=vec2(c.x,uSize.y-c.y);",
    "  vec2 dr=(texture2D(uBase,ap/uSize).gb*2.0-1.0)*uDriftMax;",
    "  float sp=floor(length(dr)*3.0+0.5)/3.0;",
    "  float aa=floor(atan(dr.y,dr.x)*11.5+0.5)/11.5;",
    "  vec2 tg=vec2(cos(aa),sin(aa)), pp=vec2(-tg.y,tg.x);",
    "  float len=max(2.0,sp*uStretch), wid=uWidth;",
    "  vec2 sc=floor(vec2((dot(ap,tg)-uTime*sp)/len, dot(ap,pp)/wid));",
    "  float ep=floor(uTime/uLife+hash(vec3(sc,3.0)));",
    "  float n;",
    "  float coh=uCoh*clamp((sp-1.2)/1.6,0.0,1.0);",
    "  if(hash(vec3(sc+vec2(37.3,91.7),ep*2.7+5.0))<coh){",
    "    vec2 ctr=tg*((sc.x+0.5)*len+uTime*sp)+pp*((sc.y+0.5)*wid);",
    "    vec2 st=tg*len;",
    "    float vd=0.2*(texture2D(uBase,(ctr-st*0.40)/uSize).r",
    "                 +texture2D(uBase,(ctr-st*0.20)/uSize).r",
    "                 +texture2D(uBase, ctr          /uSize).r",
    "                 +texture2D(uBase,(ctr+st*0.20)/uSize).r",
    "                 +texture2D(uBase,(ctr+st*0.40)/uSize).r);",
    "    v=mix(v,vd,uBlend);",
    "    n=hash(vec3(sc,ep*1.9+17.0));",
    "  }else{",
    "    n=hash(vec3(cell,uSeed));",
    "  }",
    "  float lit=v>n&&v>0.0?1.0:0.0;",
    "  vec3 gold=mix(goldLo,goldHi,clamp(v*1.2,0.0,1.0));",
    "  gl_FragColor=vec4(mix(ink,gold,lit),1.0);",
    "}",
  ].join("\n");

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }

  function initGL() {
    if (!gl) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FSHADER));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl = null;
      fallback = view.getContext("2d", { alpha: false });
      return false;
    }
    gl.useProgram(prog);
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uni.base = gl.getUniformLocation(prog, "uBase");
    uni.size = gl.getUniformLocation(prog, "uSize");
    uni.unit = gl.getUniformLocation(prog, "uUnit");
    uni.trans = gl.getUniformLocation(prog, "uTrans");
    uni.seed = gl.getUniformLocation(prog, "uSeed");
    uni.time = gl.getUniformLocation(prog, "uTime");
    gl.uniform1f(gl.getUniformLocation(prog, "uDriftMax"), DRIFTMAX);
    gl.uniform1f(gl.getUniformLocation(prog, "uCoh"), COH);
    gl.uniform1f(gl.getUniformLocation(prog, "uStretch"), STRETCH);
    gl.uniform1f(gl.getUniformLocation(prog, "uWidth"), GWIDTH);
    gl.uniform1f(gl.getUniformLocation(prog, "uLife"), LIFE);
    gl.uniform1f(gl.getUniformLocation(prog, "uBlend"), BLEND);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uni.base, 0);
    return true;
  }

  function upload() {
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, base);
    gl.uniform2f(uni.size, BW, BH);
  }

  function draw() {
    if (gl) {
      seed = (seed + 1) % 8192;
      timeTick = (timeTick + 1) % 8192;
      gl.uniform1f(uni.seed, seed);
      gl.uniform1f(uni.time, timeTick);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    if (!fallback) return;
    var W = view.width;
    var H = view.height;
    var u = Math.min(W, H) / S;
    fallback.fillStyle = "#0a0a0a";
    fallback.fillRect(0, 0, W, H);
    fallback.imageSmoothingEnabled = true;
    fallback.drawImage(base, Math.round((W - BW * u) / 2), Math.round((H - BH * u) / 2), BW * u, BH * u);
  }

  function fitCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = Math.max(1, Math.round(window.innerWidth * dpr));
    var H = Math.max(1, Math.round(window.innerHeight * dpr));
    if (view.width !== W || view.height !== H) {
      view.width = W;
      view.height = H;
    }
    var u = Math.min(W, H) / S;
    if (gl) {
      gl.viewport(0, 0, W, H);
      gl.uniform1f(uni.unit, u);
      gl.uniform2f(uni.trans, (W - BW * u) / 2, (H - BH * u) / 2);
    }
    draw();
  }

  function rebuild() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = Math.max(1, Math.round(window.innerWidth * dpr));
    var H = Math.max(1, Math.round(window.innerHeight * dpr));
    var unit = Math.min(W, H) / S;
    BW = Math.max(S, Math.ceil(W / unit));
    BH = Math.max(S, Math.ceil(H / unit));
    var px = BW * BH;
    if (px > 4600000) {
      var s = Math.sqrt(4600000 / px);
      BW = Math.max(2, Math.round(BW * s));
      BH = Math.max(2, Math.round(BH * s));
    }
    OX = Math.round((BW - S) / 2);
    OY = Math.round((BH - S) / 2);
    buildPlate();
    upload();
    fitCanvas();
  }

  function tick(now) {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (!visible || reduce) return;
    if (now - lastDraw < 1000 / FPS) return;
    lastDraw = now;
    draw();
  }

  function onResize() {
    fitCanvas();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 180);
  }

  function syncVisible() {
    visible = document.visibilityState !== "hidden";
  }

  if (!initGL() && !fallback) return;

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", syncVisible);
  var io = new IntersectionObserver(
    function (entries) {
      visible = !!(entries[0] && entries[0].isIntersecting) && document.visibilityState !== "hidden";
    },
    { rootMargin: "80px" }
  );
  io.observe(view);

  rebuild();
  if (reduce) {
    draw();
    return;
  }
  raf = requestAnimationFrame(tick);
})();
