/* Public sources for an explicit investigation. Source terms and URLs are validated before any request. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./public-records'));
  else root.SubtextInquirySources = factory(root.SubtextRecords);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Records) {
  'use strict';

  const MAX_BYTES = 1024 * 1024;
  // Short headings/qualifiers should not exhaust the passage count before the
  // fixed character budget can carry the clauses that give them meaning.
  const MAX_PASSAGES = 36;
  const MAX_PASSAGE_CHARS = 4000;
  const MAX_EXCERPT_CHARS = 12000;
  const TIMEOUT_MS = 10000;
  const SEARCH_SIZE = 12;
  const SEC_SEARCH = 'https://efts.sec.gov/LATEST/search-index';
  const PAPER_SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
  const INFO_PATHS = new Set([
    'about', 'about-us', 'how-we-make-money', 'editorial-guidelines', 'editorial-standards',
    'methodology', 'our-methodology', 'advertiser-disclosure', 'disclosure', 'disclosures',
    'advertising', 'partners', 'press',
    'investor', 'investors', 'investor-relations',
  ]);
  const INFO_PARENTS = new Set(['about', 'about-us', 'company', 'legal']);
  const TRANSACTION_PATHS = new Set([
    'terms', 'terms-of-use', 'terms-of-use-agreement', 'terms-of-service',
    'terms-of-service-agreement', 'universal-terms-of-service-agreement', 'terms-and-conditions',
    'terms-of-sale', 'subscription-terms', 'subscription-and-cancellation-terms', 'subscription-policy',
    'cancellation-terms', 'cancellation-policy', 'refund-terms', 'refund-policy', 'return-policy',
    'cancellation-and-refund-policy', 'refund-and-cancellation-policy',
  ]);
  const localCandidates = new WeakMap();

  function publicPage(href) {
    if (typeof href !== 'string' || href.length > 4096 || /[\\\s\x00-\x1f\x7f]/.test(href)) return null;
    const authority = href.match(/^https:\/\/([^/?#]+)/i);
    if (!authority || /[:@%]/.test(authority[1])) return null;
    try {
      const u = new URL(href);
      const host = u.hostname;
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ||
          /\.(?:local|localhost|localdomain|internal|test|invalid|lan|home|corp|intranet|private|onion|arpa|example)$/.test(host)) return null;
      return u;
    } catch (_) { return null; }
  }

  function disclosurePath(pathname) {
    const parts = pathname.toLowerCase().replace(/\/$/, '').slice(1).split('/');
    const leaf = parts.pop().replace(/\.html?$/, '');
    if (parts.length > 1) return '';
    const [parent] = parts;
    if (parent === undefined || INFO_PARENTS.has(parent)) {
      if (INFO_PATHS.has(leaf) || TRANSACTION_PATHS.has(leaf)) return leaf;
    } else if (parent === 'policies' && TRANSACTION_PATHS.has(leaf)) {
      return leaf;
    }
    return '';
  }

  function disclosureUrl(href, pageUrl) {
    const page = publicPage(pageUrl);
    if (!page || typeof href !== 'string' || !href || href.length > 2048 ||
        /[?%\\\s\x00-\x1f\x7f]/.test(href) ||
        /(?:^|\/)\.{1,2}(?:\/|#|$)/.test(href)) return null;
    const authority = href.match(/^(?:https:)?\/\/([^/#]+)/i);
    const absolute = href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href);
    if ((absolute && !authority) || (authority && /[:@]/.test(authority[1]))) return null;
    try {
      const u = new URL(href, page);
      if (u.origin !== page.origin || u.username || u.password) return null;
      if (!disclosurePath(u.pathname)) return null;
      return u.origin + u.pathname;
    } catch (_) { return null; }
  }

  function isTransactionPolicy(url) {
    const checked = disclosureUrl(url, url);
    return Boolean(checked && TRANSACTION_PATHS.has(disclosurePath(new URL(checked).pathname)));
  }

  const cleanLabel = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';

  function candidate(href, pageUrl, label) {
    const record = Records.canonical(href);
    if (record) return { url: record.url, kind: 'record', label: cleanLabel(label, 160) || record.label };
    const url = disclosureUrl(href, pageUrl);
    if (!url) return null;
    const entry = { url, kind: 'disclosure', label: cleanLabel(label, 160) || 'Site disclosure' };
    localCandidates.set(entry, new URL(url).origin);
    return entry;
  }

  async function boundedFetch(fetchImpl, endpoint, options, source) {
    const response = await (fetchImpl || fetch)(endpoint, options);
    if (!response.ok || response.redirected || response.url !== endpoint) throw new Error(source + ' blocked or redirected');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      if (response.body) void response.body.cancel().catch(() => {});
      throw new Error(source + ' exceeds size limit');
    }
    if (!response.body || typeof response.body.pipeThrough !== 'function') throw new Error(source + ' is not stream-readable');
    let bytes = 0;
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, stream) {
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) throw new Error(source + ' exceeds size limit');
        stream.enqueue(chunk);
      },
    }));
    return { ok: response.ok, headers: response.headers, url: response.url, redirected: response.redirected, body };
  }

  function getText(endpoint, fetchImpl, accept, source, signal) {
    return Records.withDeadline(signal, TIMEOUT_MS, source, async requestSignal => {
      const response = await boundedFetch(fetchImpl, endpoint, {
        method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        signal: requestSignal, headers: { Accept: accept },
      }, source);
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const reader = response.body.getReader();
      try {
        if (type !== accept && !(accept === 'text/html' && type === 'application/xhtml+xml')) {
          throw new Error(source + ' returned an unreadable content type');
        }
        const decoder = new TextDecoder();
        let text = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return text + decoder.decode();
          text += decoder.decode(value, { stream: true });
        }
      } finally { void reader.cancel().catch(() => {}); }
    });
  }

  function entities(text) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (encoded, entity) => {
      if (entity[0] !== '#') return Object.hasOwn(named, entity.toLowerCase()) ? named[entity.toLowerCase()] : encoded;
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
    });
  }

  const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const BLOCK = new Set('address article aside blockquote br dd div dl dt h1 h2 h3 h4 h5 h6 hr li main p pre section table td th tr'.split(' '));
  const OMIT = new Set('head template svg math canvas object audio video ix:hidden'.split(' '));
  const RAW = new Set('script style iframe noscript noembed noframes textarea xmp title'.split(' '));

  function hiddenTag(tag, attributes) {
    const attrs = new Map();
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const match of attributes.matchAll(pattern)) {
      const key = match[1].toLowerCase();
      if (!attrs.has(key)) attrs.set(key, entities(match[2] ?? match[3] ?? match[4] ?? '').trim().toLowerCase());
    }
    // strip CSS comments in one pass: a regex retried from every '/*' with no closing '*/' takes quadratic time on a hostile page
    const raw = (attrs.get('style') || '').slice(0, 4000); let style = ''; for (let i = 0; i < raw.length;) { if (raw[i] === '/' && raw[i + 1] === '*') { const e = raw.indexOf('*/', i + 2); if (e < 0) break; i = e + 2; } else style += raw[i++]; }
    style = style.replace(/\s+/g, '');
    return attrs.has('hidden') || attrs.get('aria-hidden') === 'true' ||
      /(?:^|;)(?:display:none|visibility:(?:hidden|collapse)|opacity:0(?:\.0+)?|content-visibility:hidden)(?:!important)?(?:;|$)/.test(style) ||
      /(?:^|\s)(?:hidden|visually-hidden|sr-only|screen-reader-only|screen-reader-text|d-none|u-hidden|invisible)(?:\s|$)/.test(attrs.get('class') || '') ||
      (tag === 'details' && !attrs.has('open')) || (tag === 'dialog' && !attrs.has('open'));
  }

  function visibleText(html) {
    const tokens = /<!--[^]*?(?:-->|$)|<[!?][^>]*(?:>|$)|<(\/?)([a-z][\w:-]*)(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>|[^<]+|</gi;
    const stack = [];
    const lines = [];
    let current = '', title = '', omitted = 0;
    let adjacent = false;
    const newline = () => {
      const line = cleanLabel(entities(current), 5001);
      current = '';
      if (!line) return;
      const prior = adjacent ? lines[lines.length - 1] : '';
      adjacent = false;
      if (line.length >= 12 && line.length <= 5000) {
        lines.push(line);
        adjacent = true;
      } else if (line.length < 12 && /\b(?:except|only|no|not)\b/i.test(line) &&
          prior && prior.length + line.length + 1 <= MAX_PASSAGE_CHARS) {
        lines[lines.length - 1] = prior + ' ' + line;
        adjacent = true;
      }
    };
    for (let match; (match = tokens.exec(html));) {
      const [token, closing, name, attrs] = match;
      if (!name) {
        if (!omitted && !/^<[!?]/.test(token)) current += token;
        continue;
      }
      const tag = name.toLowerCase();
      if (tag === 'plaintext') break;
      if (closing) {
        const index = stack.findLastIndex(entry => entry.tag === tag);
        if (index === -1) continue;
        if (!omitted && BLOCK.has(tag)) newline();
        while (stack.length > index) omitted -= Number(stack.pop().hidden);
        continue;
      }
      if (RAW.has(tag)) {
        const end = new RegExp('</' + tag + '\\s*>', 'gi');
        end.lastIndex = tokens.lastIndex;
        const close = end.exec(html);
        const inHead = omitted === 1 && stack[stack.length - 1]?.tag === 'head';
        if (tag === 'title' && close && !title && (inHead || !stack.length) && !hiddenTag(tag, attrs)) {
          title = cleanLabel(entities(html.slice(tokens.lastIndex, close.index)), 400);
        }
        tokens.lastIndex = close ? end.lastIndex : html.length;
        continue;
      }
      const hidden = OMIT.has(tag) || hiddenTag(tag, attrs);
      if (!omitted && !hidden && BLOCK.has(tag)) newline();
      if (!VOID.has(tag)) {
        if (stack.length >= 128) throw new Error('Disclosure has overly nested HTML');
        stack.push({ tag, hidden });
        omitted += Number(hidden);
      }
    }
    if (!omitted) newline();
    return { title, lines };
  }

  const words = value => (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const common = new Set('the and for are has was were with from into over how what why who our their this that'.split(' '));
  const terms = value => Array.from(new Set(words(value || '').filter(word => word.length > 2 && !common.has(word))));
  function termScore(text, wanted) {
    if (!wanted.length) return 0;
    const actual = new Set(words(text));
    return wanted.reduce((score, word) => score + Number(actual.has(word)), 0);
  }

  const policyWord = word => word === 'auto' ? 'automatic' : word;
  const questionWords = new Set(['can', 'could', 'does', 'mean', 'should', 'would']);

  function disclosurePassages(lines, wanted) {
    const vocabulary = Array.from(new Set(wanted.map(policyWord)));
    const variants = vocabulary.map(word => [word, word + 's', word + 'es', word + 'ed', word + 'ing']);
    const frequency = new Map();
    const ranked = lines.flatMap((line, index) => {
      if (line.length < 25 || line.length > MAX_PASSAGE_CHARS) return [];
      const actual = new Set(words(line).map(policyWord));
      const matches = variants.filter(forms => forms.some(form => actual.has(form))).map(forms => forms[0]);
      for (const word of matches) frequency.set(word, (frequency.get(word) || 0) + 1);
      return [{ line, index, matches }];
    });
    for (const item of ranked) {
      // A scarce term distinguishes a clause better than a word repeated throughout a document.
      item.score = item.matches.reduce((score, word) => score + Math.log1p(ranked.length / frequency.get(word)), 0);
    }
    ranked.sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = new Map();
    let remaining = MAX_EXCERPT_CHARS;
    function add(first, end) {
      const fresh = new Map();
      for (let index = first; index < end; index++) {
        const line = lines[index];
        if (line && line.length <= MAX_PASSAGE_CHARS && !selected.has(line) && !fresh.has(line)) fresh.set(line, index);
      }
      const size = Array.from(fresh.keys()).reduce((total, line) => total + line.length, 0);
      if (size > remaining || selected.size + fresh.size > MAX_PASSAGES) return false;
      for (const [line, index] of fresh) selected.set(line, index);
      remaining -= size;
      return true;
    }
    // Reserve room for distinct direct hits before expanding neighborhoods around them.
    for (const { line, index, score } of ranked) {
      if (!score || selected.size >= MAX_PASSAGES / 2) break;
      if (line.length <= remaining - MAX_EXCERPT_CHARS / 2) add(index, index + 1);
    }
    for (const { line, index, score } of ranked) {
      if (selected.size >= MAX_PASSAGES) break;
      // Carry adjacent conditions with a match before spending the budget on weaker matches.
      if (score > 0 && (add(Math.max(0, index - 1), index + 3) || add(index, index + 3) || add(index, index + 2))) continue;
      if (!selected.has(line)) add(index, index + 1);
    }
    return Array.from(selected).sort((a, b) => a[1] - b[1]).map(([line]) => line);
  }

  async function read(entry, { query, fetchImpl, pageUrl, signal } = {}) {
    const record = entry && entry.kind === 'record' && Records.canonical(entry.url);
    if (record && record.url === entry.url) {
      const doc = await Records.read(record, (url, options) => boundedFetch(fetchImpl, url, options, 'Public record'), { query, signal });
      return { ...doc, kind: 'record' };
    }
    const url = entry && entry.kind === 'disclosure' && disclosureUrl(entry.url, pageUrl || localCandidates.get(entry));
    if (!url || url !== entry.url) throw new Error('Unsupported investigation source');
    const html = await getText(url, fetchImpl, 'text/html', 'Disclosure', signal);
    const { title, lines } = visibleText(html);
    const wanted = terms(typeof query === 'string' ? query.slice(0, 180) : '')
      .filter(word => !questionWords.has(word));
    const passages = disclosurePassages(lines, wanted);
    if (!passages.length) throw new Error('No readable disclosure text');
    return { url, title: title || 'Site disclosure', passages, kind: 'disclosure' };
  }

  function searchTerms(query) {
    if (typeof query !== 'string' || query.length > 150 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’-]*$/u.test(query.trim()) ||
        /[^\p{L}\p{M}\p{N} '’-]/u.test(query) || /\b(?:https?|www|ftp)\b/i.test(query)) {
      throw new Error('Unsupported public search terms');
    }
    return query.trim().replace(/ +/g, ' ');
  }

  function publication(row) {
    if (!row || typeof row.title !== 'string') return null;
    const id = String(row.id);
    const href = row.source === 'MED' && /^[1-9]\d{0,8}$/.test(id) ? 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/' :
      typeof row.doi === 'string' && /^10\./.test(row.doi) ? 'https://doi.org/' + row.doi : '';
    const entry = candidate(href);
    if (!entry) return null;
    const title = cleanLabel(entities(row.title.replace(/<[^>]*>/g, ' ')), 400);
    if (!title) return null;
    const secondary = /\b(?:review|editorial|comment|news|letter)\b/i.test(String(row.pubType || ''));
    return { ...entry, title, date: dateOnly(row.firstPublicationDate), secondary };
  }

  const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';

  function filing(hit) {
    const row = hit && hit._source;
    const file = row && typeof hit._id === 'string' && hit._id.match(/^(\d{10}-\d{2}-\d{6}):([a-z0-9][a-z0-9_.-]{0,119}\.htm)$/i);
    const cik = row && Array.isArray(row.ciks) && typeof row.ciks[0] === 'string' && row.ciks[0].match(/^0*([1-9]\d{0,9})$/);
    if (!file || !cik || (row.adsh && row.adsh !== file[1]) || typeof row.form !== 'string' || !/^[A-Z0-9][A-Z0-9 /-]{0,25}$/.test(row.form) ||
        (row.file_type && row.file_type !== row.form)) return null;
    const entry = candidate('https://www.sec.gov/Archives/edgar/data/' + cik[1] + '/' + file[1].replace(/-/g, '') + '/' + file[2]);
    if (!entry) return null;
    const filer = cleanLabel(Array.isArray(row.display_names) && row.display_names[0], 250).replace(/\s*\(CIK \d+\)$/i, '');
    const title = [filer, row.form].filter(Boolean).join(' · ');
    return { ...entry, title, date: dateOnly(row.file_date) };
  }

  async function discover(input, fetchImpl, { signal } = {}) {
    if (!input || !['filing', 'paper'].includes(input.kind)) throw new Error('Unsupported public search kind');
    const query = searchTerms(input.query);
    const literal = query.split(' ').map(word => '"' + word + '"');
    const paper = input.kind === 'paper';
    const endpoint = new URL(paper ? PAPER_SEARCH : SEC_SEARCH);
    if (paper) {
      const narrow = query.split(' ').filter(word => word.length > 1 && !common.has(word.toLowerCase())).map(word => '"' + word + '"');
      // Weight the supplied title as a phrase, while also accepting nonadjacent topic terms.
      const expression = '(TITLE:"' + query + '"^10 OR TITLE_ABS:(' + (narrow.length ? narrow : literal).join(' AND ') + ')) AND HAS_ABSTRACT:y';
      endpoint.search = new URLSearchParams({ query: expression, format: 'json', resultType: 'lite', pageSize: String(SEARCH_SIZE) });
    } else {
      endpoint.search = new URLSearchParams({ q: literal.join(' '), from: '0', size: String(SEARCH_SIZE) });
    }
    const source = paper ? 'Europe PMC search' : 'SEC search';
    const data = JSON.parse(await getText(endpoint.href, fetchImpl, 'application/json', source, signal));
    const rows = paper ? data && data.resultList && data.resultList.result : data && data.hits && data.hits.hits;
    if (!Array.isArray(rows)) throw new Error(source + ' returned an unreadable result');
    const found = rows.slice(0, SEARCH_SIZE).map(paper ? publication : filing).filter(Boolean);
    if (paper) {
      const wanted = terms(query);
      const exact = words(query).join(' ');
      const rank = item => (words(item.title).join(' ') === exact ? 100 : 0) + termScore(item.title, wanted) - Number(item.secondary) * 2;
      found.sort((a, b) => rank(b) - rank(a));
    }
    const unique = new Map();
    for (const { secondary, ...entry } of found) {
      if (!unique.has(entry.url)) unique.set(entry.url, entry);
    }
    return Array.from(unique.values()).slice(0, 3);
  }

  return { candidate, isTransactionPolicy, read, discover, visibleText };
});
