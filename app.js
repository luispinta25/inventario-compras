'use strict';

const APP_VERSION = '0.2.0';
const APP_BUILD = '20260906.5';

const SUPABASE_URL = 'https://lpsupabase.luispintasolutions.com';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICJyb2xlIjogImFub24iLAogICJpc3MiOiAic3VwYWJhc2UiLAogICJpYXQiOiAxNzE1MDUwODAwLAogICJleHAiOiAxODcyODE3MjAwCn0.LJEZ3yyGRxLBmCKM9z3EW-Yla1SszwbmvQMngMe3IWA';
const PROFILE_TABLE = 'ferre_usuarios_ferreteria';
const POS_API_BASE_URL = window.location.hostname === '127.0.0.1' && window.location.port === '8091'
  ? ''
  : 'https://api.ferrisoluciones.com';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

const elements = Object.fromEntries([
  'authScreen', 'sessionLoader', 'appShell', 'loginForm', 'emailInput', 'passwordInput',
  'togglePasswordButton', 'authError', 'loginButton', 'userName', 'userRole', 'userInitials',
  'logoutButton', 'sampleButton', 'accessForm', 'accessKeyInput', 'clearKeyButton',
  'fetchButton', 'uploadButton', 'xmlFileInput', 'keyStatus', 'keyCount', 'accessKeyMeta',
  'loadingRow', 'errorBanner', 'review', 'validationBanner', 'validationIcon',
  'validationTitle', 'validationText', 'itemsBody', 'warningsSection', 'warningsList',
  'resetButton', 'downloadButton', 'copyKeyButton', 'providerMatchState',
  'continueEntryButton', 'saveToPendingButton', 'providerLinkSection', 'providerLinkButton',
  'invoiceFields', 'providerLinkModal', 'providerLinkCloseButton', 'providerLinkCancelButton',
  'providerLinkConfirmButton', 'providerLinkSearchInput', 'providerLinkGrid',
  'providerLinkModalStatus', 'providerLinkXmlName', 'providerLinkXmlTaxId',
  'accessRow', 'totalsStrip', 'itemsSection', 'appVersion', 'mobileAppVersion',
  'pendingDocumentsBadge', 'pendingDocumentsRefresh', 'pendingDocumentsSummary',
  'pendingDocumentsList', 'scannerViewport', 'scannerVideo', 'startScannerButton',
  'stopScannerButton', 'mobileAccessKeyInput', 'mobileCaptureButton',
  'mobileCaptureStatus', 'mobileInvoiceSummary', 'mobileInvoiceState',
  'mobileInvoiceProvider', 'mobileInvoiceTaxId', 'mobileInvoiceNumber',
  'mobileInvoiceItems', 'mobileInvoiceTotal', 'mobileInvoiceItemsList', 'mobileSaveButton',
  'mobileLinkProviderButton', 'mobileScanAnotherButton',
  'ocrPickCamera', 'ocrPickGallery', 'ocrKeyFileCamera',
  'ocrKeyFileGallery', 'ocrCrop', 'ocrCropStage', 'ocrCropImage',
  'ocrBarTop', 'ocrBarBottom', 'ocrShadeTop', 'ocrShadeBottom',
  'ocrLoupe', 'ocrLoupeCanvas', 'ocrCropCancel', 'ocrCropRun', 'ocrRotateButton',
  'appDialog', 'appDialogText', 'appDialogCancel', 'appDialogConfirm',
  'modeScanButton', 'modeBuildButton', 'keyBuilderForm', 'kbDay', 'kbMonth', 'kbYear',
  'kbProvider', 'kbProviderHint', 'kbProviderXmlButton', 'kbEstab', 'kbPtoEmi',
  'kbSecuencial', 'kbInvoiceResolved', 'kbTail', 'kbCheckInfo',
  'kbPreview', 'kbPreviewCount', 'kbSubmit',
  'kbInsertDate', 'kbInsertProvider', 'kbInsertNumber', 'kbInsertCode'
].map((id) => [id, document.getElementById(id)]));

// Diálogo de confirmación propio, basado en promesas. Nunca window.confirm.
function askConfirm(message, { confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    elements.appDialogText.textContent = message;
    elements.appDialogConfirm.textContent = confirmText;
    elements.appDialogCancel.hidden = cancelText === null;
    if (cancelText !== null) elements.appDialogCancel.textContent = cancelText;
    elements.appDialogConfirm.classList.toggle('button-danger', danger);
    elements.appDialog.hidden = false;
    elements.appDialogConfirm.focus();
    const finish = (value) => {
      elements.appDialog.hidden = true;
      elements.appDialogConfirm.removeEventListener('click', onOk);
      elements.appDialogCancel.removeEventListener('click', onCancel);
      elements.appDialog.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (event) => { if (event.target === elements.appDialog) finish(false); };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      else if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    };
    elements.appDialogConfirm.addEventListener('click', onOk);
    elements.appDialogCancel.addEventListener('click', onCancel);
    elements.appDialog.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

function askAlert(message) {
  return askConfirm(message, { confirmText: 'Entendido', cancelText: null });
}

let currentDraft = null;
let currentSession = null;
let currentProfile = null;
let attemptedKey = '';
let failedSriAttempts = 0;
let providerModuleLoaded = false;
let matchedProvider = null;
let providerLinkCandidates = [];
let selectedProviderForLink = null;
let providerLinkCandidatesRequest = null;
let providerLinkContinuation = null;
let currentPendingDocumentId = null;
let pendingLeaseRefreshedAt = 0;
let pendingDocuments = [];
let pendingDocumentsTimer = null;
let scannerControls = null;
let scannerReader = null;
let scannerEmptyFrames = 0;
let scannerMismatchAt = 0;
let mobileCaptureBusy = false;

// Lector de códigos con TRY_HARDER y formatos probables para la clave del SRI
// (PDF417 en el RIDE; a veces Code128 o ITF). Si el bundle no expone los enums,
// se usa la configuración por defecto.
function createScannerReader() {
  const zx = window.ZXingBrowser;
  try {
    const { DecodeHintType, BarcodeFormat } = zx;
    if (DecodeHintType && BarcodeFormat) {
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417, BarcodeFormat.CODE_128, BarcodeFormat.ITF,
        BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX
      ]);
      return new zx.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    }
  } catch (_) { /* se usa el lector por defecto */ }
  return new zx.BrowserMultiFormatReader();
}
const DESKTOP_VIEW_OVERRIDE_KEY = 'inventario-compras:vista-escritorio';

function matchMediaMatches(query) {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch (_) {
    return false;
  }
}

// Válvula de escape: `?vista=escritorio` recupera la interfaz completa en un
// equipo mal clasificado y lo recuerda en ese navegador. `?vista=auto` lo revierte.
function desktopViewForced() {
  try {
    const requested = (new URLSearchParams(window.location.search).get('vista') || '').toLowerCase();
    if (requested === 'escritorio' || requested === 'desktop') {
      localStorage.setItem(DESKTOP_VIEW_OVERRIDE_KEY, '1');
      return true;
    }
    if (requested === 'auto' || requested === 'movil' || requested === 'telefono') {
      localStorage.removeItem(DESKTOP_VIEW_OVERRIDE_KEY);
      return false;
    }
    return localStorage.getItem(DESKTOP_VIEW_OVERRIDE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

// Solo los teléfonos se fuerzan al módulo exclusivo de captura. Las tablets y
// las laptops táctiles reciben la interfaz completa. El sesgo es conservador:
// ante la duda se devuelve `false` para no dejar un equipo encerrado en cámara.
function detectPhoneDevice() {
  const ua = navigator.userAgent || '';
  const uaData = navigator.userAgentData;
  const phoneUa = /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|BB10|Opera Mini|Android.+Mobile|Mobile.+Firefox/i.test(ua);

  // 1. Pista de alta confianza en navegadores Chromium (Android, escritorio).
  if (uaData && typeof uaData.mobile === 'boolean') {
    if (uaData.mobile) return true;
    if (!phoneUa) return false;
  }

  // 2. Tokens explícitos de teléfono en el user agent (Safari iOS, Firefox…).
  if (phoneUa) return true;

  // 3. Respaldo físico estricto: entrada táctil primaria, sin mouse y pantalla
  //    con tamaño real de teléfono. Excluye laptops táctiles (puntero fino,
  //    con hover) y tablets de 7" o más (lado corto mayor a 500 px CSS).
  const coarseTouchOnly = matchMediaMatches('(pointer: coarse)') && matchMediaMatches('(hover: none)');
  const touchCapable = (navigator.maxTouchPoints || 0) > 0;
  const minSide = Math.min(screen.width || 0, screen.height || 0);
  const maxSide = Math.max(screen.width || 0, screen.height || 0);
  const phoneSizedScreen = minSide > 0 && minSide <= 500 && maxSide <= 950;
  return coarseTouchOnly && touchCapable && phoneSizedScreen;
}

const IS_MOBILE_DEVICE = !desktopViewForced() && detectPhoneDevice();
const internalProductLookupCache = new Map();
const internalProductSearchCache = new Map();
let internalProductCatalog = [];
let internalProductCatalogRequest = null;
const INTERNAL_PRODUCT_CACHE_KEY = 'inventario-compras:catalogo:v2';
const INVOICE_DRAFTS_KEY = 'inventario-compras:borradores:v1';
const INVOICE_FLOW_CACHE_KEY = 'inventario-compras:factura-flujo:v1';
const LEGACY_INVOICE_CACHE_KEY = 'ingresoFacturaCache';
const INVOICE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STASHED_DRAFTS = 12;
const XML_GAIN_OPTIONS = [20, 28, 30, 35, 38, 45, 50];
let invoiceDraftSaveTimer = null;

function readLocalCache(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    const savedAt = Number(value?.savedAt || Date.parse(value?.timestamp));
    if (!value || !Number.isFinite(savedAt) || Date.now() - savedAt > INVOICE_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    if (value.userId && value.userId !== currentSession?.user?.id) return null;
    return value;
  } catch (_) {
    localStorage.removeItem(key);
    return null;
  }
}

// Varias facturas pueden estar a medio revisar a la vez. El avance de cada una
// (marcas de recepción, notas, vínculos internos) se guarda por clave de acceso,
// así cambiar a otra factura no pierde el trabajo de la anterior.
function readDraftStore() {
  const cached = readLocalCache(INVOICE_DRAFTS_KEY);
  const drafts = (cached && typeof cached.drafts === 'object' && cached.drafts) || {};
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of Object.entries(drafts)) {
    if (!entry?.draft || !Number.isFinite(Number(entry.savedAt)) || now - Number(entry.savedAt) > INVOICE_CACHE_TTL_MS) {
      delete drafts[key];
      changed = true;
    }
  }
  if (changed) writeDraftStore(drafts);
  return drafts;
}

function writeDraftStore(drafts) {
  if (!currentSession?.user?.id) return;
  const entries = Object.entries(drafts)
    .sort((a, b) => Number(b[1].savedAt) - Number(a[1].savedAt))
    .slice(0, MAX_STASHED_DRAFTS);
  try {
    localStorage.setItem(INVOICE_DRAFTS_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      userId: currentSession.user.id,
      drafts: Object.fromEntries(entries)
    }));
  } catch (error) {
    console.warn('[inventario-compras] No se pudo guardar el borrador:', error.message);
  }
}

function getStashedDraft(accessKey) {
  if (!accessKey) return null;
  return readDraftStore()[accessKey] || null;
}

function forgetDraftForKey(accessKey) {
  if (!accessKey) return;
  const drafts = readDraftStore();
  if (drafts[accessKey]) {
    delete drafts[accessKey];
    writeDraftStore(drafts);
  }
}

function latestStashedDraft() {
  const drafts = readDraftStore();
  let best = null;
  for (const entry of Object.values(drafts)) {
    if (!best || Number(entry.savedAt) > Number(best.savedAt)) best = entry;
  }
  return best;
}

function saveInvoiceDraftNow() {
  window.clearTimeout(invoiceDraftSaveTimer);
  invoiceDraftSaveTimer = null;
  const accessKey = currentDraft?.tax_information?.access_key;
  if (!accessKey || !currentSession?.user?.id) return;
  const drafts = readDraftStore();
  drafts[accessKey] = {
    savedAt: Date.now(),
    draft: currentDraft,
    pendingDocumentId: currentPendingDocumentId
  };
  writeDraftStore(drafts);
}

function scheduleInvoiceDraftSave() {
  if (!currentDraft) return;
  window.clearTimeout(invoiceDraftSaveTimer);
  invoiceDraftSaveTimer = window.setTimeout(saveInvoiceDraftNow, 120);
}

function markManualInvoiceFlow() {
  try {
    localStorage.setItem(INVOICE_FLOW_CACHE_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      userId: currentSession?.user?.id,
      stage: 'manual-entry',
      pendingDocumentId: currentPendingDocumentId
    }));
  } catch (_) { /* La restauración es auxiliar si el almacenamiento está lleno. */ }
}

// Solo olvida la factura que se está cerrando ahora; las demás a medio revisar
// se conservan.
function clearInvoiceIntakeCache() {
  window.clearTimeout(invoiceDraftSaveTimer);
  invoiceDraftSaveTimer = null;
  forgetDraftForKey(currentDraft?.tax_information?.access_key);
  try {
    localStorage.removeItem(INVOICE_FLOW_CACHE_KEY);
    localStorage.removeItem(LEGACY_INVOICE_CACHE_KEY);
  } catch (_) { /* No debe bloquear el flujo principal. */ }
}

// Borrado total (cierre de sesión).
function clearAllInvoiceDrafts() {
  window.clearTimeout(invoiceDraftSaveTimer);
  invoiceDraftSaveTimer = null;
  try {
    localStorage.removeItem(INVOICE_DRAFTS_KEY);
    localStorage.removeItem(INVOICE_FLOW_CACHE_KEY);
    localStorage.removeItem(LEGACY_INVOICE_CACHE_KEY);
  } catch (_) { /* No debe bloquear el flujo principal. */ }
}

function hasRestorableManualInvoice() {
  const flow = readLocalCache(INVOICE_FLOW_CACHE_KEY);
  const legacy = readLocalCache(LEGACY_INVOICE_CACHE_KEY);
  return flow?.stage === 'manual-entry' && Boolean(legacy);
}

async function restoreInvoiceDraft() {
  const cached = latestStashedDraft();
  if (!cached?.draft) return false;
  elements.accessKeyInput.value = cached.draft.tax_information?.access_key || '';
  currentPendingDocumentId = cached.pendingDocumentId || null;
  updateKeyState();
  await renderDraft(cached.draft);
  return true;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

function renderApplicationVersion(state = '') {
  const label = `v${APP_VERSION} · ${APP_BUILD}${state ? ` · ${state}` : ''}`;
  if (elements.appVersion) elements.appVersion.textContent = label;
  if (elements.mobileAppVersion) elements.mobileAppVersion.textContent = label;
}

async function initializeVersioning() {
  renderApplicationVersion();
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    const remote = response.ok ? await response.json() : null;
    renderApplicationVersion(remote && (remote.version !== APP_VERSION || remote.build !== APP_BUILD)
      ? 'actualización disponible'
      : 'actualizado');
  } catch (_) {
    renderApplicationVersion('sin conexión');
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      const hadController = Boolean(navigator.serviceWorker.controller);
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await registration.update();
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !hadController) return;
        reloading = true;
        window.location.reload();
      });
    } catch (error) {
      console.warn('[inventario-compras] No se pudo activar network-first:', error.message);
    }
  }
}

async function posApiRequest(path, options = {}) {
  const { data, error } = await db.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error('Sesión no disponible para llamar al backend seguro.');

  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  // Solo se declara JSON cuando hay cuerpo: Fastify rechaza con 400 un
  // Content-Type: application/json sin cuerpo (p. ej. DELETE).
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
  if (options.body != null && !hasContentType) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${POS_API_BASE_URL}${path}`, { ...options, headers });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = { raw };
    }
  }
  if (!response.ok) throw new Error(body?.error || body?.message || `Error ${response.status}`);
  return body;
}

window.supabaseClient = db;
window.posApiRequest = posApiRequest;
window.formatCurrency = formatCurrency;
window.updateNavbarCounter = () => {};
window.volverAConsultaFactura = async () => {
  await switchAppModule('invoice-import');
  history.replaceState(null, '', '#ingreso-facturas');
};
window.app = {
  db,
  currentUser: null,
  formatCurrency,
  posApiRequest,
  askConfirm,
  askAlert,
  inventoryCatalog: {
    preload: preloadInternalProductCatalog,
    get: () => internalProductCatalog,
    rank: rankInternalProductMatches
  },
  accessKey: {
    resolveFromText: resolveAccessKeyFromText,
    voteFromReads: voteAccessKey,
    hintsFromText: accessKeyHintsFromText,
    isValid: isValidAccessKey
  }
};
window.clearInvoiceIntakeCache = clearInvoiceIntakeCache;

function humanAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (message.includes('email not confirmed')) return 'La cuenta todavía no ha sido confirmada.';
  if (message.includes('usuario no habilitado')) return error.message;
  return 'No se pudo iniciar sesión. Revisa la conexión e inténtalo nuevamente.';
}

function setAuthBusy(busy) {
  elements.emailInput.disabled = busy;
  elements.passwordInput.disabled = busy;
  elements.loginButton.disabled = busy;
  elements.loginButton.innerHTML = busy
    ? '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Verificando'
    : '<i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Iniciar sesión';
}

function showAuthError(message) {
  elements.authError.textContent = message;
  elements.authError.hidden = false;
}

function clearAuthError() {
  elements.authError.textContent = '';
  elements.authError.hidden = true;
}

function profileName(profile) {
  return [profile.nombres, profile.apellidos].filter(Boolean).join(' ').trim() || 'Usuario';
}

function profileInitials(profile) {
  return [profile.nombres, profile.apellidos]
    .filter(Boolean)
    .map((part) => part.trim()[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'US';
}

function moduleFromHash() {
  if (IS_MOBILE_DEVICE) return 'mobile-capture';
  return {
    '#ingreso-facturas': 'invoice-import',
    '#facturas': 'provider-invoices',
    '#comparador': 'comparator',
    '#producto-proveedores': 'product-providers',
    '#pendientes': 'pending-documents',
    '#cargar-factura': 'mobile-capture'
  }[window.location.hash] || 'invoice-import';
}

async function loadAuthorizedProfile(session) {
  const { data, error } = await db
    .from(PROFILE_TABLE)
    .select('user_id, nombres, apellidos, rol')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error || !data) {
    await db.auth.signOut();
    throw new Error('Usuario no habilitado para Ferrisoluciones.');
  }
  return data;
}

function showLogin() {
  currentSession = null;
  currentProfile = null;
  elements.sessionLoader.hidden = true;
  elements.appShell.hidden = true;
  elements.authScreen.hidden = false;
  stopScanner();
  stopPendingDocumentsPolling();
  elements.emailInput.focus();
}

async function showApplication(session, profile) {
  currentSession = session;
  currentProfile = profile;
  window.currentUser = session.user;
  window.currentUserData = { ...session.user, ...profile };
  window.app.currentUser = session.user;
  elements.userName.textContent = profileName(profile);
  elements.userRole.textContent = profile.rol || 'usuario';
  elements.userInitials.textContent = profileInitials(profile);
  elements.sessionLoader.hidden = true;
  elements.authScreen.hidden = true;
  elements.appShell.hidden = false;
  document.body.classList.toggle('mobile-capture-only', IS_MOBILE_DEVICE);
  if (IS_MOBILE_DEVICE) history.replaceState(null, '', '#cargar-factura');
  if (!IS_MOBILE_DEVICE) preloadInternalProductCatalog();
  const restoreManualEntry = hasRestorableManualInvoice();
  if (restoreManualEntry) {
    currentPendingDocumentId = readLocalCache(INVOICE_FLOW_CACHE_KEY)?.pendingDocumentId || null;
  }
  const initialModule = IS_MOBILE_DEVICE ? 'mobile-capture' : (restoreManualEntry ? 'provider-entry' : moduleFromHash());
  try {
    await switchAppModule(initialModule);
    if (restoreManualEntry) {
      history.replaceState(null, '', '#ingreso-facturas');
      document.querySelectorAll('[data-app-module]').forEach((item) => {
        const active = item.dataset.appModule === 'invoice-import';
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
    } else if (initialModule === 'invoice-import' && !(await restoreInvoiceDraft())) {
      elements.accessKeyInput.focus();
    }
    if (!IS_MOBILE_DEVICE) {
      await loadPendingDocuments({ silent: true });
      startPendingDocumentsPolling();
    }
  } catch (error) {
    console.error('[inventario-compras] No se pudo restaurar el módulo:', error);
  }
}

async function initializeSession() {
  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (!data.session) return showLogin();
    await showApplication(data.session, await loadAuthorizedProfile(data.session));
  } catch (error) {
    showLogin();
    showAuthError(humanAuthError(error));
  }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAuthError();
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;
  if (!email || !password) return showAuthError('Ingresa el correo y la contraseña.');

  setAuthBusy(true);
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error('No se recibió una sesión válida.');
    const profile = await loadAuthorizedProfile(data.session);
    elements.passwordInput.value = '';
    await showApplication(data.session, profile);
  } catch (error) {
    showAuthError(humanAuthError(error));
  } finally {
    setAuthBusy(false);
  }
});

elements.togglePasswordButton.addEventListener('click', () => {
  const showing = elements.passwordInput.type === 'text';
  elements.passwordInput.type = showing ? 'password' : 'text';
  elements.togglePasswordButton.title = showing ? 'Mostrar contraseña' : 'Ocultar contraseña';
  elements.togglePasswordButton.setAttribute('aria-label', elements.togglePasswordButton.title);
  elements.togglePasswordButton.innerHTML = showing
    ? '<i class="fa-regular fa-eye" aria-hidden="true"></i>'
    : '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>';
});

elements.logoutButton.addEventListener('click', async () => {
  elements.logoutButton.disabled = true;
  try {
    await releaseCurrentPendingDocument();
    await db.auth.signOut();
  } finally {
    clearAllInvoiceDrafts();
    resetInvoice({ release: false });
    resetProviderModule();
    switchAppModule('invoice-import');
    clearAuthError();
    elements.logoutButton.disabled = false;
    showLogin();
  }
});

async function loadProviderModule() {
  if (providerModuleLoaded) return;
  const loading = document.getElementById('providerModuleLoading');
  const container = document.getElementById('providerModuleContainer');
  loading.hidden = false;
  loading.classList.remove('error');
  loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Cargando gestión de facturas';

  try {
    const response = await fetch('/views/proveedores.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar el módulo de gestión de facturas.');
    const template = document.createElement('template');
    template.innerHTML = await response.text();
    const scripts = [...template.content.querySelectorAll('script')];
    scripts.forEach((script) => script.remove());
    container.replaceChildren(template.content.cloneNode(true));

    for (const source of scripts) {
      const runtime = document.createElement('script');
      runtime.dataset.providerRuntime = 'true';
      runtime.textContent = `(function(){\n"use strict";\n${source.textContent}\n})();`;
      document.body.appendChild(runtime);
      runtime.remove();
    }

    if (typeof window.initProveedores !== 'function') throw new Error('El módulo no expuso su inicializador.');
    providerModuleLoaded = true;
    loading.hidden = true;
    await window.initProveedores();
  } catch (error) {
    container.replaceChildren();
    loading.classList.add('error');
    loading.textContent = error.message;
    throw error;
  }
}

function resetProviderModule() {
  providerModuleLoaded = false;
  document.getElementById('providerModuleContainer').replaceChildren();
  const loading = document.getElementById('providerModuleLoading');
  loading.hidden = false;
  loading.classList.remove('error');
  document.querySelector('script[src="js/ingreso-factura.js"]')?.remove();
}

let comparatorModuleRequest = null;

function loadComparatorModule() {
  if (typeof window.initComparador === 'function') return Promise.resolve();
  if (comparatorModuleRequest) return comparatorModuleRequest;
  comparatorModuleRequest = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'js/comparador.js';
    script.dataset.module = 'comparator';
    script.onload = () => resolve();
    script.onerror = () => {
      comparatorModuleRequest = null;
      script.remove();
      reject(new Error('No se pudo cargar el comparador.'));
    };
    document.body.appendChild(script);
  });
  return comparatorModuleRequest;
}

let invoicesModuleRequest = null;

function loadInvoicesModule() {
  if (typeof window.initFacturas === 'function') return Promise.resolve();
  if (invoicesModuleRequest) return invoicesModuleRequest;
  invoicesModuleRequest = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'js/facturas.js';
    script.dataset.module = 'facturas';
    script.onload = () => resolve();
    script.onerror = () => {
      invoicesModuleRequest = null;
      script.remove();
      reject(new Error('No se pudo cargar la gestión de facturas.'));
    };
    document.body.appendChild(script);
  });
  return invoicesModuleRequest;
}

async function switchAppModule(moduleName) {
  if (IS_MOBILE_DEVICE && moduleName !== 'mobile-capture') {
    moduleName = 'mobile-capture';
    history.replaceState(null, '', '#cargar-factura');
  }
  const providerModes = {
    'provider-dashboard': 'dashboard',
    'provider-entry': 'productos'
  };
  const providerMode = providerModes[moduleName];
  document.querySelectorAll('[data-module-panel]').forEach((panel) => {
    const targetPanel = providerMode ? 'providers' : moduleName;
    panel.hidden = panel.dataset.modulePanel !== targetPanel;
  });
  document.querySelectorAll('[data-app-module]').forEach((item) => {
    const active = item.dataset.appModule === moduleName;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  if (providerMode) {
    await loadProviderModule();
    if (typeof window.cambiarModoProveedor === 'function') {
      await window.cambiarModoProveedor(providerMode);
    }
  } else if (moduleName === 'invoice-import') {
    preloadInternalProductCatalog();
    elements.accessKeyInput.focus();
  } else if (moduleName === 'product-providers') {
    await loadProductProviders();
  } else if (moduleName === 'comparator') {
    await loadComparatorModule();
    await window.initComparador();
  } else if (moduleName === 'provider-invoices') {
    await loadInvoicesModule();
    await window.initFacturas();
  } else if (moduleName === 'pending-documents') {
    await loadPendingDocuments();
  } else if (moduleName === 'mobile-capture') {
    elements.mobileAccessKeyInput?.focus();
  }
}

function readCachedInternalProductCatalog() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(INTERNAL_PRODUCT_CACHE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.products) || Date.now() - cached.savedAt > 15 * 60 * 1000) return false;
    internalProductCatalog = cached.products;
    internalProductCatalog.forEach((product) => internalProductLookupCache.set(product.codigo, product));
    return true;
  } catch (_) {
    return false;
  }
}

function preloadInternalProductCatalog() {
  if (internalProductCatalog.length) return Promise.resolve(internalProductCatalog);
  if (internalProductCatalogRequest) return internalProductCatalogRequest;
  if (readCachedInternalProductCatalog()) return Promise.resolve(internalProductCatalog);
  internalProductCatalogRequest = posApiRequest('/api/purchases/v2/inventory/catalog', { method: 'GET' })
    .then((response) => {
      internalProductCatalog = response?.data || [];
      internalProductCatalog.forEach((product) => internalProductLookupCache.set(product.codigo, product));
      try {
        sessionStorage.setItem(INTERNAL_PRODUCT_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), products: internalProductCatalog }));
      } catch (_) { /* La caché es opcional si el navegador no tiene espacio. */ }
      return internalProductCatalog;
    })
    .catch((error) => {
      console.warn('[inventario-compras] No se pudo precargar el catálogo:', error.message);
      return [];
    })
    .finally(() => { internalProductCatalogRequest = null; });
  return internalProductCatalogRequest;
}

const productProviderElements = Object.fromEntries([
  'productProviderSearchForm', 'productProviderSearch', 'productProviderRefresh',
  'productProviderSummary', 'productProviderResults'
].map((id) => [id, document.getElementById(id)]));

let productProviderRequest = null;
let productProviderLoaded = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function rankInternalProductMatches(products, query) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return products
    .map((product) => {
      const searchable = normalizeSearchText(`${product.codigo} ${product.producto}`);
      const words = new Set(searchable.split(' ').filter(Boolean));
      const exactCount = tokens.filter((token) => words.has(token)).length;
      const partialCount = tokens.filter((token) => searchable.includes(token)).length;
      const allExact = exactCount === tokens.length;
      const phraseMatch = searchable.includes(normalizeSearchText(query));
      const score = (allExact ? 10000 : 0) + exactCount * 1000 + partialCount * 100 + (phraseMatch ? 10 : 0);
      return { product, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || String(left.product.codigo).localeCompare(String(right.product.codigo)))
    .map(({ product }) => product)
    .slice(0, 10);
}

function formatProductProviderNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('es-EC', { maximumFractionDigits }).format(Number(value));
}

function productProviderValue(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<span><small>${label}</small>${escapeHtml(value)}</span>`;
}

function renderProductProviders(products, search) {
  const results = productProviderElements.productProviderResults;
  if (!products.length) {
    results.innerHTML = `<div class="product-provider-empty"><i class="fa-solid fa-box-open" aria-hidden="true"></i><p>No se encontraron relaciones${search ? ' para esta búsqueda' : ''}.</p></div>`;
    return;
  }

  results.innerHTML = products.map((product) => `
    <article class="product-provider-card">
      <header>
        <div>
          <p>${escapeHtml(product.codigo)}</p>
          <h2>${escapeHtml(product.nombre)}</h2>
        </div>
        <dl>
          <div><dt>Stock</dt><dd>${formatProductProviderNumber(product.stock, 3)} ${escapeHtml(product.unidad || '')}</dd></div>
          <div><dt>Mínimo</dt><dd>${formatProductProviderNumber(product.stock_minimo, 3)}</dd></div>
        </dl>
      </header>
      <div class="product-provider-list">
        ${product.proveedores.map((provider) => `
          <section class="product-provider-row${provider.proveedor_preferido ? ' preferred' : ''}">
            <div class="product-provider-name">
              <strong>${escapeHtml(provider.proveedor)}</strong>
              ${provider.proveedor_preferido ? '<span class="preferred-badge"><i class="fa-solid fa-star" aria-hidden="true"></i> Preferido</span>' : ''}
              ${provider.razon_social ? `<small>${escapeHtml(provider.razon_social)}</small>` : ''}
            </div>
            <div class="product-provider-data">
              ${productProviderValue('Código proveedor', provider.codigo_proveedor || provider.codigo_auxiliar_proveedor)}
              ${productProviderValue('Alias proveedor', provider.descripcion_proveedor)}
              ${productProviderValue('Unidad compra', provider.unidad_compra)}
              ${productProviderValue('Conversión', provider.factor_conversion ? `x ${formatProductProviderNumber(provider.factor_conversion, 4)}` : null)}
              ${productProviderValue('Mínimo', provider.cantidad_minima_compra ? formatProductProviderNumber(provider.cantidad_minima_compra, 3) : null)}
              ${productProviderValue('Múltiplo', provider.multiplo_compra ? formatProductProviderNumber(provider.multiplo_compra, 3) : null)}
              ${productProviderValue('Entrega', provider.tiempo_entrega_dias !== null && provider.tiempo_entrega_dias !== undefined ? `${formatProductProviderNumber(provider.tiempo_entrega_dias, 1)} días` : null)}
              ${productProviderValue('Costo neto', provider.ultimo_costo_neto !== null ? formatCurrency(provider.ultimo_costo_neto) : null)}
              ${productProviderValue('Origen', provider.origen_vinculo)}
            </div>
            <button type="button" class="icon-button product-provider-unlink" data-unlink-relation="${escapeHtml(provider.id)}" title="Desvincular producto" aria-label="Desvincular relación de ${escapeHtml(provider.proveedor)}">
              <i class="fa-solid fa-link-slash" aria-hidden="true"></i>
            </button>
          </section>
        `).join('')}
      </div>
    </article>
  `).join('');
}

async function loadProductProviders({ force = false } = {}) {
  if (productProviderRequest && !force) return productProviderRequest;
  const search = productProviderElements.productProviderSearch.value.trim();
  const params = new URLSearchParams({ limit: '50' });
  if (search) params.set('search', search);
  productProviderElements.productProviderRefresh.disabled = true;
  productProviderElements.productProviderRefresh.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>';
  productProviderElements.productProviderSummary.textContent = 'Cargando relaciones verificadas...';

  productProviderRequest = posApiRequest(`/api/purchases/v2/product-providers?${params}`, { method: 'GET' })
    .then((response) => {
      const data = response.data || { products: [], total: 0 };
      renderProductProviders(data.products || [], search);
      productProviderElements.productProviderSummary.textContent = data.total
        ? `${data.total} productos con relaciones de proveedor${search ? ` para “${search}”` : ''}.`
        : 'No hay relaciones para mostrar.';
      productProviderLoaded = true;
    })
    .catch((error) => {
      productProviderElements.productProviderResults.innerHTML = `<div class="product-provider-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escapeHtml(error.message)}</p></div>`;
      productProviderElements.productProviderSummary.textContent = 'No se pudo cargar el catálogo.';
    })
    .finally(() => {
      productProviderRequest = null;
      productProviderElements.productProviderRefresh.disabled = false;
      productProviderElements.productProviderRefresh.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i>';
    });

  return productProviderRequest;
}

productProviderElements.productProviderSearchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadProductProviders({ force: true });
});
productProviderElements.productProviderRefresh.addEventListener('click', () => loadProductProviders({ force: true }));
productProviderElements.productProviderResults.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-unlink-relation]');
  if (!button) return;
  const relationId = button.dataset.unlinkRelation;
  if (!relationId) return;
  if (!(await askConfirm('¿Desvincular este producto de este proveedor? Solo se eliminará la relación.', { confirmText: 'Desvincular', danger: true }))) return;
  button.disabled = true;
  try {
    await posApiRequest(`/api/purchases/v2/product-providers/${encodeURIComponent(relationId)}`, { method: 'DELETE' });
    await loadProductProviders({ force: true });
  } catch (error) {
    button.disabled = false;
    await askAlert(error.message);
  }
});

function stopPendingDocumentsPolling() {
  window.clearInterval(pendingDocumentsTimer);
  pendingDocumentsTimer = null;
}

function startPendingDocumentsPolling() {
  stopPendingDocumentsPolling();
  refreshPendingLease();
  pendingDocumentsTimer = window.setInterval(() => {
    loadPendingDocuments({ silent: true });
    refreshPendingLease();
  }, 30000);
}

async function refreshPendingLease() {
  if (!currentPendingDocumentId || Date.now() - pendingLeaseRefreshedAt < 10 * 60 * 1000) return;
  try {
    await posApiRequest(`/api/purchases/v2/documents/${encodeURIComponent(currentPendingDocumentId)}/claim`, {
      method: 'POST',
      body: '{}'
    });
    pendingLeaseRefreshedAt = Date.now();
  } catch (error) {
    console.warn('[inventario-compras] No se pudo renovar la revisión pendiente:', error.message);
  }
}

function pendingStatusLabel(document) {
  const lockActive = document.status === 'EN_REVISION'
    && document.locked_until
    && new Date(document.locked_until).getTime() > Date.now();
  if (!lockActive) return 'Pendiente';
  if (document.claimed_by === currentSession?.user?.email) return 'En revisión por ti';
  return `En revisión${document.claimed_by ? ` por ${document.claimed_by}` : ''}`;
}

function renderPendingDocuments(canDelete = false) {
  elements.pendingDocumentsList.replaceChildren();
  elements.pendingDocumentsSummary.textContent = pendingDocuments.length
    ? `${pendingDocuments.length} ${pendingDocuments.length === 1 ? 'factura espera' : 'facturas esperan'} revisión.`
    : 'No hay facturas pendientes.';
  const navItem = document.querySelector('[data-app-module="pending-documents"]');
  navItem.hidden = pendingDocuments.length === 0;
  elements.pendingDocumentsBadge.textContent = pendingDocuments.length;

  pendingDocuments.forEach((record) => {
    const card = window.document.createElement('article');
    card.className = 'pending-document-card';
    const content = window.document.createElement('button');
    content.type = 'button';
    content.className = 'pending-document-open';
    content.dataset.pendingOpen = record.id;
    content.innerHTML = `
      <header>
        <div><span>${escapeHtml(record.provider_name)}</span><strong>${escapeHtml(record.invoice_number)}</strong></div>
        <b>${escapeHtml(pendingStatusLabel(record))}</b>
      </header>
      <dl>
        <div><dt>Emisión</dt><dd>${escapeHtml(date(record.issue_date))}</dd></div>
        <div><dt>Productos</dt><dd>${escapeHtml(record.item_count)}</dd></div>
        <div><dt>Total</dt><dd>${escapeHtml(money(record.total))}</dd></div>
        <div><dt>Capturada</dt><dd>${escapeHtml(new Date(record.created_at).toLocaleString('es-EC'))}</dd></div>
      </dl>`;
    card.appendChild(content);
    if (canDelete) {
      const deleteButton = window.document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'icon-button pending-document-delete';
      deleteButton.dataset.pendingDelete = record.id;
      deleteButton.title = 'Borrar factura pendiente';
      deleteButton.setAttribute('aria-label', `Borrar factura ${record.invoice_number}`);
      deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
      card.appendChild(deleteButton);
    }
    elements.pendingDocumentsList.appendChild(card);
  });
}

async function loadPendingDocuments({ silent = false } = {}) {
  if (IS_MOBILE_DEVICE || !currentSession) return;
  if (!silent) {
    elements.pendingDocumentsRefresh.disabled = true;
    elements.pendingDocumentsSummary.textContent = 'Actualizando facturas pendientes.';
  }
  try {
    const result = await posApiRequest('/api/purchases/v2/documents/pending', { method: 'GET' });
    pendingDocuments = result.data?.items || [];
    renderPendingDocuments(Boolean(result.data?.can_delete));
  } catch (error) {
    if (!silent) elements.pendingDocumentsSummary.textContent = error.message;
  } finally {
    elements.pendingDocumentsRefresh.disabled = false;
  }
}

async function releaseCurrentPendingDocument() {
  const documentId = currentPendingDocumentId;
  currentPendingDocumentId = null;
  if (!documentId || !currentSession) return;
  try {
    await posApiRequest(`/api/purchases/v2/documents/${encodeURIComponent(documentId)}/release`, {
      method: 'POST',
      body: '{}'
    });
  } catch (error) {
    console.warn('[inventario-compras] No se pudo liberar el pendiente:', error.message);
  }
}

async function openPendingDocument(documentId) {
  if (currentDraft && currentPendingDocumentId !== documentId) {
    const label = currentDraft.invoice?.number ? `la factura ${currentDraft.invoice.number}` : 'otra factura';
    const ok = await askConfirm(
      `Tienes ${label} en revisión. Se guardará tu avance y volverá a Pendientes para retomarla luego. ¿Abrir esta factura ahora?`,
      { confirmText: 'Sí, cambiar' }
    );
    if (!ok) return;
    saveInvoiceDraftNow();
  }
  if (currentPendingDocumentId && currentPendingDocumentId !== documentId) {
    await releaseCurrentPendingDocument();
  }
  const result = await posApiRequest(`/api/purchases/v2/documents/${encodeURIComponent(documentId)}/claim`, {
    method: 'POST',
    body: '{}'
  });
  currentPendingDocumentId = documentId;
  pendingLeaseRefreshedAt = Date.now();
  await switchAppModule('invoice-import');
  history.replaceState(null, '', '#ingreso-facturas');
  const serverDraft = result.data.datos_extraidos;
  const accessKey = serverDraft?.tax_information?.access_key || '';
  // Si esta factura ya se estaba revisando en este equipo, se retoma ese avance.
  const stashed = getStashedDraft(accessKey);
  elements.accessKeyInput.value = accessKey;
  updateKeyState();
  await renderDraft(stashed?.draft || serverDraft);
  saveInvoiceDraftNow();
  await loadPendingDocuments({ silent: true });
}

async function deletePendingDocument(documentId) {
  const record = pendingDocuments.find((item) => item.id === documentId);
  if (!record) return;
  if (!(await askConfirm(`¿Borrar la factura pendiente ${record.invoice_number}? El XML y todos sus detalles se eliminarán.`, { confirmText: 'Borrar', danger: true }))) return;
  await posApiRequest(`/api/purchases/v2/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  forgetDraftForKey(record.clave_acceso);
  if (currentPendingDocumentId === documentId) {
    currentPendingDocumentId = null;
    resetInvoice({ release: false });
  }
  await loadPendingDocuments();
}

elements.pendingDocumentsRefresh.addEventListener('click', () => loadPendingDocuments());
elements.pendingDocumentsList.addEventListener('click', async (event) => {
  const openButton = event.target.closest('[data-pending-open]');
  const deleteButton = event.target.closest('[data-pending-delete]');
  try {
    if (deleteButton) await deletePendingDocument(deleteButton.dataset.pendingDelete);
    else if (openButton) await openPendingDocument(openButton.dataset.pendingOpen);
  } catch (error) {
    elements.pendingDocumentsSummary.textContent = error.message;
  }
});

function setMobileStatus(message, type = '') {
  elements.mobileCaptureStatus.className = `mobile-capture-status${type ? ` ${type}` : ''}`;
  elements.mobileCaptureStatus.textContent = message;
}

function renderMobileInvoiceSummary(draft, state) {
  currentDraft = draft;
  elements.mobileInvoiceSummary.hidden = false;
  elements.mobileInvoiceState.textContent = state;
  elements.mobileInvoiceProvider.textContent = draft.provider.trade_name || draft.provider.legal_name;
  elements.mobileInvoiceTaxId.textContent = draft.provider.tax_id;
  elements.mobileInvoiceNumber.textContent = draft.invoice.number;
  elements.mobileInvoiceItems.textContent = draft.items.length;
  elements.mobileInvoiceTotal.textContent = money(draft.totals.total);
  elements.mobileInvoiceItemsList.replaceChildren();
  draft.items.forEach((item) => {
    const entry = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'mobile-invoice-item-name';
    name.textContent = item.description || 'Sin descripción';
    const meta = document.createElement('span');
    meta.className = 'mobile-invoice-item-meta';
    meta.textContent = `${number(item.quantity)} × ${money(item.unit_cost)} = ${money(item.subtotal)}`;
    entry.append(name, meta);
    elements.mobileInvoiceItemsList.append(entry);
  });
}

function stopScanner() {
  try { scannerControls?.stop(); } catch (_) { /* La cámara puede haberse detenido sola. */ }
  scannerControls = null;
  scannerEmptyFrames = 0;
  elements.scannerViewport.hidden = true;
  elements.startScannerButton.hidden = false;
  elements.stopScannerButton.hidden = true;
}

async function startScanner() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return setMobileStatus('La cámara requiere HTTPS y permiso del navegador.', 'error');
  }
  if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
    return setMobileStatus('El lector no pudo cargarse. Actualiza la página e inténtalo nuevamente.', 'error');
  }
  stopScanner();
  setMobileStatus('Autoriza la cámara y apunta a la clave de acceso.');
  elements.scannerViewport.hidden = false;
  elements.startScannerButton.hidden = true;
  elements.stopScannerButton.hidden = false;
  scannerEmptyFrames = 0;
  scannerMismatchAt = 0;
  try {
    scannerReader ||= createScannerReader();
    scannerControls = await scannerReader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      elements.scannerVideo,
      (result) => {
        if (mobileCaptureBusy) return;
        if (!result) {
          scannerEmptyFrames += 1;
          if (scannerEmptyFrames === 120) {
            setMobileStatus('No se detecta el código. Si está borroso o dañado, usa "Tomar foto" o "Elegir de galería".', 'warning');
          }
          return;
        }
        scannerEmptyFrames = 0;
        const raw = result.getText();
        let key = (raw.replace(/\D/g, '').match(/\d{49}/) || [])[0] || '';
        if (key && !isValidAccessKey(key)) {
          key = window.app.accessKey.resolveFromText(raw, {})?.key || '';
        }
        if (!key || !isValidAccessKey(key)) {
          const now = Date.now();
          if (now - scannerMismatchAt > 2500) {
            scannerMismatchAt = now;
            setMobileStatus('Ese código no corresponde a la clave de una factura del SRI.', 'warning');
          }
          return;
        }
        elements.mobileAccessKeyInput.value = key;
        updateMobileKeyState();
        stopScanner();
        previewMobileDocument();
      }
    );
  } catch (error) {
    stopScanner();
    const denied = error?.name === 'NotAllowedError' || /permission|denied|permiso/i.test(error?.message || '');
    setMobileStatus(denied
      ? 'No se concedió acceso a la cámara. Habilítalo en la configuración del navegador.'
      : `No fue posible iniciar la cámara: ${error.message || 'error desconocido'}.`, 'error');
  }
}

function updateMobileKeyState() {
  const digits = elements.mobileAccessKeyInput.value.replace(/\D/g, '').slice(0, 49);
  elements.mobileAccessKeyInput.value = digits;
  elements.mobileCaptureButton.disabled = mobileCaptureBusy || !isValidAccessKey(digits);
}

function resetMobileCapture() {
  stopScanner();
  closeOcrCrop();
  currentDraft = null;
  providerLinkContinuation = null;
  elements.mobileAccessKeyInput.value = '';
  elements.mobileInvoiceSummary.hidden = true;
  elements.mobileInvoiceItemsList.replaceChildren();
  elements.mobileLinkProviderButton.hidden = true;
  elements.mobileSaveButton.hidden = true;
  elements.mobileSaveButton.disabled = false;
  elements.mobileScanAnotherButton.hidden = true;
  setMobileStatus('');
  updateMobileKeyState();
}

// Paso 1: consulta el SRI y muestra el resumen con la lista de productos para
// verificar. No guarda nada todavía.
async function previewMobileDocument() {
  const accessKey = elements.mobileAccessKeyInput.value;
  if (!isValidAccessKey(accessKey) || mobileCaptureBusy) return;
  mobileCaptureBusy = true;
  updateMobileKeyState();
  elements.startScannerButton.disabled = true;
  setMobileStatus('Consultando el SRI y verificando el proveedor…', 'loading');
  try {
    const result = await posApiRequest('/api/purchases/v2/documents/capture', {
      method: 'POST',
      body: JSON.stringify({ access_key: accessKey, preview: true })
    });
    const capture = result.data;
    const stashed = getStashedDraft(capture.draft?.tax_information?.access_key);
    const draft = stashed?.draft || capture.draft;
    elements.mobileScanAnotherButton.hidden = false;
    if (capture.requires_provider_link) {
      renderMobileInvoiceSummary(draft, 'Proveedor pendiente de vincular');
      providerLinkContinuation = 'mobile-preview';
      elements.mobileLinkProviderButton.hidden = false;
      elements.mobileSaveButton.hidden = true;
      setMobileStatus('Vincula el proveedor y vuelve a revisar antes de guardar.', 'warning');
      return;
    }
    renderMobileInvoiceSummary(draft, 'Revisa el detalle y guarda');
    providerLinkContinuation = null;
    elements.mobileLinkProviderButton.hidden = true;
    elements.mobileSaveButton.hidden = false;
    elements.mobileSaveButton.disabled = false;
    setMobileStatus('Verifica los productos contra el papel y toca Guardar en Pendientes.');
  } catch (error) {
    setMobileStatus(error.message, 'error');
  } finally {
    mobileCaptureBusy = false;
    elements.startScannerButton.disabled = false;
    updateMobileKeyState();
  }
}

// Paso 2: guarda el XML en la cola de pendientes tras la verificación.
async function confirmMobileDocument() {
  const accessKey = elements.mobileAccessKeyInput.value;
  if (!isValidAccessKey(accessKey) || mobileCaptureBusy) return;
  mobileCaptureBusy = true;
  elements.mobileSaveButton.disabled = true;
  setMobileStatus('Guardando en Pendientes…', 'loading');
  try {
    const result = await posApiRequest('/api/purchases/v2/documents/capture', {
      method: 'POST',
      body: JSON.stringify({ access_key: accessKey, datos_extraidos: currentDraft || undefined })
    });
    const capture = result.data;
    if (capture.requires_provider_link) {
      providerLinkContinuation = 'mobile-save';
      elements.mobileLinkProviderButton.hidden = false;
      elements.mobileSaveButton.hidden = true;
      setMobileStatus('Vincula el proveedor antes de guardar esta factura.', 'warning');
      return;
    }
    currentPendingDocumentId = null;
    providerLinkContinuation = null;
    elements.mobileLinkProviderButton.hidden = true;
    elements.mobileSaveButton.hidden = true;
    elements.mobileScanAnotherButton.hidden = false;
    setMobileStatus(capture.duplicate
      ? 'Esta factura ya estaba guardada; no se creó un duplicado.'
      : 'Factura guardada correctamente en Pendientes.', 'success');
  } catch (error) {
    setMobileStatus(error.message, 'error');
    elements.mobileSaveButton.disabled = false;
  } finally {
    mobileCaptureBusy = false;
  }
}

// --- OCR de la clave (respaldo cuando la factura no trae código de barras) ---
// Solo móvil. El escáner sigue siendo la vía principal. Todo ocurre en el
// teléfono; la foto no se sube a ningún servidor.
const OCR_MAX_IMAGE_DIM = 2200; // se reduce la foto antes de procesarla para no agotar la memoria del navegador
const OCR_MAX_FILE_BYTES = 30 * 1024 * 1024;
const OCR_TIMEOUT_MS = 90000;
let ocrModuleRequest = null;
let ocrSourceRaw = null;       // canvas ya reducido, sin rotar
let ocrSource = null;          // canvas rotado que se pasa al OCR
let ocrRotation = 0;           // 0 / 90 / 180 / 270
// Dos líneas horizontales: la clave queda entre `top` y `bottom` (fracciones).
let ocrBounds = { top: 0.35, bottom: 0.55 };
let ocrBoundsDrag = null;
let ocrBoundsUserMoved = false;
let ocrLoupeX = 0.5;
let ocrBusy = false;

function loadOcrModule() {
  if (window.ocrClave) return Promise.resolve();
  if (ocrModuleRequest) return ocrModuleRequest;
  ocrModuleRequest = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'js/ocr-clave.js';
    script.onload = () => resolve();
    script.onerror = () => { ocrModuleRequest = null; script.remove(); reject(new Error('No se pudo cargar el lector de clave.')); };
    document.body.appendChild(script);
  });
  return ocrModuleRequest;
}

function renderOcrBounds() {
  elements.ocrBarTop.style.top = `${(ocrBounds.top * 100).toFixed(2)}%`;
  elements.ocrBarBottom.style.top = `${(ocrBounds.bottom * 100).toFixed(2)}%`;
  elements.ocrShadeTop.style.height = `${(ocrBounds.top * 100).toFixed(2)}%`;
  elements.ocrShadeBottom.style.height = `${((1 - ocrBounds.bottom) * 100).toFixed(2)}%`;
}

// Lupa: mientras se arrastra una línea, muestra ampliada la zona bajo el dedo,
// pegada arriba para que el dedo no la tape.
const OCR_LOUPE_SIZE = 150;
const OCR_LOUPE_ZOOM = 3.4;
function renderOcrLoupe(fy) {
  if (!ocrSource) return;
  const windowPx = OCR_LOUPE_SIZE / OCR_LOUPE_ZOOM;
  const cx = ocrLoupeX * ocrSource.width;
  const cy = fy * ocrSource.height;
  const context = elements.ocrLoupeCanvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#101216';
  context.fillRect(0, 0, OCR_LOUPE_SIZE, OCR_LOUPE_SIZE);
  context.drawImage(ocrSource, cx - windowPx / 2, cy - windowPx / 2, windowPx, windowPx, 0, 0, OCR_LOUPE_SIZE, OCR_LOUPE_SIZE);
  elements.ocrLoupe.hidden = false;
}
function hideOcrLoupe() { elements.ocrLoupe.hidden = true; }

function closeOcrCrop() {
  elements.ocrCrop.hidden = true;
  hideOcrLoupe();
  ocrBoundsDrag = null;
  const previous = elements.ocrCropImage.getAttribute('src');
  if (previous && previous.startsWith('blob:')) URL.revokeObjectURL(previous);
  elements.ocrCropImage.removeAttribute('src');
  ocrSource = null;
  ocrSourceRaw = null;
  ocrRotation = 0;
  elements.ocrKeyFileCamera.value = '';
  elements.ocrKeyFileGallery.value = '';
}

// Aplica la rotación elegida y deja `ocrSource` y la previsualización listos.
// Al rotar se reinicia el recuadro porque cambia la orientación.
function applyOcrRotation() {
  if (!ocrSourceRaw) return;
  const deg = ((ocrRotation % 360) + 360) % 360;
  if (deg === 0) {
    ocrSource = ocrSourceRaw;
  } else {
    const swap = deg === 90 || deg === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? ocrSourceRaw.height : ocrSourceRaw.width;
    canvas.height = swap ? ocrSourceRaw.width : ocrSourceRaw.height;
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((deg * Math.PI) / 180);
    context.drawImage(ocrSourceRaw, -ocrSourceRaw.width / 2, -ocrSourceRaw.height / 2);
    ocrSource = canvas;
  }
  elements.ocrCropImage.src = ocrSource.toDataURL('image/jpeg', 0.85);
  ocrBounds = { top: 0.35, bottom: 0.55 };
  ocrBoundsUserMoved = false;
  renderOcrBounds();
}

// Ubica sola la línea de la clave y acerca las 2 líneas a sus extremos, salvo
// que el usuario ya las haya movido.
let ocrAutoLocateToken = 0;
function autoLocateClaveBand() {
  if (!ocrSource) return;
  const token = ++ocrAutoLocateToken;
  const target = ocrSource;
  loadOcrModule()
    .then(() => window.ocrClave?.locateClaveLine?.(target))
    .then((band) => {
      if (!band || token !== ocrAutoLocateToken || ocrBoundsUserMoved || ocrSource !== target || elements.ocrCrop.hidden) return;
      const top = Math.max(0, Math.min(0.9, band.top));
      const bottom = Math.max(top + 0.03, Math.min(1, band.top + band.height));
      ocrBounds = { top, bottom };
      renderOcrBounds();
      setMobileStatus('Líneas colocadas sobre la clave. Ajústalas si hace falta y toca Leer.');
    })
    .catch(() => { /* si falla, quedan las líneas por defecto */ });
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo abrir la foto.'));
    image.src = url;
  });
}

// Reduce la foto a un tamaño manejable y la deja lista tanto para previsualizar
// como para el OCR. Evita canvas gigantes que reinician la pestaña del navegador.
function downscaleToCanvas(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('La foto no se pudo leer.');
  const factor = Math.min(1, OCR_MAX_IMAGE_DIM / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function openOcrCropFromFile(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) throw new Error('Elige un archivo de imagen.');
  if (file.size > OCR_MAX_FILE_BYTES) throw new Error('La foto es demasiado grande. Toma una con menos resolución.');
  stopScanner();
  const url = URL.createObjectURL(file);
  let canvas;
  try {
    const image = await loadImageElement(url);
    canvas = downscaleToCanvas(image);
  } finally {
    URL.revokeObjectURL(url);
  }
  const previousSrc = elements.ocrCropImage.getAttribute('src');
  if (previousSrc && previousSrc.startsWith('blob:')) URL.revokeObjectURL(previousSrc);
  ocrSourceRaw = canvas;
  ocrRotation = 0;
  applyOcrRotation();
  elements.ocrCrop.hidden = false;
  elements.ocrCrop.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setMobileStatus('Buscando la línea de la clave…');
  autoLocateClaveBand();
  loadOcrModule().then(() => window.ocrClave?.warmup?.()).catch(() => {});
}

function eventFraction(event) {
  const rect = elements.ocrCropStage.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1)))
  };
}

function beginOcrBoundsDrag(event) {
  const bar = event.target.closest('.ocr-hbar');
  const point = eventFraction(event);
  let side;
  if (bar) {
    side = bar.dataset.side;
  } else {
    // toca en el escenario: mueve la línea más cercana
    side = Math.abs(point.y - ocrBounds.top) <= Math.abs(point.y - ocrBounds.bottom) ? 'top' : 'bottom';
  }
  ocrBoundsUserMoved = true;
  ocrBoundsDrag = { side };
  ocrLoupeX = point.x;
  elements.ocrCropStage.setPointerCapture?.(event.pointerId);
  renderOcrLoupe(ocrBounds[side]);
  event.preventDefault();
}

function moveOcrBoundsDrag(event) {
  if (!ocrBoundsDrag) return;
  const point = eventFraction(event);
  ocrLoupeX = point.x;
  if (ocrBoundsDrag.side === 'top') {
    ocrBounds.top = Math.min(point.y, ocrBounds.bottom - 0.03);
  } else {
    ocrBounds.bottom = Math.max(point.y, ocrBounds.top + 0.03);
  }
  renderOcrBounds();
  renderOcrLoupe(ocrBounds[ocrBoundsDrag.side]);
}

function endOcrBoundsDrag() { ocrBoundsDrag = null; hideOcrLoupe(); }

async function runOcrRead() {
  if (!ocrSource || ocrBusy) return;
  ocrBusy = true;
  elements.ocrCropRun.disabled = true;
  elements.ocrCropCancel.disabled = true;
  setMobileStatus('Leyendo la clave… puede tardar unos segundos.', 'loading');
  try {
    await loadOcrModule();
    const top = Math.round(ocrBounds.top * ocrSource.height);
    const height = Math.max(1, Math.round((ocrBounds.bottom - ocrBounds.top) * ocrSource.height));
    const hit = await Promise.race([
      window.ocrClave.run(ocrSource, { x: 0, y: top, w: ocrSource.width, h: height }, {
        onProgress: (message) => setMobileStatus(`${message}`, 'loading')
      }),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error('La lectura tardó demasiado. Inténtalo de nuevo con más luz o escríbela.')), OCR_TIMEOUT_MS))
    ]);
    if (!hit) {
      setMobileStatus('No se pudo leer la clave con claridad. Prueba a acercar más la cámara, mejorar la luz, o escríbela.', 'error');
      return;
    }
    elements.mobileAccessKeyInput.value = hit.key;
    updateMobileKeyState();
    closeOcrCrop();
    setMobileStatus(hit.confidence === 'alta'
      ? 'Clave leída. Verifícala contra el papel y toca Consultar y guardar.'
      : 'Clave reconstruida a partir de la foto. Revísala dígito por dígito antes de continuar.', 'warning');
  } catch (error) {
    setMobileStatus(error.message || 'No fue posible leer la clave.', 'error');
  } finally {
    ocrBusy = false;
    elements.ocrCropRun.disabled = false;
    elements.ocrCropCancel.disabled = false;
  }
}

function pickOcrImage(input) {
  input.value = '';
  input.click();
}

elements.startScannerButton.addEventListener('click', startScanner);
elements.stopScannerButton.addEventListener('click', stopScanner);
elements.mobileAccessKeyInput.addEventListener('input', updateMobileKeyState);
elements.mobileCaptureButton.addEventListener('click', previewMobileDocument);
elements.mobileSaveButton.addEventListener('click', confirmMobileDocument);
elements.mobileLinkProviderButton.addEventListener('click', openProviderLinking);
elements.mobileScanAnotherButton.addEventListener('click', resetMobileCapture);
elements.ocrPickCamera.addEventListener('click', () => pickOcrImage(elements.ocrKeyFileCamera));
elements.ocrPickGallery.addEventListener('click', () => pickOcrImage(elements.ocrKeyFileGallery));
function handleOcrFileChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  openOcrCropFromFile(file).catch((error) => {
    closeOcrCrop();
    setMobileStatus(error.message || 'No se pudo abrir la foto.', 'error');
  });
}
elements.ocrKeyFileCamera.addEventListener('change', handleOcrFileChange);
elements.ocrKeyFileGallery.addEventListener('change', handleOcrFileChange);
elements.ocrCropCancel.addEventListener('click', () => { if (!ocrBusy) { closeOcrCrop(); setMobileStatus(''); } });
elements.ocrRotateButton.addEventListener('click', () => { if (!ocrBusy && ocrSourceRaw) { ocrRotation += 90; applyOcrRotation(); ocrBoundsUserMoved = false; autoLocateClaveBand(); } });
elements.ocrCropRun.addEventListener('click', runOcrRead);
elements.ocrCropStage.addEventListener('pointerdown', beginOcrBoundsDrag);
elements.ocrCropStage.addEventListener('pointermove', moveOcrBoundsDrag);
elements.ocrCropStage.addEventListener('pointerup', endOcrBoundsDrag);
elements.ocrCropStage.addEventListener('pointercancel', endOcrBoundsDrag);
elements.ocrCropStage.addEventListener('lostpointercapture', endOcrBoundsDrag);

document.querySelectorAll('[data-app-module]').forEach((item) => {
  item.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await switchAppModule(item.dataset.appModule);
      history.replaceState(null, '', item.getAttribute('href'));
    } catch (error) {
      console.error('[inventario-compras] No se pudo abrir el módulo:', error);
    }
  });
});

function money(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

function number(value, maximumFractionDigits = 6) {
  return new Intl.NumberFormat('es-EC', { maximumFractionDigits }).format(Number(value) || 0);
}

function date(value) {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : value;
}

function setText(id, value) {
  document.getElementById(id).textContent = value ?? '';
}

function setBusy(busy) {
  elements.loadingRow.hidden = !busy;
  elements.accessKeyInput.disabled = busy;
  elements.fetchButton.disabled = busy || !isValidAccessKey(elements.accessKeyInput.value);
  elements.uploadButton.disabled = busy;
  elements.sampleButton.disabled = busy;
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.hidden = false;
  elements.review.hidden = true;
}

function clearError() {
  elements.errorBanner.hidden = true;
  elements.errorBanner.textContent = '';
}

function createCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function renderItems(items) {
  elements.itemsBody.replaceChildren();
  items.forEach((item) => {
    const row = document.createElement('tr');
    createCell(row, item.line);
    createCell(row, item.provider_primary_code || item.provider_auxiliary_code || 'Sin código', 'code-value');
    createCell(row, item.description || 'Sin descripción', 'product-description');
    const quantityCell = document.createElement('td');
    quantityCell.className = 'number xml-receipt-cell';
    const billedQuantity = Number(item.quantity) || 0;
    const receiptState = item.recepcion_estado === 'INCOMPLETA' ? 'INCOMPLETA' : 'COMPLETA';
    if (!item.recepcion_estado) item.recepcion_estado = receiptState;
    if (item.cantidad_recibida === undefined || item.cantidad_recibida === null) {
      item.cantidad_recibida = billedQuantity;
    }
    const quantityLabel = document.createElement('strong');
    quantityLabel.textContent = number(billedQuantity);
    const quantityCaption = document.createElement('small');
    quantityCaption.textContent = 'facturada';
    const quantitySummary = document.createElement('div');
    quantitySummary.className = 'xml-receipt-quantity';
    quantitySummary.append(quantityLabel, quantityCaption);
    const receiptButtons = document.createElement('div');
    receiptButtons.className = 'xml-receipt-buttons';
    const completeButton = document.createElement('button');
    completeButton.type = 'button';
    completeButton.className = 'xml-receipt-button complete';
    completeButton.title = 'Recibí toda la cantidad y está en buen estado';
    completeButton.setAttribute('aria-label', completeButton.title);
    completeButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    const incompleteButton = document.createElement('button');
    incompleteButton.type = 'button';
    incompleteButton.className = 'xml-receipt-button incomplete';
    incompleteButton.title = 'Recibí una cantidad diferente o hay novedades';
    incompleteButton.setAttribute('aria-label', incompleteButton.title);
    incompleteButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    receiptButtons.append(completeButton, incompleteButton);
    const receivedInput = document.createElement('input');
    receivedInput.type = 'number';
    receivedInput.className = 'xml-received-quantity';
    receivedInput.min = '0';
    receivedInput.max = String(billedQuantity);
    receivedInput.step = '1';
    receivedInput.inputMode = 'numeric';
    receivedInput.placeholder = 'Recibidas';
    receivedInput.value = item.recepcion_estado === 'INCOMPLETA' && item.cantidad_recibida !== null
      ? String(item.cantidad_recibida)
      : '';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'xml-receipt-note';
    noteInput.maxLength = 500;
    noteInput.placeholder = item.recepcion_estado === 'INCOMPLETA' ? 'Motivo obligatorio' : 'Nota (opcional)';
    noteInput.value = item.nota_recepcion || '';
    const refreshReceiptControls = () => {
      const incomplete = item.recepcion_estado === 'INCOMPLETA';
      completeButton.classList.toggle('selected', !incomplete);
      incompleteButton.classList.toggle('selected', incomplete);
      receivedInput.hidden = !incomplete;
      receivedInput.required = incomplete;
      noteInput.required = incomplete;
      noteInput.placeholder = incomplete ? 'Motivo obligatorio' : 'Nota (opcional)';
      receivedInput.classList.toggle('invalid', incomplete && (!Number.isFinite(Number(item.cantidad_recibida))
        || Number(item.cantidad_recibida) < 0 || Number(item.cantidad_recibida) > billedQuantity));
      noteInput.classList.toggle('invalid', incomplete && !String(item.nota_recepcion || '').trim());
    };
    completeButton.addEventListener('click', () => {
      item.recepcion_estado = 'COMPLETA';
      item.cantidad_recibida = billedQuantity;
      refreshReceiptControls();
      updateContinueEntryState();
    });
    incompleteButton.addEventListener('click', () => {
      item.recepcion_estado = 'INCOMPLETA';
      if (item.cantidad_recibida === billedQuantity) item.cantidad_recibida = null;
      receivedInput.value = item.cantidad_recibida ?? '';
      refreshReceiptControls();
      updateContinueEntryState();
    });
    receivedInput.addEventListener('input', () => {
      item.cantidad_recibida = receivedInput.value === '' ? null : Number(receivedInput.value);
      refreshReceiptControls();
      updateContinueEntryState();
    });
    noteInput.addEventListener('input', () => {
      item.nota_recepcion = noteInput.value;
      refreshReceiptControls();
      updateContinueEntryState();
    });
    quantityCell.append(quantitySummary, receiptButtons, receivedInput, noteInput);
    refreshReceiptControls();
    row.appendChild(quantityCell);
    createCell(row, money(item.unit_cost), 'number');
    createCell(row, money(item.discount), 'number');
    createCell(row, money(item.tax), 'number');
    createCell(row, money(item.subtotal), 'number');
    const skuCell = document.createElement('td');
    skuCell.className = 'internal-sku-cell';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'internal-sku-input';
    input.autocomplete = 'off';
    input.maxLength = 100;
    input.placeholder = 'Escanea o escribe SKU';
    input.value = item.match?.inventory?.codigo || item.internal_code || '';
    input.setAttribute('aria-label', `SKU interno para línea ${item.line}`);
    const message = document.createElement('span');
    message.className = 'line-status internal-sku-message';
    const suggestions = document.createElement('div');
    suggestions.className = 'internal-sku-suggestions';
    const salePreview = document.createElement('div');
    salePreview.className = 'xml-sale-preview';

    const calculateXmlSalePrice = (gain) => {
      const quantity = Number(item.quantity) || 1;
      const unitNetCost = Number(item.subtotal) > 0
        ? Number(item.subtotal) / quantity
        : Number(item.unit_cost) || 0;
      return Math.round(unitNetCost * 1.15 * 1.05 * (1 + Number(gain) / 100) * 100) / 100;
    };

    const renderMatch = () => {
      const match = item.match || {};
      const icon = document.createElement('i');
      icon.setAttribute('aria-hidden', 'true');
      if (match.status === 'MATCHED' && match.inventory) {
        message.className = 'line-status matched internal-sku-message';
        icon.className = 'fa-solid fa-link';
        message.replaceChildren(icon, document.createTextNode(` ${match.inventory.codigo} · ${match.inventory.producto}`));
        salePreview.replaceChildren();
        const label = document.createElement('label');
        label.textContent = 'Ganancia';
        const select = document.createElement('select');
        select.className = 'xml-gain-select';
        XML_GAIN_OPTIONS.forEach((gain) => {
          const option = document.createElement('option');
          option.value = String(gain);
          option.textContent = `${gain}%`;
          option.selected = Number(item.sale_margin_percent ?? 38) === gain;
          select.appendChild(option);
        });
        const manualOption = document.createElement('option');
        manualOption.value = 'manual';
        manualOption.textContent = 'Manual';
        manualOption.selected = item.sale_margin_percent === 'manual';
        select.appendChild(manualOption);
        const price = document.createElement('strong');
        const priceInput = document.createElement('input');
        priceInput.type = 'number';
        priceInput.className = 'xml-sale-price-input';
        priceInput.min = '0';
        priceInput.step = '0.01';
        priceInput.inputMode = 'decimal';
        priceInput.value = Number(item.sale_price || calculateXmlSalePrice(38)).toFixed(2);
        priceInput.disabled = item.sale_margin_percent !== 'manual';
        const renderSalePrice = () => {
          if (item.sale_margin_percent === 'manual') {
            priceInput.disabled = false;
            price.replaceChildren(document.createTextNode('Venta:'));
            price.appendChild(priceInput);
            return;
          }
          const selectedGain = Number(item.sale_margin_percent ?? 38);
          item.sale_margin_percent = Number.isFinite(selectedGain) ? selectedGain : 38;
          item.sale_price = calculateXmlSalePrice(item.sale_margin_percent);
          priceInput.value = item.sale_price.toFixed(2);
          priceInput.disabled = true;
          price.textContent = `Venta: ${money(item.sale_price)}`;
        };
        if (item.sale_margin_percent !== 'manual' && !Number.isFinite(Number(item.sale_price))) {
          item.sale_price = calculateXmlSalePrice(38);
        }
        renderSalePrice();
        select.addEventListener('change', () => {
          item.sale_margin_percent = select.value === 'manual' ? 'manual' : Number(select.value);
          renderSalePrice();
          scheduleInvoiceDraftSave();
        });
        priceInput.addEventListener('input', () => {
          const value = Number(priceInput.value);
          if (Number.isFinite(value) && value >= 0) item.sale_price = Math.round(value * 100) / 100;
          scheduleInvoiceDraftSave();
        });
        label.append(' ', select);
        salePreview.append(label, price);
      } else if (match.status === 'CHECKING') {
        message.className = 'line-status checking internal-sku-message';
        icon.className = 'fa-solid fa-circle-notch fa-spin';
        message.replaceChildren(icon, document.createTextNode(' Buscando SKU...'));
      } else if (match.status === 'ERROR') {
        message.className = 'line-status error internal-sku-message';
        icon.className = 'fa-solid fa-triangle-exclamation';
        message.replaceChildren(icon, document.createTextNode(` ${match.message || 'SKU no encontrado'}`));
      } else {
        message.className = 'line-status internal-sku-message';
        icon.className = 'fa-solid fa-barcode';
        message.replaceChildren(icon, document.createTextNode(' Pendiente de vincular'));
      }
    };

    const lookup = async () => {
      const code = input.value.trim();
      item.internal_code = code;
      if (!code) {
        item.match = { status: 'PENDING', inventory_id: null, inventory: null };
        renderMatch();
        updateContinueEntryState();
        return;
      }
      item.match = { status: 'CHECKING', inventory_id: null, inventory: null };
      renderMatch();
      updateContinueEntryState();
      try {
        let inventory = internalProductLookupCache.get(code);
        if (!inventory) {
          const response = await posApiRequest(`/api/purchases/v2/inventory/lookup?${new URLSearchParams({ code })}`, { method: 'GET' });
          inventory = response.data;
          internalProductLookupCache.set(code, inventory);
        }
        if (input.value.trim() !== code) return;
        item.match = { status: 'MATCHED', inventory_id: inventory.id, inventory };
      } catch (error) {
        if (input.value.trim() !== code) return;
        item.match = { status: 'ERROR', inventory_id: null, inventory: null, message: error.message };
      }
      renderMatch();
      updateContinueEntryState();
    };

    const showSuggestions = (products) => {
      suggestions.replaceChildren();
      rankInternalProductMatches(products, input.value).forEach((product) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'internal-sku-suggestion';
        option.innerHTML = `<strong>${escapeHtml(product.codigo)}</strong><span>${escapeHtml(product.producto)}</span>`;
        option.addEventListener('click', () => {
          input.value = product.codigo;
          item.internal_code = product.codigo;
          item.match = { status: 'MATCHED', inventory_id: product.id, inventory: product };
          suggestions.replaceChildren();
          renderMatch();
          updateContinueEntryState();
        });
        suggestions.appendChild(option);
      });
    };

    let searchTimer;
    const revealSkuColumn = () => {
      const tableWrap = input.closest('.table-wrap');
      if (!tableWrap) return;
      tableWrap.scrollTo({ left: tableWrap.scrollWidth - tableWrap.clientWidth, behavior: 'smooth' });
    };

    const searchProducts = () => {
      window.clearTimeout(searchTimer);
      const query = input.value.trim();
      if (query.length < 2) {
        suggestions.replaceChildren();
        return;
      }
      searchTimer = window.setTimeout(async () => {
        try {
          let products = internalProductSearchCache.get(query);
          if (!products && internalProductCatalog.length) {
            products = rankInternalProductMatches(internalProductCatalog, query);
          }
          if (!products) {
            const response = await posApiRequest(`/api/purchases/v2/inventory/search?${new URLSearchParams({ query })}`, { method: 'GET' });
            products = response.data || [];
            internalProductSearchCache.set(query, products);
          }
          if (input.value.trim() === query) showSuggestions(products);
        } catch (_) {
          suggestions.replaceChildren();
        }
      }, 180);
    };

    input.addEventListener('input', () => {
      item.match = { status: 'PENDING', inventory_id: null, inventory: null };
      renderMatch();
      updateContinueEntryState();
      searchProducts();
    });
    input.addEventListener('focus', revealSkuColumn);
    input.addEventListener('click', revealSkuColumn);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        lookup();
      }
    });
    input.addEventListener('blur', lookup);
    renderMatch();
    skuCell.append(input, message, salePreview, suggestions);
    row.appendChild(skuCell);
    elements.itemsBody.appendChild(row);
  });
}

function renderWarnings(warnings) {
  elements.warningsList.replaceChildren();
  elements.warningsSection.hidden = warnings.length === 0;
  warnings.forEach((warning) => {
    const item = document.createElement('li');
    item.textContent = warning.message;
    elements.warningsList.appendChild(item);
  });
}

function setProviderMatch(status, text) {
  elements.providerMatchState.className = `match-state ${status}`;
  elements.providerMatchState.textContent = text;
  updateProviderReviewState(status);
  updateContinueEntryState();
}

function updateProviderReviewState(status = matchedProvider ? 'matched' : 'unmatched') {
  const linked = Boolean(matchedProvider);
  const checking = status === 'checking';
  const summaryOnly = !linked;
  elements.providerLinkSection.hidden = !summaryOnly;
  elements.validationBanner.hidden = summaryOnly;
  elements.invoiceFields.hidden = summaryOnly;
  elements.accessRow.hidden = summaryOnly;
  elements.totalsStrip.hidden = summaryOnly;
  elements.itemsSection.hidden = summaryOnly;
  elements.warningsSection.hidden = summaryOnly || elements.warningsList.children.length === 0;
  elements.continueEntryButton.hidden = summaryOnly;
  elements.downloadButton.hidden = summaryOnly;
  elements.providerLinkButton.disabled = checking;
}

function updateContinueEntryState() {
  const hasEveryInternalProduct = Array.isArray(currentDraft?.items)
    && currentDraft.items.length > 0
    && currentDraft.items.every((item) => item.match?.status === 'MATCHED' && item.match.inventory?.id);
  const hasValidReception = Array.isArray(currentDraft?.items)
    && currentDraft.items.every((item) => {
      if (item.recepcion_estado !== 'INCOMPLETA') return true;
      const quantity = Number(item.quantity);
      const received = Number(item.cantidad_recibida);
      return Number.isFinite(received) && received >= 0 && received <= quantity && String(item.nota_recepcion || '').trim().length > 0;
    });
  elements.continueEntryButton.disabled = !matchedProvider || !hasEveryInternalProduct || !hasValidReception;
  scheduleInvoiceDraftSave();
}

async function resolveProvider(draft) {
  matchedProvider = null;
  setProviderMatch('checking', 'Buscando proveedor');
  const taxId = String(draft?.provider?.tax_id || '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(taxId)) {
    setProviderMatch('unmatched', 'RUC inválido');
    return;
  }

  const { data, error } = await db
    .from('ferre_proveedores')
    .select('id, codigo, empresa, ruc, razon_social')
    .eq('ruc', taxId)
    .maybeSingle();

  if (error) {
    const schemaPending = /ruc|razon_social|schema cache|column/i.test(error.message || '');
    setProviderMatch('unmatched', schemaPending ? 'Esquema pendiente' : 'No se pudo consultar');
    return;
  }
  if (!data) {
    draft.provider.match = { status: 'NOT_FOUND', provider_id: null };
    setProviderMatch('unmatched', 'RUC no vinculado');
    return;
  }

  matchedProvider = data;
  draft.provider.match = { status: 'MATCHED', provider_id: data.id };
  setText('providerName', data.empresa);
  setProviderMatch('matched', `Vinculado como ${data.empresa}`);
}

async function renderDraft(draft) {
  currentDraft = draft;
  elements.saveToPendingButton.disabled = true;
  const warningCount = draft.warnings.length;
  elements.validationBanner.classList.toggle('warning', !draft.consistent);
  elements.validationIcon.className = draft.consistent ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation';
  elements.validationTitle.textContent = draft.consistent ? 'XML válido y totales consistentes' : 'XML válido con diferencias por revisar';
  elements.validationText.textContent = draft.consistent
    ? 'No se realizó ningún cambio en inventario.'
    : `${warningCount} ${warningCount === 1 ? 'diferencia detectada' : 'diferencias detectadas'}.`;

  setText('providerName', draft.provider.trade_name || draft.provider.legal_name);
  setText('providerLegalName', `Razón social: ${draft.provider.legal_name || 'No informada'}`);
  setText('providerTaxId', `RUC ${draft.provider.tax_id}`);
  setText('invoiceNumber', draft.invoice.number);
  setText('issueDate', date(draft.invoice.issue_date));
  setText('authorizationStatus', draft.authorization.status);
  setText('invoiceTotal', money(draft.totals.total));
  setText('accessKey', draft.tax_information.access_key);
  setText('grossSubtotal', money(draft.totals.gross_subtotal));
  setText('discount', money(draft.totals.discount));
  setText('netSubtotal', money(draft.totals.subtotal));
  setText('tax', money(draft.totals.tax));
  setText('tip', money(draft.totals.tip));
  setText('itemCount', `(${draft.items.length})`);
  setText('pendingCount', draft.items.length);
  setText('providerLinkProductCount', draft.items.length);
  renderItems(draft.items);
  renderWarnings(draft.warnings);
  elements.review.hidden = false;
  await resolveProvider(draft);
  saveInvoiceDraftNow();
  elements.review.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function calculateCheckDigit(first48Digits) {
  if (!/^\d{48}$/.test(first48Digits)) return null;
  let sum = 0;
  let weight = 2;
  for (let index = 47; index >= 0; index -= 1) {
    sum += Number(first48Digits[index]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return 0;
  if (result === 10) return 1;
  return result;
}

function isValidAccessKey(value) {
  return /^\d{49}$/.test(value)
    && calculateCheckDigit(value.slice(0, 48)) === Number(value[48])
    && value.slice(8, 10) === '01'
    && ['1', '2'].includes(value[23]);
}

// La clave tiene una estructura fija; se aprovecha para descartar números
// sueltos y para corregir un dígito mal leído por OCR usando datos que también
// están impresos aparte (RUC, número de factura).
function hasPlausibleAccessKeyShape(value) {
  if (!/^\d{49}$/.test(value)) return false;
  if (value.slice(8, 10) !== '01') return false;
  if (!['1', '2'].includes(value[23])) return false;
  if (value[47] !== '1') return false;
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const year = Number(value.slice(4, 8));
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2035;
}

function hammingDistance(a, b) {
  if (a.length !== b.length) return Infinity;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) distance += 1;
  return distance;
}

// Devuelve { key, snapped } tras encajar RUC / serie / secuencial leídos aparte,
// solo cuando el candidato ya está muy cerca (a lo sumo 2 dígitos de diferencia).
function snapAccessKeyFields(key, hints = {}) {
  const chars = key.split('');
  let snapped = false;
  const place = (start, digits, width) => {
    if (!digits || !new RegExp(`^\\d{${width}}$`).test(digits)) return;
    const current = key.slice(start, start + width);
    if (current === digits || hammingDistance(current, digits) > 2) return;
    for (let index = 0; index < width; index += 1) chars[start + index] = digits[index];
    snapped = true;
  };
  place(10, hints.ruc, 13);
  place(24, hints.serie, 6);
  place(30, hints.secuencial, 9);
  if (!snapped) return { key, snapped: false };
  const first48 = chars.slice(0, 48).join('');
  chars[48] = String(calculateCheckDigit(first48));
  return { key: chars.join(''), snapped: true };
}

function accessKeyHintsFromText(text) {
  const clean = String(text || '');
  const hints = {};
  const factura = clean.match(/(\d{3})\s*-\s*(\d{3})\s*-\s*(\d{6,9})/);
  if (factura) {
    hints.serie = factura[1] + factura[2];
    hints.secuencial = factura[3].padStart(9, '0').slice(-9);
  }
  const ruc = clean.match(/\b(\d{13})\b/);
  if (ruc) hints.ruc = ruc[1];
  return hints;
}

// Reconstruye la clave de acceso a partir del texto crudo de un OCR.
// `hints` puede traer ruc / serie / secuencial leídos por separado.
// Devuelve { key, confidence: 'alta' | 'media' } o null.
function accessKeyMatchesHints(key, hints = {}) {
  return (!hints.ruc || key.slice(10, 23) === hints.ruc)
    && (!hints.serie || key.slice(24, 30) === hints.serie)
    && (!hints.secuencial || key.slice(30, 39) === hints.secuencial);
}

function classifyAccessKey(key, hints) {
  if (isValidAccessKey(key) && accessKeyMatchesHints(key, hints)) return { key, confidence: 'alta' };
  const { key: fixed, snapped } = snapAccessKeyFields(key, hints);
  if (snapped && hasPlausibleAccessKeyShape(fixed) && isValidAccessKey(fixed) && accessKeyMatchesHints(fixed, hints)) {
    return { key: fixed, confidence: 'media' };
  }
  if (isValidAccessKey(key)) return { key, confidence: 'media' };
  return null;
}

function combinations(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [
    ...combinations(rest, size - 1).map((combo) => [head, ...combo]),
    ...combinations(rest, size)
  ];
}

function bestAlignedWindow(digits, reference) {
  let best = null;
  for (let offset = 0; offset + 49 <= digits.length; offset += 1) {
    const win = digits.slice(offset, offset + 49);
    const distance = reference ? hammingDistance(win, reference) : 0;
    if (!best || distance < best.distance) best = { win, offset, distance };
  }
  return best;
}

// Voto por posición entre las lecturas del OCR. Se alinean todas contra una
// referencia (para no mezclar ventanas corridas), se toma el dígito más votado
// por posición (ponderado por la confianza de Tesseract si viene) y, si el
// resultado no valida, se prueban las 2ª/3ª opciones en las posiciones con
// menos acuerdo. Sin RUC / número de factura con que contrastar, una clave
// reconstruida se marca como "media" para que el usuario la revise.
function voteAccessKey(reads, hints = {}) {
  const merged = { ...hints };
  const strings = (reads || [])
    .map((read) => ({
      digits: String(read?.digits || '').replace(/\D/g, ''),
      weights: Array.isArray(read?.weights) ? read.weights : null
    }))
    .filter((read) => read.digits.length >= 46 && read.digits.length <= 64);
  if (strings.length < 3) return null;

  const exact = strings.find((read) => read.digits.length === 49);
  let reference = exact ? exact.digits : null;
  if (!reference) {
    // referencia = la ventana de 49 que menos difiere del resto
    let bestRef = null;
    for (const read of strings) {
      for (let offset = 0; offset + 49 <= read.digits.length; offset += 1) {
        const win = read.digits.slice(offset, offset + 49);
        let total = 0;
        for (const other of strings) total += bestAlignedWindow(other.digits, win).distance;
        if (!bestRef || total < bestRef.total) bestRef = { win, total };
      }
    }
    reference = bestRef?.win || null;
  }
  if (!reference) return null;

  const aligned = [];
  for (const read of strings) {
    const window = bestAlignedWindow(read.digits, reference);
    if (!window || window.distance > 10) continue;
    const weights = read.weights ? read.weights.slice(window.offset, window.offset + 49) : null;
    aligned.push({ win: window.win, weights });
  }
  if (aligned.length < 3) return null;

  const tally = Array.from({ length: 49 }, () => Object.create(null));
  for (const { win, weights } of aligned) {
    for (let i = 0; i < 49; i += 1) {
      const weight = weights && Number.isFinite(weights[i]) ? Math.max(3, weights[i]) : 25;
      tally[i][win[i]] = (tally[i][win[i]] || 0) + weight;
    }
  }
  const ranked = tally.map((counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]));
  const consensus = ranked.map((entry) => entry[0][0]).join('');
  const agreement = ranked.map((entry) => {
    const total = entry.reduce((sum, option) => sum + option[1], 0);
    return total ? entry[0][1] / total : 0;
  });
  const strongConsensus = agreement.every((value) => value >= 0.6);
  const hasHints = Boolean(merged.ruc || merged.serie || merged.secuencial);

  // Consenso directo válido.
  if (isValidAccessKey(consensus) && hasPlausibleAccessKeyShape(consensus)) {
    if (accessKeyMatchesHints(consensus, merged) && (hasHints || strongConsensus)) {
      return { key: consensus, confidence: 'alta' };
    }
    const snap = snapAccessKeyFields(consensus, merged);
    if (snap.snapped && isValidAccessKey(snap.key) && accessKeyMatchesHints(snap.key, merged)) {
      return { key: snap.key, confidence: 'media' };
    }
    return { key: consensus, confidence: 'media' };
  }

  // Encajar RUC / serie / secuencial leídos aparte.
  const snapped = snapAccessKeyFields(consensus, merged);
  if (snapped.snapped && hasPlausibleAccessKeyShape(snapped.key)
    && isValidAccessKey(snapped.key) && accessKeyMatchesHints(snapped.key, merged)) {
    return { key: snapped.key, confidence: 'media' };
  }

  // Probar las 2ª/3ª opciones en las posiciones con menos acuerdo.
  const weakest = agreement
    .map((value, index) => [value, index])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 5)
    .map((entry) => entry[1]);
  const matches = [];
  for (let size = 1; size <= 3 && matches.length < 4; size += 1) {
    for (const combo of combinations(weakest, size)) {
      const options = combo.map((pos) => ranked[pos].slice(1, 4).map((entry) => entry[0]));
      const cartesian = options.reduce(
        (acc, list) => acc.flatMap((prefix) => list.map((value) => [...prefix, value])),
        [[]]
      );
      for (const pick of cartesian) {
        const chars = consensus.split('');
        combo.forEach((pos, k) => { chars[pos] = pick[k]; });
        const candidate = chars.join('');
        if (!isValidAccessKey(candidate) || !hasPlausibleAccessKeyShape(candidate)) continue;
        if (hasHints && !accessKeyMatchesHints(candidate, merged)) continue;
        matches.push({ key: candidate, flips: size });
      }
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => a.flips - b.flips);
  if (hasHints) return { key: matches[0].key, confidence: 'alta' };
  // Sin datos con que contrastar: solo si la corrección es mínima e inequívoca.
  const unambiguous = new Set(matches.map((entry) => entry.key)).size === 1;
  if (matches[0].flips <= 1 || unambiguous) return { key: matches[0].key, confidence: 'media' };
  return null;
}

function resolveAccessKeyFromText(rawText, hints = {}) {
  const text = String(rawText || '');
  const merged = { ...accessKeyHintsFromText(text), ...hints };

  // Solo tramos de dígitos de UNA misma línea: la clave se imprime seguida.
  // No se concatena entre líneas ni se recorre todo el texto: eso genera
  // ventanas de 49 dígitos que pasan el verificador por pura casualidad.
  const runs = [];
  for (const line of text.split(/[\r\n]+/)) {
    const compactLine = line.replace(/[^\d]/g, '');
    if (compactLine.length >= 44) runs.push(compactLine);
    for (const token of line.match(/\d[\d -]*\d|\d/g) || []) {
      const digits = token.replace(/\D+/g, '');
      if (digits.length >= 44 && !runs.includes(digits)) runs.push(digits);
    }
  }

  const candidates = new Map(); // key -> 'clean' | 'windowed'
  const addCandidate = (key, kind) => {
    if (!/^\d{49}$/.test(key)) return;
    if (candidates.get(key) !== 'clean') candidates.set(key, kind);
  };
  for (const run of runs) {
    if (run.length === 49) addCandidate(run, 'clean');
    if (run.length === 48) addCandidate(run + calculateCheckDigit(run), 'clean');
    if (run.length > 49 && run.length <= 60) {
      for (let index = 0; index + 49 <= run.length; index += 1) addCandidate(run.slice(index, index + 49), 'windowed');
      for (let index = 0; index + 48 <= run.length; index += 1) {
        const head = run.slice(index, index + 48);
        addCandidate(head + calculateCheckDigit(head), 'windowed');
      }
    }
  }

  const isConsistentWithHints = (key) => accessKeyMatchesHints(key, merged);

  const hasHints = Boolean(merged.serie || merged.secuencial || merged.ruc);
  const validKeys = [...candidates.keys()].filter((candidate) => isValidAccessKey(candidate));
  const cleanValid = validKeys.filter((key) => candidates.get(key) === 'clean' && hasPlausibleAccessKeyShape(key));

  // 1. Clave válida leída de una línea completa y, si hay datos aparte, que cuadre con ellos.
  const cleanExact = cleanValid.find((key) => !hasHints || isConsistentWithHints(key));
  if (cleanExact) return { key: cleanExact, confidence: 'alta' };

  // 2. Clave (aunque venga con dígitos de etiqueta pegados) que cuadra con el RUC o el número de factura.
  if (hasHints) {
    const hintExact = validKeys.find(isConsistentWithHints);
    if (hintExact) return { key: hintExact, confidence: 'alta' };
  }

  // 3. Un candidato muy cercano que, al encajar RUC / serie / secuencial, queda válido.
  for (const candidate of candidates.keys()) {
    const { key: fixed, snapped } = snapAccessKeyFields(candidate, merged);
    if (snapped && hasPlausibleAccessKeyShape(fixed) && isValidAccessKey(fixed) && isConsistentWithHints(fixed)) {
      return { key: fixed, confidence: 'media' };
    }
  }

  // 4. Sin datos con que contrastar: se devuelve para revisión manual.
  if (cleanValid.length === 1 && !hasHints) return { key: cleanValid[0], confidence: 'media' };
  const anyValid = cleanValid[0] || validKeys[0];
  if (anyValid) return { key: anyValid, confidence: 'media' };
  return null;
}

function updateKeyState() {
  const key = elements.accessKeyInput.value.replace(/\D/g, '').slice(0, 49);
  if (key !== attemptedKey) {
    attemptedKey = key;
    failedSriAttempts = 0;
  }
  elements.accessKeyInput.value = key;
  elements.keyCount.textContent = `${key.length}/49`;
  elements.clearKeyButton.hidden = key.length === 0;
  const valid = isValidAccessKey(key);
  const complete = key.length === 49;
  elements.accessKeyInput.classList.toggle('valid', valid);
  elements.accessKeyInput.classList.toggle('invalid', complete && !valid);
  elements.accessKeyMeta.classList.toggle('valid', valid);
  elements.accessKeyMeta.classList.toggle('invalid', complete && !valid);
  elements.fetchButton.disabled = !valid;
  elements.uploadButton.hidden = !valid || failedSriAttempts < 3;
  elements.keyStatus.textContent = valid
    ? `Factura · ambiente ${key[23] === '2' ? 'producción' : 'pruebas'}`
    : complete ? 'La clave no es válida o no corresponde a una factura' : 'Esperando clave';
  if (!complete) clearError();
}

async function authenticatedRequest(path, body = {}) {
  const { data, error } = await db.auth.getSession();
  const session = data?.session;
  if (error || !session) {
    showLogin();
    throw new Error('La sesión caducó. Inicia sesión nuevamente.');
  }
  currentSession = session;
  return fetch(`${POS_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify(body)
  });
}

async function requestPreview(path, body = {}) {
  clearError();
  setBusy(true);
  try {
    const response = await authenticatedRequest(path, body);
    const rawResponse = await response.text();
    let result;
    try {
      result = JSON.parse(rawResponse);
    } catch (_) {
      throw new Error(
        `El backend respondió en un formato inesperado (HTTP ${response.status}). `
        + 'Código de diagnóstico: API_INVALID_RESPONSE.'
      );
    }
    if (!response.ok || !result.ok) {
      const code = String(result?.code || 'SRI_FETCH_ERROR');
      const hints = {
        SRI_UNAVAILABLE: 'Puedes reintentar; si persiste, usa Cargar XML cuando se habilite.',
        SRI_TIMEOUT: 'El SRI no respondió a tiempo. Espera unos minutos y vuelve a intentar.',
        SRI_INVOICE_NOT_FOUND: 'Comprueba que la clave sea correcta y que la factura esté autorizada.',
        SRI_NOT_CONFIGURED: 'La consulta automática no está configurada en este entorno.'
      };
      const hint = hints[code] ? ` ${hints[code]}` : '';
      throw new Error(`${result?.error || 'No se pudo consultar la factura'} Código de diagnóstico: ${code}.${hint}`);
    }
    await renderDraft(result.data);
    return true;
  } catch (error) {
    const message = error?.message === 'Failed to fetch' || error?.message === 'Load failed'
      ? 'No fue posible conectar con el backend seguro. Código de diagnóstico: API_CONNECTION_ERROR.'
      : error?.message || 'No fue posible procesar la consulta. Código de diagnóstico: API_REQUEST_ERROR.';
    showError(message);
    return false;
  } finally {
    setBusy(false);
  }
}

// preview: solo consulta el SRI y muestra el resumen para verificar, sin
// escribir nada. El guardado en Pendientes se hace después, con confirmación.
async function captureDesktopDocument({ preview = false } = {}) {
  const accessKey = elements.accessKeyInput.value;
  clearError();
  setBusy(true);
  try {
    const result = await posApiRequest('/api/purchases/v2/documents/capture', {
      method: 'POST',
      body: JSON.stringify(preview
        ? { access_key: accessKey, preview: true }
        : { access_key: accessKey, datos_extraidos: currentDraft || undefined })
    });
    const capture = result.data;
    if (capture.requires_provider_link) {
      providerLinkContinuation = preview ? 'desktop-preview' : 'desktop-capture';
      await renderDraft(capture.draft);
      elements.saveToPendingButton.disabled = true;
      return true;
    }
    if (capture.preview) {
      providerLinkContinuation = null;
      const stashed = getStashedDraft(capture.draft?.tax_information?.access_key);
      await renderDraft(stashed?.draft || capture.draft);
      // El backend ya resolvió el proveedor por RUC; se respeta esa decisión.
      if (capture.provider && !matchedProvider) {
        matchedProvider = capture.provider;
        setText('providerName', capture.provider.empresa);
        setProviderMatch('matched', `Vinculado como ${capture.provider.empresa}`);
      }
      elements.saveToPendingButton.disabled = !matchedProvider;
      return true;
    }
    if (capture.document.status === 'REGISTRADO') {
      throw new Error('Esta factura ya fue registrada y no puede volver a ingresarse.');
    }
    const claimed = await posApiRequest(`/api/purchases/v2/documents/${encodeURIComponent(capture.document.id)}/claim`, {
      method: 'POST',
      body: '{}'
    });
    currentPendingDocumentId = capture.document.id;
    pendingLeaseRefreshedAt = Date.now();
    providerLinkContinuation = null;
    await renderDraft(claimed.data.datos_extraidos);
    elements.saveToPendingButton.disabled = true;
    setProviderMatch('matched', capture.duplicate
      ? 'Ya estaba en Pendientes; no se duplicó'
      : 'Guardada en Pendientes');
    await loadPendingDocuments({ silent: true });
    return true;
  } catch (error) {
    showError(error.message || 'No fue posible consultar la factura.');
    return false;
  } finally {
    setBusy(false);
  }
}

function resetInvoice({ release = true } = {}) {
  if (release) releaseCurrentPendingDocument();
  clearInvoiceIntakeCache();
  currentDraft = null;
  currentPendingDocumentId = null;
  providerLinkContinuation = null;
  matchedProvider = null;
  attemptedKey = '';
  failedSriAttempts = 0;
  elements.accessKeyInput.value = '';
  elements.xmlFileInput.value = '';
  elements.review.hidden = true;
  clearError();
  updateKeyState();
  resetKeyBuilder();
  if (!elements.appShell.hidden && intakeMode === 'scan') elements.accessKeyInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

elements.accessKeyInput.addEventListener('input', updateKeyState);
elements.accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = elements.accessKeyInput.value;
  if (!isValidAccessKey(key)) return;
  const succeeded = await captureDesktopDocument({ preview: true });
  if (succeeded) failedSriAttempts = 0;
  else if (elements.accessKeyInput.value === attemptedKey) failedSriAttempts += 1;
  updateKeyState();
});
// ============ Reconstruir la clave de acceso paso a paso (solo PC) ============
// La clave del SRI tiene una estructura fija; casi todo es deducible. Aquí se
// arma tramo a tramo con lo impreso en la factura y solo se piden los 8 dígitos
// del código numérico (no calculables). El verificador se calcula por módulo 11.
const INTAKE_MODE_KEY = 'inventario-compras:modo-clave';
// Los pasos se "insertan" de a uno: cada tramo confirmado se anida en la clave
// que crece de izquierda a derecha, resaltado en verde. Los tramos fijos
// (01 / 2 / 1) viajan con el paso que los precede, sin animación.
const KEY_BUILDER_INSERT_LABELS = ['Insertar fecha', 'Insertar proveedor', 'Insertar número', 'Verificar e insertar'];
const KEY_BUILDER_INSERT_ICONS = ['fa-plus', 'fa-plus', 'fa-plus', 'fa-wand-magic-sparkles'];
const KEY_BUILDER_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

let intakeMode = 'scan';
let keyBuilderProviders = [];
let keyBuilderProvidersLoaded = false;
let keyBuilderProvidersLoading = null;
let keyBuilderConfirmed = [false, false, false, false];

const onlyDigits = (value, max) => String(value || '').replace(/\D/g, '').slice(0, max);

function keyBuilderProviderRuc() {
  const provider = keyBuilderProviders.find((item) => item.id === elements.kbProvider.value);
  return provider && /^\d{13}$/.test(provider.ruc) ? provider.ruc : '';
}

// Devuelve los tramos actuales (aunque estén incompletos) y la validez por paso.
function readKeyBuilderParts() {
  const day = onlyDigits(elements.kbDay.value, 2);
  const month = onlyDigits(elements.kbMonth.value, 2);
  const year = onlyDigits(elements.kbYear.value, 4);
  const dayNum = Number(day);
  const monthNum = Number(month);
  const yearNum = Number(year);
  const step1 = day.length >= 1 && month.length >= 1 && year.length === 4
    && dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12
    && yearNum >= 2020 && yearNum <= 2035;
  const fecha = step1 ? day.padStart(2, '0') + month.padStart(2, '0') + year : '';

  const ruc = keyBuilderProviderRuc();
  const step2 = ruc.length === 13;

  const estab = onlyDigits(elements.kbEstab.value, 3);
  const ptoEmi = onlyDigits(elements.kbPtoEmi.value, 3);
  const secuencialRaw = onlyDigits(elements.kbSecuencial.value, 9);
  const step3 = estab.length >= 1 && ptoEmi.length >= 1 && secuencialRaw.length >= 1;
  const serie = step3 ? estab.padStart(3, '0') + ptoEmi.padStart(3, '0') : '';
  const secuencial = step3 ? secuencialRaw.padStart(9, '0') : '';

  // Paso 4: los últimos 10 dígitos de la clave impresa = código numérico (8) +
  // tipo de emisión (1) + dígito verificador (1). Se recalcula el verificador
  // sobre los pasos 1-3 + esos dígitos y se compara con el impreso.
  const tail = onlyDigits(elements.kbTail.value, 10);
  let codigo = '';
  let emision = '';
  let checkDigit = '';
  let key48 = '';
  let key49 = '';
  let step4 = false;
  let verifyError = '';
  if (step1 && step2 && step3 && tail.length === 10) {
    const codigoIn = tail.slice(0, 8);
    const emisionIn = tail[8];
    const printedCheck = tail[9];
    const candidate48 = `${fecha}01${ruc}2${serie}${secuencial}${codigoIn}${emisionIn}`;
    const computed = calculateCheckDigit(candidate48);
    if (!['1', '2'].includes(emisionIn)) {
      verifyError = 'El penúltimo dígito (tipo de emisión) debería ser 1. Revisa los últimos 10 dígitos de la clave.';
    } else if (computed != null && String(computed) === printedCheck) {
      codigo = codigoIn;
      emision = emisionIn;
      checkDigit = printedCheck;
      key48 = candidate48;
      key49 = candidate48 + printedCheck;
      step4 = true;
    } else {
      verifyError = 'Esos 10 dígitos no cuadran con la fecha, el proveedor o el número de factura. Revisa esos pasos o vuelve a leer los dígitos de la clave.';
    }
  }

  return {
    parts: { fecha, ruc, serie, secuencial, codigo, emision, verificador: checkDigit },
    steps: [step1, step2, step3, step4],
    key48, key49, checkDigit, tail, verifyError
  };
}

// Une los tramos ya confirmados y pinta la clave como un único bloque verde que
// crece; el resto quedan como puntos. Sin animación.
function renderKeyBuilderKey(parts, checkDigit, confirmedCount) {
  const chunks = [
    parts.fecha ? `${parts.fecha}01` : '',
    parts.ruc ? `${parts.ruc}2` : '',
    (parts.serie && parts.secuencial) ? `${parts.serie}${parts.secuencial}` : '',
    parts.codigo ? `${parts.codigo}${parts.emision || '1'}${checkDigit}` : ''
  ];
  let filled = '';
  for (let i = 0; i < confirmedCount; i += 1) filled += chunks[i];
  filled = filled.slice(0, 49);
  elements.kbPreview.textContent = '';
  const on = document.createElement('span');
  on.className = 'kb-key-on';
  on.textContent = filled;
  const off = document.createElement('span');
  off.className = 'kb-key-off';
  off.textContent = '•'.repeat(Math.max(0, 49 - filled.length));
  elements.kbPreview.append(on, off);
  elements.kbPreviewCount.textContent = `${filled.length} de 49`;
}

function renderKeyBuilder() {
  const { parts, steps, checkDigit, key49, tail, verifyError } = readKeyBuilderParts();

  // Si un paso confirmado dejó de ser válido, se desanida ese y los siguientes.
  for (let i = 0; i < 4; i += 1) {
    if (keyBuilderConfirmed[i] && !steps[i]) {
      for (let j = i; j < 4; j += 1) keyBuilderConfirmed[j] = false;
      break;
    }
  }

  let confirmedCount = 0;
  for (const done of keyBuilderConfirmed) { if (!done) break; confirmedCount += 1; }

  const buttons = [elements.kbInsertDate, elements.kbInsertProvider, elements.kbInsertNumber, elements.kbInsertCode];
  const fields = [
    [elements.kbDay, elements.kbMonth, elements.kbYear],
    [elements.kbProvider],
    [elements.kbEstab, elements.kbPtoEmi, elements.kbSecuencial],
    [elements.kbTail]
  ];

  // Solo se muestra un paso a la vez: el primero sin confirmar. Los confirmados
  // se ocultan y se vuelve a ellos con la flecha de regresar.
  const currentStep = Math.min(confirmedCount, 3);
  document.querySelectorAll('#keyBuilderForm .key-builder-step').forEach((node) => {
    const index = Number(node.dataset.kbStep) - 1;
    node.hidden = index !== currentStep;
    node.classList.toggle('is-active', index === currentStep);
  });

  buttons.forEach((button, index) => {
    button.innerHTML = `<i class="fa-solid ${KEY_BUILDER_INSERT_ICONS[index]}" aria-hidden="true"></i> ${KEY_BUILDER_INSERT_LABELS[index]}`;
    button.disabled = !steps[index];
    fields[index].forEach((element) => { element.disabled = false; });
  });

  // Mensaje de la verificación (paso 4).
  const check = elements.kbCheckInfo;
  if (keyBuilderConfirmed[3]) {
    check.textContent = `Verificado. La clave termina en ${checkDigit} y el dígito verificador coincide.`;
    check.className = 'key-builder-check is-ok';
  } else if (steps[3]) {
    check.textContent = `Coincide. El dígito verificador es ${checkDigit}. Pulsa "Verificar e insertar".`;
    check.className = 'key-builder-check is-ok';
  } else if (tail.length === 10 && verifyError) {
    check.textContent = verifyError;
    check.className = 'key-builder-check is-error';
  } else {
    check.textContent = 'Ingresa los últimos 10 dígitos para comprobar.';
    check.className = 'key-builder-check';
  }

  const resolved = elements.kbInvoiceResolved;
  if (parts.serie && parts.secuencial) {
    resolved.hidden = false;
    resolved.textContent = `Número de factura: ${parts.serie.slice(0, 3)}-${parts.serie.slice(3)}-${parts.secuencial}`;
  } else {
    resolved.hidden = true;
  }

  renderKeyBuilderKey(parts, checkDigit, confirmedCount);
  elements.kbSubmit.disabled = !(confirmedCount === 4 && isValidAccessKey(key49));
}

// Inserta el paso indicado (si es válido) y avanza al siguiente.
function confirmKeyBuilderStep(index) {
  const { steps } = readKeyBuilderParts();
  if (!steps[index]) return;
  keyBuilderConfirmed[index] = true;
  renderKeyBuilder();
}

// Flecha de regresar: vuelve al paso anterior y lo deja editable.
function goBackKeyBuilderStep() {
  let confirmedCount = 0;
  for (const done of keyBuilderConfirmed) { if (!done) break; confirmedCount += 1; }
  const target = Math.min(confirmedCount, 3) - 1;
  if (target < 0) return;
  for (let i = target; i < 4; i += 1) keyBuilderConfirmed[i] = false;
  renderKeyBuilder();
  const focusTarget = [elements.kbDay, elements.kbProvider, elements.kbEstab, elements.kbTail][target];
  if (focusTarget) focusTarget.focus();
}

function populateKeyBuilderDate() {
  const addOption = (select, value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  elements.kbDay.textContent = '';
  for (let day = 1; day <= 31; day += 1) addOption(elements.kbDay, String(day).padStart(2, '0'), String(day));
  elements.kbMonth.textContent = '';
  KEY_BUILDER_MONTHS.forEach((name, index) => addOption(elements.kbMonth, String(index + 1).padStart(2, '0'), name));
  elements.kbYear.textContent = '';
  const thisYear = new Date().getFullYear();
  for (let year = thisYear + 1; year >= 2020; year -= 1) addOption(elements.kbYear, String(year), String(year));
}

function resetKeyBuilder() {
  if (!elements.keyBuilderForm) return;
  keyBuilderConfirmed = [false, false, false, false];
  const now = new Date();
  elements.kbDay.value = String(now.getDate()).padStart(2, '0');
  elements.kbMonth.value = String(now.getMonth() + 1).padStart(2, '0');
  elements.kbYear.value = String(now.getFullYear());
  elements.kbProvider.value = '';
  elements.kbEstab.value = '';
  elements.kbPtoEmi.value = '';
  elements.kbSecuencial.value = '';
  elements.kbTail.value = '';
  renderKeyBuilder();
}

function setKeyBuilderProviderPlaceholder(text) {
  elements.kbProvider.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = text;
  elements.kbProvider.appendChild(placeholder);
}

async function loadKeyBuilderProviders() {
  if (keyBuilderProvidersLoaded) return;
  if (keyBuilderProvidersLoading) return keyBuilderProvidersLoading;
  setKeyBuilderProviderPlaceholder('Cargando proveedores…');
  elements.kbProvider.disabled = true;
  keyBuilderProvidersLoading = (async () => {
    try {
      const response = await posApiRequest('/api/purchases/v2/providers');
      const rows = Array.isArray(response?.data) ? response.data : [];
      keyBuilderProviders = rows
        .map((row) => ({
          id: row.id,
          empresa: row.empresa || row.razon_social || 'Proveedor',
          ruc: String(row.ruc || '').replace(/\D/g, ''),
          razon_social: row.razon_social || ''
        }))
        .filter((row) => /^\d{13}$/.test(row.ruc))
        .sort((a, b) => a.empresa.localeCompare(b.empresa, 'es'));
      setKeyBuilderProviderPlaceholder(keyBuilderProviders.length
        ? 'Selecciona un proveedor'
        : 'No hay proveedores con RUC vinculado');
      keyBuilderProviders.forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = `${provider.empresa} · ${provider.ruc}`;
        elements.kbProvider.appendChild(option);
      });
      elements.kbProvider.disabled = keyBuilderProviders.length === 0;
      keyBuilderProvidersLoaded = true;
    } catch (error) {
      setKeyBuilderProviderPlaceholder('No fue posible cargar los proveedores');
      elements.kbProvider.disabled = true;
    } finally {
      keyBuilderProvidersLoading = null;
      renderKeyBuilder();
    }
  })();
  return keyBuilderProvidersLoading;
}

function setIntakeMode(mode, { persist = true } = {}) {
  intakeMode = mode === 'build' ? 'build' : 'scan';
  const building = intakeMode === 'build';
  elements.accessForm.hidden = building;
  elements.keyBuilderForm.hidden = !building;
  elements.modeScanButton.classList.toggle('is-active', !building);
  elements.modeBuildButton.classList.toggle('is-active', building);
  elements.modeScanButton.setAttribute('aria-selected', String(!building));
  elements.modeBuildButton.setAttribute('aria-selected', String(building));
  if (persist) {
    try { localStorage.setItem(INTAKE_MODE_KEY, intakeMode); } catch (_) { /* almacenamiento no disponible */ }
  }
  if (building) {
    loadKeyBuilderProviders();
    renderKeyBuilder();
  } else {
    elements.accessKeyInput.focus();
  }
}

if (elements.keyBuilderForm && !IS_MOBILE_DEVICE) {
  elements.modeScanButton.addEventListener('click', () => setIntakeMode('scan'));
  elements.modeBuildButton.addEventListener('click', () => setIntakeMode('build'));

  populateKeyBuilderDate();

  [elements.kbDay, elements.kbMonth, elements.kbYear].forEach((select) => {
    select.addEventListener('change', renderKeyBuilder);
  });
  [elements.kbEstab, elements.kbPtoEmi, elements.kbSecuencial, elements.kbTail].forEach((input) => {
    input.addEventListener('input', () => {
      input.value = onlyDigits(input.value, Number(input.getAttribute('maxlength')) || 10);
      renderKeyBuilder();
    });
  });
  [elements.kbEstab, elements.kbPtoEmi, elements.kbSecuencial].forEach((input) => {
    input.addEventListener('blur', () => {
      const width = input === elements.kbSecuencial ? 9 : 3;
      if (input.value) input.value = onlyDigits(input.value, width).padStart(width, '0');
      renderKeyBuilder();
    });
  });
  elements.kbProvider.addEventListener('change', renderKeyBuilder);
  elements.kbProviderXmlButton.addEventListener('click', () => elements.xmlFileInput.click());
  elements.kbInsertDate.addEventListener('click', () => confirmKeyBuilderStep(0));
  elements.kbInsertProvider.addEventListener('click', () => confirmKeyBuilderStep(1));
  elements.kbInsertNumber.addEventListener('click', () => confirmKeyBuilderStep(2));
  elements.kbInsertCode.addEventListener('click', () => confirmKeyBuilderStep(3));
  elements.keyBuilderForm.addEventListener('click', (event) => {
    if (event.target.closest('[data-kb-back]')) goBackKeyBuilderStep();
  });

  elements.keyBuilderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { key49 } = readKeyBuilderParts();
    if (!keyBuilderConfirmed.every(Boolean) || !isValidAccessKey(key49)) return;
    elements.accessKeyInput.value = key49;
    updateKeyState();
    const succeeded = await captureDesktopDocument({ preview: true });
    if (succeeded) failedSriAttempts = 0;
    updateKeyState();
  });

  resetKeyBuilder();
  let storedMode = 'scan';
  try { storedMode = localStorage.getItem(INTAKE_MODE_KEY) || 'scan'; } catch (_) { /* sin almacenamiento */ }
  if (storedMode === 'build') setIntakeMode('build', { persist: false });
}

elements.saveToPendingButton.addEventListener('click', async () => {
  if (elements.saveToPendingButton.disabled) return;
  elements.saveToPendingButton.disabled = true;
  elements.saveToPendingButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Guardando';
  try {
    await captureDesktopDocument({ preview: false });
  } finally {
    elements.saveToPendingButton.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Guardar en pendientes';
  }
});
elements.clearKeyButton.addEventListener('click', resetInvoice);
elements.sampleButton.hidden = POS_API_BASE_URL !== '';
elements.sampleButton.addEventListener('click', () => requestPreview('/api/sample'));
elements.resetButton.addEventListener('click', resetInvoice);
elements.uploadButton.addEventListener('click', () => elements.xmlFileInput.click());
elements.xmlFileInput.addEventListener('change', async () => {
  const file = elements.xmlFileInput.files[0];
  elements.xmlFileInput.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return showError('El archivo supera el límite de 5 MB.');
  if (!file.name.toLowerCase().endsWith('.xml')) return showError('Selecciona un archivo XML.');
  const succeeded = await requestPreview('/api/purchases/v2/xml/preview', {
    access_key: elements.accessKeyInput.value,
    xml: await file.text()
  });
  if (succeeded) {
    failedSriAttempts = 0;
    updateKeyState();
  }
});

elements.copyKeyButton.addEventListener('click', async () => {
  if (!currentDraft) return;
  await navigator.clipboard.writeText(currentDraft.tax_information.access_key);
  elements.copyKeyButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
  window.setTimeout(() => {
    elements.copyKeyButton.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i>';
  }, 1200);
});

elements.downloadButton.addEventListener('click', () => {
  if (!currentDraft) return;
  const blob = new Blob([JSON.stringify(currentDraft, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `factura-${currentDraft.invoice.number || 'borrador'}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

function waitForManualEntry(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (typeof window.iniciarIngresoFacturaDesdeXml === 'function') return resolve();
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('El formulario de ingreso no terminó de cargar.'));
      window.setTimeout(check, 50);
    };
    check();
  });
}

function normalizeProviderSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function renderProviderLinkCandidates() {
  const query = normalizeProviderSearch(elements.providerLinkSearchInput.value);
  const draftTaxId = String(currentDraft?.provider?.tax_id || '');
  const candidates = providerLinkCandidates.filter((provider) => {
    if (!query) return true;
    return normalizeProviderSearch(`${provider.codigo || ''} ${provider.empresa || ''} ${provider.razon_social || ''}`).includes(query);
  });

  elements.providerLinkGrid.replaceChildren();
  candidates.forEach((provider) => {
    const hasDifferentTaxId = provider.ruc && provider.ruc !== draftTaxId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `provider-link-option${selectedProviderForLink?.id === provider.id ? ' selected' : ''}`;
    button.disabled = Boolean(hasDifferentTaxId);
    button.setAttribute('aria-pressed', selectedProviderForLink?.id === provider.id ? 'true' : 'false');

    const name = document.createElement('strong');
    name.textContent = provider.empresa || 'Proveedor sin alias';
    const detail = document.createElement('span');
    detail.textContent = [provider.codigo && `Código ${provider.codigo}`, provider.razon_social].filter(Boolean).join(' · ');
    button.append(name, detail);
    if (hasDifferentTaxId) {
      const warning = document.createElement('small');
      warning.textContent = 'Ya tiene otro RUC vinculado';
      button.appendChild(warning);
    }
    button.addEventListener('click', () => {
      selectedProviderForLink = provider;
      elements.providerLinkConfirmButton.disabled = false;
      elements.providerLinkModalStatus.textContent = `Seleccionado: ${provider.empresa}`;
      elements.providerLinkModalStatus.classList.remove('error');
      renderProviderLinkCandidates();
    });
    elements.providerLinkGrid.appendChild(button);
  });

  if (!candidates.length) {
    const empty = document.createElement('p');
    empty.className = 'product-provider-empty';
    empty.textContent = 'No se encontraron proveedores con esa búsqueda.';
    elements.providerLinkGrid.appendChild(empty);
  }
}

async function loadProviderLinkCandidates() {
  if (providerLinkCandidates.length) {
    renderProviderLinkCandidates();
    return;
  }
  if (!providerLinkCandidatesRequest) {
    providerLinkCandidatesRequest = posApiRequest('/api/purchases/v2/providers')
      .then((result) => {
        providerLinkCandidates = Array.isArray(result?.data) ? result.data : [];
        return providerLinkCandidates;
      })
      .finally(() => { providerLinkCandidatesRequest = null; });
  }
  elements.providerLinkModalStatus.textContent = 'Cargando proveedores…';
  await providerLinkCandidatesRequest;
  elements.providerLinkModalStatus.textContent = `${providerLinkCandidates.length} proveedores disponibles`;
  renderProviderLinkCandidates();
}

function closeProviderLinking() {
  elements.providerLinkModal.hidden = true;
  selectedProviderForLink = null;
  elements.providerLinkConfirmButton.disabled = true;
  elements.providerLinkSearchInput.value = '';
}

async function openProviderLinking() {
  if (!currentDraft) return;
  selectedProviderForLink = null;
  elements.providerLinkConfirmButton.disabled = true;
  elements.providerLinkXmlName.textContent = currentDraft.provider?.trade_name || currentDraft.provider?.legal_name || 'Proveedor sin nombre';
  elements.providerLinkXmlTaxId.textContent = `RUC ${currentDraft.provider?.tax_id || 'no informado'}`;
  elements.providerLinkModalStatus.classList.remove('error');
  elements.providerLinkModal.hidden = false;
  elements.providerLinkSearchInput.focus();
  try {
    await loadProviderLinkCandidates();
  } catch (error) {
    elements.providerLinkModalStatus.textContent = error.message;
    elements.providerLinkModalStatus.classList.add('error');
  }
}

async function confirmProviderLinking() {
  if (!currentDraft || !selectedProviderForLink) return;
  const selected = selectedProviderForLink;
  elements.providerLinkConfirmButton.disabled = true;
  elements.providerLinkConfirmButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Vinculando';
  elements.providerLinkModalStatus.classList.remove('error');
  try {
    const result = await posApiRequest('/api/purchases/v2/providers/link-xml', {
      method: 'POST',
      body: JSON.stringify({
        proveedor_id: selected.id,
        ruc: currentDraft.provider?.tax_id,
        razon_social: currentDraft.provider?.legal_name
      })
    });
    matchedProvider = result.data;
    currentDraft.provider.match = { status: 'MATCHED', provider_id: matchedProvider.id };
    setText('providerName', matchedProvider.empresa);
    setProviderMatch('matched', `Vinculado como ${matchedProvider.empresa}`);
    providerLinkCandidates = providerLinkCandidates.map((provider) => provider.id === matchedProvider.id ? matchedProvider : provider);
    closeProviderLinking();
    const continuation = providerLinkContinuation;
    providerLinkContinuation = null;
    if (continuation === 'mobile-preview') {
      await previewMobileDocument();
    } else if (continuation === 'mobile-save') {
      await confirmMobileDocument();
    } else if (continuation === 'desktop-preview') {
      await captureDesktopDocument({ preview: true });
    } else if (continuation === 'desktop-capture') {
      await captureDesktopDocument({ preview: false });
    }
  } catch (error) {
    elements.providerLinkModalStatus.textContent = error.message;
    elements.providerLinkModalStatus.classList.add('error');
    elements.providerLinkConfirmButton.disabled = false;
  } finally {
    elements.providerLinkConfirmButton.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i> Vincular';
  }
}

elements.providerLinkButton.addEventListener('click', openProviderLinking);
elements.providerLinkCloseButton.addEventListener('click', closeProviderLinking);
elements.providerLinkCancelButton.addEventListener('click', closeProviderLinking);
elements.providerLinkConfirmButton.addEventListener('click', confirmProviderLinking);
elements.providerLinkSearchInput.addEventListener('input', renderProviderLinkCandidates);
elements.providerLinkModal.addEventListener('click', (event) => {
  if (event.target === elements.providerLinkModal) closeProviderLinking();
});
window.addEventListener('pagehide', saveInvoiceDraftNow);
window.addEventListener('pagehide', stopScanner);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScanner();
  else if (!IS_MOBILE_DEVICE) loadPendingDocuments({ silent: true });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.providerLinkModal.hidden) closeProviderLinking();
});

elements.continueEntryButton.addEventListener('click', async () => {
  if (!currentDraft || !matchedProvider) return;
  elements.continueEntryButton.disabled = true;
  elements.continueEntryButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Preparando';
  try {
    await switchAppModule('provider-entry');
    history.replaceState(null, '', '#ingreso-facturas');
    document.querySelectorAll('[data-app-module]').forEach((item) => {
      const active = item.dataset.appModule === 'invoice-import';
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    await waitForManualEntry();
    window.iniciarIngresoFacturaDesdeXml(currentDraft, matchedProvider);
    markManualInvoiceFlow();
  } catch (error) {
    document.querySelector('[data-module-panel="invoice-import"]').hidden = false;
    document.querySelector('[data-module-panel="providers"]').hidden = true;
    showError(error.message);
  } finally {
    elements.continueEntryButton.innerHTML = '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> Continuar ingreso';
    updateContinueEntryState();
  }
});

window.completePendingPurchaseDocument = async (invoiceId = null) => {
  const documentId = currentPendingDocumentId;
  if (!documentId) return { completed: false, reason: 'no_pending_document' };
  const result = await posApiRequest(`/api/purchases/v2/documents/${encodeURIComponent(documentId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ factura_id: invoiceId })
  });
  currentPendingDocumentId = null;
  forgetDraftForKey(currentDraft?.tax_information?.access_key);
  return result.data;
};

updateKeyState();
updateMobileKeyState();
initializeVersioning();
initializeSession();
