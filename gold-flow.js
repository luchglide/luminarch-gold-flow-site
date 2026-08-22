/* LuminArch gold flow field
   Method borrowed from ThreeUI Community (flow + density plate + grain),
   rebuilt as vanilla canvas in LuminArch gold. Not MengTo's artwork. */
(function () {
  "use strict";

  var canvas = document.getElementById("field");
  if (!canvas) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ctx = canvas.getContext("2d", { alpha: false });
  var dpr = 1;
  var width = 0;
  var height = 0;
  var running = true;
  var visible = true;

  var plate = null;
  var plateCtx = null;
  var density = null;
  var plateW = 0;
  var plateH = 0;

  var GW = 72;
  var GH = 48;
  var angles = new Float32Array(GW * GH);

  var filaments = [];
  var grains = [];
  var mouse = { x: 0.5, y: 0.45, tx: 0.5, ty: 0.45, on: false };
  var t0 = performance.now();
  var last = t0;

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
    return a + (b - a) * u + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
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

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function sampleDensity(nx, ny) {
    if (!density) return 0;
    var x = clamp(nx, 0, 1) * (plateW - 1);
    var y = clamp(ny, 0, 1) * (plateH - 1);
    var x0 = x | 0;
    var y0 = y | 0;
    var x1 = Math.min(x0 + 1, plateW - 1);
    var y1 = Math.min(y0 + 1, plateH - 1);
    var tx = x - x0;
    var ty = y - y0;
    var a = density[y0 * plateW + x0];
    var b = density[y0 * plateW + x1];
    var c = density[y1 * plateW + x0];
    var d = density[y1 * plateW + x1];
    return (a + (b - a) * tx + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty) / 255;
  }

  function drawMark(p, w, h) {
    var scale = Math.min(w, h) * 0.78;
    var ox = (w - scale) / 2;
    var oy = (h - scale * 1.15) / 2 + h * 0.02;
    var s = scale / 400;
    p.save();
    p.translate(ox, oy);
    p.scale(s, s);
    p.lineJoin = "round";
    p.lineCap = "round";

    p.strokeStyle = "rgba(212,175,55,0.18)";
    p.lineWidth = 3.2;
    p.strokeRect(60, 20, 280, 340);
    p.lineWidth = 2.2;
    p.strokeRect(80, 40, 240, 300);

    function arch(d, width, alpha) {
      p.strokeStyle = "rgba(245,208,96," + alpha + ")";
      p.lineWidth = width;
      p.stroke(new Path2D(d));
    }

    arch("M100 340 L100 160 Q100 80 200 20 Q300 80 300 160 L300 340", 3.4, 0.95);
    arch("M125 340 L125 175 Q125 105 200 50 Q275 105 275 175 L275 340", 2.6, 0.72);
    arch("M150 340 L150 190 Q150 130 200 80 Q250 130 250 190 L250 340", 2.1, 0.55);
    arch("M170 340 L170 210 Q170 155 200 115 Q230 155 230 210 L230 340", 1.7, 0.42);

    p.strokeStyle = "rgba(212,175,55,0.35)";
    p.lineWidth = 1.4;
    p.beginPath();
    p.moveTo(100, 200);
    p.lineTo(150, 200);
    p.moveTo(250, 200);
    p.lineTo(300, 200);
    p.moveTo(100, 260);
    p.lineTo(150, 260);
    p.moveTo(250, 260);
    p.lineTo(300, 260);
    p.stroke();

    p.strokeStyle = "rgba(245,208,96,0.95)";
    p.lineWidth = 7;
    p.stroke(new Path2D("M155 170 L155 290 L195 290"));
    p.stroke(new Path2D("M210 290 L235 170 L260 290 M216 265 L254 265"));
    p.restore();
  }

  function bakePlate() {
    plateW = Math.max(2, Math.round(width * 0.55));
    plateH = Math.max(2, Math.round(height * 0.55));
    plate = document.createElement("canvas");
    plate.width = plateW;
    plate.height = plateH;
    plateCtx = plate.getContext("2d", { alpha: false });

    var g = plateCtx.createRadialGradient(
      plateW * 0.5,
      plateH * 0.42,
      8,
      plateW * 0.5,
      plateH * 0.5,
      Math.max(plateW, plateH) * 0.62
    );
    g.addColorStop(0, "#1a1408");
    g.addColorStop(0.45, "#0c0a06");
    g.addColorStop(1, "#000000");
    plateCtx.fillStyle = g;
    plateCtx.fillRect(0, 0, plateW, plateH);

    var horizon = plateCtx.createLinearGradient(0, plateH * 0.62, 0, plateH);
    horizon.addColorStop(0, "rgba(212,175,55,0)");
    horizon.addColorStop(0.55, "rgba(212,175,55,0.07)");
    horizon.addColorStop(1, "rgba(8,6,2,0.4)");
    plateCtx.fillStyle = horizon;
    plateCtx.fillRect(0, plateH * 0.58, plateW, plateH * 0.42);

    plateCtx.save();
    plateCtx.filter = "blur(18px)";
    plateCtx.globalAlpha = 0.55;
    drawMark(plateCtx, plateW, plateH);
    plateCtx.restore();

    plateCtx.save();
    plateCtx.filter = "blur(2px)";
    plateCtx.globalAlpha = 0.95;
    drawMark(plateCtx, plateW, plateH);
    plateCtx.restore();

    var img = plateCtx.getImageData(0, 0, plateW, plateH);
    density = new Uint8Array(plateW * plateH);
    for (var i = 0, p = 0; i < density.length; i++, p += 4) {
      density[i] = img.data[p] * 0.35 + img.data[p + 1] * 0.5 + img.data[p + 2] * 0.15;
    }
  }

  function updateField(time) {
    var mx = mouse.x;
    var my = mouse.y;
    for (var y = 0; y < GH; y++) {
      for (var x = 0; x < GW; x++) {
        var nx = x / (GW - 1);
        var ny = y / (GH - 1);
        var n1 = fbm(nx * 2.4 + time * 0.045, ny * 2.4, 4);
        var n2 = fbm(nx * 2.4 + 18, ny * 2.4 + time * 0.04, 4);
        var ang = Math.atan2(n2 - 0.5, n1 - 0.5);
        var cx = nx - 0.5;
        var cy = ny - 0.46;
        var arch = Math.atan2(cy, cx * 1.15) + Math.PI * 0.5;
        ang += (arch - ang) * 0.22;
        if (mouse.on) {
          var dx = nx - mx;
          var dy = ny - my;
          var dist = Math.hypot(dx, dy) + 0.0001;
          var fall = Math.exp(-dist * dist * 18);
          ang += Math.atan2(dx, -dy) * fall * 0.9;
        }
        angles[y * GW + x] = ang;
      }
    }
  }

  function sampleAngle(nx, ny) {
    var x = clamp(nx, 0, 1) * (GW - 1);
    var y = clamp(ny, 0, 1) * (GH - 1);
    var x0 = x | 0;
    var y0 = y | 0;
    var x1 = Math.min(x0 + 1, GW - 1);
    var y1 = Math.min(y0 + 1, GH - 1);
    var tx = x - x0;
    var ty = y - y0;
    var a = angles[y0 * GW + x0];
    var b = angles[y0 * GW + x1];
    var c = angles[y1 * GW + x0];
    var d = angles[y1 * GW + x1];
    var s00 = Math.sin(a);
    var c00 = Math.cos(a);
    var s10 = Math.sin(b);
    var c10 = Math.cos(b);
    var s01 = Math.sin(c);
    var c01 = Math.cos(c);
    var s11 = Math.sin(d);
    var c11 = Math.cos(d);
    var sx = s00 + (s10 - s00) * tx + ((s01 + (s11 - s01) * tx) - (s00 + (s10 - s00) * tx)) * ty;
    var cx = c00 + (c10 - c00) * tx + ((c01 + (c11 - c01) * tx) - (c00 + (c10 - c00) * tx)) * ty;
    return Math.atan2(sx, cx);
  }

  function spawnFilament(rnd) {
    var tries = 0;
    var x = 0;
    var y = 0;
    var den = 0;
    do {
      x = rnd();
      y = rnd() * 0.92;
      den = sampleDensity(x, y);
      tries++;
    } while (den < 0.08 && tries < 40);
    return {
      x: x,
      y: y,
      life: 0.35 + rnd() * 1.4,
      age: rnd() * 0.4,
      w: 0.6 + rnd() * 1.6,
      bright: 0.45 + rnd() * 0.55,
    };
  }

  function spawnGrain(rnd) {
    return {
      x: rnd(),
      y: rnd(),
      life: 0.4 + rnd() * 1.8,
      age: rnd(),
      seed: rnd() * 1000,
    };
  }

  function seedActors() {
    var mobile = Math.min(width, height) < 720;
    var fCount = mobile ? 420 : 980;
    var gCount = mobile ? 1400 : 2800;
    var rnd = mulberry32(20260822);
    filaments = [];
    grains = [];
    for (var i = 0; i < fCount; i++) filaments.push(spawnFilament(rnd));
    for (var j = 0; j < gCount; j++) grains.push(spawnGrain(rnd));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bakePlate();
    seedActors();
  }

  function drawStatic() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (plate) ctx.drawImage(plate, 0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, width, height);
  }

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (!visible) return;

    var dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    var time = (now - t0) / 1000;

    mouse.x += (mouse.tx - mouse.x) * 0.08;
    mouse.y += (mouse.ty - mouse.y) * 0.08;

    updateField(time);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (plate) {
      ctx.globalAlpha = 0.82;
      ctx.drawImage(plate, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    ctx.lineCap = "round";
    var i;
    for (i = 0; i < filaments.length; i++) {
      var f = filaments[i];
      f.age += dt;
      if (f.age > f.life) {
        filaments[i] = spawnFilament(Math.random);
        f = filaments[i];
      }
      var den = sampleDensity(f.x, f.y);
      var ang = sampleAngle(f.x, f.y);
      var speed = (0.035 + den * 0.055) * (0.7 + f.bright);
      f.x += Math.cos(ang) * speed * dt * 9;
      f.y += Math.sin(ang) * speed * dt * 9;
      if (f.x < -0.04 || f.x > 1.04 || f.y < -0.04 || f.y > 1.04 || den < 0.03) {
        filaments[i] = spawnFilament(Math.random);
        continue;
      }
      var fade = Math.sin((f.age / f.life) * Math.PI);
      var x = f.x * width;
      var y = f.y * height;
      var len = (9 + den * 22) * f.w;
      ctx.strokeStyle =
        "rgba(245,208,96," + (0.08 + fade * den * f.bright * 0.75).toFixed(3) + ")";
      ctx.lineWidth = 0.7 + den * 1.6;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang) * len * 0.35, y - Math.sin(ang) * len * 0.35);
      ctx.lineTo(x + Math.cos(ang) * len * 0.65, y + Math.sin(ang) * len * 0.65);
      ctx.stroke();
    }

    for (i = 0; i < grains.length; i++) {
      var g = grains[i];
      g.age += dt;
      if (g.age > g.life) {
        grains[i] = spawnGrain(Math.random);
        g = grains[i];
      }
      var gd = sampleDensity(g.x, g.y);
      var ga = sampleAngle(g.x, g.y);
      var drift = 0.012 + gd * 0.03;
      g.x += Math.cos(ga) * drift * dt * 8;
      g.y += Math.sin(ga) * drift * dt * 8;
      if (g.x < 0 || g.x > 1 || g.y < 0 || g.y > 1) {
        grains[i] = spawnGrain(Math.random);
        continue;
      }
      var n = vnoise(g.x * 90 + g.seed, g.y * 90 + time * 3.4);
      if (n < 0.62 - gd * 0.25) continue;
      var gf = Math.sin((g.age / g.life) * Math.PI);
      ctx.fillStyle =
        "rgba(212,175,55," + (0.04 + gf * (0.08 + gd * 0.22)).toFixed(3) + ")";
      ctx.fillRect(g.x * width, g.y * height, 1.1, 1.1);
    }

    var vg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.45,
      Math.min(width, height) * 0.2,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);
  }

  function onMove(e) {
    var p = e.touches ? e.touches[0] : e;
    mouse.tx = p.clientX / width;
    mouse.ty = p.clientY / height;
    mouse.on = true;
  }

  function onLeave() {
    mouse.on = false;
    mouse.tx = 0.5;
    mouse.ty = 0.45;
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("mouseleave", onLeave);
  document.addEventListener("visibilitychange", function () {
    visible = document.visibilityState !== "hidden";
  });

  var io = new IntersectionObserver(
    function (entries) {
      visible = entries[0] && entries[0].isIntersecting && document.visibilityState !== "hidden";
    },
    { rootMargin: "40px" }
  );
  io.observe(canvas);

  resize();
  if (reduce) {
    drawStatic();
    return;
  }
  requestAnimationFrame(tick);
})();
