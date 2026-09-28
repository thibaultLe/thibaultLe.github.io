const CHANNELS = ["ra", "dec", "color", "mag", "uv_color", "uv_mag", "nir_color", "nir_mag"];
function panelList() {
  const blue = (state.filters && state.filters.blue) || "F475W";
  const red = (state.filters && state.filters.red) || "F814W";
  const short = (name) => name.replace("WFC3_", "").replace("WFPC2_", "");
  const b = short(blue);
  const r = short(red);
  const nirBlue = short((state.filters && state.filters.nir_blue) || "F110W");
  const nirRed = short((state.filters && state.filters.nir_red) || "F160W");
  return [
    { id: "photo", x: "ra", y: "dec", xlabel: "RA (deg)", ylabel: "Dec (deg)", invertX: true, invertY: false, photo: true },
    { id: "radec", x: "ra", y: "dec", xlabel: "RA (deg)", ylabel: "Dec (deg)", invertX: true, invertY: false },
    { id: "nir", x: "nir_color", y: "nir_mag", xlabel: `${nirBlue} − ${nirRed}`, ylabel: nirBlue, invertX: false, invertY: true },
    { id: "cmd", x: "color", y: "mag", xlabel: `${b} − ${r}`, ylabel: b, invertX: false, invertY: true },
    { id: "uv", x: "uv_color", y: "uv_mag", xlabel: `F275W − ${b}`, ylabel: "F275W", invertX: false, invertY: true },
  ];
}

const state = {
  catalog: null,
  galaxy: "ugc8508",
  tier: "dgst",
  stars: null,
  selected: null,
  drawing: null,
  pan: null,
  zoom: {},
  sky: null,
};

function dataRange(values) {
  const finite = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) finite.push(values[i]);
  }
  if (finite.length < 2) return [0, 1];
  finite.sort((a, b) => a - b);
  const drop = finite.length > 40 ? 5 : 0;
  let lo = finite[drop];
  let hi = finite[finite.length - 1 - drop];
  if (!(hi > lo)) {
    lo = finite[0];
    hi = finite[finite.length - 1];
  }
  if (!(hi > lo)) hi = lo + 1;
  const pad = (hi - lo) * 0.04;
  return [lo - pad, hi + pad];
}

function niceStep(span) {
  const rough = span / 5;
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const frac = rough / base;
  const nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * base;
}

function valuesForStep(lo, hi, step) {
  const vals = [];
  let v = Math.ceil((lo + step * 1e-6) / step) * step;
  while (v < hi - step * 1e-6 && vals.length < 8) {
    vals.push(Math.abs(v) < step * 1e-8 ? 0 : v);
    v += step;
  }
  return vals;
}

function tickValues(lo, hi) {
  const step = niceStep(hi - lo);
  return { step, vals: valuesForStep(lo, hi, step) };
}

function nextNiceStep(step) {
  const exp = Math.floor(Math.log10(step) + 1e-12);
  const base = 10 ** exp;
  const frac = step / base;
  if (frac < 1.5) return 2 * base;
  if (frac < 3) return 5 * base;
  return 10 * base;
}

function previousNiceStep(step) {
  const exp = Math.floor(Math.log10(step) + 1e-12);
  const base = 10 ** exp;
  const frac = step / base;
  if (frac > 5.5) return 5 * base;
  if (frac > 2.5) return 2 * base;
  if (frac > 1.5) return base;
  return 5 * 10 ** (exp - 1);
}

function spacedTicks(ctx, lo, hi, plotW) {
  const span = hi - lo;
  let step = niceStep(span * 5 / 3);
  let vals = valuesForStep(lo, hi, step);
  for (let i = 0; i < 8 && vals.length < 2; i++) {
    step = previousNiceStep(step);
    vals = valuesForStep(lo, hi, step);
  }
  for (let i = 0; i < 6 && vals.length > 2; i++) {
    let widest = 0;
    for (const value of vals) widest = Math.max(widest, ctx.measureText(formatTick(value, step)).width);
    const pxGap = (step / span) * plotW;
    if (pxGap >= widest + 20) break;
    const next = nextNiceStep(step);
    const nextVals = valuesForStep(lo, hi, next);
    if (nextVals.length < 2) break;
    step = next;
    vals = nextVals;
  }
  return { step, vals };
}

function formatTick(value, step) {
  const decimals = step >= 1
    ? Math.max(0, -Math.floor(Math.log10(step) + 1e-12))
    : Math.ceil(-Math.log10(step) - 1e-12);
  return value.toFixed(Math.min(6, decimals));
}

function countFinite(values) {
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) n += 1;
  }
  return n;
}

function limits(panel, stars) {
  if (panel.id === "nir" && countFinite(stars[panel.y]) < 2) {
    return { xlim: [-0.75, 3], ylim: [13.5, 25.75] };
  }
  return {
    xlim: dataRange(stars[panel.x]),
    ylim: dataRange(stars[panel.y]),
  };
}

async function gunzip(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function decode(buffer) {
  const view = new DataView(buffer);
  const n = view.getUint32(4, true);
  let off = 8;
  const nchan = CHANNELS.length;
  const scales = [];
  for (let c = 0; c < nchan; c++) {
    const lo = view.getFloat32(off, true);
    off += 4;
    const hi = view.getFloat32(off, true);
    off += 4;
    scales.push([lo, hi]);
  }
  const stars = { n };
  for (const name of CHANNELS) stars[name] = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nchan; c++) {
      const u = view.getUint16(off, true);
      off += 2;
      const [lo, hi] = scales[c];
      stars[CHANNELS[c]][i] = u === 65535 ? NaN : lo + (u / 65534) * (hi - lo);
    }
  }
  return stars;
}

function finite(a, b, i) {
  return Number.isFinite(a[i]) && Number.isFinite(b[i]);
}

function layout(canvas, lim, panel, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "11px Segoe UI, Helvetica, Arial, sans-serif";
  const yt = tickValues(lim.ylim[0], lim.ylim[1]);
  let widest = 0;
  for (const value of yt.vals) {
    widest = Math.max(widest, ctx.measureText(formatTick(value, yt.step)).width);
  }
  const outer = 2;
  const ylabelBand = 14;
  const labelGap = 4;
  const tickGap = 8;
  const padL = Math.ceil(outer + ylabelBand + labelGap + widest + tickGap);
  const labelX = outer + ylabelBand / 2;
  const padR = 8;
  const padT = 12;
  const padB = 58;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  return { ctx, cssW, cssH, padL, padR, padT, padB, plotW, plotH, labelX, lim, panel };
}

function px(view, x, y) {
  const { padL, padT, plotW, plotH, lim, panel } = view;
  let tx = (x - lim.xlim[0]) / (lim.xlim[1] - lim.xlim[0]);
  let ty = (y - lim.ylim[0]) / (lim.ylim[1] - lim.ylim[0]);
  if (panel.invertX) tx = 1 - tx;
  if (panel.invertY) ty = 1 - ty;
  return [padL + tx * plotW, padT + (1 - ty) * plotH];
}

function dataXY(view, sx, sy) {
  const { padL, padT, plotW, plotH, lim, panel } = view;
  let tx = (sx - padL) / plotW;
  let ty = 1 - (sy - padT) / plotH;
  if (panel.invertX) tx = 1 - tx;
  if (panel.invertY) ty = 1 - ty;
  return [
    lim.xlim[0] + tx * (lim.xlim[1] - lim.xlim[0]),
    lim.ylim[0] + ty * (lim.ylim[1] - lim.ylim[0]),
  ];
}

function insidePlot(view, sx, sy) {
  return sx >= view.padL && sx <= view.padL + view.plotW && sy >= view.padT && sy <= view.padT + view.plotH;
}

function drawAxes(view) {
  const { ctx, padL, padT, plotW, plotH, panel, lim } = view;
  ctx.save();
  ctx.strokeStyle = "#222";
  ctx.fillStyle = "#222";
  ctx.lineWidth = 1;
  ctx.font = "11px Segoe UI, Helvetica, Arial, sans-serif";
  ctx.strokeRect(padL, padT, plotW, plotH);

  const xt = panel.id === "radec"
    ? spacedTicks(ctx, lim.xlim[0], lim.xlim[1], plotW)
    : tickValues(lim.xlim[0], lim.xlim[1]);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const value of xt.vals) {
    const [sx] = px(view, value, lim.ylim[0]);
    ctx.beginPath();
    ctx.moveTo(sx, padT + plotH);
    ctx.lineTo(sx, padT + plotH + 6);
    ctx.stroke();
    ctx.fillText(formatTick(value, xt.step), sx, padT + plotH + 8);
  }

  const yt = tickValues(lim.ylim[0], lim.ylim[1]);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const value of yt.vals) {
    const [, sy] = px(view, lim.xlim[0], value);
    ctx.beginPath();
    ctx.moveTo(padL, sy);
    ctx.lineTo(padL - 6, sy);
    ctx.stroke();
    ctx.fillText(formatTick(value, yt.step), padL - 8, sy);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "12px Segoe UI, Helvetica, Arial, sans-serif";
  ctx.fillText(panel.xlabel, padL + plotW / 2, padT + plotH + 42);
  ctx.save();
  ctx.translate(view.labelX, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(panel.ylabel, 0, 0);
  ctx.restore();
  ctx.restore();
}

function blot(pix, w, h, ix, iy, rad, color) {
  const [r, g, b, a] = color;
  const rad2 = rad * rad;
  const reach = Math.ceil(rad);
  for (let dy = -reach; dy <= reach; dy++) {
    const yy = iy + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -reach; dx <= reach; dx++) {
      const dist2 = dx * dx + dy * dy;
      if (dist2 > rad2) continue;
      const xx = ix + dx;
      if (xx < 0 || xx >= w) continue;
      const cover = Math.min(1, rad - Math.sqrt(dist2) + 0.6);
      const alpha = (a / 255) * cover;
      const o = (yy * w + xx) * 4;
      const dstA = pix[o + 3] / 255;
      const outA = alpha + dstA * (1 - alpha);
      pix[o] = (r * alpha + pix[o] * dstA * (1 - alpha)) / outA;
      pix[o + 1] = (g * alpha + pix[o + 1] * dstA * (1 - alpha)) / outA;
      pix[o + 2] = (b * alpha + pix[o + 2] * dstA * (1 - alpha)) / outA;
      pix[o + 3] = outA * 255;
    }
  }
}

function stamp(view, mask, color, radiusCss) {
  const { ctx, stars, plotW, plotH, padL, padT } = view;
  const dpr = window.devicePixelRatio || 1;
  const rad = Math.max(2, radiusCss * dpr);
  const x0 = Math.round(padL * dpr);
  const y0 = Math.round(padT * dpr);
  const w = Math.round(plotW * dpr);
  const h = Math.round(plotH * dpr);
  const image = ctx.getImageData(x0, y0, w, h);
  const pix = image.data;
  const xs = stars[view.panel.x];
  const ys = stars[view.panel.y];
  for (let i = 0; i < stars.n; i++) {
    if (mask && !mask[i]) continue;
    if (!finite(xs, ys, i)) continue;
    const [sx, sy] = px(view, xs[i], ys[i]);
    const ix = Math.round((sx - padL) * dpr);
    const iy = Math.round((sy - padT) * dpr);
    blot(pix, w, h, ix, iy, rad, color);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(image, x0, y0);
  ctx.restore();
}

function snapshot(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  canvas._bg = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function restoreBg(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(canvas._bg, 0, 0);
  ctx.restore();
}

function skyRecord() {
  const rec = state.sky && state.sky[state.galaxy];
  if (!rec) return null;
  if (!rec.image) {
    const img = new Image();
    rec.image = img;
    img.onload = () => {
      const canvas = document.getElementById("photo");
      if (!canvas) return;
      canvas._key = "";
      paintPanel(canvas);
    };
    img.src = `sky/${state.galaxy}.jpg`;
  }
  if (!rec.image.complete || !rec.image.naturalWidth) return null;
  return rec;
}

function drawSky(view) {
  const rec = skyRecord();
  if (!rec || !view.panel.photo) return;
  const { ctx, padL, padT, plotW, plotH } = view;
  const [x0, y0] = px(view, rec.ra1, rec.dec1);
  const [x1, y1] = px(view, rec.ra0, rec.dec0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();
  ctx.drawImage(rec.image, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.restore();
}

function paintPanel(canvas) {
  const stars = state.stars;
  if (!stars) return;
  const panel = panelList().find((p) => p.id === canvas.id);
  const baseKey = state.galaxy + state.tier;
  if (canvas._baseKey !== baseKey) {
    canvas._base = limits(panel, stars);
    canvas._baseKey = baseKey;
  }
  const lim = state.zoom[canvas.id] || canvas._base;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || 380;
  const cssH = rect.height || 440;
  const skyReady = panel.photo && skyRecord() ? ":sky" : "";
  const viewKey = baseKey + JSON.stringify(lim) + "@" + Math.round(cssW) + "x" + Math.round(cssH) + skyReady;
  if (!canvas._view || canvas._key !== viewKey) {
    const view = layout(canvas, lim, panel, cssW, cssH);
    view.stars = stars;
    view.base = canvas._base;
    canvas._view = view;
    canvas._key = viewKey;
    view.ctx.clearRect(0, 0, view.cssW, view.cssH);
    drawSky(view);
    drawAxes(view);
    if (panel.id === "nir" && countFinite(stars[panel.y]) < 2) {
      view.ctx.fillStyle = "#666";
      view.ctx.font = "14px Segoe UI, Helvetica, Arial, sans-serif";
      view.ctx.textAlign = "center";
      view.ctx.textBaseline = "middle";
      view.ctx.fillText("No near-infrared photometry", view.padL + view.plotW / 2, view.padT + view.plotH / 2);
    }
    if (!panel.photo) stamp(view, null, [70, 70, 70, 140], 2.2);
    snapshot(canvas);
  } else {
    restoreBg(canvas);
  }
  if (state.selected && !panel.photo) stamp(canvas._view, state.selected, [0, 196, 214, 220], 2.6);
  if (state.drawing && state.drawing.panel === panel.id) drawDraft(canvas._view);
}

function zoomRange(range, center, factor, base) {
  const maxSpan = base[1] - base[0];
  let span = (range[1] - range[0]) * factor;
  const minSpan = maxSpan / 80;
  if (span >= maxSpan) return base.slice();
  if (span < minSpan) span = minSpan;
  let t = (center - range[0]) / (range[1] - range[0]);
  if (!Number.isFinite(t)) t = 0.5;
  t = Math.min(1, Math.max(0, t));
  let lo = center - t * span;
  let hi = lo + span;
  if (lo < base[0]) {
    hi += base[0] - lo;
    lo = base[0];
  }
  if (hi > base[1]) {
    lo -= hi - base[1];
    hi = base[1];
  }
  return [lo, hi];
}

function zoomCanvas(canvas, sx, sy, factor) {
  const view = canvas._view;
  if (!view || !insidePlot(view, sx, sy)) return;
  const [x, y] = dataXY(view, sx, sy);
  state.zoom[canvas.id] = {
    xlim: zoomRange(view.lim.xlim, x, factor, view.base.xlim),
    ylim: zoomRange(view.lim.ylim, y, factor, view.base.ylim),
  };
  paintPanel(canvas);
}

function drawDraft(view) {
  const pts = state.drawing.points;
  if (!pts.length) return;
  const { ctx } = view;
  ctx.save();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.restore();
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function applySelection(panel) {
  const stars = state.stars;
  const view = document.getElementById(panel)._view;
  if (!view) return;
  const sel = new Uint8Array(stars.n);
  const pts = state.drawing.points.map((p) => dataXY(view, p[0], p[1]));
  const xs = stars[view.panel.x];
  const ys = stars[view.panel.y];
  if (pts.length >= 3) {
    for (let i = 0; i < stars.n; i++) {
      if (!finite(xs, ys, i)) continue;
      sel[i] = pointInPoly(xs[i], ys[i], pts) ? 1 : 0;
    }
  }
  state.selected = sel;
  state.drawing = null;
  redraw();
  const n = sel.reduce((a, b) => a + b, 0);
  const status = document.getElementById("status");
  const count = document.createElement("span");
  count.className = "ink-cyan";
  count.textContent = n.toLocaleString();
  status.replaceChildren(count, ` of ${stars.n.toLocaleString()} stars selected`);
}

function redraw() {
  for (const panel of panelList()) paintPanel(document.getElementById(panel.id));
}

function panCanvas(canvas, from, to) {
  const view = canvas._view;
  if (!view) return;
  const xSpan = view.lim.xlim[1] - view.lim.xlim[0];
  const ySpan = view.lim.ylim[1] - view.lim.ylim[0];
  let dx = -(to[0] - from[0]) / view.plotW * xSpan;
  let dy = (to[1] - from[1]) / view.plotH * ySpan;
  if (view.panel.invertX) dx = -dx;
  if (view.panel.invertY) dy = -dy;
  state.zoom[canvas.id] = {
    xlim: [view.lim.xlim[0] + dx, view.lim.xlim[1] + dx],
    ylim: [view.lim.ylim[0] + dy, view.lim.ylim[1] + dy],
  };
  paintPanel(canvas);
}

function pointerPos(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function bindCanvas(canvas) {
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    if (!state.stars || !canvas._view) return;
    const p = pointerPos(canvas, event);
    if (!insidePlot(canvas._view, p[0], p[1])) return;
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      state.pan = { panel: canvas.id, last: p };
      canvas.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0) return;
    state.drawing = { panel: canvas.id, points: [p] };
    paintPanel(canvas);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (state.pan && state.pan.panel === canvas.id) {
      const p = pointerPos(canvas, event);
      panCanvas(canvas, state.pan.last, p);
      state.pan.last = p;
      return;
    }
    if (!state.drawing || state.drawing.panel !== canvas.id) return;
    const p = pointerPos(canvas, event);
    state.drawing.points.push(p);
    paintPanel(canvas);
  });
  canvas.addEventListener("pointerup", () => {
    if (state.pan && state.pan.panel === canvas.id) {
      state.pan = null;
      canvas.style.cursor = "crosshair";
      return;
    }
    if (!state.drawing || state.drawing.panel !== canvas.id) return;
    applySelection(canvas.id);
  });
  canvas.addEventListener("wheel", (event) => {
    if (!canvas._view) return;
    event.preventDefault();
    const p = pointerPos(canvas, event);
    zoomCanvas(canvas, p[0], p[1], event.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
}

async function loadGalaxy() {
  const status = document.getElementById("status");
  status.textContent = "Loading…";
  state.selected = null;
  state.drawing = null;
  state.zoom = {};
  const url = `data/${state.galaxy}_${state.tier}.bin.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing ${url}`);
  const fetched = await response.arrayBuffer();
  const bytes = new Uint8Array(fetched);
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(fetched) : fetched;
  state.stars = decode(raw);
  for (const panel of panelList()) {
    const canvas = document.getElementById(panel.id);
    canvas._view = null;
    canvas._key = "";
    canvas._baseKey = "";
  }
  status.textContent = `${state.stars.n.toLocaleString()} stars`;
  redraw();
}

function markGalaxyMenu() {
  const button = document.getElementById("galaxyButton");
  const list = document.getElementById("galaxyList");
  for (const item of list.children) {
    const chosen = item.dataset.id === state.galaxy;
    item.setAttribute("aria-selected", chosen ? "true" : "false");
    if (chosen) {
      button.textContent = item.textContent;
      button.setAttribute("aria-label", `Galaxy, ${item.textContent}`);
    }
  }
}

function closeGalaxyMenu() {
  document.getElementById("galaxyList").hidden = true;
  document.getElementById("galaxyButton").setAttribute("aria-expanded", "false");
}

function useCleanStars() {
  const galaxy = state.catalog.galaxies.find((g) => g.id === state.galaxy);
  const tier = galaxy.tiers.find((t) => t.id === "dgst") || galaxy.tiers[0];
  state.tier = tier.id;
  state.filters = tier;
}

async function main() {
  const res = await fetch("data/catalog.json");
  state.catalog = await res.json();
  const list = document.getElementById("galaxyList");
  const button = document.getElementById("galaxyButton");
  for (const galaxy of state.catalog.galaxies) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.dataset.id = galaxy.id;
    item.textContent = galaxy.label;
    item.addEventListener("click", () => {
      state.galaxy = galaxy.id;
      markGalaxyMenu();
      closeGalaxyMenu();
      useCleanStars();
      loadGalaxy().catch((err) => {
        document.getElementById("status").textContent = String(err);
      });
    });
    list.appendChild(item);
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = list.hidden;
    list.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".galaxy-picker")) closeGalaxyMenu();
  });
  try {
    state.sky = await (await fetch("sky/index.json")).json();
  } catch (err) {
    state.sky = null;
  }
  state.galaxy = state.catalog.default;
  markGalaxyMenu();
  document.getElementById("clear").addEventListener("click", () => {
    state.selected = null;
    state.drawing = null;
    if (state.stars) document.getElementById("status").textContent = `${state.stars.n.toLocaleString()} stars`;
    redraw();
  });
  document.getElementById("reset-zoom").addEventListener("click", () => {
    state.zoom = {};
    for (const panel of panelList()) document.getElementById(panel.id)._key = "";
    redraw();
  });
  for (const panel of panelList()) bindCanvas(document.getElementById(panel.id));
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redraw, 150);
  });
  useCleanStars();
  await loadGalaxy();
}

main().catch((err) => {
  document.getElementById("status").textContent = String(err);
});
