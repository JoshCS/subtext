/* Local, bounded evidence chosen by the reader. Keep this database in the
   extension origin; content scripts never receive a database handle. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubtextEvidenceBook = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DB_NAME = 'subtext-evidence-book';
  const MAX_CASES = 20, MAX_SNAPSHOTS = 12, MAX_SNAPSHOT_CHARS = 12000;

  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object.');
    return value;
  }
  function string(value, label, max, min = 0) {
    if (typeof value !== 'string' || value.length > max || value.trim().length < min) {
      fail(label + ' must contain ' + min + '–' + max + ' characters.');
    }
    return value;
  }
  function id(value, label = 'ID') {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(value)) fail(label + ' is invalid.');
    return value;
  }
  function newId() {
    if (!globalThis.crypto?.randomUUID) fail('Secure IDs are unavailable. Reload Subtext and try again.');
    return globalThis.crypto.randomUUID();
  }
  function sanitizeURL(value) {
    string(value, 'Source URL', 4096, 1);
    let url;
    try { url = new URL(value); } catch (_) { fail('Source URL must be an HTTP or HTTPS address.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      fail('Source URL must be HTTP or HTTPS without credentials.');
    }
    url.search = ''; url.hash = '';
    return url.href;
  }
  function cleanReceipt(value, analysis = false) {
    object(value, 'Receipt');
    const allowed = analysis ? ['page', 'layout', 'history', 'document', 'context'] : ['page', 'layout'];
    if (!allowed.includes(value.source)) fail('Receipt source must be ' + allowed.join(' or ') + '.');
    const receipt = {
      source: value.source,
      label: string(value.label ?? '', 'Receipt label', analysis ? 300 : 150),
      quote: string(value.quote, 'Receipt quote', 1600, 8)
    };
    if (analysis) receipt.id = id(value.id, 'Receipt ID');
    if (value.url !== undefined) receipt.url = sanitizeURL(value.url);
    return receipt;
  }
  function stringChars(value) {
    if (typeof value === 'string') return value.length;
    if (!value || typeof value !== 'object') return 0;
    return Object.values(value).reduce((count, child) => count + stringChars(child), 0);
  }
  function cleanSnapshot(value) {
    object(value, 'Snapshot');
    if (!Array.isArray(value.receipts) || value.receipts.length < 1 || value.receipts.length > 30) {
      fail('A saved step needs 1–30 page or layout receipts.');
    }
    const time = value.observedAt;
    if (typeof time !== 'string' || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) {
      fail('Capture time must be an ISO timestamp.');
    }
    if (typeof value.truncated !== 'boolean') fail('Snapshot truncated must be a boolean.');
    const snapshot = {
      id: value.id === undefined ? newId() : id(value.id, 'Snapshot ID'),
      title: string(value.title ?? '', 'Page title', 200),
      url: sanitizeURL(value.url),
      observedAt: time,
      label: string(value.label ?? '', 'Step label', 100),
      scope: string(value.scope ?? '', 'Capture scope', 60),
      receipts: value.receipts.map(receipt => cleanReceipt(receipt)),
      truncated: value.truncated
    };
    if (stringChars(snapshot) > MAX_SNAPSHOT_CHARS) fail('This step exceeds 12,000 saved characters. Select less evidence.');
    return snapshot;
  }
  // Capture the decision-bearing text before navigation headings consume the
  // receipt limit. Shared with local evaluations of the actual capture path.
  function snapshotFromPacket(packet, metadata) {
    const observed=packet.facts.filter(f=>['page','layout'].includes(f.source));
    const important=[...observed.filter(f=>f.label==='Title').slice(0,1),...observed.filter(f=>f.label==='Credit or disclosure').slice(0,4),...observed.filter(f=>f.source==='layout').slice(0,4),...observed.filter(f=>f.label==='Page text')];
    const ordered=[...new Set([...important,...observed])];
    const receipts=[];let used=0,omitted=0;
    for(const f of ordered)for(let at=0;at<f.quote.length;at+=1600) {
      const quote=f.quote.slice(at,at+1600);
      if(quote.length<8 || receipts.length>=30 || used+quote.length>10500){omitted++;continue;}
      receipts.push({source:f.source,label:f.label,quote});used+=quote.length;
    }
    return cleanSnapshot({...metadata,scope:packet.coverage.scope,receipts,truncated:!!omitted || packet.coverage.textTruncated});
  }
  function evidence(values, min = 1, max = 4) {
    if (!Array.isArray(values) || values.length < min || values.length > max) fail('The reading has an invalid number of receipts.');
    return values.map(value => cleanReceipt(value, true));
  }
  function cleanInvestigation(value) {
    object(value, 'Investigation');
    if (!Array.isArray(value.actors) || value.actors.length > 3 || !Array.isArray(value.explanations) || value.explanations.length !== 2) {
      fail('The investigation must have at most three actors and two explanations.');
    }
    const actors = value.actors.map(actor => {
      object(actor, 'Actor');
      return { name: string(actor.name, 'Actor name', 100, 1), role: string(actor.role, 'Actor role', 180, 1), evidence: evidence(actor.evidence, 1, 2) };
    });
    const h = object(value.hinge, 'Dependency');
    const hinge = { observed: string(h.observed, 'Observed fact', 280, 1), dependency: string(h.dependency, 'Dependency', 320, 1), evidence: evidence(h.evidence, 1, 2) };
    const explanations = value.explanations.map(account => {
      object(account, 'Explanation');
      return { account: string(account.account, 'Account', 280, 1), support: string(account.support, 'Support', 280), evidence: evidence(account.evidence, 0, 2) };
    });
    return { actors, hinge, explanations, discriminator: string(value.discriminator, 'Discriminator', 300, 1) };
  }
  function cleanReading(value) {
    object(value, 'Reading');
    const reading = { lead: string(value.lead, 'Reading lead', 560, 1) };
    for (const [field, max] of [['mechanism', 520], ['alternative', 420], ['check', 360], ['question', 220], ['limit', 420]]) {
      if (value[field] !== undefined) reading[field] = string(value[field], 'Reading ' + field, max);
    }
    if (value.kind !== undefined) {
      if (!['interpretation', 'straightforward'].includes(value.kind)) fail('Reading kind is invalid.');
      reading.kind = value.kind;
    }
    reading.evidence = evidence(value.evidence);
    if (value.more !== undefined) {
      if (!Array.isArray(value.more) || value.more.length > 3) fail('Reading more must be a list of at most three points.');
      reading.more = value.more.map((m) => { object(m, 'Reading point'); return { point: string(m.point, 'Reading point', 300, 1), evidence: evidence(m.evidence) }; });
    }
    if (value.investigation != null) reading.investigation = cleanInvestigation(value.investigation);
    if (value.reviewed !== undefined) {
      if (typeof value.reviewed !== 'boolean') fail('Reading reviewed must be a boolean.');
      reading.reviewed = value.reviewed;
    }
    if (value.revisedByReviewer !== undefined) { if (typeof value.revisedByReviewer !== 'boolean') fail('Reading revisedByReviewer must be a boolean.'); reading.revisedByReviewer = value.revisedByReviewer; }
    return reading;
  }
  function cleanAnalysis(result, snapshotIds) {
    object(result, 'Analysis');
    if (!['complete', 'unsupported', 'insufficient', 'review-failed'].includes(result.status)) fail('Analysis status is invalid.');
    if (result.status === 'complete' ? !result.reading : result.reading != null) fail('Analysis status does not match its reading.');
    const analysis = {
      reading: result.reading == null ? null : cleanReading(result.reading),
      status: result.status,
      snapshotIds,
      analyzedAt: new Date().toISOString()
    };
    if (new TextEncoder().encode(JSON.stringify(analysis)).length > 32768) fail('This reading exceeds the 32 KB storage limit.');
    return analysis;
  }
  function storageError(error) {
    if (error?.name === 'QuotaExceededError') return new Error('The browser has no space for this evidence. Remove a saved case and try again.');
    return error instanceof Error ? error : new Error(error?.message || 'Could not save evidence. Reload Subtext and try again.');
  }

  function createStore(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') fail('Local evidence storage is unavailable in this context.');
    let connection;
    function open() {
      if (connection) return connection;
      connection = new Promise((resolve, reject) => {
        let rejected = false;
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('cases')) request.result.createObjectStore('cases', { keyPath: 'id' });
        };
        request.onerror = () => { rejected = true; reject(storageError(request.error)); };
        request.onblocked = () => { rejected = true; reject(new Error('Evidence storage is busy in another Subtext tab. Close that tab and try again.')); };
        request.onsuccess = () => {
          const db = request.result;
          if (rejected) { db.close(); return; }
          db.onversionchange = () => { db.close(); connection = null; };
          resolve(db);
        };
      }).catch(error => { connection = null; throw error; });
      return connection;
    }
    async function transaction(mode, work) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('cases', mode);
        let value, error;
        const guard = fn => (...args) => {
          try { fn(...args); }
          catch (cause) { error = cause; tx.abort(); }
        };
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(storageError(error || tx.error));
        // Request errors abort the transaction by default; settle only after abort.
        tx.onerror = () => {};
        guard(work)(tx.objectStore('cases'), result => { value = result; }, guard);
      });
    }
    function requireCase(record) {
      if (!record) fail('This case no longer exists. Reopen the casebook and choose another case.');
      return record;
    }
    async function mutate(caseId, change) {
      id(caseId, 'Case ID');
      return transaction('readwrite', (store, done, guard) => {
        const request = store.get(caseId);
        request.onsuccess = guard(() => {
          const record = requireCase(request.result);
          change(record);
          record.revision++;
          record.updatedAt = new Date().toISOString();
          store.put(record);
          done(record);
        });
      });
    }
    return {
      async list() {
        return transaction('readonly', (store, done, guard) => {
          const request = store.getAll();
          request.onsuccess = guard(() => done(request.result.map(record => ({
            id: record.id, title: record.title, updatedAt: record.updatedAt, count: record.snapshots.length, revision: record.revision
          })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))));
        });
      },
      async create(title) {
        title = string(title, 'Case title', 200, 1).trim();
        const now = new Date().toISOString();
        const record = { id: newId(), title, createdAt: now, updatedAt: now, revision: 1, snapshots: [], analysis: null };
        return transaction('readwrite', (store, done, guard) => {
          const request = store.count();
          request.onsuccess = guard(() => {
            if (request.result >= MAX_CASES) fail('The casebook holds up to 20 cases. Delete a case before creating another.');
            store.add(record); done(record);
          });
        });
      },
      async get(caseId) {
        id(caseId, 'Case ID');
        return transaction('readonly', (store, done, guard) => {
          const request = store.get(caseId);
          request.onsuccess = guard(() => done(requireCase(request.result)));
        });
      },
      async capture(caseId, snapshot) {
        const clean = cleanSnapshot(snapshot);
        return mutate(caseId, record => {
          if (record.snapshots.length >= MAX_SNAPSHOTS) fail('A case holds up to 12 steps. Remove a step before saving another.');
          if (record.snapshots.some(step => step.id === clean.id)) fail('This step is already saved in the case.');
          record.snapshots.push(clean); record.analysis = null;
        });
      },
      async removeStep(caseId, snapshotId) {
        id(snapshotId, 'Snapshot ID');
        return mutate(caseId, record => {
          const index = record.snapshots.findIndex(step => step.id === snapshotId);
          if (index < 0) fail('This saved step no longer exists. Reopen the case and try again.');
          record.snapshots.splice(index, 1); record.analysis = null;
        });
      },
      async delete(caseId) {
        id(caseId, 'Case ID');
        return transaction('readwrite', (store, done, guard) => {
          const request = store.get(caseId);
          request.onsuccess = guard(() => { requireCase(request.result); store.delete(caseId); done(true); });
        });
      },
      async saveAnalysis(caseId, snapshotIds, result, expectedRevision) {
        if (!Array.isArray(snapshotIds) || snapshotIds.length < 2 || snapshotIds.length > 3) fail('Select two or three saved steps to compare.');
        const selected = snapshotIds.map(value => id(value, 'Snapshot ID'));
        if (new Set(selected).size !== selected.length) fail('Select different saved steps to compare.');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('The case revision is required before saving a reading.');
        const analysis = cleanAnalysis(result, selected);
        return mutate(caseId, record => {
          if (record.revision !== expectedRevision) fail('This case changed during analysis. Select its steps and analyze again.');
          if (selected.some(selectedId => !record.snapshots.some(step => step.id === selectedId))) fail('A selected step no longer exists. Select the steps again.');
          record.analysis = analysis;
        });
      }
    };
  }
  return { createStore, cleanSnapshot, sanitizeURL, snapshotFromPacket };
});
