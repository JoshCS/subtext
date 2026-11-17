/* Bounded, read-only public records. No publisher-page scraping or credentials. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubtextRecords = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  const TIMEOUT_MS = 8000;
  function canonical(href) {
    if (typeof href !== 'string' || href.length > 2048 || /[\\\s\x00-\x1f]/.test(href)) return null;
    try {
      const u = new URL(href);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || /^https:\/\/[^/]*@/i.test(href)) return null;
      // Reject path escapes before URL normalization can remove dot segments.
      const rawPath = href.replace(/^https:\/\/[^/]+/i, '').split(/[?#]/)[0];
      if (/%(?:2e|2f|5c)/i.test(rawPath) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return null;
      let m, id, kind, label, url;
      if (u.hostname === 'pubmed.ncbi.nlm.nih.gov' && (m = u.pathname.match(/^\/([1-9]\d{0,8})\/?$/))) {
        id = m[1]; kind = 'pubmed'; label = 'PubMed ' + id; url = 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/';
      } else if (['doi.org', 'dx.doi.org'].includes(u.hostname) || (['www.nejm.org', 'nejm.org'].includes(u.hostname) && /^\/doi\/(?:full|abs|pdf|epdf)\/10\./i.test(u.pathname))) {
        id = decodeURIComponent(u.pathname.replace(/^\/doi\/(?:full|abs|pdf|epdf)\//i, '/').slice(1));
        if (!/^10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._;()/:+\-]{0,400}$/.test(id) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(id)) return null;
        id = id.toLowerCase(); kind = 'doi'; label = 'DOI ' + id; url = 'https://doi.org/' + id;
      } else if (['www.nature.com','nature.com'].includes(u.hostname) && (m = u.pathname.match(/^\/articles\/(s\d{5}-\d{3}-\d{5}-[\da-z])\/?$/i))) {
        id='10.1038/'+m[1].toLowerCase(); kind='doi'; label='DOI '+id; url='https://doi.org/'+id;
      } else if (u.hostname === 'clinicaltrials.gov' && (m = u.pathname.match(/^\/study\/(NCT\d{8})\/?$/i))) {
        id = m[1].toUpperCase(); kind = 'trial'; label = 'ClinicalTrials.gov ' + id; url = 'https://clinicaltrials.gov/study/' + id;
      } else if (['www.sec.gov', 'sec.gov'].includes(u.hostname) && (m = u.pathname.match(/^\/Archives\/edgar\/data\/([1-9]\d{0,9})\/(\d{18})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.htm)$/))) {
        id = m[1] + '/' + m[2] + '/' + m[3]; kind = 'sec'; label = 'SEC filing'; url = 'https://www.sec.gov/Archives/edgar/data/' + id;
      } else return null;
      return { key: kind + ':' + id, url, kind, label };
    } catch (_) { return null; }
  }
  function plain(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').replace(/<!--[^]*?-->/g, ' ').replace(/<(script|style|noscript|ix:hidden)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
      .replace(/<h[1-6]\b[^>]*>/gi, '\n').replace(/<\/(?:p|div|h[1-6]|tr|li|section|abstract|title)>/gi, '\n').replace(/<br\b[^>]*>/gi, '\n').replace(/<\/?[A-Za-z][^>]*>/g, ' ')
      .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (_, entity) => {
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
        if (entity[0] !== '#') return named[entity.toLowerCase()];
        const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        const legacy = { 128: '€', 130: '‚', 132: '„', 133: '…', 145: '‘', 146: '’', 147: '“', 148: '”', 150: '–', 151: '—' };
        if (legacy[n]) return legacy[n];
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
      }).replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }
  const short = (value, max = 900) => plain(value).slice(0, max);
  function passages(value, limit = 16) {
    const out = [];
    for (const paragraph of plain(value).split(/\n+/)) {
      // Split only after punctuation + whitespace; decimals remain untouched.
      // Keep complete sentences: a long sentence may carry a late qualifier.
      const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/);
      let chunk = '';
      for (const sentence of sentences) {
        const s = sentence.trim();
        if (!s) continue;
        if (chunk && chunk.length + s.length > 1200) { out.push(chunk); chunk = ''; }
        if (out.length >= limit) return out;
        // Reject pathological unbroken source text rather than silently clipping it.
        if (s.length > 4000) continue;
        chunk += (chunk ? ' ' : '') + s;
      }
      if (chunk) out.push(chunk);
      if (out.length >= limit) break;
    }
    return out;
  }
  async function body(response) {
    const length = Number(response.headers && response.headers.get('content-length'));
    if (length > MAX_BYTES) throw new Error('Public record exceeds size limit');
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Public record is not stream-readable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0, text = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('Public record exceeds size limit');
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally { try { await reader.cancel(); } catch (_) { /* closed */ } }
  }
  function publication(data, record) {
    const results = data && data.resultList && data.resultList.result;
    const r = Array.isArray(results) && results.find(item => item && (record.kind === 'pubmed'
      ? String(item.id) === record.key.slice(7) && item.source === 'MED'
      : typeof item.doi === 'string' && item.doi.toLowerCase() === record.key.slice(4)));
    if (!r || !plain(r.abstractText)) throw new Error('No readable matching abstract');
    return { title: short(r.title, 400), passages: passages(r.abstractText), url: record.url, kind: record.kind };
  }
  function trial(data, record) {
    const p = data && data.protocolSection;
    if (!p || !p.identificationModule || p.identificationModule.nctId !== record.key.slice(6)) throw new Error('No matching trial');
    const out = [];
    const add = (label, value) => { const s = short(value); if (s) out.push(label + ': ' + s); };
    const sponsor = p.sponsorCollaboratorsModule || {};
    add('Lead sponsor', sponsor.leadSponsor && sponsor.leadSponsor.name);
    add('Collaborators', (sponsor.collaborators || []).map(x => x.name).filter(Boolean).join('; '));
    const d = p.designModule || {}, design = d.designInfo || {};
    add('Study type', d.studyType); add('Phases', (d.phases || []).join(', '));
    add('Allocation', design.allocation); add('Intervention model', design.interventionModel);
    add('Observational model', design.observationalModel); add('Time perspective', design.timePerspective);
    add('Primary purpose', design.primaryPurpose); add('Masking', design.maskingInfo && design.maskingInfo.masking);
    if (d.enrollmentInfo && Number.isFinite(d.enrollmentInfo.count)) add('Enrollment', String(d.enrollmentInfo.count) + (d.enrollmentInfo.type ? ' (' + d.enrollmentInfo.type + ')' : ''));
    for (const outcome of ((p.outcomesModule || {}).primaryOutcomes || []).slice(0, 5)) {
      add('Primary outcome', [outcome.measure, outcome.description, outcome.timeFrame && 'Time frame: ' + outcome.timeFrame].filter(Boolean).join('. '));
    }
    if (!out.length) throw new Error('No readable trial fields');
    return { title: short(p.identificationModule.officialTitle || p.identificationModule.briefTitle, 400), passages: out, url: record.url, kind: record.kind };
  }
  async function withDeadline(signal, timeoutMs, source, work) {
    if (signal?.aborted) throw new Error(source + ' cancelled');
    const controller = new AbortController();
    let timer, cancel;
    const stopped = new Promise((_, reject) => {
      const stop = reason => { reject(new Error(source + ' ' + reason)); controller.abort(); };
      cancel = () => stop('cancelled');
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => stop('timed out'), timeoutMs);
    });
    try { return await Promise.race([stopped, work(controller.signal)]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); }
  }
  async function read(input, fetchImpl, { query, signal } = {}) {
    const record = canonical(typeof input === 'string' ? input : input && input.url);
    if (!record) throw new Error('Unsupported public record');
    // Rebuild every endpoint from the canonical identifier, never trust input keys.
    let endpoint = record.url;
    if (record.kind === 'pubmed' || record.kind === 'doi') {
      const query = record.kind === 'pubmed' ? 'EXT_ID:' + record.key.slice(7) + ' AND SRC:MED' : 'DOI:"' + record.key.slice(4) + '"';
      endpoint = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' + encodeURIComponent(query) + '&format=json&resultType=core&pageSize=5';
    } else if (record.kind === 'trial') endpoint = 'https://clinicaltrials.gov/api/v2/studies/' + record.key.slice(6);
    return withDeadline(signal, TIMEOUT_MS, 'Public record', async requestSignal => {
      const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);
      if (!fetcher) throw new Error('Fetch unavailable');
      const response = await fetcher(endpoint, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: requestSignal, headers: { Accept: record.kind === 'sec' ? 'text/html' : 'application/json' } });
      if (!response.ok || response.redirected || (response.url && response.url !== endpoint)) throw new Error('Public record blocked or redirected');
      const type = response.headers && response.headers.get('content-type') || '';
      if (!(record.kind === 'sec' ? /text\/html|application\/xhtml\+xml/i : /application\/json/i).test(type)) throw new Error('Unreadable public record type');
      const text = await body(response);
      if (record.kind === 'sec') {
        if (/your request originates from an undeclared automated tool|request rate threshold exceeded|access denied/i.test(plain(text).slice(0, 2000))) throw new Error('SEC record blocked');
        const words = value => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        const common = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this']);
        const terms = new Set(typeof query === 'string' ? words(query.slice(0, 150)).filter(word => word.length > 2 && !common.has(word)) : []);
        const candidates = passages(text.replace(/<head\b[^>]*>[^]*?<\/head>/i, ''), terms.size ? Infinity : 400).filter(x => x.length >= 25);
        const items = candidates.map((text, index) => ({
          text, index, score: terms.size ? Array.from(new Set(words(text))).filter(word => terms.has(word)).length : 0,
        })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 28).sort((a, b) => a.index - b.index).map(item => item.text);
        if (!items.length) throw new Error('No readable filing text');
        return { title: short((text.match(/<title\b[^>]*>([^]*?)<\/title>/i) || [])[1], 400) || 'SEC filing', passages: items, url: record.url, kind: record.kind };
      }
      const data = JSON.parse(text);
      return record.kind === 'trial' ? trial(data, record) : publication(data, record);
    });
  }
  return { canonical, read, withDeadline };
});
