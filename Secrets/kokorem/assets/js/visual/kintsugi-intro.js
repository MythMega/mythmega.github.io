/* ============================================
   KOKORO — Kintsugi intro crack animation v7
   7 organic curved cracks (Catmull-Rom splines)
   from centre to viewport edge. Deterministic
   waypoints, async timing, no randomness.
   ============================================ */
(function () {
  'use strict';

  const overlay = document.getElementById('kintsugi-intro');
  const canvas  = document.getElementById('kintsugi-canvas');
  if (!overlay || !canvas) return;

  const ctx = canvas.getContext('2d');

  /* ── Easy config ── */
  const CRACK_COLOR = '#c9a227';
  const CRACK_WIDTH = 18;        /* px */
  const CRACK_CURVE = 0.12;      /* max perpendicular bend as fraction of line length
                                    0 = perfectly straight, 0.3 = very serpentine */

  const DRAW_DURATION = 3800;
  const HOLD_DURATION = 700;
  const FADE_DURATION = 700;

  const inSubdir = window.location.pathname.includes('/collection/');
  const base = inSubdir ? '../' : '';

  let vw, vh, cx, cy;
  let startTime = null;
  let rafId     = null;
  let cracks    = [];

  /* Logo */
  const logoImg    = new Image();
  let   logoLoaded = false;
  logoImg.onload   = () => { logoLoaded = true; };
  logoImg.src      = base + 'assets/images/kokoro_gold.png';

  /* Easing */
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* Catmull-Rom spline — interpolates between p1 and p2 using p0 and p3 as
     tangent guides. Produces smooth, organic-looking curves through waypoints. */
  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: 0.5 * ((2*p1.x) + (-p0.x + p2.x)*t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*t3),
      y: 0.5 * ((2*p1.y) + (-p0.y + p2.y)*t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y)*t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y)*t3),
    };
  }

  /* Exact intersection of a ray from (ox,oy) at `angle` with viewport edges */
  function edgePoint(ox, oy, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const ts   = [];
    if (Math.abs(cosA) > 1e-9) {
      const t1 = (0  - ox) / cosA; if (t1 > 1e-9) ts.push(t1);
      const t2 = (vw - ox) / cosA; if (t2 > 1e-9) ts.push(t2);
    }
    if (Math.abs(sinA) > 1e-9) {
      const t3 = (0  - oy) / sinA; if (t3 > 1e-9) ts.push(t3);
      const t4 = (vh - oy) / sinA; if (t4 > 1e-9) ts.push(t4);
    }
    return { x: ox + cosA * Math.min(...ts), y: oy + sinA * Math.min(...ts) };
  }

  /* ── Per-crack parameters — deterministic broken lines ───────
     angle   : base direction from centre (added to global offset)
     startT  : normalised time when drawing begins
     endT    : normalised time when drawing ends (each crack is independent)
     waypoints: intermediate points defined as:
       along — fraction [0,1] along centre→edge straight vector
       perp  — perpendicular offset as fraction of main distance
                (positive = left of direction, negative = right)
  ─────────────────────────────────────────────────────────── */
  const CRACK_PARAMS = [
    { startT: 0.00, endT: 0.74, waypoints: [
      { along: 0.28, perp:  0.14 },
      { along: 0.55, perp: -0.09 },
      { along: 0.80, perp:  0.18 },
    ]},
    { startT: 0.08, endT: 0.96, waypoints: [
      { along: 0.38, perp: -0.24 },
      { along: 0.72, perp:  0.11 },
    ]},
    { startT: 0.03, endT: 0.84, waypoints: [
      { along: 0.20, perp:  0.11 },
      { along: 0.46, perp: -0.19 },
      { along: 0.68, perp:  0.07 },
      { along: 0.88, perp: -0.15 },
    ]},
    { startT: 0.13, endT: 1.00, waypoints: [
      { along: 0.33, perp: -0.21 },
      { along: 0.65, perp:  0.17 },
    ]},
    { startT: 0.05, endT: 0.79, waypoints: [
      { along: 0.26, perp:  0.20 },
      { along: 0.50, perp: -0.07 },
      { along: 0.78, perp:  0.24 },
    ]},
    { startT: 0.10, endT: 0.91, waypoints: [
      { along: 0.40, perp: -0.16 },
      { along: 0.70, perp:  0.23 },
    ]},
    { startT: 0.01, endT: 0.71, waypoints: [
      { along: 0.22, perp: -0.12 },
      { along: 0.47, perp:  0.19 },
      { along: 0.70, perp: -0.10 },
      { along: 0.90, perp:  0.13 },
    ]},
    /* — 7 additional cracks (evenly interleaved between the first 7) — */
    { startT: 0.06, endT: 0.82, waypoints: [
      { along: 0.30, perp: -0.17 },
      { along: 0.58, perp:  0.12 },
      { along: 0.82, perp: -0.22 },
    ]},
    { startT: 0.11, endT: 0.77, waypoints: [
      { along: 0.35, perp:  0.26 },
      { along: 0.63, perp: -0.13 },
    ]},
    { startT: 0.02, endT: 0.88, waypoints: [
      { along: 0.18, perp: -0.15 },
      { along: 0.42, perp:  0.22 },
      { along: 0.72, perp: -0.08 },
      { along: 0.91, perp:  0.17 },
    ]},
    { startT: 0.09, endT: 0.94, waypoints: [
      { along: 0.31, perp:  0.18 },
      { along: 0.60, perp: -0.25 },
    ]},
    { startT: 0.04, endT: 0.76, waypoints: [
      { along: 0.24, perp: -0.20 },
      { along: 0.52, perp:  0.15 },
      { along: 0.76, perp: -0.11 },
    ]},
    { startT: 0.12, endT: 0.98, waypoints: [
      { along: 0.36, perp:  0.21 },
      { along: 0.66, perp: -0.14 },
    ]},
    { startT: 0.07, endT: 0.73, waypoints: [
      { along: 0.25, perp:  0.13 },
      { along: 0.48, perp: -0.22 },
      { along: 0.73, perp:  0.16 },
      { along: 0.92, perp: -0.09 },
    ]},
  ];

  function buildCracks() {
    const N       = 14;
    const offset  = 0.35;  /* fixed rotational offset for visual balance */
    const PER_SEG = 40;    /* sample points per spline segment — higher = smoother */
    const result  = [];

    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 + offset;
      const end   = edgePoint(cx, cy, angle);
      const prm   = CRACK_PARAMS[i];

      /* Main direction vector */
      const dx   = end.x - cx;
      const dy   = end.y - cy;
      const dist = Math.hypot(dx, dy);

      /* Perpendicular unit vector (90° CCW of main direction) */
      const px = -dy / dist;
      const py =  dx / dist;

      /* Control points: centre → waypoints → edge */
      const ctrl = [{ x: cx, y: cy }];
      for (const wp of prm.waypoints) {
        ctrl.push({
          x: cx + dx * wp.along + px * dist * wp.perp * CRACK_CURVE / 0.24,
          y: cy + dy * wp.along + py * dist * wp.perp * CRACK_CURVE / 0.24,
        });
      }
      ctrl.push({ x: end.x, y: end.y });

      /* Duplicate endpoints so Catmull-Rom has tangents at start and end */
      const pts  = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
      const points = [];

      /* Sample each spline segment into a dense polyline */
      for (let s = 0; s < ctrl.length - 1; s++) {
        const p0 = pts[s];
        const p1 = pts[s + 1];
        const p2 = pts[s + 2];
        const p3 = pts[s + 3];
        for (let k = 0; k < PER_SEG; k++) {
          points.push(catmullRom(p0, p1, p2, p3, k / PER_SEG));
        }
      }
      points.push(ctrl[ctrl.length - 1]); /* ensure exact endpoint */

      /* Width profile — sum of two sines with crack-unique frequencies/phases.
         Stays within [0.5 × CRACK_WIDTH, 1.5 × CRACK_WIDTH]. */
      const f1 = 2.3 + i * 0.71;   /* primary undulation frequency  */
      const f2 = 5.1 + i * 0.43;   /* secondary undulation frequency */
      const ph = i * 1.31;          /* phase offset unique per crack  */
      const widths = points.map((_, k) => {
        const t = k / Math.max(points.length - 1, 1);
        const v = Math.sin(f1 * t * Math.PI * 2 + ph) * 0.6
                + Math.sin(f2 * t * Math.PI * 2 + ph * 0.7) * 0.4;
        /* clamp to [-1,1] then scale to ±50% of base width */
        return CRACK_WIDTH * (1 + 0.5 * Math.max(-1, Math.min(1, v)));
      });

      result.push({ points, widths, startT: prm.startT, endT: prm.endT });
    }
    return result;
  }

  /* Draw a polyline with per-point variable width up to `progress` of arc-length.
     Each segment is drawn individually so lineWidth can vary along the path. */
  function drawVariablePolyline(pts, widths, progress) {
    if (progress <= 0 || pts.length < 2) return;
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      segs.push({ ax: pts[i-1].x, ay: pts[i-1].y, wa: widths[i-1],
                  bx: pts[i].x,   by: pts[i].y,   wb: widths[i], len });
      total += len;
    }
    if (total === 0) return;
    const target = total * Math.min(progress, 1);
    let drawn = 0;
    for (const s of segs) {
      if (drawn >= target) break;
      let bx, by, wb;
      if (drawn + s.len <= target) {
        bx = s.bx; by = s.by; wb = s.wb;
        drawn += s.len;
      } else {
        const t = (target - drawn) / s.len;
        bx = s.ax + (s.bx - s.ax) * t;
        by = s.ay + (s.by - s.ay) * t;
        wb = s.wa + (s.wb - s.wa) * t;
        drawn = target;
      }
      ctx.lineWidth = (s.wa + wb) / 2;
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }

  /* Render loop */
  function render(ts) {
    if (!startTime) startTime = ts;
    const rawT = Math.min((ts - startTime) / DRAW_DURATION, 1);

    ctx.clearRect(0, 0, vw, vh);

    /* Cracks — fully opaque, no shadow */
    for (const crack of cracks) {
      if (rawT < crack.startT) continue;
      const span = crack.endT - crack.startT;
      const lp   = easeInOut(Math.max(0, Math.min((rawT - crack.startT) / span, 1)));

      ctx.save();
      ctx.strokeStyle = CRACK_COLOR;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
      drawVariablePolyline(crack.points, crack.widths, lp);
      ctx.restore();
    }

    /* Logo with white outline (1-2px drop-shadow on PNG transparency) */
    if (logoLoaded) {
      const logoA = Math.min(rawT * 6, 1);
      const sz    = Math.min(vw, vh) * 0.22;
      const lx    = cx - sz / 2;
      const ly    = cy - sz / 2;

      ctx.save();
      ctx.globalAlpha = logoA;

      ctx.shadowBlur = 0;
      ctx.drawImage(logoImg, lx, ly, sz, sz);

      ctx.restore();
    }

    if (rawT < 1) {
      rafId = requestAnimationFrame(render);
    } else {
      rafId = null;
      setTimeout(startFade, HOLD_DURATION);
    }
  }

  function startFade() {
    overlay.classList.add('fading');
    setTimeout(() => overlay.classList.add('hidden'), FADE_DURATION);
  }

  function init() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width  = vw;
    canvas.height = vh;
    cx = vw / 2;
    cy = vh / 2;
    cracks    = buildCracks();
    startTime = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(render);
  }

  window.addEventListener('resize', init);
  init();
})();
