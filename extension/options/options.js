(async function () {
  const $ = (s) => document.querySelector(s);
  const rules = await fetch(chrome.runtime.getURL('rules/text-rules.json')).then((r) => r.json());
  const settings = await new Promise((res) => chrome.runtime.sendMessage({ type: 'getSettings' }, (r) => res(Object.assign({}, MLCommon.DEFAULT_SETTINGS, r || {}))));
  const P = SubtextAI.PROVIDERS;
  const provSel = $('#provider'); for (const [id, p] of Object.entries(P)) { const o = document.createElement('option'); o.value = id; o.textContent = p.name; provSel.appendChild(o); }
  const modelSel = $('#model'); const customModel = $('#customModel');
  function fillModels() {
    const p = P[provSel.value]; modelSel.innerHTML = '';
    for (const m of p.models) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name + ' · $' + m.inPrice + '/$' + m.outPrice + ' per M tokens'; modelSel.appendChild(o); }
    const o = document.createElement('option'); o.value = '__custom'; o.textContent = 'Custom model id…'; modelSel.appendChild(o);
    const cur = provSel.value === 'openai' ? settings.openaiModel : settings.anthropicModel;
    if (p.models.some((m) => m.id === cur)) { modelSel.value = cur; customModel.hidden = true; } else { modelSel.value = '__custom'; customModel.hidden = false; customModel.value = cur || ''; }
    $('#keyLabel').textContent = p.name + ' API key'; $('#apiKey').placeholder = p.keyHint; $('#apiKey').value = provSel.value === 'openai' ? settings.openaiKey || '' : settings.anthropicKey || '';
    $('#keyUrl').href = p.keyUrl; $('#keyUrl').textContent = p.keyUrl.replace('https://', '');
    price();
  }
  function price() { const p = P[provSel.value]; const m = p.models.find((x) => x.id === modelSel.value) || p.models[0]; $('#price').textContent = 'About $' + ((12000 * m.inPrice + 2500 * m.outPrice) / 1e6).toFixed(3) + ' for a typical single-pass analysis at $' + m.inPrice + ' in / $' + m.outPrice + ' out per million tokens. Inquiry cost depends on the requests it makes.'; }
  provSel.value = settings.aiProvider || 'anthropic'; fillModels();
  provSel.addEventListener('change', () => { // keep the key typed for the previous provider
    if (provSel.dataset.prev === 'openai') settings.openaiKey = $('#apiKey').value.trim(); else settings.anthropicKey = $('#apiKey').value.trim();
    provSel.dataset.prev = provSel.value; fillModels();
  });
  provSel.dataset.prev = provSel.value;
  modelSel.addEventListener('change', () => { customModel.hidden = modelSel.value !== '__custom'; price(); });
  $('#maxChars').value = settings.maxCharsToAI || 40000;
  $('#autoScan').checked = settings.autoScan !== false;
  $('#showBadge').checked = settings.showBadge !== false;
  $('#hoverTips').checked = settings.hoverTips !== false;
  $('#policyScan').checked = settings.policyScan !== false;
  $('#tosdr').checked = !!settings.tosdrLookup;
  $('#rdap').checked = !!settings.rdapLookup;
  $('#adsTxt').checked = settings.adsTxtLookup !== false; $('#sellerPages').checked = settings.sellerPages !== false;
  $('#showUnproven').checked = !!settings.showUnproven;
  const aiInvestigation = $('#aiInvestigation'), aiWebCheck = $('#aiWebCheck');
  aiInvestigation.checked = settings.aiInvestigation !== false;
  aiWebCheck.checked = !!settings.aiWebCheck;
  const aiContextSearch = $('#aiContextSearch'); aiContextSearch.checked = settings.aiContextSearch !== false;
  $('#fecKey').value = settings.fecKey || '';
  $('#contextAuto').checked = !!settings.contextAuto; $('#contextTrends').checked = settings.contextTrends !== false;
  $('#saveContext').addEventListener('click', async () => { $('#save').click(); setTimeout(() => { $('#statusContext').textContent = $('#status').textContent; }, 400); });
  const syncAIMode = () => { aiWebCheck.disabled = aiInvestigation.checked; };
  aiInvestigation.addEventListener('change', syncAIMode);
  syncAIMode();
  $('#disabledSites').value = (settings.disabledSites || []).join('\n');
  const cats = $('#cats'); const catList = $('#catList');
  for (const [id, c] of Object.entries(rules.categories)) {
    const l = document.createElement('label'); l.className = 'check';
    l.innerHTML = '<input type="checkbox" data-cat="' + id + '"' + ((settings.disabledCategories || []).includes(id) ? '' : ' checked') + '> <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + c.color + '"></span> ' + c.name;
    cats.appendChild(l);
    const dt = document.createElement('dt'); dt.textContent = c.name; const dd = document.createElement('dd'); dd.textContent = c.description; catList.append(dt, dd);
  }
  // the AI card has its own Save, so a reader pasting a key need not scroll to the bottom; an empty key field gets focus
  $('#saveAi').addEventListener('click', async () => { $('#save').click(); setTimeout(() => { $('#statusAi').textContent = $('#status').textContent; }, 400); });
  if (!$('#apiKey').value) $('#apiKey').focus();
  $('#save').addEventListener('click', async () => {
    const key = $('#apiKey').value.trim();
    if (provSel.value === 'openai') settings.openaiKey = key; else settings.anthropicKey = key;
    const modelId = modelSel.value === '__custom' ? customModel.value.trim() : modelSel.value;
    const next = {
      aiProvider: provSel.value, anthropicKey: settings.anthropicKey || '', openaiKey: settings.openaiKey || '',
      anthropicModel: provSel.value === 'anthropic' ? modelId : settings.anthropicModel, openaiModel: provSel.value === 'openai' ? modelId : settings.openaiModel,
      maxCharsToAI: Math.max(2000, parseInt($('#maxChars').value, 10) || 40000), autoScan: $('#autoScan').checked, showBadge: $('#showBadge').checked, hoverTips: $('#hoverTips').checked, policyScan: $('#policyScan').checked, tosdrLookup: $('#tosdr').checked, showUnproven: $('#showUnproven').checked, rdapLookup: $('#rdap').checked, adsTxtLookup: $('#adsTxt').checked, sellerPages: $('#sellerPages').checked, aiInvestigation: aiInvestigation.checked, aiWebCheck: aiWebCheck.checked, aiContextSearch: aiContextSearch.checked, contextAuto: $('#contextAuto').checked, fecKey: $('#fecKey').value.trim(), contextTrends: $('#contextTrends').checked,
      disabledSites: $('#disabledSites').value.split(/\s+/).map((s) => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean),
      disabledCategories: Array.from(cats.querySelectorAll('input')).filter((i) => !i.checked).map((i) => i.dataset.cat)
    };
    await new Promise((res) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: next }, res));
    $('#status').textContent = 'Saved.'; setTimeout(() => { $('#status').textContent = ''; }, 2000);
  });
  const callBg = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));
  function drawMuted() {
    const box = $('#mutedRules'); const list = settings.disabledRules || []; box.textContent = list.length ? '' : 'No rules muted.';
    for (const id of list) { const row = document.createElement('div'); const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Unmute'; b.style.marginRight = '8px'; b.addEventListener('click', async () => { await callBg({ type: 'unmuteRule', ruleId: id }); settings.disabledRules = list.filter((x) => x !== id); drawMuted(); }); row.append(b, document.createTextNode(id)); box.appendChild(row); }
  }
  drawMuted();
  async function drawFb() { const r = await callBg({ type: 'getFeedback' }); $('#fbCount').textContent = (r.feedback || []).length + ' "Not accurate" corrections saved on this device. Nothing is sent anywhere.'; return r.feedback || []; }
  drawFb();
  $('#fbExport').addEventListener('click', async () => { const list = await drawFb(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' })); a.download = 'subtext-corrections.json'; a.click(); });
  $('#fbClear').addEventListener('click', async () => { await callBg({ type: 'clearFeedback' }); drawFb(); });
  if (location.hash === '#taxonomy') document.getElementById('taxonomy').scrollIntoView();
})();
