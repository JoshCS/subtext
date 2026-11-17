/* Popup: "What to know", full breakdown (shared renderer in ui/view.js), and the buttons that act on the page:
   open the in-page panel, rescan, deep analyze. The in-page panel shows the same breakdown beside the page. */
(async function () {
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: SubtextView.CSS }));
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  let tabId = params.get('tabId') ? +params.get('tabId') : null;
  if (params.get('tall')) { document.body.style.maxHeight = 'none'; document.querySelector('main').style.overflow = 'visible'; }
  if (tabId == null) { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab && tab.id; }
  const [rules, labels] = await Promise.all(['rules/text-rules.json', 'rules/labels.json'].map((p) => fetch(chrome.runtime.getURL(p)).then((r) => r.json())));
  let view = null, panelOn = false, aiBusy = false;
  let routeEpoch = 0, announcement = 0;

  function send(msg) { return new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || {}); })); }
  function toTab(msg) { return new Promise((res) => { try { chrome.tabs.sendMessage(tabId, msg, (r) => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } }); }
  function getTab() { return new Promise((res) => chrome.tabs.get(tabId, (tab) => { void chrome.runtime.lastError; res(tab); })); }
  // Match the worker's route semantics. #/ and #! are SPA routes, other fragments are anchors.
  const routeOf = url => String(url || '').replace(/^([^#]*)#(?![!/]).*$/, '$1');
  const onTabRoute = (tab, url) => !!url && routeOf(tab?.pendingUrl || tab?.url) === routeOf(url);
  function showNotice(text, err) { const n = $('#notice'); n.hidden = false; n.textContent = text; n.classList.toggle('err', !!err); }
  function setPanelBtn(on) { panelOn = !!on; $('#panelBtn').classList.toggle('is-on', panelOn); $('#panelBtn').textContent = panelOn ? 'Close panel on page' : 'Open panel on page'; }

  // The header and the toolbar as a set, so a second load() never inherits the last state's buttons. `buttons`: ids to show; none hides the toolbar.
  function chrome_(site, label, meta, buttons) {
    $('#site').textContent = site; $('#site').title = site; $('#label').textContent = label || ''; $('#meta').textContent = meta || '';
    for (const id of ['panelBtn', 'rescanBtn', 'aiBtn']) $('#' + id).hidden = !buttons.includes(id);
    $('#toolbar').hidden = !buttons.length;
  }
  const ALL_BUTTONS = ['panelBtn', 'rescanBtn', 'aiBtn'];
  let scanRetries = 0, retryTimer = null;

  async function load() {
    clearTimeout(retryTimer);
    const epoch = routeEpoch;
    const [r, tab] = await Promise.all([send({ type: 'getState', tabId }), getTab()]);
    if (epoch !== routeEpoch) return;
    const st = onTabRoute(tab, r.state?.report?.url) ? r.state : null;
    view = { ...r, state: st };
    if (!st) {
      const live = await toTab({ type: 'getReport' });
      if (epoch !== routeEpoch) return;
      if (live?.findings && onTabRoute(tab, live.url)) { view = { ...r, state: { report: live } }; render(view); return; }
      const all = await send({ type: 'getSettings' });
      if (epoch !== routeEpoch) return;
      let host = ''; try { host = new URL(tab.pendingUrl || tab.url).hostname.replace(/^www\./, ''); } catch (e) { /* restricted page */ }
      $('#report').innerHTML = ''; $('#ftrNote').hidden = true; $('#footer').hidden = true; $('#notice').hidden = true;
      if (host && (all.disabledSites || []).some((s) => host === s || host.endsWith('.' + s))) {
        chrome_('Subtext is muted on ' + host, '', '', []);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tb'; b.textContent = 'Unmute'; b.title = 'Unmute this site and reload the page'; b.addEventListener('click', async () => { await send({ type: 'unmuteSite', hostname: host }); chrome.tabs.reload(tabId); window.close(); }); $('#report').appendChild(b); return;
      }
      // null means the content script answered and has no report yet; undefined means nothing is listening, which on a tab still loading only means not yet.
      // The first scan can wait several seconds for the ownership lookup, so a slow start is never reported as an unreadable page.
      const coming = live === null || !!(host && tab && tab.status === 'loading');
      if (coming && all.autoScan !== false && scanRetries < 12) { scanRetries++; chrome_(host, 'Scanning…', '', []); retryTimer = setTimeout(load, 800); return; }
      if (live === null) { chrome_(host, 'Not scanned yet', all.autoScan === false ? 'Auto-scan is off in settings.' : '', ['rescanBtn']); $('#rescanBtn').textContent = 'Scan this page'; return; }
      chrome_("Subtext can't read this page", '', '', []);
      showNotice('Subtext runs on normal web pages. It cannot run on browser pages, the web store or PDFs. If this page was open before Subtext was installed, reload it.');
      return;
    }
    render(view);
    const p = await toTab({ type: 'panelState' }); if (p && epoch === routeEpoch) setPanelBtn(p.on);
  }

  function render(r) {
    const st = r.state; const findings = SubtextView.composite(st, labels); const g = MLCommon.glance(findings, st.report.meta);
    chrome_(st.report.hostname.replace(/^www\./, ''), (!g.count && SubtextView.insightStatus(st)) || g.label, g.detail, ALL_BUTTONS);
    $('#rescanBtn').textContent = 'Rescan'; $('#footer').hidden = false; $('#ftrNote').hidden = !g.count;
    const box = $('#report'); const open = SubtextView.openState(box);
    SubtextView.render(box, { state: st, rules, labels, findings, open, on: { openCasebook: () => send({type:'openCasebook',tabId}), loadContext: async () => { const res = await send({ type: 'loadContext', tabId, route: st.report.url }); await load(); return res; }, compareRecord: async (key,route) => { const res=await send({type:'compareRecord',key,route,tabId}); if(res.ok) await load(); return res; }, locate: (elId) => toTab({ type: 'highlight', elId }), feedback: (f) => send({ type: 'feedback', ruleId: f.id, label: f.label, host: st.report.hostname, quote: ((f.evidence || [])[0] || {}).quote || '' }), muteRule: async (f) => { await send({ type: 'muteRule', ruleId: f.id }); showNotice('Muted "' + f.label + '" on every site. Undo it in Settings.'); setTimeout(load, 400); } } });
    updateAnalyzeButton(r);
  }

  function updateAnalyzeButton(r) {
    $('#aiBtn').classList.toggle('tb--setup', !r?.hasKey); // no key yet: the button only opens Settings, so it is drawn as a secondary button
    SubtextView.updateAnalyzeButton($('#aiBtn'), r?.state, { hasKey: r?.hasKey, provider: r?.settings?.aiProvider, estimate: r?.aiEstimate, investigation: r?.settings?.aiInvestigation, pending: aiBusy, onCancel: () => send({ type: 'cancelInquiry', tabId }) });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'ml:state' || msg.tabId !== tabId) return;
    const sequence = ++announcement;
    if (msg.state === null) {
      routeEpoch++;
      view = null; aiBusy = false; scanRetries = 0;
      $('#report').replaceChildren(); $('#notice').hidden = true; $('#footer').hidden = true;
      setPanelBtn(false); updateAnalyzeButton(view);
      chrome_('', 'Scanning…', '', []);
      void load();
      return;
    }
    if (!msg.state?.report || !view) return;
    getTab().then(tab => {
      if (sequence !== announcement || !view || !onTabRoute(tab, msg.state.report.url)) return;
      view = { ...view, state: msg.state };
      if (msg.state.aiProgress) updateAnalyzeButton(view);
      else render(view);
    });
  });

  $('#panelBtn').addEventListener('click', async () => { const r = await toTab({ type: 'togglePanel' }); if (!r) { showNotice('The page has no Subtext content script (reload it first).'); return; } setPanelBtn(r.on); });
  $('#rescanBtn').addEventListener('click', async () => { scanRetries = 0; await toTab({ type: 'rescan' }); setTimeout(load, 600); });
  $('#settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#aboutLink').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#taxonomy') }); });
  $('#aiBtn').addEventListener('click', async () => {
    if (aiBusy || view?.state?.aiProgress) return;
    if (!view?.hasKey) { chrome.runtime.openOptionsPage(); return; }
    const epoch = routeEpoch;
    aiBusy = true; updateAnalyzeButton(view); $('#notice').hidden = true;
    const r = await send({ type: 'deepAnalyze', tabId });
    if (epoch !== routeEpoch) return;
    aiBusy = false;
    if (!r.ai || r.error) { console.warn('[Subtext] AI request failed:', r.error); showNotice('Investigate did not finish. ' + MLCommon.plainError(r.error) + (view && view.state && view.state.ai ? ' The reading below is from the earlier run.' : ''), true); }
    await load();
  });
  load();
})();
