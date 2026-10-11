'use strict';
// Raumplanung – lokaler Server ohne externe Abhängigkeiten (Node >= 20).
// Alle Fotos und Ergebnisse liegen im Ordner data/ auf diesem Rechner.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PROJ = path.join(DATA, 'projects');
fs.mkdirSync(PROJ, { recursive: true });

// ---------- Konfiguration (.env) ----------
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env ist optional */ }

const cfg = {
  port: parseInt(process.env.PORT || '3000', 10),
  claudeKey: process.env.ANTHROPIC_API_KEY || '',
  atlasKey: process.env.ATLASCLOUD_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  dailyLimit: parseFloat(process.env.DAILY_LIMIT_USD || '2'),
  claudeCost: parseFloat(process.env.CLAUDE_COST_EST_USD || '0.05'),
  claudeBase: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  atlasBase: process.env.ATLAS_BASE_URL || 'https://api.atlascloud.ai/api/v1/model',
};
let VERSION = '0.0.0'; try { VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* egal */ }
const STYLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles.json'), 'utf8'));
const MODELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'models.json'), 'utf8'));
const ROOMS = ['Wohnzimmer', 'Schlafzimmer', 'Küche', 'Esszimmer', 'Arbeitszimmer', 'Bad', 'Kinderzimmer', 'Flur', 'Balkon / Terrasse', 'Garten', 'Anderer Platz'];

// ---------- Hilfsfunktionen ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readJson(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(httpErr(413, 'Anfrage zu groß.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(httpErr(400, 'Ungültiges JSON.')); } });
    req.on('error', reject);
  });
}
// Rohdaten lesen (für Bild-Umwandlung)
function readBuffer(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(httpErr(413, 'Datei zu groß (max. 60 MB).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 60000 }, (err) => (err ? reject(err) : resolve())));
// Wandelt HEIC, TIFF und andere Formate in JPEG um (max. 2048 px). macOS: sips (eingebaut). Sonst ImageMagick, falls vorhanden.
async function convertToJpeg(buf, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raumplanung-'));
  const inp = path.join(dir, 'in.' + ext), out = path.join(dir, 'out.jpg');
  fs.writeFileSync(inp, buf);
  const attempts = [
    ['sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', '-Z', '2048', inp, '--out', out]],
    ['magick', [inp + '[0]', '-auto-orient', '-resize', '2048x2048>', '-quality', '90', out]],
    ['convert', [inp + '[0]', '-auto-orient', '-resize', '2048x2048>', '-quality', '90', out]],
  ];
  try {
    for (const [cmd, args] of attempts) {
      try { await run(cmd, args); if (fs.existsSync(out) && fs.statSync(out).size > 0) return fs.readFileSync(out); } catch { /* nächster Versuch */ }
    }
    throw httpErr(415, 'Dieses Bildformat kann nicht umgewandelt werden. Bitte als JPEG oder PNG exportieren.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const today = () => new Date().toLocaleDateString('sv-SE'); // lokales Datum, YYYY-MM-DD

// ---------- Tageslimit ----------
const usageFile = path.join(DATA, 'usage.json');
function readUsage() {
  try { const u = JSON.parse(fs.readFileSync(usageFile, 'utf8')); if (u.date === today()) return u; } catch { /* neu */ }
  return { date: today(), usd: 0, calls: 0 };
}
function reserve(amount) {
  const u = readUsage();
  if (u.usd + amount > cfg.dailyLimit + 1e-9) {
    throw httpErr(402, `Tageslimit erreicht: ${u.usd.toFixed(2)} von ${cfg.dailyLimit.toFixed(2)} USD verbraucht. Das Limit steht in .env (DAILY_LIMIT_USD).`);
  }
  u.usd = +(u.usd + amount).toFixed(4); u.calls += 1;
  fs.writeFileSync(usageFile, JSON.stringify(u));
}
function refund(amount) {
  const u = readUsage(); u.usd = Math.max(0, +(u.usd - amount).toFixed(4));
  fs.writeFileSync(usageFile, JSON.stringify(u));
}

// ---------- Projekte ----------
const ID_RE = /^[a-z0-9-]{3,40}$/;
const projDir = (id) => { if (!ID_RE.test(id)) throw httpErr(400, 'Ungültige Projekt-ID.'); return path.join(PROJ, id); };
function readMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(projDir(id), 'meta.json'), 'utf8')); }
  catch (e) { if (e.status) throw e; throw httpErr(404, 'Projekt nicht gefunden.'); }
}
const writeMeta = (id, meta) => fs.writeFileSync(path.join(projDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
function readIdeas(id) { try { return JSON.parse(fs.readFileSync(path.join(projDir(id), 'ideas.json'), 'utf8')); } catch { return null; } }
function parseDataUrl(s) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s || '');
  if (!m) throw httpErr(400, 'Foto fehlt oder hat ein ungültiges Format (JPEG, PNG oder WebP).');
  return { mime: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2], buf: Buffer.from(m[3], 'base64') };
}
function listProjects() {
  return fs.readdirSync(PROJ).filter((d) => ID_RE.test(d)).map((d) => { try { return readMeta(d); } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => ({ id: m.id, title: m.title, room: m.room, createdAt: m.createdAt, photo: m.photo, redesigns: (m.redesigns || []).length }));
}

// Angaben des Nutzers (Briefing) aus Projekt-Metadaten, als Text für Claude
function briefText(meta, lang) {
  const style = STYLES.find((x) => x.id === meta.style);
  const L = lang === 'de'
    ? { room: 'Raumtyp', desc: 'Beschreibung des Nutzers', prob: 'Das stört den Nutzer', wish: 'Das wünscht sich der Nutzer', budget: 'Budget', style: 'Gewünschte Stilrichtung', open: 'Stilrichtung: offen, schlage passende vor.', none: '(keine)' }
    : { room: 'Room type', desc: "Owner's description (German)", prob: 'Problems the owner wants solved (German)', wish: "Owner's wishes (German)", budget: 'Budget', style: 'Style', open: '', none: '(none)' };
  let t = `${L.room}: ${meta.room}.\n${L.desc}: ${meta.description || L.none}\n`;
  if (meta.problems) t += `${L.prob}: ${meta.problems}\n`;
  if (meta.wishes) t += `${L.wish}: ${meta.wishes}\n`;
  if (meta.budget) { const n = parseBudget(meta.budget); t += `${L.budget}: ${meta.budget}${n > 0 ? ` (Obergrenze ${n} EUR)` : ''}\n`; }
  if (lang !== 'de' && !(parseBudget(meta.budget) > 0)) t += 'Budget: not given. Assume a mid-range budget: solid mid-priced furniture, neither cheap nor luxury.\n';
  if ((meta.furniture || []).length) {
    const list = meta.furniture.map((f) => `${f.name}${f.note ? ' (' + f.note + ')' : ''}`).join('; ');
    t += lang === 'de'
      ? `Eigene Möbel des Nutzers (bereits vorhanden oder gekauft, werden fest eingebaut, zählen nicht zum Budget): ${list}. Plane den Raum um diese Stücke herum und schlage keine ähnlichen vor.\n`
      : `The owner's own pieces (will be placed in the room, do not replace them): ${list}.\n`;
  }
  if (style) t += `${L.style}: ${lang === 'de' ? style.name : style.prompt}.\n`; else if (L.open) t += L.open + '\n';
  return t;
}
const cleanText = (v, n) => String(v || '').trim().slice(0, n);
const BRIEF_FIELDS = { description: 2000, problems: 2000, wishes: 2000, budget: 80 };

// ---------- Claude: Ideen ----------
const IDEAS_SYSTEM = `Du bist ein erfahrener Innenarchitekt und Raumplaner. Du siehst ein Foto eines Raums oder Platzes und bekommst eine kurze Beschreibung des Nutzers. Berücksichtige die Beschreibung ausdrücklich.
Antworte ausschließlich mit einem einzigen JSON-Objekt, ohne Text davor oder danach, auf Deutsch, in einfacher, klarer, KOMPAKTER Sprache.
Regeln:
- Alle Maße sind Schätzungen aus dem Foto. Nenne sie in cm. Wenn der Nutzer Maße nennt, haben diese Vorrang.
- Erfinde keine Marken- oder Produktnamen mit Preisen. Gib einen guten deutschen Suchbegriff für den Möbelkauf an und einen realistischen Preisrahmen als Zahlen in EUR (preis_min_eur, preis_max_eur).
- Die Angaben des Nutzers haben Vorrang: Beschreibung, was ihn stört, seine Wünsche, Budget und Stil. Jedes Konzept muss die genannten Probleme lösen und die Wünsche erfüllen. Sage im Feld "idee" kurz, wie. Nenne ein Budget, das zum Budget des Nutzers passt, falls er eins nennt.
- Liefere 3 deutlich verschiedene Konzepte (zum Beispiel: sparsam und schnell, ausgewogen, mutig).
- Fasse dich kurz: Das ist eine Übersicht, kein Aufsatz.
Schema:
{
 "zusammenfassung": "höchstens 2 kurze Sätze: was du siehst und was am meisten bringt",
 "analyse": {"raumtyp": "", "licht": "höchstens 10 Wörter", "probleme": ["höchstens 3 Stichpunkte, je höchstens 8 Wörter"], "potenzial": ["höchstens 3 Stichpunkte, je höchstens 8 Wörter"]},
 "konzepte": [
  {"titel": "höchstens 4 Wörter", "idee": "höchstens 2 Sätze", "aufwand": "gering|mittel|hoch", "budget_eur": "z. B. 300-600",
   "farben": [{"name": "", "hex": "#RRGGBB"}],
   "materialien": ["höchstens 3"],
   "moebel": [{"name": "", "masse_cm": "B x T x H", "platzierung": "ein kurzer Satz", "suchbegriff": "", "preis_min_eur": 150, "preis_max_eur": 300}]}
 ],
 "schnelle_erfolge": ["genau 3 Maßnahmen unter 50 EUR, je höchstens 8 Wörter"],
 "hinweis": "höchstens 1 Satz zu Unsicherheiten"
}
Pro Konzept höchstens 5 Möbelstücke und höchstens 3 Farben.`;

// Größte Zahl aus einem Budget-Text, z. B. "1.500 EUR" -> 1500, "1500 bis 2000" -> 2000. 0 = kein Budget.
function parseBudget(str) {
  const m = String(str || '').match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g);
  if (!m) return 0;
  return Math.max(...m.map((x) => parseFloat(x.replace(/\./g, '').replace(',', '.'))));
}
function budgetRules(n) {
  return `
BUDGET-MODUS: Der Nutzer hat ein Budget von ${n} EUR genannt. Plane ALLE drei Konzepte um dieses Budget herum:
- Die Summe aller preis_max_eur der Möbel eines Konzepts darf ${n} EUR nicht überschreiten. Rechne nach, bevor du antwortest.
- Staffle die Konzepte: (1) Kernlösung bei etwa 50 % des Budgets, (2) ausgewogen bei etwa 80 %, (3) nutzt das Budget fast voll aus. Keines darf darüber liegen.
- budget_eur ist die geschätzte Gesamtsumme des Konzepts (Möbel plus Kleinteile) und muss unter ${n} liegen.
- Setze das Geld dort ein, wo es das genannte Problem am stärksten löst. Bei knappem Budget: einfache, gebrauchte oder selbstgebaute Lösungen.
- Reicht das Budget nicht für alle Wünsche, sage das ehrlich im Feld "hinweis" und nenne, was du weglässt oder später empfiehlst.`;
}
const NO_BUDGET_RULES = `KEIN BUDGET genannt: Keine Obergrenze. Staffle die Konzepte nach Preisniveau: (1) sparsam und schnell, (2) AUSGEWOGEN mit mittlerem Preisniveau (solide Möbel der mittleren Preisklasse, weder billig noch Luxus; dieses Konzept wird zuerst als Redesign umgesetzt), (3) hochwertig und mutig. Schätze realistische Gesamtkosten je Konzept.`;
const ideasSystem = (meta) => IDEAS_SYSTEM + (parseBudget(meta.budget) > 0 ? '\n' + budgetRules(parseBudget(meta.budget)) : '\n' + NO_BUDGET_RULES);

async function callClaudeText(system, photo, userText, maxTokens = 6000) {
  if (!cfg.claudeKey) throw httpErr(400, 'Der Claude-Schlüssel fehlt. Bitte unter Einstellungen eintragen.');
  const r = await fetch(cfg.claudeBase + '/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cfg.claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.claudeModel, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: photo.mime, data: photo.buf.toString('base64') } },
        { type: 'text', text: userText },
      ] }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(502, 'Claude-API: ' + ((j.error && j.error.message) || r.status));
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}
async function callClaude(photo, userText, system = IDEAS_SYSTEM) {
  const text = await callClaudeText(system, photo, userText);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(a, b + 1)); }
  catch { throw httpErr(502, 'Claude hat kein gültiges JSON geliefert. Bitte noch einmal versuchen.'); }
}

const PROMPT_SYSTEM = `You write instructions for an AI image-editing model (it receives the photo plus your text). Look at the photo carefully.
Write ONE prompt in GERMAN (the owner reads and edits it), 90 to 170 words, plain text only, no lists, no quotes, no preamble. Use simple, concrete German with clear positions (linke Wand, rechts neben dem Fenster, im Vordergrund).
Structure: (1) what must stay exactly as in the photo: walls, corners, windows, doors, radiators, floor, ceiling, camera angle and framing; (2) the concrete changes, each with position (left wall, right of the window, foreground, next to the door), approximate size, material and color; (3) light and mood.
Rules: follow the owner's wishes literally and make them clearly visible. Use only the furniture pieces you are given plus small decor. Never invent room dimensions. If told to keep existing furniture, name the visible pieces and say they stay in place. No text, labels or watermarks in the image.`;

// ---------- Atlas Cloud: Redesign ----------
function pickAspect(model, w, h) {
  if (!model.aspect || !w || !h) return {};
  const target = Math.log(w / h);
  let best = null, bestD = Infinity;
  for (const v of model.aspect.values) {
    const [a, b] = v.split(/[:*]/).map(Number);
    const d = Math.abs(Math.log(a / b) - target);
    if (d < bestD) { bestD = d; best = v; }
  }
  return { [model.aspect.param]: best };
}
const PRESERVE = 'This is an edit of the existing photo, not a new image. Keep the room architecture exactly as it is: same walls, corners, windows, doors, radiators, ceiling, floor, camera angle, framing and perspective. Photorealistic interior photograph with natural proportions, no text or watermark.';
function furnList(concept, idx) {
  const all = (concept && concept.moebel) || [];
  return (idx || []).map((i) => all[+i]).filter(Boolean)
    .map((m) => `${m.name}${m.masse_cm ? ' (' + m.masse_cm + ' cm)' : ''}${m.platzierung ? ', ' + m.platzierung : ''}`);
}
const MAX_OWN = 4;
function ownRefs(own) {
  return `Image 1 is the room photo to edit. The other images are reference photos of the owner's own furniture: ` +
    own.map((f, i) => `image ${i + 2} shows "${f.name}"${f.note ? ` (placement wish, German: ${f.note})` : ''}`).join('; ') +
    '. Place each of these exact pieces into the room of image 1, copy its shape, color, material and proportions faithfully, scale it realistically to the room and do not redesign it. Do not copy the background of the reference photos.';
}
function buildRedesignPrompt(style, meta, concept, o = {}) {
  if (o.customPrompt) return PRESERVE + ' ' + o.customPrompt;
  let p = PRESERVE;
  if (o.keep) p += ' Keep the main existing furniture and the room layout where they are; restyle and add around them.';
  else p += ' Change furniture, decor, colors, materials and lighting.';
  p += ` Room type: ${meta.room || 'room'}. Style: ${style.prompt}.`;
  if (meta.description) p += ` The owner wrote (German): "${meta.description}".`;
  if (meta.problems) p += ` Problems the owner wants solved (German): "${meta.problems}".`;
  if (meta.wishes) p += ` The owner's wishes, which must be clearly visible in the result (German): "${meta.wishes}".`;
  const bud = parseBudget(meta.budget);
  p += bud > 0 ? ` Furniture and finishes must look realistic for a total budget of about ${bud} EUR.` : ' Furniture and finishes: solid mid-range quality, neither cheap-looking nor luxury.';
  if (o.wishes) p += ` Extra instruction for this image: "${o.wishes}".`;
  if (concept) {
    const farben = (concept.farben || []).map((f) => f.name).filter(Boolean).join(', ');
    const mat = (concept.materialien || []).join(', ');
    p += ` Follow this concept: ${concept.titel}. ${concept.idee || ''} Colors: ${farben}. Materials: ${mat}.`;
    const items = furnList(concept, o.furnitureIdx);
    if (items.length) p += ` Include these pieces, placed as described: ${items.join('; ')}.`;
  }
  return p;
}
async function atlasGenerate(model, prompt, dataUris, aspect) {
  if (!cfg.atlasKey) throw httpErr(400, 'ATLASCLOUD_API_KEY fehlt in der Datei .env.');
  const headers = { Authorization: 'Bearer ' + cfg.atlasKey, 'Content-Type': 'application/json' };
  const body = { model: model.id, prompt, [model.imageField]: [].concat(dataUris), ...(model.extra || {}), ...aspect };
  const r = await fetch(cfg.atlasBase + '/generateImage', { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code && j.code !== 200)) {
    const msg = j.msg || j.message || (j.error && (j.error.message || j.error)) || r.status;
    throw httpErr(502, `Atlas Cloud (${model.name}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}. Falls es um das Eingabebild geht: ein anderes Modell wählen.`);
  }
  const id = (j.data && j.data.id) || j.id;
  if (!id) throw httpErr(502, 'Atlas Cloud hat keine Auftrags-ID geliefert.');
  for (let i = 0; i < 90; i++) {
    await sleep(i < 3 ? 1500 : 2500);
    const pr = await fetch(`${cfg.atlasBase}/prediction/${id}`, { headers });
    const pj = await pr.json().catch(() => ({}));
    const d = pj.data || pj;
    if (d.status === 'completed' || d.status === 'succeeded') {
      const o = (d.outputs || [])[0];
      const url = typeof o === 'string' ? o : o && o.url;
      if (!url) throw httpErr(502, 'Atlas Cloud meldet Erfolg, aber ohne Bild.');
      return url;
    }
    if (d.status === 'failed') throw httpErr(502, `Atlas Cloud (${model.name}): Erzeugung fehlgeschlagen${d.error ? ': ' + d.error : ''}.`);
  }
  throw httpErr(504, 'Atlas Cloud hat nach etwa 4 Minuten nicht geantwortet.');
}
async function downloadTo(url, dir, base) {
  const r = await fetch(url);
  if (!r.ok) throw httpErr(502, 'Das fertige Bild konnte nicht geladen werden (' + r.status + ').');
  const ct = r.headers.get('content-type') || '';
  const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : 'jpg';
  const file = `${base}.${ext}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(await r.arrayBuffer()));
  return file;
}

// ---------- Einstellungen (.env) ----------
const ENV_FILE = path.join(ROOT, '.env');
function upsertEnv(updates) {
  let lines = [];
  try { lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/); }
  catch { try { lines = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').split(/\r?\n/); } catch { /* leer */ } }
  const seen = new Set();
  lines = lines.map((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) { seen.add(m[1]); return `${m[1]}=${updates[m[1]]}`; }
    return l;
  });
  for (const k of Object.keys(updates)) if (!seen.has(k)) lines.push(`${k}=${updates[k]}`);
  const tmp = ENV_FILE + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
}
const keyHint = (k) => (k ? '…' + k.slice(-4) : '');
function settingsView() {
  return {
    claude: { set: !!cfg.claudeKey, hint: keyHint(cfg.claudeKey) },
    atlas: { set: !!cfg.atlasKey, hint: keyHint(cfg.atlasKey) },
    claudeModel: cfg.claudeModel, dailyLimit: cfg.dailyLimit, version: VERSION,
  };
}
function saveSettings(b) {
  const up = {}, next = {};
  const keyOk = (v) => /^[A-Za-z0-9._\-+/=]{10,400}$/.test(v);
  const takeKey = (clear, val, envName, cfgName, label) => {
    if (clear) { up[envName] = ''; next[cfgName] = ''; return; }
    if (typeof val === 'string' && val.trim()) {
      const v = val.trim();
      if (!keyOk(v)) throw httpErr(400, `Der ${label}-Schlüssel hat ein ungültiges Format. Bitte ohne Leerzeichen und Anführungszeichen einfügen.`);
      up[envName] = v; next[cfgName] = v;
    }
  };
  takeKey(b.clearAnthropic, b.anthropicKey, 'ANTHROPIC_API_KEY', 'claudeKey', 'Claude');
  takeKey(b.clearAtlas, b.atlasKey, 'ATLASCLOUD_API_KEY', 'atlasKey', 'Atlas-Cloud');
  if (b.dailyLimit !== undefined && b.dailyLimit !== '') {
    const n = Number(String(b.dailyLimit).replace(',', '.'));
    if (!(n >= 0 && n <= 1000)) throw httpErr(400, 'Das Tageslimit muss eine Zahl zwischen 0 und 1000 sein.');
    up.DAILY_LIMIT_USD = String(n); next.dailyLimit = n;
  }
  if (typeof b.claudeModel === 'string' && b.claudeModel.trim()) {
    const v = b.claudeModel.trim();
    if (!/^[A-Za-z0-9._:-]{3,80}$/.test(v)) throw httpErr(400, 'Der Modellname enthält ungültige Zeichen.');
    up.CLAUDE_MODEL = v; next.claudeModel = v;
  }
  if (!Object.keys(up).length) throw httpErr(400, 'Es gibt nichts zu speichern.');
  try { upsertEnv(up); } catch (e) { throw httpErr(500, 'Die Datei .env konnte nicht geschrieben werden: ' + e.message); }
  Object.assign(cfg, next);
}

// ---------- Routen ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function handle(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) throw httpErr(403, 'Nur lokal erreichbar.');
  if (req.method !== 'GET' && req.headers.origin) {
    let oh = ''; try { oh = new URL(req.headers.origin).hostname; } catch { /* ungültig */ }
    if (!['localhost', '127.0.0.1'].includes(oh)) throw httpErr(403, 'Fremde Herkunft nicht erlaubt.');
  }
  const u = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(u.pathname);

  if (req.method === 'GET' && p === '/api/config') {
    const u = readUsage();
    return sendJson(res, 200, {
      styles: STYLES, rooms: ROOMS,
      models: MODELS.map((m) => ({ id: m.id, name: m.name, preis: m.preis, maxImages: m.maxImages || 5 })),
      budget: { used: u.usd, limit: cfg.dailyLimit },
      claude: { ok: !!cfg.claudeKey, model: cfg.claudeModel }, atlas: { ok: !!cfg.atlasKey },
      version: VERSION,
    });
  }
  if (p === '/api/settings' && req.method === 'GET') return sendJson(res, 200, settingsView());
  if (p === '/api/settings' && req.method === 'PUT') { saveSettings(await readJson(req, 64 * 1024)); return sendJson(res, 200, settingsView()); }
  if (req.method === 'GET' && p === '/api/projects') return sendJson(res, 200, listProjects());
  if (req.method === 'POST' && p === '/api/convert') {
    const buf = await readBuffer(req);
    if (!buf.length) throw httpErr(400, 'Keine Datei empfangen.');
    const raw = (u.searchParams.get('ext') || '').toLowerCase();
    const jpg = await convertToJpeg(buf, /^[a-z0-9]{2,5}$/.test(raw) ? raw : 'img');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(jpg);
  }
  if (req.method === 'POST' && p === '/api/projects') {
    const b = await readJson(req);
    const photo = parseDataUrl(b.photo);
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex');
    const dir = projDir(id); fs.mkdirSync(dir, { recursive: true });
    const photoFile = 'photo.' + photo.ext;
    fs.writeFileSync(path.join(dir, photoFile), photo.buf);
    const meta = {
      id, title: String(b.title || '').trim().slice(0, 80) || 'Ohne Titel', room: ROOMS.includes(b.room) ? b.room : ROOMS[0],
      description: cleanText(b.description, 2000), problems: cleanText(b.problems, 2000), wishes: cleanText(b.wishes, 2000),
      budget: cleanText(b.budget, 80), style: STYLES.some((x) => x.id === b.style) ? b.style : '', createdAt: new Date().toISOString(),
      photo: photoFile, width: +b.width || 0, height: +b.height || 0, redesigns: [],
    };
    writeMeta(id, meta);
    return sendJson(res, 201, meta);
  }

  let m = p.match(/^\/api\/projects\/([a-z0-9-]+)\/redesign\/(redesign-[A-Za-z0-9._-]+)$/);
  if (m && req.method === 'DELETE') {
    const meta = readMeta(m[1]);
    if (!(meta.redesigns || []).some((r) => r.file === m[2])) throw httpErr(404, 'Bild nicht gefunden.');
    meta.redesigns = meta.redesigns.filter((r) => r.file !== m[2]);
    writeMeta(m[1], meta);
    fs.rmSync(path.join(projDir(m[1]), m[2]), { force: true });
    return sendJson(res, 200, { ok: true });
  }
  m = p.match(/^\/api\/projects\/([a-z0-9-]+)\/furniture$/);
  if (m && req.method === 'POST') {
    const b = await readJson(req); const meta = readMeta(m[1]);
    if ((meta.furniture || []).length >= 12) throw httpErr(400, 'Es sind höchstens 12 eigene Möbelstücke pro Projekt möglich.');
    const img = parseDataUrl(b.photo);
    const name = cleanText(b.name, 80); if (!name) throw httpErr(400, 'Bitte einen Namen für das Möbelstück angeben.');
    const fid = crypto.randomBytes(3).toString('hex');
    const file = `own-${fid}.${img.ext}`;
    fs.writeFileSync(path.join(projDir(m[1]), file), img.buf);
    const fresh = readMeta(m[1]);
    fresh.furniture = (fresh.furniture || []).concat([{ id: fid, file, name, note: cleanText(b.note, 200) }]);
    fresh.briefUpdatedAt = new Date().toISOString();
    writeMeta(m[1], fresh);
    return sendJson(res, 201, { furniture: fresh.furniture });
  }
  m = p.match(/^\/api\/projects\/([a-z0-9-]+)\/furniture\/([a-f0-9]{6})$/);
  if (m && req.method === 'DELETE') {
    const meta = readMeta(m[1]); const f = (meta.furniture || []).find((x) => x.id === m[2]);
    if (!f) throw httpErr(404, 'Möbelstück nicht gefunden.');
    meta.furniture = meta.furniture.filter((x) => x.id !== m[2]); meta.briefUpdatedAt = new Date().toISOString();
    writeMeta(m[1], meta); fs.rmSync(path.join(projDir(m[1]), f.file), { force: true });
    return sendJson(res, 200, { furniture: meta.furniture });
  }
  m = p.match(/^\/api\/projects\/([a-z0-9-]+)(?:\/(ideas|redesign|prompt))?$/);
  if (m) {
    const id = m[1], action = m[2];
    if (!action && req.method === 'GET') return sendJson(res, 200, { ...readMeta(id), ideas: readIdeas(id) });
    if (!action && req.method === 'DELETE') { readMeta(id); fs.rmSync(projDir(id), { recursive: true, force: true }); return sendJson(res, 200, { ok: true }); }
    if (!action && req.method === 'PATCH') {
      const b = await readJson(req); const meta = readMeta(id); let changed = false;
      if (typeof b.title === 'string') meta.title = b.title.trim().slice(0, 80) || meta.title;
      for (const [k, n] of Object.entries(BRIEF_FIELDS)) if (typeof b[k] === 'string' && cleanText(b[k], n) !== (meta[k] || '')) { meta[k] = cleanText(b[k], n); changed = true; }
      if (ROOMS.includes(b.room) && b.room !== meta.room) { meta.room = b.room; changed = true; }
      if (typeof b.style === 'string') { const st = STYLES.some((x) => x.id === b.style) ? b.style : ''; if (st !== (meta.style || '')) { meta.style = st; changed = true; } }
      if (changed) meta.briefUpdatedAt = new Date().toISOString();
      writeMeta(id, meta); return sendJson(res, 200, meta);
    }

    if (action === 'ideas' && req.method === 'POST') {
      const meta = readMeta(id);
      const photoPath = path.join(projDir(id), meta.photo);
      const ext = path.extname(meta.photo).slice(1);
      const photo = { buf: fs.readFileSync(photoPath), mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext };
      reserve(cfg.claudeCost);
      let result;
      try { result = await callClaude(photo, briefText(meta, 'de'), ideasSystem(meta)); } catch (e) { refund(cfg.claudeCost); throw e; }
      const ideas = { createdAt: new Date().toISOString(), styleId: meta.style || null, budget: meta.budget || '', result };
      fs.writeFileSync(path.join(projDir(id), 'ideas.json'), JSON.stringify(ideas, null, 2));
      return sendJson(res, 200, ideas);
    }

    if (action === 'prompt' && req.method === 'POST') {
      const b = await readJson(req); const meta = readMeta(id);
      const style = STYLES.find((x) => x.id === b.styleId) || STYLES[0];
      const ideas = readIdeas(id);
      const concept = b.conceptIndex !== '' && b.conceptIndex != null ? ((ideas && ideas.result && ideas.result.konzepte) || [])[+b.conceptIndex] || null : null;
      const ext = path.extname(meta.photo).slice(1);
      const photo = { buf: fs.readFileSync(path.join(projDir(id), meta.photo)), mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext };
      let text = briefText({ ...meta, style: style.id }, 'en');
      if (b.wishes) text += `Extra instruction for this image (German): ${String(b.wishes).slice(0, 1500)}\n`;
      if (concept) text += `Concept: ${concept.titel}. ${concept.idee || ''} Colors: ${(concept.farben || []).map((f) => f.name).join(', ')}. Materials: ${(concept.materialien || []).join(', ')}.\n`;
      const items = furnList(concept, b.furnitureIdx);
      if (items.length) text += `Furniture to include (name, size, position): ${items.join('; ')}\n`;
      text += b.keep ? 'Keep the existing main furniture and layout in place.\n' : 'Existing furniture may be replaced.\n';
      reserve(cfg.claudeCost);
      let out;
      try { out = (await callClaudeText(PROMPT_SYSTEM, photo, text, 1200)).trim(); } catch (e) { refund(cfg.claudeCost); throw e; }
      if (!out) { refund(cfg.claudeCost); throw httpErr(502, 'Claude hat keinen Prompt geliefert. Bitte noch einmal versuchen.'); }
      return sendJson(res, 200, { prompt: out });
    }

    if (action === 'redesign' && req.method === 'POST') {
      const b = await readJson(req); const meta = readMeta(id);
      const style = STYLES.find((s) => s.id === b.styleId) || STYLES[0];
      const model = MODELS.find((x) => x.id === b.modelId) || MODELS[0];
      const count = Math.min(3, Math.max(1, parseInt(b.count, 10) || 1));
      let concept = null;
      if (b.conceptIndex !== null && b.conceptIndex !== undefined && b.conceptIndex !== '') {
        const ideas = readIdeas(id); concept = ideas && ideas.result && (ideas.result.konzepte || [])[+b.conceptIndex] || null;
      }
      const ext = path.extname(meta.photo).slice(1);
      const dataUri = `data:${ext === 'jpg' ? 'image/jpeg' : 'image/' + ext};base64,` + fs.readFileSync(path.join(projDir(id), meta.photo)).toString('base64');
      const wishes = String(b.wishes || '').trim().slice(0, 1500);
      const customPrompt = String(b.customPrompt || '').trim().slice(0, 4000);
      let prompt = buildRedesignPrompt(style, meta, concept, { wishes, customPrompt, keep: b.keep !== false, furnitureIdx: Array.isArray(b.furnitureIdx) ? b.furnitureIdx.slice(0, 30) : [] });
      const wantOwn = Array.isArray(b.ownIds) ? b.ownIds : [];
      const own = (meta.furniture || []).filter((f) => wantOwn.includes(f.id)).slice(0, MAX_OWN);
      const uris = [dataUri];
      if (own.length) {
        if ((model.maxImages || 5) < own.length + 1) throw httpErr(400, `${model.name} kann nur ${model.maxImages} Bild verarbeiten, also kein eigenes Möbelstück. Bitte Nano Banana 2 oder Seedream 4.5 wählen.`);
        own.forEach((f) => {
          const e = path.extname(f.file).slice(1);
          uris.push(`data:${e === 'jpg' ? 'image/jpeg' : 'image/' + e};base64,` + fs.readFileSync(path.join(projDir(id), f.file)).toString('base64'));
        });
        prompt = ownRefs(own) + ' ' + prompt;
      }
      const aspect = pickAspect(model, meta.width, meta.height);
      const cost = model.preis * count;
      reserve(cost);
      const settled = await Promise.allSettled(Array.from({ length: count }, async (_, n) => {
        const url = await atlasGenerate(model, prompt, uris, aspect);
        const file = await downloadTo(url, projDir(id), `redesign-${Date.now().toString(36)}-${n}`);
        return { file, modelId: model.id, model: model.name, styleId: style.id, style: style.name, concept: concept ? concept.titel : null, prompt, createdAt: new Date().toISOString() };
      }));
      const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
      const failed = settled.filter((s) => s.status === 'rejected');
      if (failed.length) refund(model.preis * failed.length);
      if (ok.length) { const fresh = readMeta(id); fresh.redesigns = (fresh.redesigns || []).concat(ok); writeMeta(id, fresh); }
      if (!ok.length) throw failed[0].reason;
      return sendJson(res, 200, { added: ok, errors: failed.map((f) => f.reason.message) });
    }
  }

  m = p.match(/^\/files\/([a-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  if (m && req.method === 'GET') return serveFile(res, path.join(projDir(m[1]), m[2]));

  if (req.method === 'GET') {
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const file = path.join(PUB, rel);
    if (!file.startsWith(PUB + path.sep)) throw httpErr(403, 'Nicht erlaubt.');
    return serveFile(res, file);
  }
  throw httpErr(404, 'Nicht gefunden.');
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message || 'Unbekannter Fehler' });
  });
}).listen(cfg.port, '127.0.0.1', () => {
  console.log(`Raumplanung läuft: http://localhost:${cfg.port}`);
  if (!cfg.claudeKey) console.log('Hinweis: ANTHROPIC_API_KEY fehlt (.env).');
  if (!cfg.atlasKey) console.log('Hinweis: ATLASCLOUD_API_KEY fehlt (.env).');
});
