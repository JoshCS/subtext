/* Behavior detector: things that only show up over time — countdown timers (and whether they reset on reload),
   infinite scroll, interrupting/exit-intent pop-ups, autoplay media, title-bar notification bait. */
(function () {
  const ML = window.ML;
  const state = { installed: false, findings: new Map(), loadedAt: performance.now(), lastClick: 0, lastScroll: 0, lastMouseLeave: 0, interacted: false, overlays: 0, initialHeight: 0, prevHeight: 0, growthEvents: 0, scrolledNearBottom: false, infiniteFlagged: false, gen: 0, seen: new WeakSet() };
  let titleObserver = null;

  function emit(ctx, f) {
    if (state.stopped) return;
    f = ML.makeFinding(Object.assign({ source: 'behavior' }, f));
    const prev = state.findings.get(f.id);
    if (prev) { prev.count += 1; for (const e of f.evidence) if (prev.evidence.length < 6) prev.evidence.push(e); prev.severity = Math.max(prev.severity, f.severity); Object.assign(prev.meta, f.meta); }
    else state.findings.set(f.id, f);
    if (ctx.onBehavior) ctx.onBehavior(Array.from(state.findings.values()));
  }
  ML.behaviorFindings = () => Array.from(state.findings.values());

  // ---- countdown timers ---------------------------------------------------
  function toSeconds(m) { return (+m[1]) * 3600 + (+m[2]) * 60 + (m[3] != null ? +m[3] : 0); }
  function findTimerElements(cfg) {
    const re = new RegExp(cfg.timers.pattern);
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, guard = 0;
    while ((n = walker.nextNode()) && guard++ < 20000) {
      const t = n.nodeValue; if (!t || t.length > 60) continue;
      const m = t.match(re); if (!m) continue;
      const el = n.parentElement; if (!el || !ML.isVisibleNow(el)) continue;
      out.push({ el, value: toSeconds(m), text: ML.normText(el.parentElement ? el.parentElement.innerText : el.innerText).slice(0, 120) });
      if (out.length >= 8) break;
    }
    // split-digit timers: <span>02</span>:<span>14</span>:<span>59</span> or labelled boxes (hours/mins/secs)
    document.querySelectorAll('[class*="countdown" i],[class*="timer" i],[id*="countdown" i],[id*="timer" i]').forEach((el) => {
      if (out.length >= 10 || !ML.isVisibleNow(el)) return;
      const t = ML.normText(el.innerText || '');
      const digits = t.match(/\d{1,2}/g);
      if (digits && digits.length >= 2 && digits.length <= 4 && t.length < 80 && !out.some((o) => el.contains(o.el) || o.el.contains(el))) {
        const nums = digits.map(Number); let secs = 0; for (const d of nums) secs = secs * 60 + d;
        out.push({ el, value: secs, text: t.slice(0, 120), split: true });
      }
    });
    return out;
  }
  async function checkTimers(ctx) {
    const cfg = ctx.domConfig; const gen = state.gen;
    const first = findTimerElements(cfg);
    if (!first.length) return;
    await new Promise((r) => setTimeout(r, cfg.timers.observeMs));
    if (gen !== state.gen) return; // the page changed route while the clock was being watched
    const live = [];
    for (const f of first) {
      if (!document.contains(f.el)) continue;
      const re = new RegExp(cfg.timers.pattern);
      const t = ML.normText(f.el.innerText || f.el.textContent || '');
      let now = null;
      if (f.split) { const d = t.match(/\d{1,2}/g); if (d) { now = 0; for (const x of d.map(Number)) now = now * 60 + x; } }
      else { const m = t.match(re); if (m) now = toSeconds(m); }
      if (now == null) continue;
      const drop = f.value - now;
      if (drop >= 1 && drop <= Math.ceil(cfg.timers.observeMs / 1000) + 2) live.push({ el: f.el, remaining: now, text: f.text });
    }
    if (!live.length) return;
    emit(ctx, {
      id: 'urgency.live_countdown', category: 'urgency_scarcity', name: 'Live countdown timer', severity: 2, confidence: 0.9,
      biases: ['scarcity', 'loss_aversion', 'present_bias'],
      explain: 'A ticking clock is counting down on this page. Countdown timers raise arousal and cut deliberation time; most e-commerce timers are "evergreen" and restart for each visitor.',
      tip: 'Reload the page. If the timer resets, it is a prop. Subtext checks this automatically on your next visit.',
      evidence: live.slice(0, 3).map((l) => ML.evidenceFor(l.el, l.text)), count: live.length
    });
    // persistence check across loads
    const key = 'timer:' + location.origin + location.pathname;
    const stored = await ML.storage.get(key);
    if (gen !== state.gen) return;
    const nowMs = Date.now();
    const t0 = live[0];
    if (stored && typeof stored.remaining === 'number') {
      const expected = stored.remaining - (nowMs - stored.ts) / 1000; // what it should read now if real
      if (t0.remaining > expected + cfg.timers.resetToleranceSec) {
        emit(ctx, {
          id: 'urgency.fake_countdown_reset', category: 'urgency_scarcity', name: 'Countdown resets on reload (fake deadline)', severity: 3, confidence: 0.9,
          biases: ['scarcity', 'loss_aversion'],
          explain: 'On your previous visit ' + Math.round((nowMs - stored.ts) / 60000) + ' minute(s) ago this timer showed ' + fmt(stored.remaining) + ' remaining. A real deadline would now read about ' + fmt(Math.max(0, expected)) + '; it reads ' + fmt(t0.remaining) + '. The deadline is manufactured per visitor.',
          tip: 'Treat every countdown on this site as decoration.',
          evidence: [ML.evidenceFor(t0.el, t0.text)], count: 1, meta: { previous: stored.remaining, expected: Math.round(expected), observed: t0.remaining }
        });
      }
    }
    await ML.storage.set(key, { remaining: t0.remaining, ts: nowMs, text: t0.text });
  }
  function fmt(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return (h ? h + 'h ' : '') + m + 'm ' + sec + 's'; }

  // ---- interrupting overlays ----------------------------------------------
  function isOverlay(el, cfg) {
    if (!el || el.nodeType !== 1 || !ML.isVisibleNow(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    const z = parseInt(cs.zIndex, 10);
    if (!(z >= cfg.overlay.zIndexMin) && cs.position !== 'fixed') return false;
    if (cs.position === 'absolute' && !el.matches('[role="dialog"],dialog,[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="overlay" i],[class*="lightbox" i],[class*="interstitial" i]')) return false; // a big positioned block is layout, not a pop-up
    const words = String(el.innerText || ''); if (!words.trim() || (words.match(/[$£€]\s?\d/g) || []).length >= 2) return false; // an empty layer or a plan table is not an interruption
    if (el.querySelector('nav,main,[role="main"],[role="navigation"]') || /^\s*skip to\b/i.test(words)) return false; // the page shell, not a pop-up
    const a = ML.rectArea(el.getBoundingClientRect());
    return a >= ML.viewportArea() * cfg.overlay.minViewportAreaRatio;
  }
  function describeTrigger() {
    const now = performance.now();
    if (now - state.lastMouseLeave < 1500) return 'exit-intent (appeared as the cursor left the page)';
    if (now - state.lastScroll < 1500) return 'scroll-triggered';
    if (state.lastClick && now - state.lastClick < 2000) return null; // user-initiated, ignore
    const focus = document.activeElement; if (focus && focus !== document.body && focus.matches && focus.matches('button,a[href],[role="button"]') && state.lastClick && now - state.lastClick < 5000) return null; // opened from the control the reader just used
    return 'timed (appeared on its own after ' + Math.round((now - state.loadedAt) / 1000) + 's)';
  }
  function watchOverlays(ctx) {
    const cfg = ctx.domConfig;
    const handle = (el) => {
      if (state.seen.has(el)) return; state.seen.add(el);
      const trigger = describeTrigger();
      if (!trigger) return;
      const text = ML.normText(el.innerText || '').slice(0, 160);
      if (ctx.requestRescan) ctx.requestRescan(700); // let the DOM/text detectors see the new overlay
      const isConsent = cfg.consent.bannerKeywords.some((k) => text.toLowerCase().includes(k));
      if (isConsent) return; // a cookie dialog is not an interruption by the site's choice; the consent checks in dom.js judge it
      state.overlays++; (state.overlayTexts = state.overlayTexts || []).push(text);
      const exit = trigger.startsWith('exit');
      emit(ctx, {
        id: exit ? 'dark.exit_intent_popup' : 'dark.interrupting_overlay', category: 'dark_pattern',
        name: exit ? 'Exit-intent pop-up' : 'Interrupting pop-up / modal',
        severity: 2, confidence: 0.8,
        biases: exit ? ['loss_aversion', 'interruption', 'fomo'] : ['interruption', 'default_effect'],
        explain: 'A large overlay appeared without you asking for it: ' + trigger + '. ' + (exit ? 'Exit-intent pop-ups fire when you move to leave and almost always offer a sudden discount or a guilt message, exploiting the moment of decision.' : 'Interruptions reset your attention and make the pop-up\'s request the path of least resistance.'),
        tip: 'Close it without reading the offer. If a discount only appears when you try to leave, it was available all along.',
        evidence: [ML.evidenceFor(el, text), { quote: trigger, elId: null }], count: 1, meta: { trigger }
      });
      if (state.overlays >= 3) emit(ctx, {
        id: 'dark.nagging', category: 'dark_pattern', name: 'Nagging: repeated interruptions', severity: 3, confidence: 0.8,
        biases: ['interruption', 'obstruction'],
        explain: state.overlays + ' separate overlays have interrupted this page. Repeated prompts wear down refusal; the hope is that you will say yes to make it stop.',
        tip: 'Saying no repeatedly is fine. Consider whether the site deserves your time.',
        evidence: (state.overlayTexts || []).slice(0, 3).map((q) => ({ quote: q || '(an overlay with no text)', elId: null })), count: state.overlays
      });
    };
    // one timer per burst, at most 50 candidates: a feed adding thousands of nodes must not force thousands of style flushes
    let pending = new Set(), timer = null;
    const flush = () => {
      timer = null; const list = Array.from(pending).slice(0, 50); pending = new Set();
      for (const node of list) {
        if (state.stopped || !document.contains(node)) continue;
        if (isOverlay(node, cfg)) { handle(node); continue; }
        const inner = node.querySelector && node.querySelector('[role="dialog"],[class*="modal" i],[class*="popup" i],[class*="overlay" i],[class*="lightbox" i],[class*="interstitial" i]');
        if (inner && isOverlay(inner, cfg)) handle(inner);
      }
    };
    const mo = new MutationObserver((muts) => {
      if (performance.now() - state.loadedAt < cfg.overlay.minDelayMs) return;
      for (const m of muts) {
        for (const node of m.addedNodes) if (node.nodeType === 1) pending.add(node);
        if (m.type === 'attributes' && m.target.nodeType === 1) pending.add(m.target);
      }
      if (pending.size && !timer) timer = setTimeout(flush, 150);
    });
    state.cleanups.push(() => { mo.disconnect(); clearTimeout(timer); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden', 'aria-hidden'] });
  }

  // ---- infinite scroll -----------------------------------------------------
  function watchScroll(ctx) {
    const cfg = ctx.domConfig;
    state.initialHeight = state.prevHeight = document.documentElement.scrollHeight;
    window.addEventListener('scroll', () => {
      if (state.stopped) return;
      state.lastScroll = performance.now();
      const h = document.documentElement.scrollHeight;
      // the page's own handler usually appends content before ours runs, so judge "near the bottom" against the previous height
      const nearPrevBottom = window.scrollY + window.innerHeight > state.prevHeight - 1500;
      if (h > state.prevHeight * 1.08 && nearPrevBottom) state.growthEvents++;
      state.prevHeight = Math.max(state.prevHeight, h);
      if (state.infiniteFlagged || state.growthEvents < 2 || h < state.initialHeight * cfg.feed.growthRatioForInfiniteScroll || h < window.innerHeight * 4) return;
      state.infiniteFlagged = true; const gen = state.gen;
      setTimeout(() => {
        if (gen !== state.gen) return;
        const now = document.documentElement.scrollHeight;
        const loadMore = Array.from(document.querySelectorAll('button,a')).some((b) => /load more|show more|see more|next page/i.test(b.innerText || ''));
        if (loadMore) return; // a load-more button is a stopping point
        emit(ctx, {
          id: 'attention.infinite_scroll', category: 'attention', name: 'Infinite scroll', severity: 2, confidence: 0.85,
          biases: ['variable_reward', 'zeigarnik', 'default_effect'],
          explain: 'The page grew from ' + Math.round(state.initialHeight) + 'px to ' + Math.round(now) + 'px as you scrolled, loading more content automatically. Infinite scroll removes the natural stopping point that a page end or a "next" button provides; its inventor, Aza Raskin, has publicly regretted it.',
          tip: 'Decide in advance how long you will spend. Set a timer, because the page will not give you a stopping cue.',
          evidence: [{ quote: 'page grew from ' + Math.round(state.initialHeight) + 'px to ' + Math.round(now) + 'px while scrolling', elId: null }], count: 1, meta: { from: state.initialHeight, to: now, growthEvents: state.growthEvents }
        });
      }, 500);
    }, { passive: true });
  }

  // ---- autoplay media -----------------------------------------------------
  function checkMedia(ctx) {
    const media = Array.from(document.querySelectorAll('video,audio')).filter((m) => ML.isVisibleNow(m) || m.tagName === 'AUDIO');
    const playing = media.filter((m) => (m.autoplay || (!m.paused && m.currentTime > 0)) && !state.interacted);
    if (!playing.length) return;
    const withSound = playing.filter((m) => !m.muted && m.volume > 0);
    emit(ctx, {
      id: 'attention.autoplay_media', category: 'attention', name: withSound.length ? 'Autoplaying media with sound' : 'Autoplaying video', severity: withSound.length ? 2 : 0, confidence: 0.85,
      biases: ['interruption', 'default_effect', 'zeigarnik'],
      explain: playing.length + ' media element(s) started playing without you pressing play' + (withSound.length ? ', with sound' : ' (muted)') + '. Autoplay captures attention through motion and makes continuing the default.',
      tip: 'Disable autoplay in your browser or site settings.',
      evidence: playing.slice(0, 3).map((m) => ML.evidenceFor(m, (m.getAttribute('aria-label') || m.getAttribute('title') || m.currentSrc || m.tagName).slice(0, 120))), count: playing.length
    });
  }

  // ---- title-bar bait -----------------------------------------------------
  function watchTitle(ctx) {
    if (titleObserver) titleObserver.disconnect();
    const titleEl = document.querySelector('title'); if (!titleEl) return;
    let original = document.title, url = location.href;
    const mo = titleObserver = new MutationObserver(() => {
      const t = document.title;
      if (location.href !== url) { url = location.href; original = t; return; } // a route change sets a new title; that is navigation
      if (document.hidden && t !== original && /\(\d+\)|\p{Extended_Pictographic}|\bcome back\b|\bdon['’]?t (go|leave|miss|forget)\b|\b(we )?miss(ed)? you\b|\byou('re| are)? missing\b|\bdon['’]?t miss\b/iu.test(t)) {
        emit(ctx, {
          id: 'attention.title_bait', category: 'attention', name: 'Tab title changes to lure you back', severity: 1, confidence: 0.8,
          biases: ['fomo', 'interruption', 'variable_reward'],
          explain: 'While this tab was in the background its title changed to "' + t.slice(0, 60) + '". Flashing or counting titles are a re-engagement trick aimed at your peripheral vision.',
          tip: 'Pin or mute tabs that do this, or close them.',
          evidence: [{ quote: '"' + original.slice(0, 60) + '" became "' + t.slice(0, 60) + '"', elId: null }], count: 1
        });
        mo.disconnect();
      }
    });
    mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  ML.detectors.behavior = {
    install(ctx) {
      if (state.installed) return; state.installed = true; state.cleanups = state.cleanups || [];
      const onPointer = () => { state.lastClick = performance.now(); state.interacted = true; }, onKey = () => { state.interacted = true; }, onLeave = (e) => { if (e.clientY <= 0) state.lastMouseLeave = performance.now(); }, onLeaveRoot = () => { state.lastMouseLeave = performance.now(); };
      document.addEventListener('pointerdown', onPointer, true); document.addEventListener('keydown', onKey, true); document.addEventListener('mouseleave', onLeave, true); document.documentElement.addEventListener('mouseleave', onLeaveRoot, true);
      state.cleanups.push(() => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mouseleave', onLeave, true); document.documentElement.removeEventListener('mouseleave', onLeaveRoot, true); });
      try { watchOverlays(ctx); } catch (e) { /* ignore */ }
      try { watchScroll(ctx); } catch (e) { /* ignore */ }
      try { watchTitle(ctx); } catch (e) { /* ignore */ }
      state.cleanups.push(() => { if (titleObserver) titleObserver.disconnect(); });
      setTimeout(() => { try { checkMedia(ctx); } catch (e) { /* ignore */ } }, ctx.domConfig.media.autoplayCheckDelayMs);
      checkTimers(ctx).catch(() => {});
    },
    // a single-page app moved to a new route: what was seen on the last one is forgotten and the checks start again.
    // state.interacted and lastClick stay: the reader did press something, so a video started by that click is not autoplay
    reset(ctx) {
      state.gen++; if (!state.installed || state.stopped) return;
      const gen = state.gen, h = document.documentElement.scrollHeight;
      state.findings.clear(); state.seen = new WeakSet(); state.overlayTexts = [];
      Object.assign(state, { overlays: 0, loadedAt: performance.now(), initialHeight: h, prevHeight: h, growthEvents: 0, infiniteFlagged: false, scrolledNearBottom: false });
      try { watchTitle(ctx); } catch (e) { /* ignore */ }
      setTimeout(() => { if (gen !== state.gen || state.stopped) return; checkTimers(ctx).catch(() => {}); try { checkMedia(ctx); } catch (e) { /* ignore */ } }, (ctx.domConfig.scanning && ctx.domConfig.scanning.initialDelayMs) || 1200);
    },
    recheck(ctx) { if (state.stopped) return; checkTimers(ctx).catch(() => {}); try { checkMedia(ctx); } catch (e) { /* ignore */ } },
    uninstall() { state.stopped = true; for (const fn of state.cleanups || []) { try { fn(); } catch (e) { /* ignore */ } } state.cleanups = []; }
  };
})();
