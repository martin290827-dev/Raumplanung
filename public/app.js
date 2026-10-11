'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexOk = (h) => /^#[0-9a-f]{3,8}$/i.test(h || '');
const usd = (n) => n.toFixed(2).replace('.', ',') + ' USD';

let cfg = null;
let projects = [];
let cur = null;            // aktuelles Projekt (inkl. ideas)
let shown = null;          // angezeigtes Redesign (Dateiname) oder null
let pending = null;        // { dataUrl, width, height } im Formular "Neues Projekt"
const ui = { styleId: null, modelId: null, count: 1, concept: '', wishes: '', customPrompt: '', keep: true, furn: new Set() };

function store(k, v) { try { if (v === undefined) return localStorage.getItem('rp.' + k); localStorage.setItem('rp.' + k, v); } catch { return null; } }

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
  return j;
}
let toastTimer;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, bad ? 7000 : 3000);
}

// Bild in ein Canvas laden, auf max. 2048 px verkleinern, als JPEG ausgeben.
function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
// Erst der Browser (JPEG, PNG, WebP, GIF, AVIF, BMP). Sonst wandelt der lokale Server um (HEIC, TIFF und mehr).
async function readPhoto(file) {
  try { return await decodeImage(file); } catch { /* weiter mit Server-Umwandlung */ }
  const ext = (file.name.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1] || 'img';
  let r;
  try { r = await fetch('/api/convert?ext=' + encodeURIComponent(ext), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); }
  catch { throw new Error('Der lokale Server ist nicht erreichbar.'); }
  if (r.status === 404) throw new Error('Der Server läuft noch in einer älteren Version. Im Terminal Strg+C drücken, start.command neu starten und die Seite neu laden.');
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Das Bild konnte nicht gelesen werden.'); }
  try { return await decodeImage(await r.blob()); }
  catch { throw new Error('Das Bild konnte nicht gelesen werden. Bitte als JPEG oder PNG exportieren.'); }
}

/* ---------- Seitenleiste ---------- */
function renderRail() {
  const ul = $('#projects');
  ul.innerHTML = projects.length ? projects.map((p) => `
    <li><button type="button" data-id="${esc(p.id)}" ${cur && cur.id === p.id ? 'aria-current="true"' : ''}>
      <span class="t">${esc(p.title)}</span>
      <span class="s">${esc(p.room)} · ${new Date(p.createdAt).toLocaleDateString('de-AT')}${p.redesigns ? ' · ' + p.redesigns + ' Bild' + (p.redesigns > 1 ? 'er' : '') : ''}</span>
    </button></li>`).join('') : '<li class="s hint">Noch keine Projekte.</li>';
  ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => openProject(b.dataset.id)));
  renderStatus();
}
function renderStatus() {
  if (!cfg) return;
  const b = cfg.budget; const rest = Math.max(0, b.limit - b.used);
  const miss = [!cfg.claude.ok && 'Claude-Schlüssel', !cfg.atlas.ok && 'Atlas-Cloud-Schlüssel'].filter(Boolean);
  $('#status').innerHTML = `Heute ${usd(b.used)} von ${usd(b.limit)}<br>Rest ${usd(rest)}` +
    (miss.length ? `<br><span class="warn">Es fehlt: ${miss.map((m) => esc(m)).join(', ')}. <a href="#" id="toSettings">Einstellungen öffnen</a></span>` : '') +
    `<br>Version ${esc(cfg.version || '')}`;
  const a = $('#toSettings'); if (a) a.addEventListener('click', (e) => { e.preventDefault(); showSettings(); });
}
async function refreshConfig() { cfg = await api('GET', '/api/config'); renderStatus(); }
async function refreshProjects() { projects = await api('GET', '/api/projects'); renderRail(); }

/* ---------- Neues Projekt ---------- */
function showNew() {
  cur = null; shown = null; pending = null; renderRail();
  $('#main').innerHTML = `
  <section class="new">
    <h2>Neues Projekt</h2>
    <label class="drop" id="drop" tabindex="0">
      <input type="file" accept="image/*,.heic,.heif,.tif,.tiff,.avif,.bmp" hidden id="file">
      <span id="dropText">Foto des Raums oder Platzes hierher ziehen, einfügen (Cmd+V) oder klicken<br><small>JPEG, PNG, HEIC (iPhone), WebP, TIFF und mehr</small></span>
    </label>
    <div class="fields">
      <label class="f">Titel<input id="title" maxlength="80" placeholder="z. B. Wohnzimmer Graz"></label>
      <label class="f">Art des Raums<select id="room">${cfg.rooms.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="f">Kurzbeschreibung<textarea id="desc" placeholder="Was soll der Raum können? Was stört dich? Maße, falls bekannt (z. B. 4 × 5 m, Raumhöhe 2,6 m)."></textarea></label>
      <button class="btn primary" id="create" type="button" disabled>Projekt anlegen</button>
      <p class="hint" id="newErr"></p>
    </div>
  </section>`;
  const drop = $('#drop'), file = $('#file');
  const take = async (f) => {
    if (!f) return;
    try {
      pending = await readPhoto(f);
      drop.innerHTML = `<img src="${pending.dataUrl}" alt="Vorschau des Fotos">`;
      $('#create').disabled = false; $('#newErr').textContent = '';
    } catch (e) { toast(e.message, true); }
  };
  drop.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') file.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => take(file.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
  $('#create').addEventListener('click', async () => {
    const btn = $('#create'); btn.disabled = true; btn.classList.add('busy');
    try {
      const meta = await api('POST', '/api/projects', {
        photo: pending.dataUrl, width: pending.width, height: pending.height,
        title: $('#title').value, room: $('#room').value, description: $('#desc').value,
      });
      await refreshProjects(); await openProject(meta.id);
    } catch (e) { $('#newErr').textContent = e.message; $('#newErr').className = 'err'; btn.disabled = false; }
    btn.classList.remove('busy');
  });
}
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item && $('#drop')) { const f = item.getAsFile(); const dt = new DataTransfer(); dt.items.add(f); const inp = $('#file'); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }
});

/* ---------- Projektansicht ---------- */
async function openProject(id) {
  try { cur = await api('GET', '/api/projects/' + id); } catch (e) { return toast(e.message, true); }
  const last = (cur.redesigns || []).slice(-1)[0];
  shown = last ? last.file : null;
  ui.styleId = ui.styleId || store('style') || cfg.styles[0].id;
  ui.modelId = ui.modelId || store('model') || cfg.models[0].id;
  if (!cfg.models.some((m) => m.id === ui.modelId)) ui.modelId = cfg.models[0].id;
  ui.concept = '';
  ui.wishes = cur.wishes || ''; ui.customPrompt = ''; ui.keep = true; ui.furn = new Set();
  renderRail(); renderProject();
}
const fileUrl = (name) => `/files/${encodeURIComponent(cur.id)}/${encodeURIComponent(name)}`;

function stageHTML() {
  const ar = cur.width && cur.height ? (cur.width / cur.height).toFixed(4) : '1.5';
  const before = fileUrl(cur.photo);
  if (!shown) return `<div class="stage" style="--ar:${ar}"><img src="${before}" alt="Foto des Raums"></div>`;
  return `<div class="stage compare" id="cmp" style="--ar:${ar}">
    <img class="after" src="${fileUrl(shown)}" alt="Redesign">
    <img class="before" id="cmpBefore" src="${before}" alt="Originalfoto">
    <div class="handle" id="cmpHandle"></div>
    <span class="tag l">Vorher</span><span class="tag r">Nachher</span>
    <input type="range" min="0" max="100" value="50" id="cmpRange" aria-label="Vorher-Nachher-Regler">
  </div>`;
}

function renderProject() {
  const rds = cur.redesigns || [];
  const concepts = (cur.ideas?.result?.konzepte) || [];
  $('#main').innerHTML = `
  <div class="phead">
    <h2>${esc(cur.title)}</h2>
    <span class="meta">${esc(cur.room)} · ${new Date(cur.createdAt).toLocaleDateString('de-AT')}</span>
    <button class="btn small danger" id="del" type="button">Projekt löschen</button>
  </div>
  ${cur.description ? `<p class="hint">${esc(cur.description)}</p>` : ''}
  <div id="stageWrap">${stageHTML()}</div>
  <div class="thumbs" id="thumbs">${rds.length ? `
    <button type="button" data-f="" aria-pressed="${!shown}" aria-label="Nur Originalfoto"><img src="${fileUrl(cur.photo)}" alt=""></button>
    ${rds.map((r) => `<button type="button" data-f="${esc(r.file)}" aria-pressed="${shown === r.file}" title="${esc(r.style)} · ${esc(r.model)}"><img src="${fileUrl(r.file)}" alt="Redesign ${esc(r.style)}"></button>`).join('')}
    ${shown ? `<a class="dl" href="${fileUrl(shown)}" download>Bild speichern</a>` : ''}` : '<span class="hint">Noch kein Redesign. Wähle unten einen Stil.</span>'}</div>

  <section class="panel">
    <h3>Redesign aus dem Foto</h3>
    <div class="chips" role="group" aria-label="Stilvorlage">${cfg.styles.map((s) => `
      <button type="button" class="chip" data-s="${esc(s.id)}" aria-pressed="${ui.styleId === s.id}">
        <span class="dots">${s.farben.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>${esc(s.name)}</button>`).join('')}</div>
    <label class="f" style="margin-bottom:12px">Eigene Wünsche für das Bild (optional)
      <textarea id="wishes" rows="3" placeholder="z. B. Schuhregal an der linken Wand, Garderobe mit 6 Haken, Sitzbank mit Stauraum. Die Kommode mit den Bildern bleibt.">${esc(ui.wishes)}</textarea>
    </label>
    <label class="opt"><input type="checkbox" id="keep" ${ui.keep ? 'checked' : ''}> Vorhandene Möbel und Raumaufteilung beibehalten</label>
    <div class="row">
      <label class="f">Modell<select id="model">${cfg.models.map((m) => `<option value="${esc(m.id)}" ${m.id === ui.modelId ? 'selected' : ''}>${esc(m.name)} (${m.preis.toFixed(3).replace('.', ',')} USD pro Bild)</option>`).join('')}</select></label>
      <label class="f">Anzahl<select id="count">${[1, 2, 3].map((n) => `<option ${n === ui.count ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f">Nach Konzept<select id="concept"><option value="">Nur Stilvorlage</option>${concepts.map((c, i) => `<option value="${i}" ${String(i) === ui.concept ? 'selected' : ''}>${esc(c.titel)}</option>`).join('')}</select></label>
    </div>
    <div id="furn" style="margin-top:14px"></div>
    <div class="row" style="margin-top:6px"><button class="btn" id="suggest" type="button">Bildanweisung von Claude schreiben lassen</button></div>
    <label class="f" id="pbox" style="margin-top:10px" ${ui.customPrompt ? '' : 'hidden'}>Anweisung an das Bildmodell (englisch, bearbeitbar)
      <textarea id="cprompt" class="mono" rows="7">${esc(ui.customPrompt)}</textarea>
      <span class="hint" style="font-weight:400">Ist dieses Feld gefüllt, wird es statt der automatischen Anweisung verwendet. Leer lassen für automatisch.</span>
    </label>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="go" type="button">Redesign erzeugen</button></div>
    <p class="hint" id="cost"></p>
    <p class="err" id="rdErr"></p>
  </section>

  <section class="panel">
    <h3>Ideen für Raum und Möbel</h3>
    <div class="row">
      <label class="f">Budget (optional)<input id="budget" placeholder="z. B. 1500 EUR" value="${esc(cur.ideas?.budget || '')}"></label>
      <label class="f" style="flex:1;min-width:220px">Zusätzliche Wünsche (optional)<input id="notes" placeholder="z. B. Platz für Homeoffice, Katze, wenig Stauraum"></label>
      <button class="btn primary" id="ideasBtn" type="button">${cur.ideas ? 'Ideen neu erzeugen' : 'Ideen von Claude holen'}</button>
    </div>
    <p class="hint">Claude wertet Foto, Beschreibung und gewählten Stil aus. Maße sind Schätzungen vom Foto.</p>
    <p class="err" id="ideasErr"></p>
    <div id="ideas">${cur.ideas ? ideasHTML(cur.ideas.result) : ''}</div>
  </section>`;

  const upd = () => {
    const m = cfg.models.find((x) => x.id === ui.modelId); const c = m.preis * ui.count;
    $('#cost').textContent = `Geschätzte Kosten: ${usd(c)}. Dauer meist 20 bis 60 Sekunden.`;
  };
  upd();
  $('#del').addEventListener('click', async () => {
    if (!confirm('Projekt mit allen Bildern und Ideen löschen?')) return;
    await api('DELETE', '/api/projects/' + cur.id); await refreshProjects(); showNew();
  });
  $('#thumbs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { shown = b.dataset.f || null; renderProject(); }));
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    ui.styleId = b.dataset.s; store('style', ui.styleId);
    document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#model').addEventListener('change', (e) => { ui.modelId = e.target.value; store('model', ui.modelId); upd(); });
  $('#count').addEventListener('change', (e) => { ui.count = +e.target.value; upd(); });
  const furnReset = () => {
    const c = concepts[ui.concept === '' ? -1 : +ui.concept];
    ui.furn = new Set(c ? (c.moebel || []).map((_, i) => i) : []);
  };
  const renderFurn = () => {
    const c = concepts[ui.concept === '' ? -1 : +ui.concept];
    const box = $('#furn');
    if (!c || !(c.moebel || []).length) { box.innerHTML = ''; return; }
    box.innerHTML = `<fieldset class="furnsel"><legend>Möbel aus dem Konzept im Bild einbauen</legend>${c.moebel.map((m, i) =>
      `<label><input type="checkbox" data-i="${i}" ${ui.furn.has(i) ? 'checked' : ''}><span><b>${esc(m.name)}</b> <span class="hint">${esc(m.platzierung)}</span></span></label>`).join('')}</fieldset>`;
    box.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => { if (inp.checked) ui.furn.add(+inp.dataset.i); else ui.furn.delete(+inp.dataset.i); }));
  };
  $('#concept').addEventListener('change', (e) => { ui.concept = e.target.value; furnReset(); renderFurn(); });
  $('#wishes').addEventListener('input', (e) => { ui.wishes = e.target.value; });
  $('#keep').addEventListener('change', (e) => { ui.keep = e.target.checked; });
  $('#cprompt').addEventListener('input', (e) => { ui.customPrompt = e.target.value; });
  $('#suggest').addEventListener('click', doSuggest);
  renderFurn();
  $('#go').addEventListener('click', doRedesign);
  $('#ideasBtn').addEventListener('click', doIdeas);
  const rng = $('#cmpRange');
  if (rng) {
    const set = () => { $('#cmpBefore').style.clipPath = `inset(0 ${100 - rng.value}% 0 0)`; $('#cmpHandle').style.left = rng.value + '%'; };
    rng.addEventListener('input', set); set();
  }
}

async function doSuggest() {
  const btn = $('#suggest'); btn.disabled = true; btn.classList.add('busy'); $('#rdErr').textContent = '';
  try {
    const out = await api('POST', `/api/projects/${cur.id}/prompt`, { styleId: ui.styleId, conceptIndex: ui.concept, wishes: ui.wishes, keep: ui.keep, furnitureIdx: [...ui.furn] });
    ui.customPrompt = out.prompt; $('#cprompt').value = out.prompt; $('#pbox').hidden = false;
    await refreshConfig(); toast('Anweisung geschrieben. Du kannst sie ändern.');
  } catch (e) { $('#rdErr').textContent = e.message; refreshConfig(); }
  btn.disabled = false; btn.classList.remove('busy');
}
async function doRedesign() {
  const btn = $('#go'); btn.disabled = true; btn.classList.add('busy'); $('#rdErr').textContent = '';
  try {
    const out = await api('POST', `/api/projects/${cur.id}/redesign`, { styleId: ui.styleId, modelId: ui.modelId, count: ui.count, conceptIndex: ui.concept, wishes: ui.wishes, keep: ui.keep, furnitureIdx: [...ui.furn], customPrompt: ui.customPrompt });
    const keepIdeas = cur.ideas; cur = await api('GET', '/api/projects/' + cur.id); cur.ideas = cur.ideas || keepIdeas;
    shown = out.added[out.added.length - 1].file;
    await Promise.all([refreshConfig(), refreshProjects()]); renderProject();
    $('#stageWrap').scrollIntoView({ block: 'start' });
    if (out.errors.length) { $('#rdErr').textContent = out.errors.join(' | '); }
    toast(out.added.length + ' Redesign' + (out.added.length > 1 ? 's' : '') + ' gespeichert');
  } catch (e) { $('#rdErr').textContent = e.message; btn.disabled = false; btn.classList.remove('busy'); refreshConfig(); }
}
async function doIdeas() {
  const btn = $('#ideasBtn'); btn.disabled = true; btn.classList.add('busy'); $('#ideasErr').textContent = '';
  try {
    cur.ideas = await api('POST', `/api/projects/${cur.id}/ideas`, { styleId: ui.styleId, budget: $('#budget').value, notes: $('#notes').value });
    ui.concept = ''; ui.furn = new Set();
    await refreshConfig(); renderProject(); toast('Ideen gespeichert');
  } catch (e) { $('#ideasErr').textContent = e.message; btn.disabled = false; btn.classList.remove('busy'); refreshConfig(); }
}

function list(a) { return (a || []).map((x) => `<li>${esc(x)}</li>`).join(''); }
function ideasHTML(r) {
  if (!r) return '';
  const a = r.analyse || {};
  return `
  <p class="lead">${esc(r.zusammenfassung)}</p>
  <div class="cols">
    <div><h4>Licht</h4><p style="margin:0">${esc(a.licht)}</p></div>
    <div><h4>Probleme</h4><ul>${list(a.probleme)}</ul></div>
    <div><h4>Potenzial</h4><ul>${list(a.potenzial)}</ul></div>
  </div>
  ${(r.konzepte || []).map((c, i) => `
    <article class="concept">
      <h3>${esc(c.titel)}</h3>
      <div class="tags">Aufwand ${esc(c.aufwand)} · Budget ${esc(c.budget_eur)} EUR</div>
      <p class="lead">${esc(c.idee)}</p>
      <div class="swatches">${(c.farben || []).map((f) => `<span class="sw"><i style="background:${hexOk(f.hex) ? esc(f.hex) : 'transparent'}"></i>${esc(f.name)}</span>`).join('')}</div>
      ${(c.materialien || []).length ? `<p style="margin:0 0 6px"><b>Materialien:</b> ${esc(c.materialien.join(', '))}</p>` : ''}
      <ul class="furn">${(c.moebel || []).map((m) => `
        <li><span class="n">${esc(m.name)}</span> · ${esc(m.masse_cm)} cm · ca. ${esc(m.preis_eur)} EUR<br>
        ${esc(m.platzierung)}<br>
        <a href="https://www.google.at/search?tbm=shop&q=${encodeURIComponent(m.suchbegriff || m.name)}" target="_blank" rel="noopener noreferrer">Suchen: ${esc(m.suchbegriff || m.name)}</a></li>`).join('')}</ul>
    </article>`).join('')}
  ${(r.schnelle_erfolge || []).length ? `<div class="concept"><h3>Schnelle Erfolge unter 50 EUR</h3><ul class="quick">${list(r.schnelle_erfolge)}</ul></div>` : ''}
  ${r.hinweis ? `<p class="hint">${esc(r.hinweis)}</p>` : ''}`;
}

/* ---------- Einstellungen ---------- */
async function showSettings() {
  cur = null; shown = null; renderRail();
  let st;
  try { st = await api('GET', '/api/settings'); } catch (e) { return toast(e.message, true); }
  const keyBlock = (id, title, info, s, ph) => `
    <section class="panel">
      <h3>${title}</h3>
      <p class="hint" style="margin:0 0 10px">${info}</p>
      <label class="f">API-Schlüssel
        <input type="password" id="${id}" autocomplete="off" spellcheck="false" placeholder="${s.set ? 'Gespeichert (' + esc(s.hint) + '). Zum Ersetzen neuen Schlüssel einfügen.' : esc(ph)}">
      </label>
      ${s.set ? `<button class="btn small danger" type="button" data-clear="${id}" style="margin-top:8px">Gespeicherten Schlüssel entfernen</button>` : '<p class="err" style="margin-top:8px">Noch kein Schlüssel gespeichert.</p>'}
    </section>`;
  $('#main').innerHTML = `
  <section class="settings">
    <h2>Einstellungen</h2>
    <p class="hint">Die Werte werden in der Datei <b>.env</b> im Programmordner auf diesem Rechner gespeichert. Gespeicherte Schlüssel zeigt die App nie wieder an. Änderungen gelten sofort, ein Neustart ist nicht nötig.</p>
    ${keyBlock('kA', 'Claude (Anthropic)', 'Für die Ideen zu Raum und Möbeln. Schlüssel aus der Anthropic Console.', st.claude, 'sk-ant-…')}
    <section class="panel">
      <h3>Claude-Modell</h3>
      <label class="f">Modellname<input id="kModel" value="${esc(st.claudeModel)}" spellcheck="false"></label>
    </section>
    ${keyBlock('kB', 'Atlas Cloud', 'Für die KI-Redesigns. Schlüssel aus der Atlas-Cloud-Konsole.', st.atlas, 'Atlas-Cloud-Schlüssel')}
    <section class="panel">
      <h3>Kostenlimit</h3>
      <label class="f">Tageslimit in USD<input id="kLimit" inputmode="decimal" value="${esc(String(st.dailyLimit))}"></label>
      <p class="hint">Die App stoppt, wenn die geschätzten Kosten des Tages dieses Limit erreichen.</p>
    </section>
    <div class="row" style="margin-top:18px"><button class="btn primary" id="sSave" type="button">Speichern</button><span id="sMsg" class="hint"></span></div>
    <p class="hint">Version ${esc(st.version)}</p>
  </section>`;
  const save = async (extra) => {
    const body = { claudeModel: $('#kModel').value, dailyLimit: $('#kLimit').value, ...extra };
    if ($('#kA').value) body.anthropicKey = $('#kA').value;
    if ($('#kB').value) body.atlasKey = $('#kB').value;
    const btn = $('#sSave'); btn.disabled = true; btn.classList.add('busy'); $('#sMsg').textContent = ''; $('#sMsg').className = 'hint';
    try { await api('PUT', '/api/settings', body); await refreshConfig(); toast('Gespeichert in .env'); showSettings(); }
    catch (e) { $('#sMsg').textContent = e.message; $('#sMsg').className = 'err'; btn.disabled = false; btn.classList.remove('busy'); }
  };
  $('#sSave').addEventListener('click', () => save({}));
  document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Gespeicherten Schlüssel aus der .env entfernen?')) save(b.dataset.clear === 'kA' ? { clearAnthropic: true } : { clearAtlas: true });
  }));
}

/* ---------- Start ---------- */
$('#newBtn').addEventListener('click', showNew);
$('#setBtn').addEventListener('click', showSettings);
(async () => {
  try {
    await refreshConfig(); await refreshProjects();
    if (projects.length) await openProject(projects[0].id); else showNew();
  } catch (e) { $('#main').innerHTML = `<p class="err">Der Server antwortet nicht: ${esc(e.message)}</p>`; }
})();
