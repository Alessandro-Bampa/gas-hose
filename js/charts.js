/*
 * charts.js — grafici SVG leggeri, senza librerie.
 *   stack: colonne impilate per mese (+ segno orizzontale per le entrate)
 *   line:  andamento dei contatori cumulativi
 *   hbar:  barre orizzontali (es. spese per categoria)
 * I colori arrivano dal CSS (classi .s-nec, .s-des, .s-ris, .s-other, .s-inc).
 */
(function (global) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtEur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
  const eur = n => fmtEur.format(Math.abs(n) < 0.005 ? 0 : n);

  function short(n) {
    const a = Math.abs(n);
    if (a >= 1000) return (n / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + 'k';
    return Math.round(n).toLocaleString('it-IT', { useGrouping: 'always' });
  }

  function niceTicks(min, max, count = 4) {
    if (max - min < 1e-9) { max = min + 1; }
    const raw = (max - min) / count;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }

  // Rettangolo con angoli superiori arrotondati (estremità del dato), base dritta.
  function topRounded(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h, w / 2));
    return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
  }
  // Rettangolo con estremità destra arrotondata.
  function rightRounded(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w, h / 2));
    return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`;
  }

  const tipAttr = (title, rows) => `data-tip="${esc(JSON.stringify({ t: title, r: rows }))}"`;

  /* ----------------------------------------------------------- colonne */

  function stackSvg(spec, W) {
    const H = spec.height || 260;
    const m = { t: 14, r: 8, b: 28, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = spec.labels.length;
    const totals = spec.labels.map((_, i) => spec.series.reduce((s, se) => s + Math.max(0, se.values[i] || 0), 0));
    const maxV = Math.max(1, ...totals, ...(spec.line ? spec.line.values : [0]));
    const tk = niceTicks(0, maxV, 4);
    const top = tk[tk.length - 1];
    const y = v => m.t + ih - (v / top) * ih;
    const band = iw / n;
    const bw = Math.min(24, band * 0.6);

    let s = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.aria || '')}">`;
    for (const t of tk) {
      s += `<line class="grid${t === 0 ? ' base' : ''}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${y(t)}" dy="0.32em" text-anchor="end">${esc(short(t))}</text>`;
    }
    for (let i = 0; i < n; i++) {
      const x0 = m.l + band * i;
      const cx = x0 + band / 2;
      const rows = [];
      if (spec.line) rows.push([spec.line.name, eur(spec.line.values[i] || 0), 'inc']);
      for (const se of spec.series) rows.push([se.name, eur(se.values[i] || 0), se.key]);
      if (spec.extraTip) rows.push(...spec.extraTip(i));
      s += `<rect class="hit" x="${x0}" y="${m.t}" width="${band}" height="${ih}" tabindex="0" ${tipAttr(spec.titles[i], rows)}/>`;

      let base = 0;
      const segs = spec.series.map(se => ({ key: se.key, v: Math.max(0, se.values[i] || 0) })).filter(g => g.v > 0);
      segs.forEach((g, j) => {
        const yTop = y(base + g.v);
        let yBot = y(base) - (j > 0 ? 2 : 0); // 2px di stacco tra i segmenti
        const h = yBot - yTop;
        base += g.v;
        if (h < 0.5) return;
        const last = j === segs.length - 1;
        s += last
          ? `<path class="mark s-${g.key}" d="${topRounded(cx - bw / 2, yTop, bw, h, 4)}"/>`
          : `<rect class="mark s-${g.key}" x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${h}"/>`;
      });
      if (spec.line && spec.line.values[i] > 0) {
        const yy = y(spec.line.values[i]);
        const hw = Math.min(band * 0.42, bw / 2 + 7);
        s += `<line class="inc-mark" x1="${cx - hw}" x2="${cx + hw}" y1="${yy}" y2="${yy}"/>`;
      }
      s += `<text class="tick" x="${cx}" y="${H - 9}" text-anchor="middle">${esc(spec.labels[i])}</text>`;
    }
    return s + '</svg>';
  }

  /* -------------------------------------------------------------- linee */

  function lineSvg(spec, W) {
    const H = spec.height || 240;
    const m = { t: 14, r: 14, b: 28, l: 60 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = spec.labels.length;
    const vals = spec.series.flatMap(se => se.values.filter(v => v != null));
    const tk = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals, 1), 4);
    const lo = tk[0], hi = tk[tk.length - 1];
    const x = i => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = v => m.t + ih - ((v - lo) / (hi - lo)) * ih;

    let s = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.aria || '')}">`;
    for (const t of tk) {
      s += `<line class="grid${t === 0 ? ' base' : ''}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${y(t)}" dy="0.32em" text-anchor="end">${esc(short(t))}</text>`;
    }
    // etichette asse x (diradate se lo spazio è poco)
    const every = iw / n < 34 ? 2 : 1;
    spec.labels.forEach((l, i) => {
      if (i % every === 0 || i === n - 1) s += `<text class="tick" x="${x(i)}" y="${H - 9}" text-anchor="middle">${esc(l)}</text>`;
    });
    s += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;

    for (const se of spec.series) {
      let d = '', open = false, last = -1;
      se.values.forEach((v, i) => {
        if (v == null) { open = false; return; }
        d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        open = true;
        last = i;
      });
      if (d) s += `<path class="line s-${se.key}" d="${d}"/>`;
      if (last >= 0) s += `<circle class="dot s-${se.key}" cx="${x(last)}" cy="${y(se.values[last])}" r="4"/>`;
    }

    const step = n > 1 ? iw / (n - 1) : iw;
    for (let i = 0; i < n; i++) {
      if (spec.series.every(se => se.values[i] == null)) continue;
      const rows = spec.series.map(se => [se.name, se.values[i] == null ? '—' : (se.values[i] > 0.004 ? '+' : '') + eur(se.values[i]), se.key]);
      s += `<rect class="hit hit-line" x="${x(i) - step / 2}" y="${m.t}" width="${step}" height="${ih}" data-cx="${x(i)}" tabindex="0" ${tipAttr(spec.titles[i], rows)}/>`;
    }
    return s + '</svg>';
  }

  /* -------------------------------------------------- barre orizzontali */

  function hbarSvg(spec, W) {
    const rowH = 30, barH = 14;
    const labelW = Math.min(180, Math.max(110, W * 0.34));
    const valueW = 92;
    const H = spec.rows.length * rowH + 6;
    const max = Math.max(1, ...spec.rows.map(r => r.value));
    const maxW = Math.max(40, W - labelW - valueW);
    let s = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.aria || '')}">`;
    spec.rows.forEach((r, i) => {
      const y0 = i * rowH + 3;
      const cy = y0 + rowH / 2;
      const w = Math.max(2, (r.value / max) * maxW);
      const maxChars = Math.floor((labelW - 14) / 7);
      const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label;
      s += `<rect class="hit" x="0" y="${y0}" width="${W}" height="${rowH}" tabindex="0" ${tipAttr(r.label, [[r.group || '', eur(r.value), r.key]])}/>`;
      s += `<text class="lbl" x="${labelW - 12}" y="${cy}" dy="0.32em" text-anchor="end">${esc(label)}</text>`;
      s += `<path class="mark s-${r.key}" d="${rightRounded(labelW, cy - barH / 2, w, barH, 4)}"/>`;
      s += `<text class="val" x="${labelW + w + 8}" y="${cy}" dy="0.32em">${esc(eur(r.value))}</text>`;
    });
    return s + '</svg>';
  }

  /* ------------------------------------------------------- montaggio */

  const specs = new WeakMap();
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => {
      for (const e of entries) {
        const spec = specs.get(e.target);
        if (spec && Math.abs(e.target.clientWidth - spec._w) > 4) draw(e.target, spec);
      }
    })
    : null;

  function draw(el, spec) {
    const w = Math.max(280, Math.floor(el.clientWidth));
    spec._w = w;
    el.innerHTML = spec.type === 'stack' ? stackSvg(spec, w) : spec.type === 'line' ? lineSvg(spec, w) : hbarSvg(spec, w);
  }

  function mount(el, spec) {
    specs.set(el, spec);
    draw(el, spec);
    if (ro) ro.observe(el);
  }

  /* --------------------------------------------------------- tooltip */

  function initTooltip(tip) {
    let current = null;

    function show(target, px, py) {
      if (current !== target) {
        current = target;
        let d;
        try { d = JSON.parse(target.getAttribute('data-tip')); } catch { return; }
        tip.replaceChildren();
        const h = document.createElement('div');
        h.className = 'tt-title';
        h.textContent = d.t;
        tip.append(h);
        for (const [label, value, key] of d.r) {
          const row = document.createElement('div');
          row.className = 'tt-row';
          const k = document.createElement('span');
          k.className = 'tt-key' + (key ? ' s-' + key : '');
          const v = document.createElement('strong');
          v.textContent = value;
          const l = document.createElement('span');
          l.className = 'tt-label';
          l.textContent = label;
          row.append(k, v, l);
          tip.append(row);
        }
        const svg = target.ownerSVGElement;
        const cross = svg && svg.querySelector('.crosshair');
        if (cross && target.dataset.cx) {
          cross.setAttribute('x1', target.dataset.cx);
          cross.setAttribute('x2', target.dataset.cx);
          cross.setAttribute('visibility', 'visible');
        }
      }
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      let x = px + 14, y = py + 14;
      if (x + r.width > window.innerWidth - 8) x = px - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = py - r.height - 14;
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, y) + 'px';
    }

    function hide() {
      if (!current) return;
      const svg = current.ownerSVGElement;
      const cross = svg && svg.querySelector('.crosshair');
      if (cross) cross.setAttribute('visibility', 'hidden');
      current = null;
      tip.hidden = true;
    }

    document.addEventListener('pointermove', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t) show(t, e.clientX, e.clientY);
      else hide();
    });
    document.addEventListener('focusin', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { hide(); return; }
      const b = t.getBoundingClientRect();
      show(t, b.left + b.width / 2, b.top + Math.min(b.height / 2, 40));
    });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
    return { hide };
  }

  global.Charts = { mount, initTooltip };
})(window);
