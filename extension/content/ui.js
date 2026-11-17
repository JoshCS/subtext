/* Subtext — in-page UI. Everything the user sees on the page lives in one closed shadow root: the corner pill,
   the resizable report panel docked to the right, the hover tooltip for flagged elements, the transient "locate"
   wash, and optional small dot markers. Nothing is drawn by writing classes, attributes or styles onto site
   elements; positions are measured with getBoundingClientRect and refreshed on scroll/resize, never polled. */
(function () {
  const ML = window.ML; if (!ML || window.top !== window) return;
  if (ML.ui) return; // double-injection guard
  const UI = (ML.ui = {});
  const MIN_W = 280, MIN_H = 240, DEF_W = 360, TIP_W = 320, TIP_MIN_W = 200, OPEN_DELAY = 150, CLOSE_DELAY = 300;
  const FONT = '13px/19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const SEV_COLOR = (s) => (s >= 3 ? '#d94f4f' : s === 2 ? '#e67e22' : s === 1 ? '#c9a227' : '#7f8c8d');
  let host = null, root = null, E = {}, prefs = { panelW: DEF_W, panelH: 0, panelOpen: false, marks: false }, prefsLoaded = false;
  let state = null, ctx = null, settings = {}, extra = { hasKey: false, provider: 'anthropic', aiBusy: false, notice: '' };
  let findings = [], elMap = new Map(), washes = [], marks = [], relayoutQueued = false;

  /* The shell around the report: pill, panel frame, tooltip, overlays. Type, spacing, colour tokens and the report's own
     components come from SubtextView.CSS (ui/view.js), appended to this string in mount(); the two are one system.
     No url() and no inline style attributes in markup: a page's content policy must not be able to break the layout. */
  const CSS = `
:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; }
:host *, :host *::before, :host *::after { box-sizing: border-box; }
.ui { font: ${FONT}; color: var(--fg); -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums; }
button { font: inherit; }
.ui :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* pill */
.pill { pointer-events: auto; position: fixed; right: 14px; bottom: 14px; display: inline-flex; align-items: center; gap: 8px; min-height: 28px; padding: 6px 12px 6px 10px; border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; background: rgba(22, 24, 28, 0.94); color: #fff; font: 600 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.25); cursor: pointer; user-select: none; opacity: 0.94; transition: opacity 0.2s, transform 0.2s; }
.pill:hover, .pill:focus-visible { opacity: 1; transform: translateY(-1px); }
.pill:focus-visible { outline: 2px solid #8cbcf0; outline-offset: 2px; }
.pill[hidden] { display: none; }
.pill.quiet { opacity: 0.62; }
.pill__dot { width: 8px; height: 8px; border-radius: 50%; background: #8d97a3; }
/* panel */
.panel { pointer-events: auto; position: fixed; top: 12px; right: 12px; display: flex; flex-direction: column; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.08); overflow: hidden; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); container: stpanel / inline-size; }
.panel[hidden] { display: none; }
.panel.dragging { user-select: none; }
.rs { position: absolute; z-index: 3; background: transparent; border: 0; padding: 0; margin: 0; touch-action: none; }
.rs-w { left: 0; top: 0; bottom: 0; width: 8px; cursor: ew-resize; }
.rs-h { left: 0; right: 0; bottom: 0; height: 8px; cursor: ns-resize; }
.rs-c { left: 0; bottom: 0; width: 16px; height: 16px; cursor: nesw-resize; }
@media (pointer: coarse) { .rs-w { width: 18px; } .rs-h { height: 18px; } .rs-c { width: 28px; height: 28px; } }
.rs-w::after { content: ''; position: absolute; left: 2px; top: 50%; width: 3px; height: 32px; margin-top: -16px; border-radius: 2px; background: var(--line2); opacity: 0; transition: opacity 0.15s; }
.rs-w:hover::after, .rs-w:focus-visible::after, .panel.dragging .rs-w::after { opacity: 1; background: var(--accent); }
.ui .rs:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* header: the site and the four icon buttons on one row, the count line under them at full width (it wraps badly beside the buttons at 280 px) */
.ph { display: grid; grid-template-columns: minmax(0, 1fr) repeat(4, 28px); column-gap: 2px; align-items: center; padding: 10px 10px 4px 16px; }
.ph__t { display: contents; }
.ph__site { grid-area: 1 / 1; margin-right: 6px; font-weight: 600; font-size: 13px; line-height: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph__meta { grid-area: 2 / 1 / 3 / -1; padding-right: 6px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ib { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--fg2); cursor: pointer; }
.ib:hover { background: var(--card); color: var(--fg); }
.ib.on { background: var(--card); color: var(--accent); }
.pt { display: flex; gap: 8px; padding: 8px 16px 12px; border-bottom: 1px solid var(--line); }
.pb { flex: 1; min-height: 32px; padding: 6px 12px; border: 1px solid var(--line2); border-radius: 6px; background: var(--bg); color: var(--fg); font-size: 13px; line-height: 18px; font-weight: 600; cursor: pointer; }
.pb:hover { background: var(--card); border-color: var(--muted); }
/* the one primary button; with no AI key it only opens Settings, so it is a secondary button until a key exists */
.pb--ai { background: var(--fill); border-color: var(--fill); color: #fff; }
.pb--ai:hover { background: var(--fill-hover); border-color: var(--fill-hover); }
.pb--ai.pb--setup, .pb--ai.pb--secondary { background: var(--bg); border-color: var(--line2); color: var(--fg); }
.pb--ai.pb--setup:hover, .pb--ai.pb--secondary:hover { background: var(--card); border-color: var(--muted); }
.pb:disabled { cursor: progress; } /* no dimming while it works: white progress text must keep its contrast on the fill */
.pt .ai-cancel { min-height: 32px; margin-left: 0; }
.pm { flex: 1; min-height: 0; overflow-y: auto; padding: 0 16px 16px; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.pf { border-top: 1px solid var(--line); padding: 8px 16px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.pf a { color: var(--accent); }
.pf__mute { display: inline-flex; align-items: center; min-height: 24px; margin: 0 0 0 -6px; padding: 2px 6px; border: 0; border-radius: 6px; background: transparent; color: var(--fg2); font: inherit; font-weight: 600; cursor: pointer; }
.pf__mute:hover { background: var(--card); color: var(--fg); }
@container stpanel (max-width: 330px) { .ph { padding-left: 12px; padding-right: 6px; } .pt { padding-left: 12px; padding-right: 12px; } .pm { padding-left: 12px; padding-right: 12px; } .pf { padding-left: 12px; padding-right: 12px; } }
/* hover tooltip: always the dark surface, so it reads the dark severity colours */
.tip { --sev3: #f0736e; --sev2: #f0a04b; --sev1: #dcb93c; --sev0: #8d97a3; pointer-events: auto; position: fixed; width: ${TIP_W}px; background: #1b1d22; color: #eef0f3; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 4px 12px 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); font: ${FONT}; font-variant-numeric: tabular-nums; text-align: left; }
.tip[hidden] { display: none; }
.tip__row { padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.1); }
.tip__row:first-child { border-top: 0; }
.tip__head { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 8px; align-items: start; }
.tip__chip { font-weight: 600; }
.tip__cat { color: #939ca8; font-size: 12px; white-space: nowrap; }
.tip__why { grid-column: 2 / -1; color: #b7bec8; }
.tip__more { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; margin: 4px 0 0 18px; padding: 3px 8px 3px 6px; border: 0; border-radius: 6px; background: transparent; color: #b7bec8; font: inherit; font-size: 12px; line-height: 17px; font-weight: 600; cursor: pointer; }
.tip__more:hover, .tip__open:hover { background: rgba(255,255,255,0.08); color: #fff; }
.tip__detail { margin: 4px 0 0 24px; color: #d3d8df; }
.tip__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); color: #939ca8; font-size: 12px; line-height: 17px; }
.tip__open { min-height: 24px; margin-right: -6px; padding: 3px 6px; border: 0; border-radius: 6px; background: transparent; color: #8cbcf0; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.tip :focus-visible { outline-color: #8cbcf0; }
/* locate wash and dot markers: overlays measured from the element, never styles on it */
.wash { position: fixed; pointer-events: none; border-radius: 6px; background: rgba(230,126,34,0.16); transition: opacity 0.5s; }
.wash.strong { background: rgba(217,79,79,0.22); box-shadow: 0 0 0 4px rgba(217,79,79,0.12); }
.mark { position: fixed; pointer-events: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.45); }
@media (prefers-reduced-motion: reduce) { .pill, .wash, .rs-w::after { transition: none; } .pill:hover, .pill:focus-visible { transform: none; } }
@media print { .ui { display: none; } }
`;

  // ---- mount ------------------------------------------------------------------
  function mount() {
    if (host) return;
    const rnd = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6) || 'x';
    const tag = ML.testHooks ? 'subtext-' + rnd() : rnd() + '-' + rnd(); // no stable name for site scripts to probe; tests find the host by the prefix
    host = document.createElement(tag);
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = CSS + (typeof SubtextView !== 'undefined' ? SubtextView.CSS : '');
    const ui = document.createElement('div'); ui.className = 'ui';
    const IC = (typeof SubtextView !== 'undefined' && SubtextView.ICON) || { marks: '', rescan: '', settings: '', close: '' }; // static SVG strings, no page text
    ui.innerHTML =
      '<button class="pill" type="button" hidden aria-haspopup="dialog"><span class="pill__dot"></span><span class="pill__txt"></span></button>' +
      '<aside class="panel" hidden role="dialog" aria-label="Subtext report">' +
        '<header class="ph"><div class="ph__t"><div class="ph__site"></div><div class="ph__meta"></div></div>' +
          '<button class="ib ib-marks" type="button" title="Mark flagged elements with small dots" aria-label="Mark flagged elements with small dots" aria-pressed="false">' + IC.marks + '</button><button class="ib ib-rescan" type="button" title="Scan the page again" aria-label="Scan the page again">' + IC.rescan + '</button><button class="ib ib-settings" type="button" title="Subtext settings" aria-label="Subtext settings">' + IC.settings + '</button><button class="ib ib-close" type="button" title="Close (Escape)" aria-label="Close">' + IC.close + '</button></header>' +
        '<div class="pt"><button class="pb pb--ai" type="button"></button></div>' +
        '<div class="pm"></div>' +
        '<footer class="pf"><span class="pf__note">Techniques present are not proof of bad intent; honest sites use some of them. Decide with the evidence in front of you. </span><button type="button" class="pf__mute">Don\'t scan this site</button></footer>' +
        // absolutely placed on the panel's edges, so their place in the DOM only sets the tab order: after the report, not before the header
        '<div class="rs rs-w" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Panel width"></div><div class="rs rs-h" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Panel height"></div><div class="rs rs-c" aria-hidden="true"></div>' +
      '</aside>' +
      '<div class="tip" hidden role="dialog" aria-live="polite" aria-label="Subtext: why this is flagged"></div>' +
      '<div class="layer"></div>';
    root.append(style, ui);
    const $ = (s) => ui.querySelector(s);
    E = { ui, pill: $('.pill'), pillTxt: $('.pill__txt'), pillDot: $('.pill__dot'), panel: $('.panel'), site: $('.ph__site'), meta: $('.ph__meta'), marksBtn: $('.ib-marks'), closeBtn: $('.ib-close'), note: $('.pf__note'), aiBtn: $('.pb--ai'), main: $('.pm'), tip: $('.tip'), layer: $('.layer'), rsW: $('.rs-w'), rsH: $('.rs-h'), rsC: $('.rs-c') };
    (document.body || document.documentElement).prepend(host); // first in the document, so Tab reaches the pill without crossing the whole page
    // drag the pill to another corner; a drag is not a click (UX-19)
    let drag = null, dragged = false;
    E.pill.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; dragged = false; });
    E.pill.addEventListener('pointermove', (e) => { if (drag && !dragged && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { dragged = true; try { E.pill.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } } });
    E.pill.addEventListener('pointerup', (e) => { if (drag && dragged) { prefs.pillCorner = (e.clientY < window.innerHeight / 2 ? 't' : 'b') + (e.clientX < window.innerWidth / 2 ? 'l' : 'r'); prefs.pillChosen = true; savePrefs(); placePill(); } drag = null; });
    E.pill.addEventListener('click', (e) => { if (dragged) { dragged = false; e.preventDefault(); return; } UI.togglePanel(); });
    let placeTimer = null; const placeSoon = () => { clearTimeout(placeTimer); placeTimer = setTimeout(placePill, 250); };
    window.addEventListener('resize', placeSoon, { passive: true }); window.addEventListener('scroll', placeSoon, { passive: true });
    $('.ib-close').addEventListener('click', () => UI.togglePanel(false));
    $('.ib-rescan').addEventListener('click', () => { renderWanted = true; if (UI.onRescan) UI.onRescan(); });
    $('.ib-settings').addEventListener('click', () => { if (ML.hasChrome) chrome.runtime.sendMessage({ type: 'openOptions' }, () => void chrome.runtime.lastError); });
    E.marksBtn.addEventListener('click', () => { prefs.marks = !prefs.marks; savePrefs(); drawMarks(); });
    E.aiBtn.addEventListener('click', deepAnalyze);
    $('.pf__mute').addEventListener('click', () => { if (ML.hasChrome) chrome.runtime.sendMessage({ type: 'muteSite', hostname: location.hostname }, () => void chrome.runtime.lastError); });
    E.tip.addEventListener('mouseenter', cancelHide);
    E.tip.addEventListener('mouseleave', scheduleHide);
    // while the reader's pointer is inside the panel, rescans do not rebuild it under them (see renderPanel)
    E.panel.addEventListener('mouseenter', () => { hoverPanel = true; });
    E.panel.addEventListener('mouseleave', () => { hoverPanel = false; if (renderPending) renderPanel(); });
    installResize();
    applyGeometry();
  }
  UI.host = () => host;

  // ---- prefs ------------------------------------------------------------------
  let saveTimer = null;
  function savePrefs() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; ML.storage.set('ui', prefs); }, 300); }
  async function loadPrefs() {
    if (prefsLoaded) return; prefsLoaded = true;
    const p = await ML.storage.get('ui'); if (p && typeof p === 'object') prefs = Object.assign(prefs, p);
    if (host) { applyGeometry(); if (prefs.panelOpen && state) UI.togglePanel(true, { restore: true }); if (prefs.marks) drawMarks(); }
  }

  // ---- public API ---------------------------------------------------------------
  UI.update = function (st, context) {
    if (!st || !st.report) return;
    const finished = st.ai?.ts !== state?.ai?.ts || (!!state?.aiProgress && !st.aiProgress);
    state = st; if (context) ctx = context;
    mount(); loadPrefs();
    findings = (typeof SubtextView !== 'undefined') ? SubtextView.composite(state, ML.labels) : state.report.findings.slice();
    buildElMap();
    drawPill();
    if (!E.panel.hidden) renderPanel(finished);
    if (prefs.marks) drawMarks();
    if (tipFor && !elMap.has(tipFor)) hideTip();
  };
  UI.setSettings = function (s) {
    settings = s || {};
    if (host) { drawPill(); if (!E.panel.hidden) refreshState(); }
    if (settings.hoverTips === false) hideTip();
  };
  UI.setExtra = function (x) { Object.assign(extra, x || {}); if (host && !E.panel.hidden) renderPanel(); };
  UI.shutdown = function () { if (!host) return; hideTip(); clearWashes(); host.remove(); host = null; root = null; elMap = new Map(); state = null; };
  UI.panelOpen = () => !!(host && !E.panel.hidden);
  // Focus: an open the reader asked for moves focus into the panel; a panel restored on page load must not take it from the site's own search box.
  // On close it goes to the pill when it was in the panel or nowhere; focus the reader has since put in the page stays there.
  let focusBefore = null;
  UI.togglePanel = function (on, opts) {
    mount();
    const wasOpen = !E.panel.hidden; const next = on == null ? E.panel.hidden : !!on;
    if (!next) {
      const page = document.activeElement; const giveBack = wasOpen && (panelHasFocus() || !page || page === document.body || page === document.documentElement);
      E.panel.hidden = true; E.pill.classList.remove('on'); hoverPanel = false; renderPending = false; clearWashes();
      drawPill();
      if (giveBack) { const to = !E.pill.hidden ? E.pill : focusBefore && focusBefore.isConnected ? focusBefore : null; if (to) to.focus({ preventScroll: true }); }
    } else {
      if (!wasOpen) focusBefore = document.activeElement === host ? null : document.activeElement;
      E.panel.hidden = false; E.pill.classList.add('on'); applyGeometry(); if (state) renderPanel(true); refreshState();
      drawPill(); // the pill hides while the panel is open (both sit bottom-right; the panel header says the same)
      if (!wasOpen && !(opts && opts.restore)) E.closeBtn.focus({ preventScroll: true }); // the header is never rebuilt, so this focus survives rescans
      if (tipFor) placeTip(true);
    }
    if (prefs.panelOpen !== next) { prefs.panelOpen = next; savePrefs(); }
    return next;
  };
  UI.locate = function (elId) {
    const el = elById(elId); if (!el) return false;
    try { el.scrollIntoView({ behavior: settings.reducedMotion ? 'auto' : 'smooth', block: 'center' }); } catch (e) { el.scrollIntoView(); }
    clearWashes();
    setTimeout(() => { wash([el], true, 2600); if (elMap.has(el) && settings.hoverTips !== false) { const r = el.getBoundingClientRect(); mouse = { x: r.left + Math.min(40, r.width / 2), y: Math.min(r.bottom, window.innerHeight - 40) }; tipPinned = true; showTip(el); } }, 450);
    return true;
  };
  UI.openFinding = function (id) { UI.togglePanel(true); if (typeof SubtextView !== 'undefined') SubtextView.openFinding(E.main, id); };

  function elById(id) { return ML.elById(id); }
  function refreshState(force) {
    if (!ML.hasChrome) return;
    try {
      chrome.runtime.sendMessage({ type: 'getState' }, (r) => {
        void chrome.runtime.lastError;
        if (!r?.state || !host) return;
        extra.hasKey = !!r.hasKey;
        extra.aiEstimate = r.aiEstimate || '';
        extra.provider = r.settings?.aiProvider || 'anthropic';
        extra.aiInvestigation = r.settings?.aiInvestigation;
        UI.update(r.state);
        if (force && renderPending) renderPanel(true);
      });
    } catch (e) { /* extension reloaded */ }
  }

  // element → findings (strongest first), rebuilt on every report
  function buildElMap() {
    elMap = new Map();
    for (const f of findings) {
      if (f.severity <= 0) continue;
      for (const e of f.evidence || []) {
        const el = elById(e.elId); if (!el || el === document.body || el === document.documentElement) continue;
        const list = elMap.get(el) || []; if (!list.includes(f)) list.push(f); elMap.set(el, list);
      }
    }
  }

  // ---- pill -------------------------------------------------------------------
  function drawPill() {
    if (!host) return;
    if (settings.showBadge === false || !state || !E.panel.hidden) { E.pill.hidden = true; return; }
    const g = MLCommon.glance(findings, state.report.meta);
    E.pill.hidden = false; E.pillDot.style.background = g.color;
    const insight = !g.count && SubtextView.insightStatus(state);
    E.pillTxt.textContent = insight ? 'Subtext · '+insight : g.pill;
    E.pill.classList.toggle('quiet', g.tone === 'quiet');
    E.pill.title = 'Subtext: ' + (insight || g.meta) + '. Click for the report; rest the mouse on a flagged element for the reason.'; E.pill.setAttribute('aria-label', E.pill.title);
    E.pill.setAttribute('aria-expanded', String(!E.panel.hidden));
    placePill();
  }
  // The pill must not cover something the reader may need to click (a cookie banner's settings link, a chat button).
  // Try the chosen corner first, then the others; a corner the reader dragged it to is kept unless something clickable is under it.
  const CORNERS = ['br', 'bl', 'tr', 'tl'];
  function setCorner(c) { const st = E.pill.style; st.top = c[0] === 't' ? '14px' : 'auto'; st.bottom = c[0] === 'b' ? '14px' : 'auto'; st.left = c[1] === 'l' ? '14px' : 'auto'; st.right = c[1] === 'r' ? '14px' : 'auto'; }
  function coversClickable() {
    const r = E.pill.getBoundingClientRect(); if (!r.width) return false;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
    for (const [x, y] of pts) { for (const el of document.elementsFromPoint(x, y)) { if (el === host || host.contains(el)) continue; if (el.closest && el.closest('a[href],button,input,select,textarea,label,[role="button"],[role="link"],[onclick],[tabindex]:not([tabindex="-1"])')) return true; break; } }
    return false;
  }
  function placePill() {
    if (!host || E.pill.hidden) return;
    const first = prefs.pillCorner && CORNERS.includes(prefs.pillCorner) ? prefs.pillCorner : 'br';
    for (const c of [first].concat(CORNERS.filter((x) => x !== first))) { setCorner(c); if (!coversClickable()) return; }
    setCorner(first); // every corner covers something: stay where the reader expects it
  }

  // ---- panel ------------------------------------------------------------------
  // Pages with live feeds rescan every few seconds and each rescan re-renders the report. While the pointer is inside the
  // panel the render is deferred (text must not jump under the reader) and applied on mouseleave; `force` is for renders
  // the reader asked for from inside the panel (Deep analyze, rescan, open).
  let hoverPanel = false, renderPending = false, renderWanted = false;
  function renderAnalyzeButton() {
    if (!ML.hasChrome) { E.aiBtn.textContent = 'Deep analyze (AI)'; return; }
    SubtextView.updateAnalyzeButton(E.aiBtn, state, { hasKey: extra.hasKey, provider: extra.provider, estimate: extra.aiEstimate, investigation: extra.aiInvestigation ?? settings.aiInvestigation, pending: extra.aiBusy, onCancel: () => chrome.runtime.sendMessage({ type: 'cancelInquiry' }, () => void chrome.runtime.lastError) });
  }
  function renderPanel(force) {
    if (!state || !ctx) return;
    renderAnalyzeButton();
    if (hoverPanel && !force && !renderWanted) { renderPending = true; return; }
    renderPending = false; renderWanted = false;
    const g = MLCommon.glance(findings, state.report.meta);
    E.site.textContent = state.report.hostname.replace(/^www\./, '');
    const insight=SubtextView.insightStatus(state);
    E.meta.textContent = (!g.count && insight) || g.meta;
    E.aiBtn.classList.toggle('pb--secondary',!!insight && !extra.hasKey);
    E.aiBtn.classList.toggle('pb--setup', !extra.hasKey);
    E.note.hidden = !g.count; // nothing flagged, nothing to put in context
    E.marksBtn.classList.toggle('on', !!prefs.marks); E.marksBtn.setAttribute('aria-pressed', String(!!prefs.marks));
    const open = SubtextView.openState(E.main); const scrollTop = E.main.scrollTop; const focusKey = focusInReport();
    SubtextView.render(E.main, { state, rules: ctx.rules, labels: ML.labels, findings, open, on: { openCasebook: () => chrome.runtime.sendMessage({type:'openCasebook'}), loadContext: async () => { const res = await chrome.runtime.sendMessage({ type: 'loadContext', route: state.report.url }); refreshState(true); return res; }, /* a render held back while focus is on the button would otherwise keep showing "Looking up…" */ compareRecord: async (key,route) => {
      const res = await chrome.runtime.sendMessage({type:'compareRecord',key,route});
      if (res?.ok) refreshState(true);
      return res;
    }, feedback, muteRule, locate: (id) => UI.locate(id), hover: (f, entering) => { if (entering) wash(elsFor(f), false, 0); else clearWashes(); } } });
    if (extra.notice) { const n = document.createElement('div'); n.className = 'notice' + (extra.noticeErr ? ' err' : ''); n.textContent = extra.notice; E.main.prepend(n); }
    E.main.scrollTop = scrollTop;
    if (focusKey) (E.main.querySelector(focusKey) || (focusKey.startsWith('.investigation__button') && E.main.querySelector('[data-fold="source-comparison"]')) || E.closeBtn).focus({ preventScroll: true });
    E.pill.setAttribute('aria-expanded', 'true');
  }
  // rebuilding the report body drops focus to the page unless it is put back on the same row
  function focusInReport() {
    const a = root && root.activeElement; if (!a || !E.main.contains(a)) return null;
    const esc = window.CSS.escape; // this file's own CSS is the stylesheet string
    if (a.matches('a[href]')) return 'a[href="' + esc(a.getAttribute('href')) + '"]';
    if (a.matches('.card__more[data-fold]')) return '.card__more[data-fold="' + esc(a.dataset.fold) + '"]';
    if (a.matches('.casebook-button')) return '.casebook-button';
    if (a.matches('.investigation__button')) return '.investigation__button[data-record="' + esc(a.dataset.record) + '"]';
    if (a.matches('.sig')) return '.sig[data-id="' + esc(a.dataset.id) + '"]';
    const f = a.closest('.f'); if (f) return '.f[data-id="' + esc(f.dataset.id) + '"] .f__hd';
    const c = a.closest('.cat'); if (c) return '.cat[data-cat="' + esc(c.dataset.cat) + '"] .cat__hd';
    return '.ib-close-fallback'; // no row to return to: the close button takes it
  }
  function feedback(f) { if (ML.hasChrome) chrome.runtime.sendMessage({ type: 'feedback', ruleId: f.id, label: f.label, host: location.hostname, quote: ((f.evidence || [])[0] || {}).quote || '' }, () => void chrome.runtime.lastError); }
  function muteRule(f) { if (!ML.hasChrome) return; chrome.runtime.sendMessage({ type: 'muteRule', ruleId: f.id }, () => void chrome.runtime.lastError); extra.notice = 'Muted "' + f.label + '" on every site. Undo it in Settings.'; extra.noticeErr = false; }
  function elsFor(f) { const out = []; for (const e of f.evidence || []) { const el = elById(e.elId); if (el && !out.includes(el)) out.push(el); } return out; }
  async function deepAnalyze() {
    if (!ML.hasChrome || extra.aiBusy || state?.aiProgress) return;
    if (!extra.hasKey) { chrome.runtime.sendMessage({ type: 'openOptions' }, () => void chrome.runtime.lastError); return; }
    extra.aiBusy = true; extra.notice = ''; renderPanel(true);
    chrome.runtime.sendMessage({ type: 'deepAnalyze' }, (r) => {
      void chrome.runtime.lastError; extra.aiBusy = false;
      if (!r || r.error) { console.warn('[Subtext] AI request failed:', r && r.error); extra.notice = 'Investigate did not finish. ' + MLCommon.plainError(r?.error) + (state && state.ai ? ' The reading below is from the earlier run.' : ''); extra.noticeErr = true; renderPanel(true); return; }
      extra.notice = ''; refreshState(true);
    });
  }

  // ---- geometry + resize (W3C window-splitter pattern on the handles) --------------
  function clampGeometry() {
    const vw = window.innerWidth, vh = window.innerHeight;
    prefs.panelW = Math.round(Math.min(Math.max(prefs.panelW || DEF_W, MIN_W), Math.max(MIN_W, vw - 24)));
    if (prefs.panelH) prefs.panelH = Math.round(Math.min(Math.max(prefs.panelH, MIN_H), vh - 24));
  }
  function applyGeometry() {
    if (!host) return; clampGeometry();
    E.panel.style.width = prefs.panelW + 'px'; E.panel.style.height = prefs.panelH ? prefs.panelH + 'px' : 'calc(100vh - 24px)';
    E.rsW.setAttribute('aria-valuemin', String(MIN_W)); E.rsW.setAttribute('aria-valuemax', String(Math.max(MIN_W, window.innerWidth - 24))); E.rsW.setAttribute('aria-valuenow', String(prefs.panelW));
    E.rsH.setAttribute('aria-valuemin', String(MIN_H)); E.rsH.setAttribute('aria-valuemax', String(window.innerHeight - 24)); E.rsH.setAttribute('aria-valuenow', String(prefs.panelH || window.innerHeight - 24));
    if (tipFor) placeTip(true); // the panel's left edge may have moved under the tooltip
  }
  function installResize() {
    const start = (axis) => (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault(); const sx = ev.clientX, sy = ev.clientY, w0 = prefs.panelW, h0 = prefs.panelH || E.panel.getBoundingClientRect().height;
      const handle = ev.currentTarget; let frame = null, last = ev;
      try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      E.panel.classList.add('dragging');
      const move = (e) => { last = e; if (frame) return; frame = requestAnimationFrame(() => { frame = null; if (axis !== 'h') prefs.panelW = w0 + (sx - last.clientX); if (axis !== 'w') prefs.panelH = h0 + (last.clientY - sy); applyGeometry(); }); };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); E.panel.classList.remove('dragging'); applyGeometry(); savePrefs(); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    };
    E.rsW.addEventListener('pointerdown', start('w')); E.rsH.addEventListener('pointerdown', start('h')); E.rsC.addEventListener('pointerdown', start('c'));
    E.rsW.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 80 : 20; let handled = true;
      if (ev.key === 'ArrowLeft') prefs.panelW += step; else if (ev.key === 'ArrowRight') prefs.panelW -= step; else if (ev.key === 'Home') prefs.panelW = MIN_W; else if (ev.key === 'End') prefs.panelW = window.innerWidth - 24; else if (ev.key === 'Enter') UI.togglePanel(false); else handled = false;
      if (handled) { ev.preventDefault(); applyGeometry(); savePrefs(); }
    });
    E.rsH.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 80 : 20; const cur = prefs.panelH || E.panel.getBoundingClientRect().height; let handled = true;
      if (ev.key === 'ArrowDown') prefs.panelH = cur + step; else if (ev.key === 'ArrowUp') prefs.panelH = cur - step; else if (ev.key === 'Home') prefs.panelH = MIN_H; else if (ev.key === 'End') prefs.panelH = 0; else handled = false;
      if (handled) { ev.preventDefault(); applyGeometry(); savePrefs(); }
    });
    window.addEventListener('resize', () => { if (host) { applyGeometry(); queueRelayout(); } }, { passive: true });
  }

  // ---- hover tooltip (WCAG 1.4.13: dismissible, hoverable, persistent) -------------
  // The tooltip is anchored to the pointer, not to the element's box: on a big element (a feed, a consent wall) the
  // box corner can be far from where the reader is looking. `anchor` is where the pointer was when it opened.
  let tipPinned = false; // opened from the panel (keyboard or click), not by the pointer: scrolling must not close it
  let tipFor = null, openTimer = null, hideTimer = null, pendingEl = null, dismissedEl = null, mouse = { x: 0, y: 0 }, anchor = { x: 0, y: 0 };
  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  function cancelOpen() { if (openTimer) { clearTimeout(openTimer); openTimer = null; } pendingEl = null; }
  function scheduleHide() { cancelHide(); hideTimer = setTimeout(hideTip, CLOSE_DELAY); }
  function hideTip() { cancelHide(); cancelOpen(); tipPinned = false; if (!host) return; E.tip.hidden = true; E.tip.innerHTML = ''; tipFor = null; }
  function hitFor(target) {
    if (!(target instanceof Element) || target === host) return null;
    let e = target, d = 0;
    while (e && d++ < 60) { if (elMap.has(e)) return e; e = e.parentElement; }
    return null;
  }
  function inRect(el, p) { const r = el.getBoundingClientRect(); return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom; }
  function panelHasFocus() { const a = root && root.activeElement; return !!(a && E.panel && E.panel.contains(a)); }
  document.addEventListener('mousemove', (ev) => { mouse = { x: ev.clientX, y: ev.clientY }; }, { capture: true, passive: true });
  document.addEventListener('mouseover', (ev) => {
    mouse = { x: ev.clientX, y: ev.clientY };
    if (!host || !elMap.size || settings.hoverTips === false) return;
    if (ev.target === host) { // events from the shadow tree are retargeted to the host: the tooltip keeps itself alive, the panel and pill do not
      cancelOpen();
      if (tipFor) { if (inRect(E.tip, mouse)) cancelHide(); else scheduleHide(); }
      return;
    }
    const hit = hitFor(ev.target);
    if (hit !== dismissedEl) dismissedEl = null; // Escape dismisses until the pointer leaves that element
    if (!hit || hit === dismissedEl) { if (tipFor || pendingEl) scheduleHide(); return; }
    cancelHide();
    if (hit === tipFor) return;
    if (pendingEl === hit) return;
    pendingEl = hit; if (openTimer) clearTimeout(openTimer);
    openTimer = setTimeout(() => { openTimer = null; if (pendingEl === hit) showTip(hit); }, OPEN_DELAY);
  }, true);
  // Escape: first an open tooltip; then the panel, wherever the pointer is (focus returns to the pill). A key pressed in the page also stays the page's: a site's own dialog still closes.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !host) return;
    if (tipFor) { dismissedEl = tipFor; hideTip(); ev.stopPropagation(); ev.preventDefault(); return; }
    if (openTimer) cancelOpen();
    if (!E.panel.hidden) {
      const fromPanel = ev.target === host; // retargeted: the key came from inside the shadow root
      UI.togglePanel(false);
      // the page element now under the resting pointer gets a synthetic mouseover; the reader asked to dismiss, not to open
      try { dismissedEl = hitFor(document.elementFromPoint(mouse.x, mouse.y)); } catch (e) { dismissedEl = null; }
      if (fromPanel) { ev.stopPropagation(); ev.preventDefault(); }
    }
  }, true);
  // the width left beside the open panel: below TIP_MIN_W a tooltip would only cover the panel, so none shows
  function tipRoom() {
    const m = 8; let maxRight = window.innerWidth - m;
    if (!E.panel.hidden) { const pr = E.panel.getBoundingClientRect(); if (pr.width) maxRight = Math.min(maxRight, pr.left - m); }
    return { maxRight, width: Math.min(TIP_W, maxRight - m) };
  }
  function showTip(el) {
    const fs = (elMap.get(el) || []).slice().sort((a, b) => b.severity - a.severity).slice(0, 3);
    if (!fs.length || tipRoom().width < TIP_MIN_W) { tipPinned = false; return; }
    tipFor = el; const tip = E.tip; tip.innerHTML = '';
    for (const f of fs) {
      const cat = (ML.labels && ML.labels.categories && ML.labels.categories[f.category]) || {};
      const row = document.createElement('div'); row.className = 'tip__row';
      const head = document.createElement('div'); head.className = 'tip__head';
      const glyph = document.createElement('span'); glyph.innerHTML = SubtextView.sevGlyph(f.severity); // a static SVG string chosen by a number
      const chip = document.createElement('span'); chip.className = 'tip__chip'; chip.textContent = f.label;
      const kind = document.createElement('span'); kind.className = 'tip__cat'; kind.textContent = cat.short || '';
      const why = document.createElement('span'); why.className = 'tip__why'; why.textContent = f.why || '';
      head.append(glyph.firstChild, chip, kind, why); row.appendChild(head);
      const more = document.createElement('button'); more.type = 'button'; more.className = 'tip__more'; more.textContent = 'Details'; more.setAttribute('aria-expanded', 'false');
      const detail = document.createElement('div'); detail.className = 'tip__detail'; detail.hidden = true; detail.textContent = f.explain + (f.tip ? ' What to do: ' + f.tip : '');
      more.addEventListener('click', (ev) => { ev.stopPropagation(); detail.hidden = !detail.hidden; more.textContent = detail.hidden ? 'Details' : 'Less'; more.setAttribute('aria-expanded', String(!detail.hidden)); placeTip(true); });
      row.append(more, detail); tip.appendChild(row);
    }
    const foot = document.createElement('div'); foot.className = 'tip__foot';
    const brand = document.createElement('span'); brand.textContent = 'Subtext · Esc to close';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'tip__open'; open.textContent = E.panel.hidden ? 'Open in panel' : 'Show in panel';
    open.addEventListener('click', () => { const id = fs[0].id; hideTip(); UI.openFinding(id); });
    foot.append(brand, open); tip.appendChild(foot);
    anchor = { x: mouse.x, y: mouse.y };
    tip.hidden = false; placeTip(false);
  }
  // Below-right of the pointer; flips left / above at the viewport edges; never crosses the open panel's left edge minus 8 px.
  // `keep` (Details toggled, window resized): hold the current corner and only shift as far as the new size needs, so the
  // pointer stays inside the tooltip and the reader's click does not close what they just opened.
  function placeTip(keep) {
    const vh = window.innerHeight, m = 8, gap = 12; const { maxRight, width: w } = tipRoom();
    if (w < TIP_MIN_W) { hideTip(); return; }
    E.tip.style.width = w + 'px';
    const h = E.tip.offsetHeight;
    let left, top;
    if (keep && !E.tip.hidden) { left = parseFloat(E.tip.style.left) || m; top = parseFloat(E.tip.style.top) || m; }
    else {
      left = anchor.x + gap; if (left + w > maxRight) left = anchor.x - gap - w; // flip left
      top = anchor.y + gap; if (top + h > vh - m) top = anchor.y - gap - h; // flip above
    }
    left = Math.max(m, Math.min(left, maxRight - w));
    top = Math.max(m, Math.min(top, vh - m - h));
    E.tip.style.left = left + 'px'; E.tip.style.top = top + 'px';
  }
  // after a scroll the pointer rests on whatever moved under it: close the tooltip unless that is still its element or the tooltip itself
  function checkTipUnderPointer() {
    if (tipPinned) return; if (!tipFor) return;
    let under = null; try { under = document.elementFromPoint(mouse.x, mouse.y); } catch (e) { /* ignore */ }
    if (under === host) { if (!inRect(E.tip, mouse)) hideTip(); return; }
    if (hitFor(under) !== tipFor) hideTip();
  }

  // ---- overlays: locate wash, panel-hover wash, dot markers -------------------------
  function rectOf(el) { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; if (r.bottom < -200 || r.top > window.innerHeight + 200) return null; return r; }
  function wash(els, strong, ttl) {
    clearWashes();
    for (const el of els.slice(0, 12)) {
      const d = document.createElement('div'); d.className = 'wash' + (strong ? ' strong' : ''); E.layer.appendChild(d); washes.push({ el, d });
    }
    positionWashes();
    if (ttl) setTimeout(() => { for (const w of washes) w.d.style.opacity = '0'; setTimeout(clearWashes, 500); }, ttl);
  }
  function clearWashes() { for (const w of washes) w.d.remove(); washes = []; }
  function positionWashes() {
    for (const w of washes) { const r = rectOf(w.el); if (!r) { w.d.style.display = 'none'; continue; } w.d.style.display = ''; w.d.style.left = (r.left - 3) + 'px'; w.d.style.top = (r.top - 2) + 'px'; w.d.style.width = (r.width + 6) + 'px'; w.d.style.height = (r.height + 4) + 'px'; }
  }
  function drawMarks() {
    for (const m of marks) m.d.remove(); marks = [];
    if (host) { E.marksBtn.classList.toggle('on', !!prefs.marks); E.marksBtn.setAttribute('aria-pressed', String(!!prefs.marks)); }
    if (!prefs.marks || !host) return;
    let n = 0;
    for (const [el, fs] of elMap) {
      const sev = Math.max(...fs.map((f) => f.severity)); if (sev < 2) continue;
      const d = document.createElement('div'); d.className = 'mark'; d.style.background = SEV_COLOR(sev); d.title = fs[0].label; E.layer.appendChild(d); marks.push({ el, d });
      if (++n >= 60) break;
    }
    positionMarks();
  }
  function positionMarks() {
    for (const m of marks) { const r = rectOf(m.el); if (!r || !ML.isVisible(m.el, true)) { m.d.style.display = 'none'; continue; } m.d.style.display = ''; m.d.style.left = (r.left - 5) + 'px'; m.d.style.top = (r.top - 5) + 'px'; }
  }
  function queueRelayout() {
    if (relayoutQueued || !host) return;
    if (!washes.length && !marks.length && !tipFor) return;
    relayoutQueued = true;
    requestAnimationFrame(() => { relayoutQueued = false; positionWashes(); positionMarks(); if (tipFor) { checkTipUnderPointer(); if (tipFor) placeTip(true); } });
  }
  document.addEventListener('scroll', queueRelayout, { capture: true, passive: true });
})();
