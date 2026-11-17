/* Chart detector: finds charts (inline SVG, canvas, embeds, images) and runs axis heuristics on SVGs. */
(function () {
  const ML = window.ML;
  const NUM = /^[\s$£€¥]*[-−]?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?\s*(%|k|m|bn|b|x|°)?[\s]*$/i;
  function parseNum(s) {
    s = ML.normText(s).replace(/[$£€¥,\s]/g, '').replace('−', '-');
    const m = s.match(/^(-?\d+(?:\.\d+)?)(%|k|m|bn|b|x|°)?$/i); if (!m) return null;
    let v = parseFloat(m[1]); const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'bn' || suf === 'b') v *= 1e9;
    return v;
  }
  const YEAR = /^(18|19|20)\d{2}$/;

  function analyzeSvg(svg, cfg) {
    const issues = [];
    const r = svg.getBoundingClientRect();
    const texts = Array.from(svg.querySelectorAll('text,tspan')).filter((t) => t.textContent && t.textContent.trim());
    const nums = [];
    const words = [];
    for (const t of texts) {
      const s = t.textContent.trim();
      if (NUM.test(s) && parseNum(s) != null) { const b = t.getBoundingClientRect(); nums.push({ v: parseNum(s), x: b.x + b.width / 2, y: b.y + b.height / 2, raw: s, isYear: YEAR.test(s.replace(/\D/g, '')) }); }
      else if (/[a-z]{3,}/i.test(s)) words.push(s.toLowerCase());
    }
    const rects = svg.querySelectorAll('rect').length, paths = svg.querySelectorAll('path').length, circles = svg.querySelectorAll('circle').length;
    const allText = words.join(' ');
    const chartLike = nums.length >= cfg.charts.minSvgNumericLabels && (rects >= 3 || paths >= 1 || circles >= 3 || /axis|tick|grid|bar|line|series|legend/i.test(svg.innerHTML.slice(0, 20000)));
    if (!chartLike) return null;

    // vertical axes: numbers sharing (roughly) the same x
    const byX = {}; for (const n of nums) { if (n.isYear) continue; const k = Math.round(n.x / 10); (byX[k] = byX[k] || []).push(n); }
    const vAxes = Object.values(byX).filter((g) => g.length >= 3 && new Set(g.map((n) => Math.round(n.y))).size >= 3).map((g) => g.sort((a, b) => a.y - b.y));
    // horizontal axis: numbers sharing the same y
    const byY = {}; for (const n of nums) { const k = Math.round(n.y / 8); (byY[k] = byY[k] || []).push(n); }
    const hAxes = Object.values(byY).filter((g) => g.length >= 3 && new Set(g.map((n) => Math.round(n.x))).size >= 3).map((g) => g.sort((a, b) => a.x - b.x));

    const yAxis = vAxes.sort((a, b) => a[0].x - b[0].x)[0];
    const hasBars = rects >= 3 && Array.from(svg.querySelectorAll('rect')).filter((rc) => { const h = rc.getBoundingClientRect().height; return h > 4; }).length >= 3;

    if (yAxis) {
      const vals = yAxis.map((n) => n.v);
      const min = Math.min(...vals), max = Math.max(...vals);
      // inverted axis: values increase as pixel y increases (downwards)
      const top = yAxis[0].v, bottom = yAxis[yAxis.length - 1].v;
      if (top < bottom && min >= 0) issues.push({ id: 'charts.inverted_axis', sev: 3, name: 'Inverted y-axis', explain: 'Values increase downwards (' + yAxis[0].raw + ' at the top, ' + yAxis[yAxis.length - 1].raw + ' at the bottom). Readers assume up means more; inverting the axis flips the visual story (the infamous 2014 Florida gun-deaths chart made a rise look like a fall).' });
      // truncated baseline
      if (min > 0 && max > min) {
        const frac = min / max;
        if (hasBars && frac > 0.05) issues.push({ id: 'charts.truncated_bar_axis', sev: 3, name: 'Bar chart with a non-zero baseline', explain: 'The y-axis starts at ' + yAxis.find((n) => n.v === min).raw + ' instead of 0. Bar length encodes value, so a truncated axis makes differences look ' + Math.round(1 / Math.max(0.01, 1 - frac)) + 'x larger than they are.' });
        else if (!hasBars && frac > 0.5) issues.push({ id: 'charts.zoomed_line_axis', sev: 1, name: 'Zoomed y-axis on a line chart', explain: 'The axis runs from ' + yAxis.find((n) => n.v === min).raw + ' to ' + yAxis.find((n) => n.v === max).raw + ', so small movements fill the whole chart. Acceptable for showing detail, misleading when presented as dramatic change.' });
      }
      // irregular / log spacing
      if (yAxis.length >= 4) {
        const steps = []; for (let i = 1; i < yAxis.length; i++) steps.push({ dv: Math.abs(yAxis[i].v - yAxis[i - 1].v), dy: Math.abs(yAxis[i].y - yAxis[i - 1].y) });
        const ratios = steps.filter((s) => s.dy > 0).map((s) => s.dv / s.dy);
        const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const spread = Math.max(...ratios) / Math.max(1e-9, Math.min(...ratios));
        const geometric = (() => { const vs = vals.filter((v) => v > 0).sort((a, b) => a - b); if (vs.length < 3) return false; const rr = []; for (let i = 1; i < vs.length; i++) rr.push(vs[i] / vs[i - 1]); return rr.every((q) => Math.abs(q - rr[0]) < 0.15 * rr[0]) && rr[0] > 2; })();
        if (geometric && !/log/i.test(allText)) issues.push({ id: 'charts.unlabeled_log_scale', sev: 2, name: 'Logarithmic scale without a label', explain: 'Tick values multiply (' + vals.slice(0, 4).join(', ') + '…) but nothing says "log scale". Log axes flatten exponential growth and make large differences look small.' });
        else if (!geometric && isFinite(spread) && spread > 2.2 && mean > 0) issues.push({ id: 'charts.irregular_axis', sev: 2, name: 'Irregular axis intervals', explain: 'Equal pixel distances represent unequal value steps (' + yAxis.map((n) => n.raw).join(', ') + '). A broken or stretched axis distorts slopes and comparisons.' });
      }
    }
    if (vAxes.length >= 2) {
      const left = vAxes[0], right = vAxes[vAxes.length - 1];
      if (right[0].x - left[0].x > r.width * 0.5) issues.push({ id: 'charts.dual_axis', sev: 2, name: 'Dual y-axes', explain: 'Two independent vertical scales share one chart. By choosing the scales, the author can make any two series appear to track each other (or diverge). Look at each series on its own axis.' });
    }
    const xAxis = hAxes.sort((a, b) => b.length - a.length)[0];
    if (xAxis) {
      const years = xAxis.filter((n) => n.isYear).map((n) => n.v);
      if (years.length >= 3) {
        const span = Math.max(...years) - Math.min(...years);
        if (span <= 3) issues.push({ id: 'charts.short_window', sev: 1, name: 'Short time window (' + span + ' years)', explain: 'The x-axis covers only ' + Math.min(...years) + '–' + Math.max(...years) + '. Short windows are the main tool of cherry-picking: the same series over 20 years may tell the opposite story.' });
      }
      if (xAxis.length <= 4 && !xAxis.some((n) => n.isYear)) issues.push({ id: 'charts.few_points', sev: 1, name: 'Very few data points', explain: 'Only ' + xAxis.length + ' x-axis positions. Trends drawn through a handful of points are fragile.' });
    }
    // pie / arcs
    const arcs = Array.from(svg.querySelectorAll('path')).filter((p) => /[Aa]\s*[\d.]+/.test(p.getAttribute('d') || '')).length;
    if (arcs >= 3 && !yAxis) issues.push({ id: 'charts.pie', sev: 1, name: 'Pie / donut chart', explain: 'Humans compare angles and areas poorly. Pies hide small differences and are easy to abuse (slices that do not sum to 100%, 3D tilt, exploded segments). A bar chart would be more honest.' });
    // aspect ratio
    if (r.width > 0 && r.height > 0) { const ar = r.width / r.height; if (ar > 4.5) issues.push({ id: 'charts.flat_aspect', sev: 1, name: 'Extremely wide aspect ratio', explain: 'A very wide, short chart flattens slopes and makes change look smaller.' }); else if (ar < 0.45 && yAxis) issues.push({ id: 'charts.tall_aspect', sev: 1, name: 'Extremely tall aspect ratio', explain: 'A tall, narrow chart steepens slopes and makes change look dramatic.' }); }
    // axis titles / units
    const hasUnits = nums.some((n) => /[%$£€¥°]|k$|m$|bn$/i.test(n.raw));
    if (!hasUnits && words.length === 0) issues.push({ id: 'charts.no_axis_titles', sev: 1, name: 'No axis titles or units', explain: 'Numbers without units or axis labels cannot be interpreted; the reader supplies the meaning, which is what the author may want.' });
    // source citation in svg or surrounding figure/caption/siblings
    let ctxText = (svg.textContent || '').toLowerCase();
    let anc = svg.parentElement, depth = 0;
    while (anc && depth++ < 3) { ctxText += ' ' + ML.lower(anc.innerText || '').slice(0, 1500); anc = anc.parentElement; }
    if (svg.nextElementSibling) ctxText += ' ' + ML.lower(svg.nextElementSibling.innerText || '').slice(0, 500);
    if (!cfg.charts.sourceWords.some((w) => ctxText.includes(w))) issues.push({ id: 'charts.no_source', sev: 1, name: 'No data source cited', explain: 'Nothing near this chart says where the data came from. Uncited charts cannot be checked and are a staple of persuasive (rather than informative) graphics.' });
    return { issues, meta: { numericLabels: nums.length, bars: hasBars, axes: vAxes.length } };
  }

  const CHART_WORDS = /\b(chart|graph|plot|histogram|trend line|time series)\b/i;
  function canvasIsChart(el, cfg) {
    try { if (el.matches(cfg.charts.librarySelectors.join(','))) return true; } catch (e) { /* selector issues */ }
    if (/chart/i.test(String(el.className || '')) || /chart/i.test(el.id || '')) return true;
    if (CHART_WORDS.test(el.getAttribute('aria-label') || '')) return true;
    if (el.closest('[class*="chart" i],[id*="chart" i]')) return true;
    const fig = el.closest('figure'); return !!(fig && fig.querySelector('figcaption'));
  }

  ML.detectors.charts = function (ctx) {
    const cfg = ctx.domConfig, out = [], assets = [];
    const add = (f) => out.push(ML.makeFinding(Object.assign({ category: 'charts' }, f)));
    const seen = new Set();

    // inline SVG charts
    const svgs = Array.from(document.querySelectorAll('svg')).filter((s) => { const r = s.getBoundingClientRect(); return r.width >= 120 && r.height >= 80 && ML.isVisible(s); }).slice(0, 25);
    let chartCount = 0;
    for (const svg of svgs) {
      let res = null;
      try { res = analyzeSvg(svg, cfg); } catch (e) { res = null; }
      if (!res) continue;
      chartCount++;
      const id = ML.mark(svg);
      assets.push({ type: 'svg', elId: id, markup: svg.outerHTML.slice(0, 30000), caption: ML.normText((svg.closest('figure') && svg.closest('figure').innerText) || (svg.parentElement && svg.parentElement.innerText) || '').slice(0, 300) });
      for (const iss of res.issues) {
        add({ id: iss.id, name: iss.name, severity: iss.sev, confidence: 0.7, biases: ['framing', 'cherry_picking', 'anchoring'], explain: iss.explain,
          tip: 'Redraw it mentally with a zero baseline, a single axis and a longer time window, then ask whether the story survives.',
          evidence: [ML.evidenceFor(svg, 'Chart #' + chartCount + (iss.id === 'charts.no_source' ? '' : ' (' + res.meta.numericLabels + ' numeric labels)'))], count: 1, meta: res.meta });
      }
      if (!res.issues.length) add({ id: 'charts.svg_chart_ok', name: 'Chart passed basic axis checks', severity: 0, confidence: 0.6, biases: [], explain: 'An SVG chart was found and no axis-level problems were detected. Heuristics cannot judge data selection, labelling honesty or context; enable deep analysis for a reading of the chart itself.', tip: '', evidence: [ML.evidenceFor(svg, 'Chart #' + chartCount)], count: 1 });
    }

    // canvas / library charts
    let canvasCharts = [];
    try {
      canvasCharts = Array.from(document.querySelectorAll('canvas,' + cfg.charts.librarySelectors.join(','))).filter((el) => {
        if (seen.has(el) || !ML.isVisible(el)) return false;
        const r = el.getBoundingClientRect(); if (r.width < 150 || r.height < 100) return false;
        if (String(el.tagName).toLowerCase() === 'svg' || el.closest('svg')) return false; // handled above
        if (String(el.tagName).toUpperCase() === 'CANVAS' && !canvasIsChart(el, cfg)) return false; // a bare canvas is a QR code or an animated banner as often as a chart
        seen.add(el); return true;
      }).slice(0, 10);
    } catch (e) { canvasCharts = []; }
    if (canvasCharts.length) add({
      id: 'charts.canvas_chart', name: 'Canvas / library-rendered chart (not inspectable)', severity: 0, confidence: 0.6, biases: ['framing'],
      explain: canvasCharts.length + ' chart(s) are drawn with a charting library onto a canvas, so axis values cannot be read from the page structure. Enable deep analysis to have the chart image assessed, or check the axes by hand.',
      tip: 'Check: does the y-axis start at zero? Are there two y-axes? How long is the time window? Where is the source?',
      evidence: canvasCharts.slice(0, 3).map((el) => ML.evidenceFor(el, (el.getAttribute('aria-label') || el.className || el.tagName).toString().slice(0, 100))), count: canvasCharts.length
    });
    for (const el of canvasCharts.slice(0, 4)) {
      if (String(el.tagName).toUpperCase() === 'CANVAS') { try { assets.push({ type: 'canvas', elId: ML.mark(el), dataUrl: el.toDataURL('image/png').slice(0, 2_500_000), caption: ML.normText(el.getAttribute('aria-label') || (el.parentElement && el.parentElement.innerText) || '').slice(0, 300) }); } catch (e) { /* tainted canvas */ } }
    }

    // embedded chart iframes
    const embeds = Array.from(document.querySelectorAll('iframe[src]')).filter((f) => cfg.charts.iframeHints.some((h) => (f.src || '').toLowerCase().includes(h)) && ML.isVisible(f)).slice(0, 8);
    if (embeds.length) add({
      id: 'charts.embedded_chart', name: 'Embedded third-party chart', severity: 0, confidence: 0.7, biases: ['framing'],
      explain: embeds.length + ' chart(s) are embedded from ' + Array.from(new Set(embeds.map((f) => ML.hostOf(f.src)))).join(', ') + '. Content inside an iframe cannot be inspected from this page; open the embed directly to check axes and sources.',
      tip: 'Right-click the chart and open its frame in a new tab, then re-run Subtext there.',
      evidence: embeds.slice(0, 3).map((f) => ML.evidenceFor(f, f.src.slice(0, 120))), count: embeds.length
    });

    // chart images
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      if (!ML.isVisible(img) || img.naturalWidth < cfg.charts.minImageSize || img.naturalHeight < 100) return false;
      const fig = img.closest('figure'); const cap = fig && fig.querySelector('figcaption');
      const t = ML.lower([img.alt, img.title, img.getAttribute('src'), img.className, cap && cap.textContent].filter(Boolean).join(' '));
      return cfg.charts.imageHints.some((h) => t.includes(h));
    }).slice(0, 8);
    if (imgs.length) {
      add({
        id: 'charts.image_chart', name: 'Chart image detected', severity: 0, confidence: 0.6, biases: ['framing'],
        explain: imgs.length + ' image(s) appear to be charts or infographics. Raster charts cannot be checked structurally; the AI deep analysis can read them. Common tricks to look for: truncated or missing baseline, dual axes, cherry-picked time window, cumulative totals instead of per-period values, 3D distortion, relative percentages with no absolute numbers, no source.',
        tip: 'Find the source and the full time series before believing the picture.',
        evidence: imgs.slice(0, 4).map((img) => ML.evidenceFor(img, (img.alt || img.getAttribute('src') || '').slice(0, 120))), count: imgs.length
      });
      for (const img of imgs.slice(0, 4)) assets.push({ type: 'img', elId: ML.mark(img), src: img.currentSrc || img.src, alt: (img.alt || '').slice(0, 300), caption: ML.normText((img.closest('figure') && img.closest('figure').innerText) || '').slice(0, 300) });
    }
    ctx.chartAssets = assets;
    return out;
  };
})();
