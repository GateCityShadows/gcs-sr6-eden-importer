/* Gate City Shadows — SR6 Eden Importer (v0.4.1)
 * - Sanitizes incoming JSON (removes _stats/_id/ownership/etc.)
 * - GM socket fallback preserved
 * - v13-friendly header-control hooks
 */
const MOD_ID = "gcs-sr6-eden-importer";
const SYS_ID = "shadowrun6-eden";
const SOCKET = `module.${MOD_ID}`;

console.log(`[${MOD_ID}] importer.js loaded`);

Hooks.once("init", () => console.log(`[${MOD_ID}] init`));
Hooks.once("setup", () => console.log(`[${MOD_ID}] setup`));
Hooks.once("ready", () => {
  console.log(`[${MOD_ID}] ready — system=${game.system?.id}, core=${game.version ?? game.release?.generation}`);

  const pkg = game.modules.get(MOD_ID);
  if (pkg) pkg.api = { open: () => GCSImporter.openDialog() };
  globalThis.gcsImporter = { open: () => GCSImporter.openDialog() };

  // GM handles creation requests from players
  game.socket.on(SOCKET, async (msg) => {
    try {
      if (!game.user.isGM) return;
      if (!msg || msg.action !== "createActor" || !Array.isArray(msg.docs)) return;
      const created = await createDirect(msg.docs.map(sanitizeActorData), msg.options);
      const actorId = created?.[0]?.id ?? null;
      game.socket.emit(SOCKET, { action: "createActorResult", requestId: msg.requestId, ok: !!actorId, actorId, error: actorId ? null : "No actor created" });
    } catch (err) {
      game.socket.emit(SOCKET, { action: "createActorResult", requestId: msg?.requestId, ok: false, error: err?.message || String(err) });
    }
  });
});

/* ---------- header controls (v13) + legacy injection fallback ---------- */
Hooks.on("getHeaderControls", (app, controls) => isActorDirectory(app) && addHeaderControl(controls));
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => isActorDirectory(app) && addHeaderControl(controls));
Hooks.on("getHeaderControlsActorDirectory", (app, controls) => isActorDirectory(app) && addHeaderControl(controls));

Hooks.on("renderActorDirectory", (app, htmlOrElem) => {
  const root = htmlOrElem instanceof HTMLElement ? htmlOrElem : htmlOrElem?.[0];
  if (!root) return;
  const header = root.querySelector(".directory-header .header-actions");
  if (!header || header.querySelector(".gcs-eden-import")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gcs-eden-import";
  btn.innerHTML = `<i class="fas fa-file-import"></i> SR6-Eden Import`;
  btn.addEventListener("click", () => GCSImporter.openDialog());
  header.appendChild(btn);

  // drag & drop JSON onto the directory
  root.addEventListener("dragover", (ev) => {
    const items = ev.dataTransfer?.items ? Array.from(ev.dataTransfer.items) : [];
    if (items.some((i) => i.kind === "file")) ev.preventDefault();
  });
  root.addEventListener("drop", async (ev) => {
    try {
      const file = ev.dataTransfer?.files?.[0];
      if (!file || !file.name.toLowerCase().endsWith(".json")) return;
      ev.preventDefault();
      const txt = await file.text();
      await GCSImporter.importFromText(txt, { debug: true });
    } catch (err) {
      ui.notifications.error(`SR6-Eden Import (drop) failed: ${err?.message || err}`);
      console.error(`[${MOD_ID}] drop import error`, err);
    }
  });
});

function addHeaderControl(controls) {
  if (controls.some((c) => c?.class === "gcs-eden-import-ctl")) return;
  controls.push({ icon: "fas fa-file-import", label: "SR6-Eden Import", class: "gcs-eden-import-ctl", onClick: () => GCSImporter.openDialog() });
}
function isActorDirectory(app) {
  if (!app) return false;
  if (app?.constructor?.name === "ActorDirectory") return true;
  if (app?.options?.id === "actors") return true;
  const cls = foundry?.applications?.sidebar?.tabs?.ActorDirectory;
  return !!(cls && app instanceof cls);
}

/* -------------------------------- Importer UI -------------------------------- */
const GCSImporter = {
  openDialog() {
    const canCreate = canUserCreateActors();
    if (!canCreate) ui.notifications.info("You may not have permission to create Actors; importer will try GM-assisted creation.");

    const folders = (game.folders ?? []).filter((f) => f.type === "Actor");
    const content = `
      <form class="gcs-eden-form">
        <div class="form-group">
          <label>Choose a SR6-Eden Actor JSON file</label>
          <input type="file" accept=".json,application/json" />
          <p class="notes">Use a JSON from your Gate City Shadows generator or any JSON matching the shadowrun6-eden actor schema.</p>
        </div>
        <div class="form-group">
          <label>Actor Folder (optional)</label>
          <select name="folder">
            <option value="">— none —</option>
            ${folders.map((f) => `<option value="${f.id}">${f.name}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Render Sheet After Import</label>
          <input type="checkbox" name="render" checked />
        </div>
        <hr/>
        <details>
          <summary>Advanced</summary>
          <label style="display:block;margin-top:.25rem;">
            Proceed if system id differs (this world: <code>${game.system?.id}</code>)
            <input type="checkbox" name="forceSystem" checked />
          </label>
          <label style="display:block;margin-top:.25rem;">
            If <code>type</code> is not recognized, coerce to <code>Player</code>
            <input type="checkbox" name="coerceType" checked />
          </label>
          <label style="display:block;margin-top:.25rem;">
            Try GM-assisted creation if direct create is denied
            <input type="checkbox" name="gmFallback" checked />
          </label>
          <label style="display:block;margin-top:.25rem;">
            Log debug to console
            <input type="checkbox" name="debug" checked />
          </label>
        </details>
      </form>
    `;

    new Dialog({
      title: "SR6-Eden: Import Actor JSON",
      content,
      buttons: {
        import: {
          label: "Import",
          icon: '<i class="fas fa-file-import"></i>',
          callback: async (html) => {
            const root = html[0] ?? html;
            const form = root.querySelector("form");
            const file = form.querySelector('input[type=file]').files[0];
            if (!file) return ui.notifications.warn("Please choose a .json file.");
            const folder = form.querySelector("select[name=folder]").value || null;
            const render = form.querySelector("input[name=render]").checked;
            const forceSystem = form.querySelector("input[name=forceSystem]").checked;
            const coerceType = form.querySelector("input[name=coerceType]").checked;
            const gmFallback = form.querySelector("input[name=gmFallback]").checked;
            const debug = form.querySelector("input[name=debug]").checked;

            try {
              const txt = await file.text();
              if (debug) console.debug(`[${MOD_ID}] raw JSON`, truncate(txt));
              const created = await GCSImporter.importFromText(txt, { folder, render, forceSystem, coerceType, gmFallback, debug });
              if (debug) console.debug(`[${MOD_ID}] created`, created);
            } catch (err) {
              ui.notifications.error(`Import failed: ${err?.message || err}`);
              console.error(`[${MOD_ID}] import failed`, err);
            }
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "import"
    }).render(true);
  },

  async importFromText(text, opts = {}) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("Invalid JSON"); }

    if (Array.isArray(data)) {
      const results = [];
      for (const d of data) results.push(await importOne(d, opts));
      ui.notifications.info(`Imported ${results.filter(Boolean).length} SR6-Eden actor(s).`);
      return results.filter(Boolean);
    }

    const actor = await importOne(data, opts);
    if (actor) ui.notifications.info(`Imported actor: ${actor.name}`);
    return [actor].filter(Boolean);
  }
};

/* ---------------------------- Import core (1 actor) --------------------------- */
async function importOne(input, { folder = null, render = true, forceSystem = true, coerceType = true, gmFallback = true, debug = false } = {}) {
  const data = foundry.utils.duplicate(input);

  if (forceSystem && game.system?.id !== SYS_ID) {
    ui.notifications.warn(`This world is running system "${game.system?.id}". Importer expects "${SYS_ID}". Proceeding anyway.`);
  }

  // Normalize actor type for Eden
  const t = String(data.type || "").toLowerCase();
  data.type = ["player", "character", "pc", "runner"].includes(t) ? "Player" : (coerceType ? "Player" : data.type || "Player");

  // Ensure system object and eden-ish attributes/skills exist
  data.system ??= {};
  data.system.attributes ??= {};
  const attrs = data.system.attributes;

  const mapFlat = { body:"bod", agility:"agi", reaction:"rea", strength:"str", willpower:"wil", logic:"log", intuition:"int", charisma:"cha" };
  for (const [flatKey, edenKey] of Object.entries(mapFlat)) {
    if (!attrs[edenKey]) {
      const n = Number(attrs[flatKey] ?? input.system?.attributes?.[flatKey] ?? input.attributes?.[flatKey]);
      if (Number.isFinite(n)) attrs[edenKey] = mkAttr(n);
    }
    if (!attrs[edenKey]) attrs[edenKey] = mkAttr(1);
  }
  attrs.mag = objOrNum(attrs.mag, 0, true);
  attrs.res = objOrNum(attrs.res, 0);
  attrs.edg = edgeObj(attrs.edg, Number(attrs.edg?.max ?? 1));
  attrs.essence = attrs.essence || { base: 6, mod: 0, pool: 6 };

  data.system.skills = data.system.skills || {};
  const edenSkillKeys = ["astral","athletics","biotech","close_combat","con","conjuring","cracking","electronics","enchanting","engineering","exotic_weapons","firearms","influence","outdoors","perception","piloting","sorcery","stealth","tasking"];
  for (const k of edenSkillKeys) {
    const v = data.system.skills[k];
    if (typeof v === "number") data.system.skills[k] = sk(v);
    else if (!v || typeof v !== "object") data.system.skills[k] = sk(0);
  }

  data.img ||= "systems/shadowrun6-eden/icons/compendium/default/Default_Clothing.svg";
  data.prototypeToken ||= {
    name: data.name || "Runner",
    displayName: 20, actorLink: true,
    width: 1, height: 1,
    texture: { src: data.img, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1 },
    bar1: { attribute: "physical" }, bar2: { attribute: "stun" }
  };

  if (folder) data.folder = folder;

  // *** NEW: Sanitize before creation ***
  const clean = sanitizeActorData(data);
  if (debug) console.debug(`[${MOD_ID}] sanitized actor`, clean);

  // Try direct create; if denied, ask GM via socket
  let actor = null;
  try {
    const created = await createWithFallback([clean], { render: false }, gmFallback);
    actor = created?.[0] ?? null;
  } catch (err) {
    ui.notifications.error(`Actor creation failed: ${err?.message || err}`);
    console.error(`[${MOD_ID}] createWithFallback error`, err);
    return null;
  }

  if (!actor) {
    ui.notifications.error("Actor creation returned no result. Check console.");
    console.error(`[${MOD_ID}] create returned null/empty`);
    return null;
  }
  if (render && actor.sheet) actor.sheet.render(true);
  return actor;
}

/* --------------------------- Creation helpers --------------------------- */
function canUserCreateActors() {
  try {
    return game.actors?.documentClass?.canUserCreate?.(game.user)
        ?? game.user?.isGM
        ?? false;
  } catch { return !!game.user?.isGM; }
}

async function createWithFallback(arr, opts, gmFallback) {
  if (canUserCreateActors()) return await createDirect(arr, opts);

  if (!gmFallback) throw new Error("User lacks permission to create Actors and GM-fallback is disabled.");

  const requestId = randomId();
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { game.socket.off(SOCKET, handler); reject(new Error("GM did not respond to creation request (timeout).")); }, 15000);
    function handler(msg) {
      if (!msg || msg.action !== "createActorResult" || msg.requestId !== requestId) return;
      clearTimeout(timeout); game.socket.off(SOCKET, handler);
      if (msg.ok) { const actor = game.actors.get(msg.actorId); return resolve([actor].filter(Boolean)); }
      reject(new Error(msg.error || "Unknown GM creation error"));
    }
    game.socket.on(SOCKET, handler);
    game.socket.emit(SOCKET, { action: "createActor", requestId, docs: arr, options: opts });
  });
  return result;
}

async function createDirect(arr, opts = {}) {
  if (Actor?.createDocuments) return await Actor.createDocuments(arr, opts);
  if (Actor?.implementation?.createDocuments) return await Actor.implementation.createDocuments(arr, opts);
  const a = await Actor.create(arr[0], opts); // very old fallback
  return [a].filter(Boolean);
}

/* ------------------------------ Sanitizer ------------------------------ */
function sanitizeActorData(src) {
  const data = foundry.utils.duplicate(src);

  // Only keep document-legal top-level keys
  const allowedTop = new Set(["name","type","img","system","items","effects","folder","flags","prototypeToken"]);
  for (const k of Object.keys(data)) if (!allowedTop.has(k)) delete data[k];

  // Remove internal & unsafe keys
  delete data._id;
  delete data._stats;
  delete data.permission;
  delete data.ownership; // let Foundry assign
  delete data.sort;      // let Foundry assign

  // Fix folder if it doesn't exist
  if (data.folder && !game.folders.get(data.folder)) delete data.folder;

  // Items / Effects: strip internals too
  if (Array.isArray(data.items)) data.items = data.items.map(sanitizeEmbedded);
  if (Array.isArray(data.effects)) data.effects = data.effects.map(sanitizeEmbedded);

  // Token: make sure it has no private internals either
  if (data.prototypeToken) {
    delete data.prototypeToken._id;
    delete data.prototypeToken.actorId;
    delete data.prototypeToken.flags?.core?.sourceId;
  }

  // System-specific: ensure plain objects, no _stats inside
  if (data.system && typeof data.system === "object") {
    deepStrip(data.system, ["_id","_stats","_sourceId","_key","permission","ownership"]);
  }

  return data;
}
function sanitizeEmbedded(it) {
  const e = foundry.utils.duplicate(it);
  delete e._id;
  delete e._stats;
  delete e.permission;
  delete e.ownership;
  // only keep doc schema-ish keys
  const keep = new Set(["name","type","img","system","flags","effects"]);
  for (const k of Object.keys(e)) if (!keep.has(k)) delete e[k];
  if (e.system && typeof e.system === "object") deepStrip(e.system, ["_id","_stats","_sourceId","_key","permission","ownership"]);
  if (Array.isArray(e.effects)) e.effects = e.effects.map(sanitizeEmbedded);
  return e;
}
function deepStrip(obj, blacklistKeys) {
  for (const k of Object.keys(obj)) {
    if (blacklistKeys.includes(k)) { delete obj[k]; continue; }
    const v = obj[k];
    if (v && typeof v === "object") deepStrip(v, blacklistKeys);
  }
}

/* ------------------------------ Utilities ------------------------------ */
function mkAttr(base){ const n = Number(base)||0; return { base:n, mod:0, modString:"", augment:0, pool:n }; }
function objOrNum(obj, def, hasMin=false){ if (typeof obj==="number") return hasMin?{base:obj,mod:0,pool:obj,min:0}:{base:obj,mod:0,pool:obj}; if (obj&&typeof obj==="object") return obj; return hasMin?{base:def,mod:0,pool:def,min:0}:{base:def,mod:0,pool:def}; }
function edgeObj(obj, maxDefault=1){ if (obj && typeof obj==="object" && "max" in obj) return obj; return { current:0, max:Number(maxDefault)||1 }; }
function sk(points){ return { points:Number(points)||0, specialization:"", expertise:"", modifier:0, augment:0 }; }
function randomId(){ return crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2); }
function truncate(txt, n=1600){ return txt.length>n ? (txt.slice(0,n)+"…(truncated)") : txt; }
