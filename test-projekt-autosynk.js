/* Jans verkstad: forsiktig automatisk synkronisering av Projekt & ritningar.
   Snapshot-formatet och den manuella molnkopieringen forblir oforandrade.
   Ingen automatisk radering; avvikande parallella andringar stoppas. */
(function () {
  'use strict';
  const MAX = 25 * 1024 * 1024;
  const DB = 'jans-verkstad-projekt-test-v1';
  const BUCKET = 'jans-projekt';
  const FIELDS = ['title', 'status', 'tags', 'link', 'notes'];
  let running = false, rerun = false, timer = null, refresh = null;
  const $ = id => document.getElementById(id);
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

  function status(message, kind) {
    const node = $('autoSyncStatus');
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind || 'neutral';
  }
  function ready() {
    return document.visibilityState !== 'hidden' && !$('editor')?.open;
  }
  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('Lokalt lagringsfel'));
    });
  }
  async function localData() {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', {keyPath: 'id'});
        if (!d.objectStoreNames.contains('files')) {
          const store = d.createObjectStore('files', {keyPath: 'id'});
          store.createIndex('byProject', 'projectId', {unique: false});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('Kan inte oppna projektlagring'));
    });
    try {
      const tx = db.transaction(['projects', 'files'], 'readonly');
      const p = tx.objectStore('projects').getAll();
      const f = tx.objectStore('files').getAll();
      const [projects, files] = await Promise.all([request(p), request(f)]);
      return {projects, files};
    } finally {
      db.close();
    }
  }
  async function saveRemoteChanges(changes, expected) {
    if (!changes.projects.length && !changes.files.length) return;
    const originalProjects = new Map(expected.projects.map(p => [p.id, p]));
    const originalFiles = new Set(expected.files.map(f => f.id));
    // Appen kan bara lagga till eller ta bort bilagor, inte andra filinnehall
    // med samma ID. Tillat darfor aldrig automatisk overskrivning av en bilaga.
    if (changes.files.some(f => originalFiles.has(f.id)))
      throw Error('En befintlig bilaga har andrats. Automatisk overskrivning stoppades.');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('Kan inte oppna projektlagring'));
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['projects', 'files'], 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || Error('Projektet andrades under synkroniseringen. Prova igen.'));
        function ensureSameAndWrite(project) {
          const store = tx.objectStore('projects'), get = store.get(project.id);
          get.onsuccess = () => {
            const now = get.result, before = originalProjects.get(project.id);
            if (before) {
              const same = now && projectHash(now) === projectHash(before) &&
                String(now.created || '') === String(before.created || '') &&
                String(now.updated || '') === String(before.updated || '');
              if (!same) { tx.abort(); return; }
              store.put(project);
            } else {
              if (now) { tx.abort(); return; }
              store.add(project);
            }
          };
        }
        for (const project of changes.projects) ensureSameAndWrite(project);
        for (const file of changes.files) tx.objectStore('files').add(file);
      });
    } finally {
      db.close();
    }
  }
  function connection() {
    let conf, session;
    try {
      conf = JSON.parse(localStorage.getItem('jans-verkstad-supabase-v1') || 'null');
      session = JSON.parse(localStorage.getItem('jans-verkstad-auth-v1') || 'null');
    } catch (_) {}
    if (!conf?.url || !conf?.key || !session?.access_token || !session?.user?.id)
      throw Error('Logga in under Molnsynkronisering i verktygsregistret.');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(conf.url))
      throw Error('Molnanslutningen har fel adress.');
    return {url: conf.url, key: conf.key, token: session.access_token, uid: session.user.id};
  }
  function headers(c, type) {
    const h = {apikey: c.key, Authorization: 'Bearer ' + c.token};
    if (type) h['Content-Type'] = type;
    return h;
  }
  async function api(c, method, path, body, type) {
    const response = await fetch(c.url + '/storage/v1/' + path, {
      method, headers: headers(c, type), body, cache: 'no-store'
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw Error('Molninloggningen har gått ut. Logga in igen i verktygsregistret.');
      throw Error('Molntjänsten svarar inte korrekt (' + response.status + ').');
    }
    return response;
  }
  async function snapshots(c) {
    const result = await api(c, 'POST', 'object/list/' + BUCKET,
      JSON.stringify({prefix: c.uid + '/autosynk-test/snapshots/', limit: 100, offset: 0,
        sortBy: {column: 'name', order: 'desc'}}), 'application/json');
    const rows = await result.json();
    if (!Array.isArray(rows)) throw Error('Oväntad svarstyp från molnet.');
    return rows.filter(x => /^projekt-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-[a-f0-9-]+\.json$/.test(x.name))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  function decodeBase64(value, type) {
    const binary = atob(value), out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return new Blob([out], {type: type || 'application/octet-stream'});
  }
  function encodeBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error || Error('Kunde inte läsa bilagan'));
      reader.readAsDataURL(blob);
    });
  }
  function decode(data) {
    if (data?.format !== 'jans-verkstad-projekt-backup-v1' ||
        !Array.isArray(data.projects) || !Array.isArray(data.files))
      throw Error('Molnkopian har fel format.');
    const ids = new Set(), fileIds = new Set();
    const projects = data.projects.map(p => {
      if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 200 ||
          typeof p.title !== 'string' || !p.title || ids.has(p.id))
        throw Error('Ogiltiga projekt i molnkopian.');
      ids.add(p.id);
      return {id: p.id, title: p.title.slice(0, 160),
        status: ['Idé', 'Planerat', 'Pågående', 'Färdigt'].includes(p.status) ? p.status : 'Idé',
        tags: String(p.tags || '').slice(0, 240),
        link: String(p.link || ''), notes: String(p.notes || '').slice(0, 12000),
        created: p.created, updated: p.updated};
    });
    const files = data.files.map(f => {
      if (!f || typeof f.id !== 'string' || !f.id || fileIds.has(f.id) ||
          !ids.has(f.projectId) || typeof f.data !== 'string')
        throw Error('Ogiltiga bilagor i molnkopian.');
      fileIds.add(f.id);
      const blob = decodeBase64(f.data, f.type);
      if (blob.size > MAX || (f.size != null && f.size !== blob.size))
        throw Error('En bilaga har fel storlek.');
      return {id: f.id, projectId: f.projectId,
        name: String(f.name || 'Bilaga').slice(0, 250),
        type: String(f.type || ''), size: blob.size, created: f.created, blob};
    });
    return {projects, files};
  }
  async function latest(c) {
    const list = await snapshots(c);
    if (!list.length) return {name: null, parent: null, ancestors: [], projects: [], files: []};
    const name = list[0].name;
    const response = await api(c, 'GET',
      'object/authenticated/' + BUCKET + '/' + c.uid + '/autosynk-test/snapshots/' + name);
    const raw = await response.text();
    if (raw.length > MAX * 2) throw Error('Molnkopian är för stor.');
    const data = JSON.parse(raw);
    const meta = data?.autosync?.version === 1 ? data.autosync : {};
    return {name, parent: typeof meta.parent === 'string' ? meta.parent : null,
      ancestors: Array.isArray(meta.ancestors)
        ? meta.ancestors.filter(x => typeof x === 'string').slice(-100) : [],
      ...decode(data)};
  }
  function projectHash(p) {
    return JSON.stringify(FIELDS.map(k => String(p[k] || '')));
  }
  async function fileHash(f) {
    if (!(f.blob instanceof Blob)) throw Error('En lokal bilaga kan inte läsas.');
    const dig = await crypto.subtle.digest('SHA-256', await f.blob.arrayBuffer());
    const hex = Array.from(new Uint8Array(dig), x => x.toString(16).padStart(2, '0')).join('');
    return JSON.stringify([f.projectId, f.name, f.type, f.blob.size, hex]);
  }
  async function fingerprints(data) {
    const projects = Object.create(null), files = Object.create(null);
    for (const p of data.projects) {
      if (!p?.id || own(projects, p.id)) throw Error('Ogiltigt eller dubbelt projekt-ID.');
      projects[p.id] = projectHash(p);
    }
    for (const f of data.files) {
      if (!f?.id || own(files, f.id)) throw Error('Ogiltigt eller dubbelt bilage-ID.');
      files[f.id] = await fileHash(f);
    }
    return {projects, files};
  }
  function equalHashes(a, b) {
    for (const type of ['projects', 'files']) {
      const aa = a[type], bb = b[type];
      const keys = Object.keys(aa);
      if (keys.length !== Object.keys(bb).length) return false;
      if (keys.some(k => aa[k] !== bb[k])) return false;
    }
    return true;
  }
  function reconcile(kind, local, remote, hashesL, hashesR, previous) {
    const a = new Map(local.map(x => [x.id, x]));
    const b = new Map(remote.map(x => [x.id, x]));
    const merged = new Map(a), remoteUpdates = [];
    let needUpload = false;
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const hasLocal = a.has(id), hasRemote = b.has(id);
      const hasBase = own(previous, id), old = previous?.[id];
      const l = hashesL[id], r = hashesR[id];
      const label = (a.get(id) || b.get(id))?.title || (a.get(id) || b.get(id))?.name || id;
      if (hasLocal && hasRemote && l === r) continue;
      if (hasLocal && !hasRemote) {
        if (hasBase) throw Error('Möjlig borttagning i molnet: ' + label + '. Ingen överskrivning gjordes.');
        needUpload = true;
      } else if (!hasLocal && hasRemote) {
        if (hasBase) throw Error('Borttaget lokalt: ' + label + '. Borttagningar kräver manuell hantering.');
        merged.set(id, b.get(id));
        remoteUpdates.push(b.get(id));
      } else if (hasBase && l === old && r !== old) {
        merged.set(id, b.get(id));
        remoteUpdates.push(b.get(id));
      } else if (hasBase && r === old && l !== old) {
        needUpload = true;
      } else {
        throw Error('Olika ändringar i ' + kind + ': ' + label + '. Ingen överskrivning gjordes.');
      }
    }
    return {all: [...merged.values()], remoteUpdates, needUpload};
  }
  function baselineKey(uid) {
    return 'jans-projekt-autosynk-test-v1:' + uid;
  }
  async function sync() {
    if (!ready()) return;
    if (!navigator.onLine) { status('Offline – synkroniserar när internet finns.', 'waiting'); return; }
    status('Kontrollerar projekt i molnet …', 'working');
    const c = connection();
    const who = await fetch(c.url + '/auth/v1/user',
      {headers: headers(c), cache: 'no-store'});
    if (!who.ok) throw Error('Logga in igen i verktygsregistret.');
    const user = await who.json();
    if (user.id !== c.uid) throw Error('Molnkontot stämmer inte med inloggningen.');
    const local = await localData(), originalHash = await fingerprints(local);
    const cloud = await latest(c), cloudHash = await fingerprints(cloud);
    if (!ready()) return;
    let previous = null;
    try { previous = JSON.parse(localStorage.getItem(baselineKey(c.uid)) || 'null'); } catch (_) {}
    const base = previous?.version === 1 ? previous : {projects: {}, files: {}};
    // Detect two devices creating distinct snapshots from the same parent.
    // Without ancestry proof never silently accept an unrelated remote edit.
    if (previous?.version === 1 && previous.cloud && cloud.name &&
        previous.cloud !== cloud.name && cloud.parent !== previous.cloud &&
        !cloud.ancestors.includes(previous.cloud) &&
        !equalHashes(cloudHash, {projects: base.projects, files: base.files}) &&
        !equalHashes(originalHash, cloudHash)) {
      throw Error('Molnkopian har en annan versionshistorik. ' +
        'Dina projekt skyddas; använd de manuella molnkopiorna för kontroll.');
    }
    const p = reconcile('projekt', local.projects, cloud.projects,
      originalHash.projects, cloudHash.projects, base.projects);
    const f = reconcile('bilaga', local.files, cloud.files,
      originalHash.files, cloudHash.files, base.files);
    const merged = {projects: p.all, files: f.all};
    const mergedHash = await fingerprints(merged);
    const changedCloud = p.needUpload || f.needUpload;
    const remoteChanges = {projects: p.remoteUpdates, files: f.remoteUpdates};

    // Kontrollera att inget har hunnit redigeras innan vi skriver.
    if (!ready()) { rerun = true; return; }
    const fresh = await fingerprints(await localData());
    if (!equalHashes(fresh, originalHash)) { rerun = true; return; }
    const names = await snapshots(c);
    if ((names[0]?.name || null) !== cloud.name) { rerun = true; return; }
    if (!ready()) { rerun = true; return; }

    if (remoteChanges.projects.length || remoteChanges.files.length) {
      await saveRemoteChanges(remoteChanges, local);
      if (typeof refresh === 'function') await refresh();
    }
    let finalName = cloud.name;
    if (changedCloud) {
      status('Sparar nya ändringar i molnet …', 'working');
      const attachments = [];
      for (const item of merged.files)
        attachments.push({id: item.id, projectId: item.projectId,
          name: item.name, type: item.type, size: item.blob.size,
          created: item.created, data: await encodeBase64(item.blob)});
      const json = JSON.stringify({
        format: 'jans-verkstad-projekt-backup-v1',
        autosync: {version: 1, parent: cloud.name,
          ancestors: [...cloud.ancestors, ...(cloud.name ? [cloud.name] : [])].slice(-100)},
        exported: new Date().toISOString(),
        projects: merged.projects, files: attachments
      });
      const blob = new Blob([json], {type: 'application/json'});
      if (blob.size > MAX)
        throw Error('Projektkopian är större än 25 MB. Använd manuell säkerhetskopia.');
      const beforeUpload = await snapshots(c);
      if ((beforeUpload[0]?.name || null) !== cloud.name) { rerun = true; return; }
      finalName = 'projekt-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-')
        + '-' + crypto.randomUUID() + '.json';
      await api(c, 'POST', 'object/' + BUCKET + '/' + c.uid + '/autosynk-test/snapshots/' + finalName,
        blob, 'application/json');
    }

    localStorage.setItem(baselineKey(c.uid), JSON.stringify({
      version: 1, cloud: finalName, projects: mergedHash.projects, files: mergedHash.files
    }));
    const after = await fingerprints(await localData());
    if (!equalHashes(after, mergedHash)) { rerun = true; return; }
    const newest = await snapshots(c);
    if ((newest[0]?.name || null) !== finalName) {
      rerun = true;
      status('En annan enhet har sparat nya ändringar. Kontrollerar igen …', 'working');
      return;
    }
    status('Synkroniserat med molnet ✓', 'good');
  }

  async function run() {
    timer = null;
    if (running) { rerun = true; return; }
    if (!ready()) return;
    running = true;
    rerun = false;
    try {
      await sync();
    } catch (e) {
      status('Automatisk synkronisering pausad: ' + e.message +
        ' Dina lokala uppgifter är kvar. Se Molnkopior vid behov.', 'error');
    } finally {
      running = false;
      if (rerun && ready()) schedule(500);
    }
  }
  function schedule(delay) {
    if (!ready()) return;
    if (running) { rerun = true; return; }
    clearTimeout(timer);
    timer = setTimeout(run, delay == null ? 900 : delay);
  }
  window.JansProjectAutoSync = {
    start: fn => { refresh = fn; schedule(700); },
    changed: () => schedule(900),
    check: () => schedule(0)
  };
  window.addEventListener('online', () => schedule(500));
  window.addEventListener('focus', () => schedule(700));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(700);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && rerun) schedule(700);
  });
  setInterval(() => { if (ready()) schedule(900); }, 60000);
})();