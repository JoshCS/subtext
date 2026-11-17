/* Case records are supplied only by the extension worker. All saved text remains text. */
(function () {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const rawSourceTab = params.get('sourceTab');
  const sourceTabId = rawSourceTab !== null && /^\d+$/.test(rawSourceTab) && Number.isSafeInteger(Number(rawSourceTab)) ? Number(rawSourceTab) : null;
  // "Save this page" opens the casebook with save=1. Drop the flag from the address before any await,
  // so a reload (even one during the save) never saves the page a second time. sourceTab stays.
  const saveOnArrival = params.get('save') === '1' && sourceTabId !== null;
  if (params.has('save')) {
    params.delete('save');
    const query = params.toString();
    history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash);
  }
  const DEFAULT_CASE_TITLE = 'Saved pages';
  let cases = [], current = null, selected = new Set(), comparison = null, busy = false, hasKey = null;

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The request took too long. It may still finish; reopen the case before trying again.')), 240000);
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) { reject(new Error(runtimeError.message || 'Could not contact Subtext. Reload the extension and try again.')); return; }
          if (response?.error) { reject(new Error(typeof response.error === 'string' ? response.error : response.error.message || 'The request failed.')); return; }
          if (!response || !Object.prototype.hasOwnProperty.call(response, 'data')) { reject(new Error('Subtext returned no result. Reload the extension and try again.')); return; }
          resolve(response.data);
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }

  function status(text, error = false) {
    const el = $(error ? '#error' : '#status');
    el.textContent = text || '';
    el.hidden = !text;
  }

  function controls() {
    document.querySelectorAll('button, input').forEach((el) => { el.disabled = busy; });
    if (!busy) {
      $('#analyze').disabled = selected.size < 2 || selected.size > 3;
      document.querySelectorAll('.step-select input').forEach((el) => { el.disabled = !el.checked && selected.size >= 3; });
    }
    $('#case-content').setAttribute('aria-busy', String(busy));
    $('#analyze').textContent = busy && comparison?.pending ? 'Analyzing selected evidence…' : 'Analyze selected evidence';
  }

  // The Analyze button reports beside itself: the top notice sits far above it on a long case.
  function analyzeError(text) {
    const el = $('#analyze-error');
    el.textContent = text || '';
    el.hidden = !text;
  }

  function renderKeyHint() { $('#analyze-key').hidden = hasKey !== false; }

  // getState answers hasKey (a yes/no) without the key. Ask for tab -1 so no page report comes back either.
  function checkKey() {
    try {
      chrome.runtime.sendMessage({ type: 'getState', tabId: -1 }, (response) => {
        if (chrome.runtime.lastError || !response || typeof response.hasKey !== 'boolean') return;
        hasKey = response.hasKey; renderKeyHint();
      });
    } catch (_) { /* the hint is optional; Analyze still reports a missing key */ }
  }

  // work may return a line to keep in the top notice once it finishes.
  // With besideAnalyze, a failure shows under the Analyze button instead of the top notice, and takes focus.
  async function run(message, work, besideAnalyze = false) {
    if (busy) return;
    busy = true; status(''); status('', true); analyzeError(''); status(message); controls();
    let inlineFailure = false;
    try { const done = await work(); status(typeof done === 'string' ? done : ''); }
    catch (error) {
      status('');
      const text = error?.message || 'Something went wrong. Please try again.';
      if (besideAnalyze) { analyzeError(text); inlineFailure = true; } else status(text, true);
    }
    finally {
      busy = false; if (comparison?.pending) comparison = null; controls();
      // focus only after controls(): the button was disabled while busy
      if (inlineFailure) $('#analyze-error').focus();
    }
  }

  function date(value) {
    const d = new Date(value);
    return value && Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'time unavailable';
  }

  function safeURL(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch (_) { return null; }
  }

  function sourceLink(url, label) {
    const safe = safeURL(url);
    if (!safe) return null;
    const link = node('a', '', label);
    link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  }

  function receiptKey(receipt) { return [receipt.id || receipt.source || '', receipt.quote, receipt.url || ''].join('\n'); }

  function uniqueReceipts(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((receipt) => {
      if (!receipt || typeof receipt.quote !== 'string' || !receipt.quote.trim()) return false;
      const key = receiptKey(receipt);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  function scopeLabel(scope) {
    if (scope === 'visible-page-text' || scope === 'visible-page' || scope === 'Visible page excerpt') return 'Visible page excerpt';
    if (scope === 'selected-excerpt' || scope === 'Selected excerpt') return 'Selected excerpt';
    return 'Saved excerpts';
  }

  function receipts(into, values, numbered = false) {
    const list = uniqueReceipts(values);
    if (!list.length) { into.appendChild(node('p', 'small muted', 'No saved excerpts.')); return; }
    for (const [index, receipt] of list.entries()) {
      const item = node('div', 'receipt');
      item.appendChild(node('p', 'receipt-label', (numbered ? `[${index + 1}] ` : '') + (receipt.label || receipt.source || 'Saved excerpt')));
      item.appendChild(node('blockquote', '', receipt.quote));
      const link = sourceLink(receipt.url, 'Open cited source');
      if (link) item.appendChild(link);
      into.appendChild(item);
    }
  }

  function snapshots() { return Array.isArray(current?.snapshots) ? current.snapshots : []; }
  function selectedSnapshots() { return snapshots().filter((snapshot) => selected.has(snapshot.id)); }
  function selectionKey() { return [...selected].sort().join('\n'); }

  function adopt(record, reset = false) {
    if (!record?.id || !Array.isArray(record.snapshots)) throw new Error('Subtext returned an incomplete case.');
    current = record;
    const ids = new Set(record.snapshots.map((snapshot) => snapshot.id));
    const savedIds = Array.isArray(record.analysis?.snapshotIds) ? record.analysis.snapshotIds : [];
    const savedSelection = savedIds.length >= 2 && savedIds.length <= 3 && new Set(savedIds).size === savedIds.length && savedIds.every((id) => ids.has(id));
    selected = reset ? new Set(savedSelection ? savedIds : []) : new Set([...selected].filter((id) => ids.has(id)));
    comparison = null;
    if (savedSelection && [...savedIds].sort().join('\n') === selectionKey()) comparison = { result: record.analysis, key: selectionKey() };
    const summary = { id: record.id, title: record.title, updatedAt: record.updatedAt, count: record.snapshots.length };
    cases = [summary, ...cases.filter((entry) => entry.id !== record.id)];
    render();
  }

  function renderCases() {
    const list = $('#case-list'); list.replaceChildren();
    if (!cases.length) list.appendChild(node('p', 'small muted', 'No saved cases yet.'));
    for (const entry of cases) {
      const button = node('button', 'case-link'); button.type = 'button';
      if (entry.id === current?.id) button.setAttribute('aria-current', 'true');
      button.appendChild(node('span', '', entry.title || 'Untitled case'));
      button.appendChild(node('span', 'small muted', `${entry.count || 0} saved ${entry.count === 1 ? 'step' : 'steps'}`));
      button.addEventListener('click', () => run('Opening case…', async () => { adopt(await send('caseGet', { id: entry.id }), true); }));
      list.appendChild(button);
    }
  }

  function renderSteps() {
    const list = $('#steps'); list.replaceChildren();
    const values = snapshots();
    $('#step-count').textContent = `${values.length} saved`;
    $('#selection-help').textContent = selected.size === 3 ? 'Three steps selected. Deselect one to choose another.' : 'Select two or three saved steps to compare.';
    if (!values.length) list.appendChild(node('p', 'empty-steps', 'No captured evidence yet. Save a source page to begin.'));
    values.forEach((snapshot, index) => {
      const step = node('article', 'step');
      const row = node('div', 'step-row');
      const label = node('label', 'step-select');
      const input = node('input'); input.type = 'checkbox'; input.checked = selected.has(snapshot.id);
      input.setAttribute('aria-describedby', 'selection-help');
      input.addEventListener('change', () => {
        if (busy) return;
        if (input.checked && selected.size < 3) selected.add(snapshot.id); else selected.delete(snapshot.id);
        comparison = null; analyzeError(''); renderSteps(); renderComparison(); controls();
        const replacement = Array.from($('#steps').querySelectorAll('input'))[index];
        replacement?.focus();
      });
      label.append(input, node('span', '', snapshot.label || snapshot.title || `Step ${index + 1}`));
      const remove = node('button', 'quiet', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${snapshot.label || snapshot.title || `step ${index + 1}`}`);
      remove.addEventListener('click', () => {
        if (busy || !window.confirm('Remove this captured step from the case? This cannot be undone.')) return;
        void run('Removing step…', async () => adopt(await send('caseRemoveStep', { id: current.id, snapshotId: snapshot.id })));
      });
      row.append(label, remove); step.appendChild(row);
      step.appendChild(node('p', 'step-meta', `Captured ${date(snapshot.observedAt)}`));
      const detail = node('details'); detail.appendChild(node('summary', '', 'Show saved evidence'));
      if (snapshot.title && snapshot.label) detail.appendChild(node('p', 'small muted', snapshot.title));
      detail.appendChild(node('p', 'small muted', scopeLabel(snapshot.scope)));
      if (snapshot.truncated) detail.appendChild(node('p', 'small muted', 'Text limit reached: only part of the visible page was saved.'));
      const link = sourceLink(snapshot.url, 'Open source page'); if (link) detail.appendChild(link);
      receipts(detail, snapshot.receipts); step.appendChild(detail); list.appendChild(step);
    });
  }

  function renderReading() {
    const box = $('#reading'); box.replaceChildren(); box.hidden = true;
    if (!comparison || comparison.pending || comparison.key !== selectionKey()) return;
    box.hidden = false;
    box.appendChild(node('p', 'eyebrow', 'AI reading'));
    const reading = comparison.result?.reading;
    if (!reading) {
      const message = {
        'review-failed': 'The review could not finish, so there is no conclusion to show.',
        insufficient: 'There was too little saved evidence to compare.',
        unsupported: 'No supported comparison emerged from these excerpts.'
      }[comparison.result?.status] || 'No comparison is available.';
      box.appendChild(node('p', '', message + ' The saved evidence is still available above.'));
      return;
    }
    if (reading.lead) box.appendChild(node('p', 'reading-lead', reading.lead));
    for (const [field, heading] of [['mechanism', 'How it works'], ['check', 'What to check next']]) {
      if (typeof reading[field] !== 'string' || !reading[field]) continue;
      const section = node('div', 'reading-section');
      section.append(node('h4', '', heading), node('p', '', reading[field])); box.appendChild(section);
    }
    const detail = node('details'), cited = [], citationIndex = new Map();
    const refs = (values) => uniqueReceipts(values).map((receipt) => {
      const key = receiptKey(receipt);
      if (!citationIndex.has(key)) { cited.push(receipt); citationIndex.set(key, cited.length); }
      return `[${citationIndex.get(key)}]`;
    }).join(' ');
    const section = (heading, text, evidence) => {
      if (typeof text !== 'string' || !text.trim()) return;
      const block = node('div', 'reading-section'), paragraph = node('p', '', text);
      const references = refs(evidence);
      if (references) paragraph.appendChild(node('sup', '', ` ${references}`));
      if (heading) block.appendChild(node('h4', '', heading));
      block.appendChild(paragraph); detail.appendChild(block);
    };
    const joinText = (...values) => values.filter((value) => typeof value === 'string' && value.trim()).join(' ');
    refs(reading.evidence);
    section('Another explanation', reading.alternative);
    const brief = reading.investigation;
    if (brief && typeof brief === 'object') {
      section('The key dependency', joinText(brief.hinge?.observed, brief.hinge?.dependency), brief.hinge?.evidence);
      for (const actor of Array.isArray(brief.actors) ? brief.actors : []) {
        if (actor) section(typeof actor.name === 'string' ? actor.name : 'Actor', actor.role, actor.evidence);
      }
      const explanations = Array.isArray(brief.explanations) ? brief.explanations : [];
      explanations.forEach((explanation, index) => {
        if (explanation) section(index === 0 ? 'Competing explanations' : '', joinText(explanation.account, explanation.support), explanation.evidence);
      });
      section('What distinguishes them', brief.discriminator);
    }
    if (detail.childElementCount || cited.length) {
      detail.prepend(node('summary', '', 'Show evidence and context' + (cited.length ? ` (${cited.length})` : '')));
      if (cited.length) receipts(detail, cited, true);
      box.appendChild(detail);
    }
  }

  function renderComparison() {
    const values = selectedSnapshots();
    $('#comparison').hidden = values.length === 0;
    $('#selection-count').textContent = `${values.length} of 3 selected`;
    const grid = $('#comparison-grid'); grid.replaceChildren();
    values.forEach((snapshot) => {
      const card = node('article', 'evidence-card');
      card.appendChild(node('p', 'step-number', `Step ${snapshots().indexOf(snapshot) + 1}`));
      card.appendChild(node('h4', '', snapshot.label || snapshot.title || 'Captured page'));
      card.appendChild(node('p', 'small muted', `Captured ${date(snapshot.observedAt)}`));
      if (snapshot.title && snapshot.label) card.appendChild(node('p', 'small muted', snapshot.title));
      card.appendChild(node('p', 'small muted', scopeLabel(snapshot.scope)));
      if (snapshot.truncated) card.appendChild(node('p', 'small muted', 'Text limit reached: only part of the visible page was saved.'));
      const link = sourceLink(snapshot.url, 'Open source page'); if (link) card.appendChild(link);
      const excerpts = uniqueReceipts(snapshot.receipts);
      receipts(card, excerpts.slice(0, 2));
      if (excerpts.length > 2) {
        const detail = node('details', 'more-excerpts');
        detail.appendChild(node('summary', '', `Show ${excerpts.length - 2} more saved excerpts`));
        receipts(detail, excerpts.slice(2)); card.appendChild(detail);
      }
      grid.appendChild(card);
    });
    renderReading();
  }

  function render() {
    renderCases();
    $('#welcome').hidden = !!current; $('#case-detail').hidden = !current;
    if (current) {
      $('#current-title').textContent = current.title || 'Untitled case';
      $('#current-meta').textContent = 'Saved evidence in this browser profile';
      $('#capture-form').hidden = sourceTabId === null;
      $('#source-note').textContent = sourceTabId === null ? 'Open the casebook from Subtext on a page to save it here.' : 'Save the page you opened this casebook from. You can navigate that page and save another step here.';
      renderSteps(); renderComparison();
    }
    controls();
  }

  $('#create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('#case-title').value.trim();
    if (!title) { status('Enter a title for this case.', true); return; }
    void run('Creating case…', async () => { adopt(await send('caseCreate', { title }), true); $('#case-title').value = ''; });
  });

  $('#capture-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || sourceTabId === null) return;
    void run('Saving the current source page…', async () => {
      adopt(await send('caseCapture', { id: current.id, sourceTabId, label: $('#step-label').value.trim() }));
      $('#step-label').value = '';
    });
  });

  $('#delete-case').addEventListener('click', () => {
    if (busy || !current || !window.confirm('Delete this case and all its saved evidence? This cannot be undone.')) return;
    void run('Deleting case…', async () => {
      const id = current.id; await send('caseDelete', { id });
      cases = cases.filter((entry) => entry.id !== id); current = null; selected.clear(); comparison = null;
      render();
      if (cases.length) adopt(await send('caseGet', { id: cases[0].id }), true);
    });
  });

  $('#analyze').addEventListener('click', () => {
    if (busy || !current || selected.size < 2 || selected.size > 3) return;
    const key = selectionKey(), id = current.id, snapshotIds = selectedSnapshots().map((snapshot) => snapshot.id);
    comparison = { pending: true, key }; renderReading();
    void run('Analyzing the selected saved evidence. This can take a few minutes…', async () => {
      const result = await send('caseCompare', { id, snapshotIds });
      comparison = { result, key }; renderReading();
    }, true).then(checkKey);
  });

  $('#open-settings').addEventListener('click', (event) => {
    // the href stays as a fallback if the worker cannot open the settings page
    try { chrome.runtime.openOptionsPage(); event.preventDefault(); } catch (_) { /* follow the link */ }
  });
  // A key added in Settings in another tab shows up when the reader comes back here.
  window.addEventListener('focus', checkKey);

  // Save this page: the newest case, or a new "Saved pages" case, through the same capture call as the button.
  async function saveSourcePage(list) {
    const target = list[0] ? await send('caseGet', { id: list[0].id }) : await send('caseCreate', { title: DEFAULT_CASE_TITLE });
    // Select the case before saving: if the save is refused, the reader still has the case and its manual save button.
    adopt(target, true);
    adopt(await send('caseCapture', { id: target.id, sourceTabId, label: '' }));
    return `Saved this page to “${current.title || 'Untitled case'}”.`;
  }

  checkKey();
  void run(saveOnArrival ? 'Saving this page…' : 'Loading your cases…', async () => {
    const result = await send('caseList');
    if (!Array.isArray(result)) throw new Error('Subtext returned an incomplete case list.');
    cases = result; render();
    if (saveOnArrival) {
      // the worker lists cases newest first; sort again here so the choice does not depend on it
      const newest = [...cases].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return saveSourcePage(newest);
    }
    const requested = params.get('case');
    const first = cases.find((entry) => entry.id === requested) || cases[0];
    if (first) adopt(await send('caseGet', { id: first.id }), true);
  });
})();
