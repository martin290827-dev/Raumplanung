'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexOk = (h) => /^#[0-9a-f]{3,8}$/i.test(h || '');
const eur = (n) => Math.round(n).toLocaleString('de-AT');
function parseBudget(str) {
  const m = String(str || '').match(/\d[\d.\u2009 ]*(?:,\d+)?/g); if (!m) return 0;
  const nums = m.map((x) => parseFloat(x.replace(/[.\u2009 ]/g, '').replace(',', '.'))).filter((n) => isFinite(n));
  return nums.length ? Math.max(...nums) : 0;
}
// Konzept fürs erste Redesign: mit Budget das, das es am besten ausnutzt (und nicht übersteigt), sonst das mittlere.
function recommendedConcept(meta, concepts) {
  if (!concepts || !concepts.length) return -1;
  const bud = parseBudget(meta && meta.budget);
  if (bud > 0) {
    let best = -1, bestHi = -1, lowest = 0, lowestHi = Infinity;
    concepts.forEach((c, i) => {
      const s = conceptSum(c); if (!s) return;
      if (s.hi <= bud && s.hi > bestHi) { best = i; bestHi = s.hi; }
      if (s.hi < lowestHi) { lowest = i; lowestHi = s.hi; }
    });
    return best >= 0 ? best : lowest;
  }
  return concepts.length >= 3 ? 1 : Math.floor((concepts.length - 1) / 2);
}
function conceptSum(c) {
  let lo = 0, hi = 0, ok = false;
  for (const m of c.moebel || []) {
    const a = Number(m.preis_min_eur), b = Number(m.preis_max_eur);
    if (isFinite(a) && isFinite(b) && (a || b)) { lo += a; hi += b; ok = true; }
  }
  return ok ? { lo, hi } : null;
}
const usd = (n) => n.toFixed(2).replace('.', ',') + ' USD';

let cfg = null;
let projects = [];
let cur = null;            // aktuelles Projekt (inkl. ideas)
let shown = null;          // angezeigtes Redesign (Dateiname) oder null
let pending = null;        // { dataUrl, width, height } im Formular "Neues Projekt"
const ui = { styleId: null, modelId: null, count: 1, concept: '', prompt: '', edited: false, keep: true, furn: new Set(), own: new Set() };

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
function decodeImage(blob, maxDim = 2048) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
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
async function readPhoto(file, maxDim = 2048) {
  try { return await decodeImage(file, maxDim); } catch { /* weiter mit Server-Umwandlung */ }
  const ext = (file.name.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1] || 'img';
  let r;
  try { r = await fetch('/api/convert?ext=' + encodeURIComponent(ext), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); }
  catch { throw new Error('Der lokale Server ist nicht erreichbar.'); }
  if (r.status === 404) throw new Error('Der Server läuft noch in einer älteren Version. Im Terminal Strg+C drücken, start.command neu starten und die Seite neu laden.');
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Das Bild konnte nicht gelesen werden.'); }
  try { return await decodeImage(await r.blob(), maxDim); }
  catch { throw new Error('Das Bild konnte nicht gelesen werden. Bitte als JPEG oder PNG exportieren.'); }
}

// Eigener Bestätigungsdialog (Browser-Dialoge werden manchmal blockiert)
function askConfirm(text, okLabel = 'Löschen') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'confirm';
    d.innerHTML = `<p>${esc(text)}</p><div class="row"><button class="btn danger" type="button" value="ok">${esc(okLabel)}</button><button class="btn" type="button" value="cancel" autofocus>Abbrechen</button></div>`;
    d.addEventListener('click', (e) => { const v = e.target.closest('button')?.value; if (v) d.close(v); });
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    document.body.appendChild(d); d.showModal();
  });
}
async function deleteProject(id) {
  const title = (projects.find((p) => p.id === id) || cur || {}).title || 'Projekt';
  if (!(await askConfirm(`Projekt „${title}“ mit allen Bildern und Ideen löschen? Das lässt sich nicht rückgängig machen.`))) return;
  try {
    await api('DELETE', '/api/projects/' + id);
    await refreshProjects(); toast('Projekt gelöscht');
    if (cur && cur.id === id) { if (projects.length) await openProject(projects[0].id); else showNew(); }
  } catch (e) { toast(e.message, true); }
}
async function deleteRedesign(file) {
  if (!(await askConfirm('Dieses Redesign-Bild löschen?'))) return;
  try {
    await api('DELETE', `/api/projects/${cur.id}/redesign/${encodeURIComponent(file)}`);
    cur = await api('GET', '/api/projects/' + cur.id);
    shown = (cur.redesigns || []).slice(-1)[0]?.file || null;
    await refreshProjects(); renderProject(); toast('Bild gelöscht');
  } catch (e) { toast(e.message, true); }
}

/* ---------- Seitenleiste ---------- */
function renderRail() {
  const ul = $('#projects');
  ul.innerHTML = projects.length ? projects.map((p) => `
    <li><button type="button" class="pi" data-id="${esc(p.id)}" ${cur && cur.id === p.id ? 'aria-current="true"' : ''}>
      <span class="t">${esc(p.title)}</span>
      <span class="s">${esc(p.room)} · ${new Date(p.createdAt).toLocaleDateString('de-AT')}${p.redesigns ? ' · ' + p.redesigns + ' Bild' + (p.redesigns > 1 ? 'er' : '') : ''}</span>
    </button><button type="button" class="x" data-del="${esc(p.id)}" aria-label="Projekt ${esc(p.title)} löschen" title="Projekt löschen">×</button></li>`).join('') : '<li class="s hint">Noch keine Projekte.</li>';
  ul.querySelectorAll('.pi').forEach((b) => b.addEventListener('click', () => openProject(b.dataset.id)));
  ul.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => deleteProject(b.dataset.del)));
  renderStatus();
}
function renderStatus() {
  if (!cfg) return;
  const b = cfg.budget; const rest = Math.max(0, b.limit - b.used);
  const miss = [!cfg.claude.ok && 'Claude-Schlüssel', !cfg.atlas.ok && 'Atlas-Cloud-Schlüssel'].filter(Boolean);
  const pct = b.limit > 0 ? Math.min(100, Math.round((b.used / b.limit) * 100)) : 0;
  $('#status').innerHTML = `<div class="meter" role="img" aria-label="Tageskosten ${pct} Prozent des Limits"><i style="width:${pct}%"></i></div>Heute ${usd(b.used)} von ${usd(b.limit)}<br>Rest ${usd(rest)}` +
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
      <span id="dropText"><svg class="ico" viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="6"/><circle cx="17" cy="21" r="3.5"/><path d="M5 34l11-9 8 7 7-6 12 9"/></svg><br>Foto des Raums oder Platzes hierher ziehen, einfügen (Cmd+V) oder klicken<br><small>JPEG, PNG, HEIC (iPhone), WebP, TIFF und mehr</small></span>
    </label>
    <div class="fields">
      <label class="f">Projektname<input id="title" maxlength="80" placeholder="z. B. Vorraum Graz"></label>
      <label class="f">Art des Raums<select id="room">${cfg.rooms.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="f">Beschreibung<textarea id="desc" rows="2" placeholder="Was ist das für ein Raum? Maße, falls bekannt (z. B. 2 × 3 m, Raumhöhe 2,6 m)."></textarea></label>
      <label class="f">Was stört dich?<textarea id="prob" rows="3" placeholder="z. B. zu viele Schuhe, kein Platz für Jacken, wirkt dunkel und unruhig."></textarea></label>
      <label class="f">Was wünschst du dir?<textarea id="wish" rows="3" placeholder="z. B. Garderobe mit 6 Haken, Sitzbank zum Schuhe anziehen, mehr Ordnung."></textarea></label>
      <div class="row">
        <label class="f">Budget (optional)<input id="budget" placeholder="z. B. 1500 EUR"></label>
        <label class="f">Stil (optional)<select id="nstyle"><option value="">Offen (Claude wählt)</option>${cfg.styles.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary" id="create" type="button" disabled>Ideen und Redesign erzeugen</button>
      <button class="btn" id="createOnly" type="button" disabled>Nur anlegen, ohne Ideen</button>
      <p class="hint">Claude bekommt Foto und alle Angaben, liefert sofort Ideen und daraus entsteht gleich das erste Redesign. Mit Budget richtet es sich danach, ohne Budget nimmt es mittlere Ausgaben. Kosten zusammen etwa 0,10 bis 0,15 USD (Schätzung). Alles lässt sich später ändern.</p>
      <p class="hint" id="newErr"></p>
    </div>
  </section>`;
  const drop = $('#drop'), file = $('#file');
  const take = async (f) => {
    if (!f) return;
    try {
      pending = await readPhoto(f);
      drop.innerHTML = `<img src="${pending.dataUrl}" alt="Vorschau des Fotos">`;
      $('#create').disabled = false; $('#createOnly').disabled = false; $('#newErr').textContent = '';
    } catch (e) { toast(e.message, true); }
  };
  drop.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') file.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => take(file.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
  const create = async (withIdeas) => {
    const b1 = $('#create'), b2 = $('#createOnly'); b1.disabled = b2.disabled = true; $('#newErr').textContent = '';
    const main = withIdeas ? b1 : b2; main.classList.add('busy');
    if (withIdeas) b1.textContent = 'Claude analysiert das Foto';
    let ideaErr = '';
    try {
      const meta = await api('POST', '/api/projects', {
        photo: pending.dataUrl, width: pending.width, height: pending.height,
        title: $('#title').value, room: $('#room').value, description: $('#desc').value,
        problems: $('#prob').value, wishes: $('#wish').value, budget: $('#budget').value, style: $('#nstyle').value,
      });
      await refreshProjects();
      let ideas = null;
      if (withIdeas) { try { ideas = await api('POST', `/api/projects/${meta.id}/ideas`, {}); await refreshConfig(); } catch (e) { ideaErr = e.message; } }
      let rdErr = '';
      const cs = (ideas && ideas.result && ideas.result.konzepte) || [];
      const ci = recommendedConcept(meta, cs);
      if (ci >= 0) {
        b1.textContent = 'Redesign wird erzeugt';
        try {
          const sid = meta.style || store('style') || cfg.styles[0].id;
          let mid = store('model') || cfg.models[0].id; if (!cfg.models.some((m) => m.id === mid)) mid = cfg.models[0].id;
          await api('POST', `/api/projects/${meta.id}/redesign`, { styleId: sid, modelId: mid, count: 1, conceptIndex: String(ci), wishes: '', keep: true, furnitureIdx: (cs[ci].moebel || []).map((_, i) => i), customPrompt: '' });
          await refreshConfig();
        } catch (e) { rdErr = e.message; }
      }
      await refreshProjects();
      await openProject(meta.id);
      if (ideaErr) toast('Projekt angelegt, aber die Ideen fehlen: ' + ideaErr, true);
      else if (rdErr) toast('Ideen sind da, aber das Redesign fehlt: ' + rdErr, true);
    } catch (e) {
      $('#newErr').textContent = e.message; $('#newErr').className = 'err';
      b1.disabled = b2.disabled = false; b1.textContent = 'Ideen und Redesign erzeugen'; main.classList.remove('busy');
    }
  };
  $('#create').addEventListener('click', () => create(true));
  $('#createOnly').addEventListener('click', () => create(false));
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
  ui.styleId = cur.style || store('style') || cfg.styles[0].id;
  ui.modelId = ui.modelId || store('model') || cfg.models[0].id;
  if (!cfg.models.some((m) => m.id === ui.modelId)) ui.modelId = cfg.models[0].id;
  ui.prompt = ''; ui.edited = false; ui.keep = true;
  const cs0 = (cur.ideas && cur.ideas.result && cur.ideas.result.konzepte) || [];
  const rc = recommendedConcept(cur, cs0);
  ui.concept = rc >= 0 ? String(rc) : '';
  ui.furn = new Set(rc >= 0 ? (cs0[rc].moebel || []).map((_, i) => i) : []);
  ui.own = new Set((cur.furniture || []).map((f) => f.id));
  renderRail(); renderProject();
}
const fileUrl = (name) => `/files/${encodeURIComponent(cur.id)}/${encodeURIComponent(name)}`;

function stageHTML(big) {
  const ar = cur.width && cur.height ? (cur.width / cur.height).toFixed(4) : '1.5';
  const before = fileUrl(cur.photo);
  const zoom = big ? '' : '<button type="button" class="zoom" data-zoom aria-label="Bild vergrößern" title="Vergrößern"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5"/></svg></button>';
  if (!shown) return `<div class="stage" style="--ar:${ar}"><img src="${before}" alt="Foto des Raums">${zoom}</div>`;
  return `<div class="stage compare"${big ? '' : ' id="cmp"'} style="--ar:${ar}">
    <img class="after" src="${fileUrl(shown)}" alt="Redesign">
    <img class="before" src="${before}" alt="Originalfoto">
    <div class="handle"></div>
    <span class="tag l">Vorher</span><span class="tag r">Nachher</span>
    <input type="range" min="0" max="100" value="50" aria-label="Vorher-Nachher-Regler">
    ${zoom}
  </div>`;
}
function initCompare(root) {
  const rng = root.querySelector('input[type=range]'); if (!rng) return;
  const set = () => { root.querySelector('.before').style.clipPath = `inset(0 ${100 - rng.value}% 0 0)`; root.querySelector('.handle').style.left = rng.value + '%'; };
  rng.addEventListener('input', set); set();
}
function openLightbox() {
  const d = document.createElement('dialog'); d.className = 'lightbox';
  d.innerHTML = `${stageHTML(true)}<div class="lbbar">${shown ? `<a href="${fileUrl(shown)}" download>Bild speichern</a>` : ''}<button class="btn small" type="button" id="lbClose">Schließen</button></div>`;
  d.addEventListener('click', (e) => { if (e.target === d || e.target.id === 'lbClose') d.close(); });
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d); d.showModal(); initCompare(d);
}

function renderProject() {
  const rds = cur.redesigns || [];
  const concepts = (cur.ideas?.result?.konzepte) || [];
  $('#main').innerHTML = `
  <div class="phead">
    <h2>${esc(cur.title)}</h2>
    <span class="meta">${esc(cur.room)} · ${new Date(cur.createdAt).toLocaleDateString('de-AT')}</span>
    <button class="btn small" id="rename" type="button">Umbenennen</button>
    <button class="btn small danger" id="del" type="button">Projekt löschen</button>
  </div>
  <div class="brief" id="brief"></div>
  <div id="stageWrap">${stageHTML()}</div>
  <div class="thumbs" id="thumbs">${rds.length ? `
    <button type="button" data-f="" aria-pressed="${!shown}" aria-label="Nur Originalfoto"><img src="${fileUrl(cur.photo)}" alt=""></button>
    ${rds.map((r) => `<button type="button" data-f="${esc(r.file)}" aria-pressed="${shown === r.file}" title="${esc(r.style)} · ${esc(r.model)}"><img src="${fileUrl(r.file)}" alt="Redesign ${esc(r.style)}"></button>`).join('')}
    ${shown ? `<span class="dl"><a href="${fileUrl(shown)}" download>Bild speichern</a><button class="btn small danger" id="delImg" type="button">Bild löschen</button></span>` : ''}` : '<span class="hint">Noch kein Redesign. Hole zuerst Ideen und erzeuge dann unten das Redesign.</span>'}</div>

  <section class="panel">
    <h3>Ideen von Claude</h3>
    <div class="row"><button class="btn primary" id="ideasBtn" type="button">${cur.ideas ? 'Ideen neu erzeugen' : 'Ideen von Claude holen'}</button></div>
    <p class="hint">Claude nutzt das Foto und deine Angaben oben: Beschreibung, was dich stört, Wünsche, Budget und Stil. Kosten etwa 0,05 USD. Maße sind Schätzungen vom Foto.</p>
    <p class="hint" id="ideasWait"></p>
    <p class="err" id="ideasErr"></p>
    <div id="ideas">${cur.ideas ? ideasHTML(cur.ideas.result) : ''}</div>
  </section>

  <section class="panel" id="redesignPanel">
    <h3>Redesign aus dem Foto</h3>
    <div class="f" style="margin-bottom:6px"><span>Stil</span></div>
    <div class="chips" role="group" aria-label="Stilvorlage">${cfg.styles.map((s) => `
      <button type="button" class="chip" data-s="${esc(s.id)}" aria-pressed="${ui.styleId === s.id}">
        <span class="dots">${s.farben.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>${esc(s.name)}</button>`).join('')}</div>
    <label class="f">Konzept<select id="concept"><option value="">Kein Konzept, nur Stil</option>${concepts.map((c, i) => `<option value="${i}" ${String(i) === ui.concept ? 'selected' : ''}>${esc(c.titel)}${i === recommendedConcept(cur, concepts) ? ' (empfohlen)' : ''}</option>`).join('')}</select></label>
    <div id="furn" style="margin-top:12px"></div>
    <div id="own" class="own"></div>
    <label class="f" style="margin-top:14px">Anweisung an das Bildmodell
      <textarea id="prompt" rows="8" placeholder="Wird automatisch aus Konzept und Angaben erstellt.">${esc(ui.prompt)}</textarea>
    </label>
    <div class="phint"><span class="hint" id="pHint"></span>
      <span class="plinks"><button class="lnk" id="pReset" type="button" hidden>Automatisch neu erstellen</button><button class="lnk" id="suggest" type="button">Von Claude formulieren lassen</button></span></div>
    <label class="opt" style="margin-top:14px"><span>Vorhandene Möbel und Raumaufteilung beibehalten</span><span class="switch"><input type="checkbox" id="keep" ${ui.keep ? 'checked' : ''}><i></i></span></label>
    <div class="row">
      <label class="f">Modell<select id="model">${cfg.models.map((m) => `<option value="${esc(m.id)}" ${m.id === ui.modelId ? 'selected' : ''}>${esc(m.name)} (${m.preis.toFixed(3).replace('.', ',')} USD pro Bild)</option>`).join('')}</select></label>
      <div class="f"><span id="cntLbl">Anzahl</span><div class="seg" role="radiogroup" aria-labelledby="cntLbl">${[1, 2, 3].map((n) => `<button type="button" role="radio" data-n="${n}" aria-checked="${n === ui.count}">${n}</button>`).join('')}</div></div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="go" type="button">Redesign erzeugen</button></div>
    <p class="hint" id="cost"></p>
    <p class="err" id="rdErr"></p>
  </section>`;

  const upd = () => {
    const m = cfg.models.find((x) => x.id === ui.modelId); const c = m.preis * ui.count;
    $('#cost').textContent = `Geschätzte Kosten: ${usd(c)}. Dauer meist 20 bis 60 Sekunden.`;
  };
  upd();
  $('#del').addEventListener('click', () => deleteProject(cur.id));
  const di = $('#delImg'); if (di) di.addEventListener('click', () => deleteRedesign(shown));
  renderBrief(false);
  $('#rename').addEventListener('click', () => { renderBrief(true); $('#brief').scrollIntoView(); $('#bTitle').focus(); });
  $('#thumbs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { shown = b.dataset.f || null; renderProject(); }));
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    ui.styleId = b.dataset.s; store('style', ui.styleId);
    document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#model').addEventListener('change', (e) => { ui.modelId = e.target.value; store('model', ui.modelId); upd(); renderOwn(); });
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    ui.count = +b.dataset.n; document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); upd();
  }));
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
    box.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => { if (inp.checked) ui.furn.add(+inp.dataset.i); else ui.furn.delete(+inp.dataset.i); syncPrompt(); }));
  };
  $('#concept').addEventListener('change', (e) => { ui.concept = e.target.value; furnReset(); renderFurn(); syncPrompt(); });
  $('#keep').addEventListener('change', (e) => { ui.keep = e.target.checked; syncPrompt(); });
  $('#prompt').addEventListener('input', (e) => { ui.prompt = e.target.value; ui.edited = true; promptHint(); });
  $('#prompt').addEventListener('blur', () => { if (!ui.prompt.trim()) { ui.edited = false; syncPrompt(); } });
  $('#pReset').addEventListener('click', () => { ui.edited = false; syncPrompt(); });
  $('#suggest').addEventListener('click', doSuggest);
  renderFurn(); renderOwn(); syncPrompt();
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    ui.concept = b.dataset.pick; ui.edited = false; furnReset(); $('#concept').value = ui.concept; renderFurn(); syncPrompt();
    toast('Konzept übernommen. Die Anweisung ist aktualisiert.'); $('#redesignPanel').scrollIntoView();
  }));
  $('#go').addEventListener('click', doRedesign);
  $('#ideasBtn').addEventListener('click', doIdeas);
  const cmp = $('#cmp'); if (cmp) initCompare(cmp);
  document.querySelectorAll('[data-zoom]').forEach((z) => z.addEventListener('click', openLightbox));
}

// Anweisung (Deutsch): wird automatisch aus Angaben, Konzept und Möbeln gebaut, bleibt frei bearbeitbar
function autoPrompt() {
  const cs = (cur.ideas && cur.ideas.result && cur.ideas.result.konzepte) || [];
  const c = cs[ui.concept === '' ? -1 : +ui.concept];
  const end = (t) => { t = String(t || '').trim(); return t && !/[.!?]$/.test(t) ? t + '.' : t; };
  const L = [];
  L.push(end(`${cur.room}${cur.description ? ': ' + cur.description : ''}`));
  if (cur.problems) L.push(end('Das soll gelöst werden: ' + cur.problems));
  if (cur.wishes) L.push(end('Wünsche: ' + cur.wishes));
  if (c) {
    const farben = (c.farben || []).map((f) => f.name).filter(Boolean).join(', ');
    L.push(end(`Konzept „${c.titel}“: ${c.idee || ''}`));
    if (farben || (c.materialien || []).length) L.push(end(`${farben ? 'Farben: ' + farben + '. ' : ''}${(c.materialien || []).length ? 'Materialien: ' + c.materialien.join(', ') : ''}`));
    const items = (c.moebel || []).filter((_, i) => ui.furn.has(i)).map((m) => `${m.name}${m.masse_cm ? ' (' + m.masse_cm + ' cm)' : ''}${m.platzierung ? ', ' + m.platzierung.replace(/[.!?]$/, '').replace(/^./, (x) => x.toLowerCase()) : ''}`);
    if (items.length) L.push(end('Diese Möbel einbauen: ' + items.join('; ')));
  }
  const own = (cur.furniture || []).filter((f) => ui.own.has(f.id)).map((f) => f.name + (f.note ? ' (' + f.note + ')' : ''));
  if (own.length) L.push(end('Meine eigenen Möbel genau so einbauen (Referenzfotos): ' + own.join('; ')));
  L.push(ui.keep ? 'Vorhandene Möbel und die Raumaufteilung bleiben an ihrem Platz, ringsum wird umgestaltet.' : 'Möbel, Deko, Farben und Licht dürfen frei umgestaltet werden.');
  return L.filter(Boolean).join('\n');
}
function promptHint() {
  const h = $('#pHint'), r = $('#pReset'); if (!h) return;
  h.textContent = ui.edited ? 'Von dir geändert. Diese Anweisung wird so verwendet.' : 'Entsteht automatisch aus deinen Angaben, dem Konzept und den Möbeln. Du kannst sie frei ändern.';
  r.hidden = !ui.edited;
}
function syncPrompt() {
  if (!ui.edited) { ui.prompt = autoPrompt(); const t = $('#prompt'); if (t) t.value = ui.prompt; }
  promptHint();
}

function renderOwn(adding) {
  const box = $('#own'); if (!box) return;
  const fl = cur.furniture || [];
  const m = cfg.models.find((x) => x.id === ui.modelId);
  const warn = fl.length && m && (m.maxImages || 5) < 2 ? `<p class="err">${esc(m.name)} kann nur ein Bild verarbeiten. Für eigene Möbel Nano Banana 2 oder Seedream 4.5 wählen.</p>` : '';
  const sel = fl.filter((f) => ui.own.has(f.id)).length;
  box.innerHTML = `<div class="ownh"><b>Eigene Möbel einbauen</b><button class="btn small" id="ownAdd" type="button">Foto hinzufügen</button></div>
    <input type="file" id="ownFile" accept="image/*,.heic,.heif,.tif,.tiff,.avif,.bmp" hidden>
    ${fl.length ? `<ul class="ownl">${fl.map((f) => `<li>
      <label class="ownc"><input type="checkbox" data-o="${esc(f.id)}" ${ui.own.has(f.id) ? 'checked' : ''}>
      <img src="${fileUrl(f.file)}" alt="${esc(f.name)}"><span><b>${esc(f.name)}</b>${f.note ? `<br><span class="hint">${esc(f.note)}</span>` : ''}</span></label>
      <button type="button" class="x" data-od="${esc(f.id)}" aria-label="${esc(f.name)} entfernen" title="Entfernen">×</button></li>`).join('')}</ul>` : '<p class="hint">Lade Fotos von Möbeln hoch, die du schon hast oder kaufen willst (am besten freigestellt auf hellem Hintergrund). Die KI baut genau diese Stücke ins Redesign ein.</p>'}
    ${sel > 4 ? '<p class="hint">Es werden höchstens 4 Stücke pro Bild verwendet.</p>' : ''}${warn}
    <div id="ownForm"></div>`;
  $('#ownAdd').addEventListener('click', () => $('#ownFile').click());
  $('#ownFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const ph = await readPhoto(f, 1024); showOwnForm(ph, f.name.replace(/\.[^.]+$/, '')); } catch (er) { toast(er.message, true); }
  });
  box.querySelectorAll('[data-o]').forEach((c) => c.addEventListener('change', () => { if (c.checked) ui.own.add(c.dataset.o); else ui.own.delete(c.dataset.o); syncPrompt(); }));
  box.querySelectorAll('[data-od]').forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('li'); li.style.opacity = '.4'; li.style.pointerEvents = 'none';
    try { const r = await api('DELETE', `/api/projects/${cur.id}/furniture/${b.dataset.od}`); cur.furniture = r.furniture; ui.own.delete(b.dataset.od); renderOwn(); syncPrompt(); toast('Möbelstück entfernt'); }
    catch (er) { li.style.opacity = ''; li.style.pointerEvents = ''; toast(er.message, true); }
  }));

}
function showOwnForm(ph, guess) {
  const f = $('#ownForm');
  f.innerHTML = `<div class="ownnew"><img src="${ph.dataUrl}" alt="Vorschau">
    <div class="ownfs"><label class="f">Name<input id="oName" maxlength="80" placeholder="z. B. Sofa grau, 3-Sitzer" value="${esc(guess.length > 2 && guess.length < 40 && !/^(img|dsc|image|photo)/i.test(guess) ? guess : '')}"></label>
    <label class="f">Wohin damit? (optional)<input id="oNote" maxlength="200" placeholder="z. B. an die linke Wand unter das Fenster"></label>
    <div class="row"><button class="btn primary small" id="oSave" type="button">Hinzufügen</button><button class="btn small" id="oCancel" type="button">Abbrechen</button></div>
    <p class="err" id="oErr"></p></div></div>`;
  $('#oName').focus();
  $('#oCancel').addEventListener('click', () => { f.innerHTML = ''; });
  $('#oSave').addEventListener('click', async () => {
    const b = $('#oSave'); b.disabled = true;
    try {
      const r = await api('POST', `/api/projects/${cur.id}/furniture`, { photo: ph.dataUrl, name: $('#oName').value, note: $('#oNote').value });
      const added = r.furniture.find((x) => !(cur.furniture || []).some((y) => y.id === x.id));
      cur.furniture = r.furniture; if (added) ui.own.add(added.id); renderOwn(); syncPrompt(); toast('Möbelstück hinzugefügt');
    } catch (er) { $('#oErr').textContent = er.message; b.disabled = false; }
  });
}
async function doSuggest() {
  const btn = $('#suggest'); btn.disabled = true; btn.classList.add('busy'); $('#rdErr').textContent = '';
  try {
    const out = await api('POST', `/api/projects/${cur.id}/prompt`, { styleId: ui.styleId, conceptIndex: ui.concept, wishes: '', keep: ui.keep, furnitureIdx: [...ui.furn] });
    ui.prompt = out.prompt; ui.edited = true; $('#prompt').value = out.prompt; promptHint();
    await refreshConfig(); toast('Anweisung von Claude geschrieben. Du kannst sie ändern.');
  } catch (e) { $('#rdErr').textContent = e.message; refreshConfig(); }
  btn.disabled = false; btn.classList.remove('busy');
}
async function doRedesign() {
  const btn = $('#go'); btn.disabled = true; btn.classList.add('busy'); $('#rdErr').textContent = '';
  try {
    const out = await api('POST', `/api/projects/${cur.id}/redesign`, { styleId: ui.styleId, modelId: ui.modelId, count: ui.count, conceptIndex: ui.concept, wishes: '', keep: ui.keep, furnitureIdx: [...ui.furn], ownIds: [...ui.own], customPrompt: ui.prompt.trim() });
    const keepIdeas = cur.ideas; cur = await api('GET', '/api/projects/' + cur.id); cur.ideas = cur.ideas || keepIdeas;
    shown = out.added[out.added.length - 1].file;
    await Promise.all([refreshConfig(), refreshProjects()]); renderProject();
    $('#stageWrap').scrollIntoView({ block: 'start' });
    if (out.errors.length) { $('#rdErr').textContent = out.errors.join(' | '); }
    toast(out.added.length + ' Redesign' + (out.added.length > 1 ? 's' : '') + ' gespeichert');
  } catch (e) { $('#rdErr').textContent = e.message; btn.disabled = false; btn.classList.remove('busy'); refreshConfig(); }
}
async function doIdeas() {
  const btns = ['#ideasBtn', '#regen'].map((q) => $(q)).filter(Boolean);
  const wait = $('#ideasWait'); const t0 = Date.now();
  btns.forEach((b) => { b.disabled = true; b.classList.add('busy'); });
  $('#ideasErr').textContent = '';
  const tick = () => { if (wait) wait.textContent = `Claude analysiert Foto und Angaben … ${Math.round((Date.now() - t0) / 1000)} s. Das dauert meist 20 bis 60 Sekunden.`; };
  tick(); const timer = setInterval(tick, 1000);
  if (wait) wait.scrollIntoView({ block: 'center', behavior: 'smooth' });
  try {
    cur.ideas = await api('POST', `/api/projects/${cur.id}/ideas`, {});
    const cs1 = (cur.ideas.result && cur.ideas.result.konzepte) || [];
    const rc1 = recommendedConcept(cur, cs1);
    ui.concept = rc1 >= 0 ? String(rc1) : ''; ui.furn = new Set(rc1 >= 0 ? (cs1[rc1].moebel || []).map((_, i) => i) : []);
    clearInterval(timer); await refreshConfig(); renderProject(); toast('Ideen gespeichert');
  } catch (e) {
    clearInterval(timer); if (wait) wait.textContent = '';
    $('#ideasErr').textContent = e.message; btns.forEach((b) => { b.disabled = false; b.classList.remove('busy'); }); refreshConfig();
  }
}

function renderBrief(edit) {
  const b = $('#brief'); if (!b) return;
  if (!edit) {
    const st = cfg.styles.find((x) => x.id === cur.style);
    const rows = [['Raum', cur.room], ['Stil', st ? st.name : 'offen'], cur.budget && ['Budget', cur.budget],
      cur.description && ['Beschreibung', cur.description], cur.problems && ['Stört dich', cur.problems], cur.wishes && ['Wünsche', cur.wishes]].filter(Boolean);
    const stale = cur.ideas && cur.briefUpdatedAt && cur.briefUpdatedAt > cur.ideas.createdAt;
    b.innerHTML = `<div class="bh"><b>Deine Angaben</b><span class="hint">Sie fließen in Ideen, Bildanweisung und Redesign ein.</span><button class="btn small" id="editBrief" type="button">Bearbeiten</button></div>
      <dl class="facts brieff">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${rows.length <= 2 ? '<p class="hint" style="margin:6px 0 0">Mit Beschreibung, Problemen und Wünschen werden Ideen und Redesign besser.</p>' : ''}
      ${stale ? '<p class="stale">Die Angaben wurden nach den letzten Ideen geändert. <button class="btn small" id="regen" type="button">Ideen neu erzeugen</button></p>' : ''}`;
    $('#editBrief').addEventListener('click', () => renderBrief(true));
    const rg = $('#regen'); if (rg) rg.addEventListener('click', doIdeas);
    return;
  }
  b.innerHTML = `<div class="bform">
    <label class="f">Projektname<input id="bTitle" maxlength="80" value="${esc(cur.title)}"></label>
    <div class="row">
      <label class="f">Art des Raums<select id="bRoom">${cfg.rooms.map((r) => `<option ${r === cur.room ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="f">Stil<select id="bStyle"><option value="">Offen (Claude wählt)</option>${cfg.styles.map((x) => `<option value="${esc(x.id)}" ${x.id === cur.style ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="f">Budget<input id="bBudget" value="${esc(cur.budget || '')}" placeholder="z. B. 1500 EUR"></label>
    </div>
    <label class="f">Beschreibung<textarea id="bDesc" rows="2">${esc(cur.description || '')}</textarea></label>
    <label class="f">Was stört dich?<textarea id="bProb" rows="3">${esc(cur.problems || '')}</textarea></label>
    <label class="f">Was wünschst du dir?<textarea id="bWish" rows="3">${esc(cur.wishes || '')}</textarea></label>
    <div class="row"><button class="btn primary small" id="bSave" type="button">Speichern</button><button class="btn small" id="bCancel" type="button">Abbrechen</button></div>
    <p class="err" id="bErr"></p></div>`;
  $('#bCancel').addEventListener('click', () => renderBrief(false));
  $('#bSave').addEventListener('click', async () => {
    try {
      const m = await api('PATCH', '/api/projects/' + cur.id, {
        title: $('#bTitle').value, room: $('#bRoom').value, style: $('#bStyle').value, budget: $('#bBudget').value,
        description: $('#bDesc').value, problems: $('#bProb').value, wishes: $('#bWish').value,
      });
      Object.assign(cur, { title: m.title, room: m.room, style: m.style, budget: m.budget, description: m.description, problems: m.problems, wishes: m.wishes, briefUpdatedAt: m.briefUpdatedAt });
      await refreshProjects(); renderProject(); toast('Gespeichert');
    } catch (e) { $('#bErr').textContent = e.message; }
  });
}

function priceTxt(m) {
  const a = Number(m.preis_min_eur), b = Number(m.preis_max_eur);
  if (isFinite(a) && isFinite(b) && (a || b)) return a === b ? `ca. ${eur(a)} EUR` : `ca. ${eur(a)} bis ${eur(b)} EUR`;
  return m.preis_eur ? `ca. ${esc(m.preis_eur)} EUR` : '';
}
function budgetLine(c) {
  const s = conceptSum(c); if (!s) return '';
  const bud = parseBudget(cur && cur.budget);
  const range = s.lo === s.hi ? `${eur(s.hi)} EUR` : `${eur(s.lo)} bis ${eur(s.hi)} EUR`;
  if (!bud) return `<p class="bline">Möbel gesamt: ${range}</p>`;
  const over = s.hi - bud;
  return over <= 0
    ? `<p class="bline ok">Möbel gesamt: ${range} · im Budget (${eur(bud)} EUR)</p>`
    : `<p class="bline over">Möbel gesamt: ${range} · über dem Budget um bis zu ${eur(over)} EUR (${eur(bud)} EUR)</p>`;
}
function list(a) { return (a || []).map((x) => `<li>${esc(x)}</li>`).join(''); }
function ideasHTML(r) {
  if (!r) return '';
  const a = r.analyse || {};
  const facts = [
    a.licht && ['Licht', esc(a.licht)],
    (a.probleme || []).length && ['Probleme', esc(a.probleme.join('; '))],
    (a.potenzial || []).length && ['Potenzial', esc(a.potenzial.join('; '))],
  ].filter(Boolean);
  return `
  <p class="lead">${esc(r.zusammenfassung)}</p>
  ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
  <div class="concepts">${(r.konzepte || []).map((c, i) => `
    <details class="cc" ${i === 0 ? 'open' : ''}>
      <summary><span class="ct">${esc(c.titel)}</span>${i === recommendedConcept(cur, (r.konzepte || [])) ? '<span class="rec">Empfohlen</span>' : ''}<span class="cm">Aufwand ${esc(c.aufwand)}, ${esc(c.budget_eur)} EUR</span>
        <span class="sws">${(c.farben || []).map((f) => `<i title="${esc(f.name)}" style="background:${hexOk(f.hex) ? esc(f.hex) : 'transparent'}"></i>`).join('')}</span></summary>
      <div class="cb">
        <p>${esc(c.idee)}</p>
        ${(c.materialien || []).length ? `<p class="mats">Material: ${esc(c.materialien.join(', '))}. Farben: ${esc((c.farben || []).map((f) => f.name).join(', '))}.</p>` : ''}
        ${budgetLine(c)}
        <ul class="furn compact">${(c.moebel || []).map((m) => `
          <li><b>${esc(m.name)}</b> <span class="mm">${esc(m.masse_cm)} cm, ${priceTxt(m)}</span><br>
          <span class="hint">${esc(m.platzierung)}</span> <a href="https://www.google.at/search?tbm=shop&q=${encodeURIComponent(m.suchbegriff || m.name)}" target="_blank" rel="noopener noreferrer">Suchen</a></li>`).join('')}</ul>
        <button class="btn small" type="button" data-pick="${i}">Dieses Konzept fürs Redesign wählen</button>
      </div>
    </details>`).join('')}</div>
  ${(r.schnelle_erfolge || []).length ? `<details class="cc"><summary><span class="ct">Schnelle Erfolge unter 50 EUR</span></summary><div class="cb"><ul class="quick">${list(r.schnelle_erfolge)}</ul></div></details>` : ''}
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
    askConfirm('Gespeicherten Schlüssel aus der .env entfernen?', 'Entfernen').then((ok) => { if (ok) save(b.dataset.clear === 'kA' ? { clearAnthropic: true } : { clearAtlas: true }); });
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
