/* ══════════════════════════════════════════════
   app.js — Déclaration d'anomalie · Rassemblement kit
   ══════════════════════════════════════════════ */

/* ── Constantes globales ── */
const MAX_PHOTOS   = 4;
const MAX_PX       = 900;
const JPEG_QUALITY = 0.72;
const WARN_SIZE_B  = 200000; // 200 Ko

/* ── Firebase ── */
const firebaseConfig = {
  apiKey:            "AIzaSyARI0sADSyvYcTwaSlK0TpvLY0uwL2BlRw",
  authDomain:        "rassemblement-b7927.firebaseapp.com",
  projectId:         "rassemblement-b7927",
  storageBucket:     "rassemblement-b7927.firebasestorage.app",
  messagingSenderId: "127334162906",
  appId:             "1:127334162906:web:92c2e6281c93df6eab20e3"
};
firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

/* ── Chargement tree.json ── */
let TREE = null;
fetch('./tree.json')
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(data => {
    TREE = data;
    auth.onAuthStateChanged(u => u ? showApp(u) : showLogin());
  })
  .catch(err => {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                  background:#151c2c;font-family:system-ui;text-align:center;padding:24px">
        <div style="background:#fff;border-radius:16px;padding:32px;max-width:400px">
          <div style="font-size:40px;margin-bottom:12px">⚠️</div>
          <h2 style="color:#151c2c;margin-bottom:8px">Impossible de charger tree.json</h2>
          <p style="color:#6b7280;font-size:14px">
            Vérifiez que <strong>tree.json</strong> est dans le même dossier que index.html.
          </p>
          <p style="color:#dc2626;font-size:12px;margin-top:12px">${err.message}</p>
        </div>
      </div>`;
  });

/* ══════════════════════════════════════════════
   AUTHENTIFICATION
   ══════════════════════════════════════════════ */
async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-password").value;
  const btn   = document.getElementById("login-btn");

  document.getElementById("login-error").classList.remove("show");
  ["login-email", "login-password"].forEach(id => document.getElementById(id).classList.remove("error"));

  if (!email || !pass) {
    showLoginError("Veuillez remplir tous les champs.");
    if (!email) document.getElementById("login-email").classList.add("error");
    if (!pass)  document.getElementById("login-password").classList.add("error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>&nbsp;Connexion…';

  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = "Se connecter";
    const msgs = {
      "auth/user-not-found":        "Aucun compte trouvé pour cet e-mail.",
      "auth/wrong-password":        "Mot de passe incorrect.",
      "auth/invalid-email":         "Adresse e-mail invalide.",
      "auth/too-many-requests":     "Trop de tentatives. Réessayez dans quelques minutes.",
      "auth/invalid-credential":    "Identifiants incorrects. Vérifiez votre e-mail et mot de passe.",
      "auth/network-request-failed":"Erreur réseau. Vérifiez votre connexion."
    };
    showLoginError(msgs[err.code] || "Erreur : " + err.message);
  }
}

function showLoginError(msg) {
  const b = document.getElementById("login-error");
  b.textContent = "⚠ " + msg;
  b.classList.add("show");
}

async function doLogout() {
  if (!confirm("Se déconnecter ?")) return;
  await auth.signOut();
}

function showLogin() {
  document.getElementById("login-view").style.display = "flex";
  document.getElementById("app-view").style.display   = "none";
  document.getElementById("login-email").value    = "";
  document.getElementById("login-password").value = "";
  document.getElementById("login-error").classList.remove("show");
  const btn = document.getElementById("login-btn");
  btn.disabled = false;
  btn.innerHTML = "Se connecter";
}

function showApp(user) {
  document.getElementById("login-view").style.display = "none";
  document.getElementById("app-view").style.display   = "block";
  const email = user.email || "";
  document.getElementById("user-avatar").textContent        = email.charAt(0).toUpperCase();
  document.getElementById("user-email-display").textContent = email;

  const overlay = document.getElementById("confirm-overlay");
  if (overlay && !overlay.dataset.listenerSet) {
    overlay.addEventListener("click", e => { if (e.target === overlay) closeConfirm(); });
    overlay.dataset.listenerSet = "1";
  }
  restart();
}

document.addEventListener("keydown", e => {
  if (e.key === "Enter" && document.getElementById("login-view").style.display !== "none") doLogin();
});

/* ══════════════════════════════════════════════
   ÉTAT NAVIGATION
   ══════════════════════════════════════════════ */
let currentStepId = null;
let stepHistory   = [];
let collected     = {};
let breadcrumb    = [];
let toastTimer    = null;
let pendingPhotos = []; // [{ base64, size }]
const ESTIMATED_MAX = 9;

/* ══════════════════════════════════════════════
   RENDU PRINCIPAL
   ══════════════════════════════════════════════ */
function render() {
  const step = TREE.nodes[currentStepId];
  const pct  = Math.min(Math.round((stepHistory.length / ESTIMATED_MAX) * 100), 95);
  document.getElementById("progress-bar").style.width   = pct + "%";
  document.getElementById("progress-label").textContent = "Étape " + (stepHistory.length + 1);
  document.getElementById("breadcrumb").innerHTML = breadcrumb.map((b, i) =>
    (i > 0 ? '<span class="bc-sep">›</span>' : '') + `<span class="bc-item">${b}</span>`
  ).join("");

  let inner = `<div class="step-tag">${step.tag || ""}</div><div class="step-question">${step.question}</div>`;

  if (step.type === "select") {
    inner += `<div class="options">${step.options.map((o, i) =>
      `<button class="opt-btn" onclick="pickOption(${i})"><span>${o.label}</span><span class="chevron">›</span></button>`
    ).join("")}</div>`;
    if (stepHistory.length > 0)
      inner += `<div class="btn-row"><button class="btn btn-back" onclick="goBack()">← Retour</button></div>`;

  } else if (step.type === "fields") {
    inner += `<div class="fields">${step.fields.map(f =>
      `<div class="field"><label>${f.label}</label>
       <input id="f_${f.key}" placeholder="${f.placeholder}" value="${esc(collected[f.key] || "")}" /></div>`
    ).join("")}</div>` + navButtons("submitFields()");

  } else if (step.type === "text") {
    inner += `<div class="fields"><div class="field">
      <input id="txt_field" placeholder="${step.placeholder}" value="${esc(collected[step.field] || "")}" />
    </div></div>` + navButtons("submitText()");

  } else if (step.type === "textarea") {
    const isLast = step.next === null;
    inner += `<div class="fields"><div class="field">
      <textarea id="ta_field" placeholder="${step.placeholder}">${esc(collected[step.field || "commentaire"] || "")}</textarea>
    </div></div>` + navButtons("submitTextarea()", isLast ? "📋 Voir le récapitulatif" : "Suivant →");

  } else if (step.type === "info") {
    inner += `<div class="info-banner">${step.message}</div>` + navButtons("advanceStep()");
  }

  document.getElementById("step-container").innerHTML = `<div class="card">${inner}</div>`;
}

function navButtons(onNext, nextLabel = "Suivant →") {
  const back = stepHistory.length > 0
    ? `<button class="btn btn-back" onclick="goBack()">← Retour</button>`
    : "";
  return `<div class="btn-row">${back}<button class="btn btn-next" onclick="${onNext}">${nextLabel}</button></div>`;
}

function esc(s) {
  return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/* ══════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════ */
function pickOption(i) {
  const step = TREE.nodes[currentStepId];
  const opt  = step.options[i];
  pushHistory();
  breadcrumb.push(opt.label);
  collected["n" + stepHistory.length] = opt.label;
  currentStepId = opt.next;
  render();
}

function submitFields() {
  const step = TREE.nodes[currentStepId];
  let ok = true;
  step.fields.forEach(f => {
    const el  = document.getElementById("f_" + f.key);
    const val = el.value.trim();
    if (f.required && !val) { el.classList.add("error"); ok = false; }
    else { el.classList.remove("error"); collected[f.key] = val; }
  });
  if (!ok) { alert("❗ Veuillez remplir tous les champs obligatoires (*)"); return; }
  pushHistory();
  currentStepId = step.next;
  render();
}

function submitText() {
  const step = TREE.nodes[currentStepId];
  const val  = document.getElementById("txt_field").value.trim();
  if (step.required && !val) { alert("❗ Ce champ est obligatoire."); return; }
  collected[step.field] = val;
  pushHistory();
  currentStepId = step.next;
  render();
}

function submitTextarea() {
  const step = TREE.nodes[currentStepId];
  collected[step.field || "commentaire"] = document.getElementById("ta_field").value.trim();
  pushHistory();
  if (step.next === null) renderSummary();
  else { currentStepId = step.next; render(); }
}

function advanceStep() {
  const step = TREE.nodes[currentStepId];
  pushHistory();
  currentStepId = step.next;
  render();
}

function goBack() {
  if (!stepHistory.length) return;
  const prev = stepHistory.pop();
  currentStepId = prev.stepId;
  collected     = prev.collected;
  breadcrumb    = prev.breadcrumb;
  render();
}

function pushHistory() {
  stepHistory.push({
    stepId:    currentStepId,
    collected: JSON.parse(JSON.stringify(collected)),
    breadcrumb: [...breadcrumb]
  });
}

/* ── Label map ── */
const LABEL_MAP = {
  support:     "Support",
  kit:         "Kit",
  engin:       "Engin",
  commentaire: "Commentaire",
  preco:       "Préconisation",
  stockage_hs: "Emplacement HS"
};

/* ══════════════════════════════════════════════
   RÉCAPITULATIF
   ══════════════════════════════════════════════ */
function renderSummary() {
  document.getElementById("progress-bar").style.width   = "100%";
  document.getElementById("progress-label").textContent = "Récapitulatif";

  const path = [];
  for (let i = 1; ; i++) { if (collected["n" + i]) path.push(collected["n" + i]); else break; }
  const extras = Object.entries(collected)
    .filter(([k]) => !k.startsWith("n"))
    .map(([k, v]) => ({ key: LABEL_MAP[k] || k, val: v || "—" }));

  document.getElementById("step-container").innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="step-tag">Récapitulatif</div>
      <div class="step-question" style="font-size:17px">Vérifiez avant d'enregistrer</div>
    </div>

    <div class="summary-table">
      <div class="summary-header">📋 Chemin d'anomalie</div>
      ${path.map((p, i) => `
        <div class="summary-row">
          <span class="s-key">Niveau ${i + 1}</span>
          <span class="s-val">${p}</span>
        </div>`).join("")}
    </div>

    ${extras.length ? `<div class="summary-table">
      <div class="summary-header">📝 Données saisies</div>
      ${extras.map(e => `
        <div class="summary-row">
          <span class="s-key">${e.key}</span>
          <span class="s-val">${e.val}</span>
        </div>`).join("")}
    </div>` : ""}

    <div class="summary-table" style="margin-bottom:14px">
      <div class="summary-header">📷 Photos (optionnel · max ${MAX_PHOTOS})</div>
      <div style="padding:14px 16px">
        <div class="photo-size-warn" id="photo-warn">⚠ Une ou plusieurs photos dépassent 200 Ko après compression.</div>
        <div class="photo-grid" id="photo-preview-grid"></div>
        <div id="photo-add-zone" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          <button class="btn btn-next"
                  style="flex:1;min-width:140px;font-size:14px;padding:13px 10px;"
                  onclick="triggerPhotoCamera()">
            📷 Prendre une photo
          </button>
          <button class="btn btn-back"
                  style="flex:1;min-width:140px;font-size:14px;padding:13px 10px;background:#e5e7eb;color:#111827;"
                  onclick="triggerPhotoGallery()">
            🖼 Depuis la galerie
          </button>
        </div>
        <div id="photo-counter" style="font-size:12px;color:var(--muted);margin-top:8px;text-align:right;">
          0 / ${MAX_PHOTOS} photo
        </div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
      <button class="btn btn-back" style="flex:0 0 auto;" onclick="restart()">↺ Recommencer</button>
      <button class="btn-submit-main" id="save-btn" onclick="saveAnomaly()" style="flex:1;min-width:180px;">
        ✅ Enregistrer l'anomalie
      </button>
    </div>

    <div class="success-state" id="success-state">
      <div class="success-icon">✅</div>
      <h2>Anomalie enregistrée !</h2>
      <p>La déclaration a été sauvegardée avec succès.</p>
      <button class="btn-new" onclick="restart()">+ Nouvelle déclaration</button>
    </div>
  `;

  renderPhotoPreview();
}

/* ══════════════════════════════════════════════
   PHOTOS
   ══════════════════════════════════════════════ */
function triggerPhotoCamera() {
  const input = document.getElementById("photo-input");
  input.removeAttribute("capture");
  input.setAttribute("capture", "environment");
  input.value = "";
  input.click();
}

function triggerPhotoGallery() {
  const input = document.getElementById("photo-input");
  input.removeAttribute("capture");
  input.value = "";
  input.click();
}

async function handlePhotoInput(event) {
  const files     = Array.from(event.target.files);
  if (!files.length) return;
  const remaining = MAX_PHOTOS - pendingPhotos.length;
  const toProcess = files.slice(0, remaining);

  for (const file of toProcess) {
    try {
      const base64 = await compressToBase64(file);
      pendingPhotos.push({ base64, size: base64.length });
    } catch (e) {
      showToast("❌ Erreur photo : " + e.message);
    }
  }
  if (files.length > remaining)
    showToast("⚠ Max " + MAX_PHOTOS + " photos — " + (files.length - remaining) + " ignorée(s)");

  renderPhotoPreview();
}

function compressToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error("Lecture impossible")); };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () { reject(new Error("Image invalide")); };
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > MAX_PX || h > MAX_PX) {
          if (w >= h) { h = Math.round(h * MAX_PX / w); w = MAX_PX; }
          else        { w = Math.round(w * MAX_PX / h); h = MAX_PX; }
        }
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  var grid    = document.getElementById("photo-preview-grid");
  var addZone = document.getElementById("photo-add-zone");
  var warn    = document.getElementById("photo-warn");
  var counter = document.getElementById("photo-counter");
  if (!grid) return;

  var hasLarge = pendingPhotos.some(function (p) { return p.size > WARN_SIZE_B; });
  if (hasLarge) warn.classList.add("show"); else warn.classList.remove("show");

  grid.innerHTML = pendingPhotos.map(function (p, i) {
    return '<div class="photo-thumb-wrap">' +
      '<img src="' + p.base64 + '" alt="Photo ' + (i + 1) + '" onclick="openLightboxLocal(' + i + ')" />' +
      '<button class="photo-thumb-del" onclick="removePhoto(' + i + ')">✕</button>' +
      '</div>';
  }).join("");

  if (addZone) addZone.style.display = pendingPhotos.length >= MAX_PHOTOS ? "none" : "flex";
  if (counter) {
    var n = pendingPhotos.length;
    counter.textContent = n + " / " + MAX_PHOTOS + " photo" + (n > 1 ? "s" : "");
  }
}

function removePhoto(index) {
  pendingPhotos.splice(index, 1);
  renderPhotoPreview();
}

/* ══════════════════════════════════════════════
   LIGHTBOX
   ══════════════════════════════════════════════ */
var lbImages = [];
var lbIndex  = 0;

function openLightboxLocal(i)            { lbImages = pendingPhotos.map(p => p.base64); openLightbox(i); }
function openLightboxHistory(photos, i)  { lbImages = photos; openLightbox(i); }

function openLightbox(i) {
  lbIndex = i;
  updateLightboxImage();
  document.getElementById("lightbox").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("show");
  document.body.style.overflow = "";
}

function updateLightboxImage() {
  document.getElementById("lightbox-img").src        = lbImages[lbIndex];
  document.getElementById("lightbox-counter").textContent = (lbIndex + 1) + " / " + lbImages.length;
  document.getElementById("lightbox-prev").style.display  = lbImages.length > 1 ? "grid" : "none";
  document.getElementById("lightbox-next").style.display  = lbImages.length > 1 ? "grid" : "none";
}

function lightboxNav(dir) {
  lbIndex = (lbIndex + dir + lbImages.length) % lbImages.length;
  updateLightboxImage();
}

function handleLightboxClick(e) {
  if (e.target === document.getElementById("lightbox")) closeLightbox();
}

document.addEventListener("keydown", function (e) {
  if (!document.getElementById("lightbox").classList.contains("show")) return;
  if (e.key === "ArrowRight") lightboxNav(+1);
  if (e.key === "ArrowLeft")  lightboxNav(-1);
  if (e.key === "Escape")     closeLightbox();
});

/* ══════════════════════════════════════════════
   SAUVEGARDE FIREBASE
   ══════════════════════════════════════════════ */
async function saveAnomaly() {
  var btn = document.getElementById("save-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-top-color:#fff;border-color:#fff4;width:18px;height:18px;' +
    'display:inline-block;vertical-align:middle;margin-right:8px;border-radius:50%;' +
    'animation:spin .7s linear infinite;border-width:2.5px;flex-shrink:0"></span>Enregistrement…';

  var path = [];
  for (var i = 1; ; i++) { if (collected["n" + i]) path.push(collected["n" + i]); else break; }

  var user = auth.currentUser;
  try {
    await db.collection("anomalies").add({
      chemin:          path,
      categorie:       path[0]                   || "",
      support:         collected.support         || "",
      kit:             collected.kit             || "",
      engin:           collected.engin           || "",
      commentaire:     collected.commentaire     || "",
      preco:           collected.preco           || "",
      stockage_hs:     collected.stockage_hs     || "",
      date:            new Date().toISOString(),
      ts:              firebase.firestore.FieldValue.serverTimestamp(),
      declarant_uid:   user ? user.uid   : "",
      declarant_email: user ? user.email : "",
      photos:          pendingPhotos.map(p => p.base64)
    });
    pendingPhotos = [];
    document.getElementById("success-state").classList.add("show");
    btn.style.display = "none";
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = "✅ Enregistrer l'anomalie";
    alert("❌ Erreur Firebase :\n" + err.message);
  }
}

/* ══════════════════════════════════════════════
   HISTORIQUE
   ══════════════════════════════════════════════ */
var historyVisible = false;
var allDocs        = [];

function toggleHistory() {
  historyVisible = !historyVisible;
  document.getElementById("form-view").style.display = historyVisible ? "none" : "block";
  document.getElementById("history-view").classList.toggle("show", historyVisible);
  if (historyVisible) loadHistory();
}

async function loadHistory() {
  var list = document.getElementById("history-list");
  list.innerHTML = "<p class='empty-state' style='padding:20px 0'>Chargement…</p>";
  try {
    var snap = await db.collection("anomalies").orderBy("ts", "desc").limit(200).get();
    allDocs = snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    populateCategoryFilter();
    applyFilters();
  } catch (err) {
    list.innerHTML = "<p class='empty-state' style='color:#dc2626'>Erreur : " + err.message + "</p>";
  }
}

function populateCategoryFilter() {
  var sel  = document.getElementById("f-categorie");
  var cats = [];
  allDocs.forEach(d => { if (d.categorie && cats.indexOf(d.categorie) === -1) cats.push(d.categorie); });
  cats.sort();
  sel.innerHTML = '<option value="">Toutes catégories</option>' +
    cats.map(c => `<option value="${esc(c)}">${c}</option>`).join("");
}

function applyFilters() {
  var search    = document.getElementById("f-search").value.trim().toLowerCase();
  var categorie = document.getElementById("f-categorie").value;
  var dateFrom  = document.getElementById("f-date-from").value;
  var dateTo    = document.getElementById("f-date-to").value;
  var declarant = document.getElementById("f-declarant").value.trim().toLowerCase();

  var filtered = allDocs.filter(d => {
    if (categorie && d.categorie !== categorie) return false;
    if (d.date) {
      var docDate = d.date.slice(0, 10);
      if (dateFrom && docDate < dateFrom) return false;
      if (dateTo   && docDate > dateTo)   return false;
    }
    if (declarant && !(d.declarant_email || "").toLowerCase().includes(declarant)) return false;
    if (search) {
      var hay = [].concat(d.chemin || [])
        .concat([d.support, d.kit, d.engin, d.commentaire, d.preco, d.stockage_hs, d.declarant_email])
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  var fc = document.getElementById("filter-count");
  fc.textContent = filtered.length + " / " + allDocs.length + " entrée" + (allDocs.length > 1 ? "s" : "");
  renderHistoryItems(filtered, search);
}

function clearFilters() {
  ["f-search", "f-date-from", "f-date-to", "f-declarant"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("f-categorie").value = "";
  applyFilters();
}

function highlight(text, term) {
  if (!term || !text) return text || "";
  var escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text).replace(new RegExp(escaped, "gi"), m => `<mark>${m}</mark>`);
}

/* ── Rendu des items historique avec labels ── */
function renderHistoryItems(docs, searchTerm) {
  var list = document.getElementById("history-list");
  if (!docs.length) {
    list.innerHTML = "<p class='empty-state' style='padding:30px 0'>Aucun résultat pour ces filtres.</p>";
    return;
  }

  list.innerHTML = docs.map(d => {
    var dt       = d.date ? new Date(d.date).toLocaleString("fr-FR") : "—";
    var dec      = d.declarant_email
      ? `<span style="opacity:.7">· ${highlight(d.declarant_email, searchTerm)}</span>`
      : "";
    var cheminHL = (d.chemin || []).map(c => highlight(c, searchTerm)).join(" › ");
    var photos   = d.photos || [];

    /* ── Champs labellisés ── */
    var infoFields = [
      { label: "Support",     val: d.support     },
      { label: "Kit",         val: d.kit         },
      { label: "Engin",       val: d.engin       },
      { label: "Stockage HS", val: d.stockage_hs },
      { label: "Préco.",      val: d.preco       }
    ].filter(f => f.val);

    var infosHTML = infoFields.length
      ? `<div class="hist-fields">` +
          infoFields.map(f =>
            `<span class="hist-field-item">
               <span class="hist-field-label">${f.label}</span>
               <span class="hist-field-sep">:</span>
               <span class="hist-field-value">${highlight(f.val, searchTerm)}</span>
             </span>`
          ).join("") +
        `</div>`
      : "";

    /* ── Commentaire avec label ── */
    var commentHTML = d.commentaire
      ? `<div class="hist-comment">
           <span class="hist-comment-label">Commentaire :</span>
           <em>${highlight(d.commentaire, searchTerm)}</em>
         </div>`
      : "";

    /* ── Photos ── */
    var photoEl = "";
    if (photos.length) {
      window._histPhotos = window._histPhotos || {};
      window._histPhotos[d.id] = photos;
      var thumbs = photos.map((src, i) =>
        `<img class="hist-photo-thumb" src="${src}" alt="Photo ${i + 1}"
              data-index="${i}" data-docid="${d.id}"
              onclick="openHistoryPhoto(this)" />`
      ).join("");
      photoEl = `<div class="hist-photos">${thumbs}</div>`;
    }

    return `<div class="history-item" id="item-${d.id}">
      <div class="history-item-top">
        <span class="hist-badge">${highlight(d.categorie || "—", searchTerm)}</span>
        <span class="hist-date">${dt} ${dec}</span>
        <button class="btn-delete" onclick="deleteAnomaly('${d.id}')">🗑 Supprimer</button>
      </div>
      <div class="hist-path">${cheminHL}</div>
      ${infosHTML}
      ${commentHTML}
      ${photoEl}
    </div>`;
  }).join("");
}

/* ── Lightbox depuis historique ── */
function openHistoryPhoto(el) {
  var docId  = el.dataset.docid;
  var index  = parseInt(el.dataset.index, 10);
  var photos = (window._histPhotos || {})[docId] || [];
  openLightboxHistory(photos, index);
}

/* ── Suppression ── */
function deleteAnomaly(docId) {
  var overlay = document.getElementById("confirm-overlay");
  var okBtn   = document.getElementById("confirm-ok-btn");
  overlay.classList.add("show");
  var fresh = okBtn.cloneNode(true);
  okBtn.replaceWith(fresh);
  fresh.onclick = async function () {
    closeConfirm();
    var item = document.getElementById("item-" + docId);
    if (item) item.classList.add("removing");
    try {
      await db.collection("anomalies").doc(docId).delete();
      allDocs = allDocs.filter(d => d.id !== docId);
      setTimeout(() => { if (item) item.remove(); applyFilters(); }, 280);
      showToast("✅ Anomalie supprimée");
    } catch (err) {
      if (item) item.classList.remove("removing");
      showToast("❌ Erreur : " + err.message);
    }
  };
}

function closeConfirm() {
  document.getElementById("confirm-overlay").classList.remove("show");
}

function showToast(msg) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

/* ══════════════════════════════════════════════
   EXPORT CSV / XLSX
   ══════════════════════════════════════════════ */
async function getExportRows() {
  var docs = allDocs;
  if (!docs.length) {
    var snap = await db.collection("anomalies").orderBy("ts", "desc").get();
    docs = snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
  }
  return docs.map(d => ({
    "Date":           d.date ? new Date(d.date).toLocaleString("fr-FR") : "",
    "Catégorie":      d.categorie      || "",
    "Chemin complet": (d.chemin || []).join(" › "),
    "Support":        d.support        || "",
    "Kit":            d.kit            || "",
    "Engin":          d.engin          || "",
    "Commentaire":    d.commentaire    || "",
    "Préconisation":  d.preco          || "",
    "Stockage HS":    d.stockage_hs    || "",
    "Déclarant":      d.declarant_email|| "",
    "Nb photos":      (d.photos || []).length
  }));
}

async function exportCSV() {
  showToast("⏳ Préparation du CSV…");
  try {
    var rows = await getExportRows();
    if (!rows.length) { showToast("⚠ Aucune anomalie à exporter"); return; }
    var headers = Object.keys(rows[0]);
    var escCSV  = v => '"' + String(v).replace(/"/g, '""') + '"';
    var lines   = [headers.map(escCSV).join(";")]
      .concat(rows.map(r => headers.map(h => escCSV(r[h])).join(";")));
    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, "anomalies_" + dateStamp() + ".csv");
    showToast("✅ CSV téléchargé (" + rows.length + " lignes)");
  } catch (err) { showToast("❌ Erreur : " + err.message); }
}

async function exportXLSX() {
  showToast("⏳ Préparation Excel…");
  try {
    var rows = await getExportRows();
    if (!rows.length) { showToast("⚠ Aucune anomalie à exporter"); return; }
    var ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      {wch:18},{wch:18},{wch:50},{wch:16},{wch:14},
      {wch:14},{wch:35},{wch:35},{wch:20},{wch:28},{wch:10}
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Anomalies");
    XLSX.writeFile(wb, "anomalies_" + dateStamp() + ".xlsx");
    showToast("✅ Excel téléchargé (" + rows.length + " lignes)");
  } catch (err) { showToast("❌ Erreur : " + err.message); }
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Restart ── */
function restart() {
  currentStepId  = TREE.start;
  stepHistory    = [];
  collected      = {};
  breadcrumb     = [];
  pendingPhotos  = [];
  historyVisible = false;
  document.getElementById("form-view").style.display = "block";
  document.getElementById("history-view").classList.remove("show");
  render();
}

/* ══════════════════════════════════════════════
   VERSION BADGE + SERVICE WORKER
   ══════════════════════════════════════════════ */
(function () {
  const v = localStorage.getItem("app-version");
  if (v) document.querySelectorAll(".version-badge").forEach(el => el.textContent = "v" + v);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data && event.data.type === "VERSION") {
        const v = event.data.version;
        localStorage.setItem("app-version", v);
        document.querySelectorAll(".version-badge").forEach(el => el.textContent = "v" + v);
        console.log("[PWA] Version active :", v);
      }
    });

    navigator.serviceWorker.register("./sw.js")
      .then(reg => {
        console.log("[PWA] SW enregistré :", reg.scope);
        navigator.serviceWorker.ready.then(registration => {
          if (registration.active) registration.active.postMessage({ type: "GET_VERSION" });
        });
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated") newWorker.postMessage({ type: "GET_VERSION" });
          });
        });
      })
      .catch(err => console.error("[PWA] Erreur SW :", err));
  });
}
