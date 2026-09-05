'use strict';

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
  'continueEntryButton', 'providerLinkSection', 'providerLinkButton',
  'invoiceFields', 'providerLinkModal', 'providerLinkCloseButton', 'providerLinkCancelButton',
  'providerLinkConfirmButton', 'providerLinkSearchInput', 'providerLinkGrid',
  'providerLinkModalStatus', 'providerLinkXmlName', 'providerLinkXmlTaxId',
  'accessRow', 'totalsStrip', 'itemsSection'
].map((id) => [id, document.getElementById(id)]));

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
const internalProductLookupCache = new Map();
const internalProductSearchCache = new Map();
let internalProductCatalog = [];
let internalProductCatalogRequest = null;
const INTERNAL_PRODUCT_CACHE_KEY = 'inventario-compras:catalogo:v1';
const INVOICE_DRAFT_CACHE_KEY = 'inventario-compras:factura-borrador:v1';
const INVOICE_FLOW_CACHE_KEY = 'inventario-compras:factura-flujo:v1';
const LEGACY_INVOICE_CACHE_KEY = 'ingresoFacturaCache';
const INVOICE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const XML_GAIN_OPTIONS = [20, 28, 30, 35, 38, 45, 50];
let invoiceDraftSaveTimer = null;

function readLocalCache(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value || Date.now() - Number(value.savedAt || Date.parse(value.timestamp)) > INVOICE_CACHE_TTL_MS) {
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

function saveInvoiceDraftNow() {
  window.clearTimeout(invoiceDraftSaveTimer);
  invoiceDraftSaveTimer = null;
  if (!currentDraft || !currentSession?.user?.id) return;
  try {
    localStorage.setItem(INVOICE_DRAFT_CACHE_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      userId: currentSession.user.id,
      draft: currentDraft
    }));
  } catch (error) {
    console.warn('[inventario-compras] No se pudo guardar el borrador:', error.message);
  }
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
      stage: 'manual-entry'
    }));
  } catch (_) { /* La restauración es auxiliar si el almacenamiento está lleno. */ }
}

function clearInvoiceIntakeCache() {
  window.clearTimeout(invoiceDraftSaveTimer);
  invoiceDraftSaveTimer = null;
  try {
    localStorage.removeItem(INVOICE_DRAFT_CACHE_KEY);
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
  const cached = readLocalCache(INVOICE_DRAFT_CACHE_KEY);
  if (!cached?.draft) return false;
  elements.accessKeyInput.value = cached.draft.tax_information?.access_key || '';
  updateKeyState();
  await renderDraft(cached.draft);
  return true;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

async function posApiRequest(path, options = {}) {
  const { data, error } = await db.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error('Sesión no disponible para llamar al backend seguro.');

  const response = await fetch(`${POS_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
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
  posApiRequest
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
  return {
    '#ingreso-facturas': 'invoice-import',
    '#dashboard': 'provider-dashboard',
    '#facturas': 'provider-invoices',
    '#comparador': 'provider-comparator',
    '#producto-proveedores': 'product-providers'
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
  const restoreManualEntry = hasRestorableManualInvoice();
  const initialModule = restoreManualEntry ? 'provider-entry' : moduleFromHash();
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
    await db.auth.signOut();
  } finally {
    clearInvoiceIntakeCache();
    resetInvoice();
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

async function switchAppModule(moduleName) {
  const providerModes = {
    'provider-dashboard': 'dashboard',
    'provider-invoices': 'facturas',
    'provider-entry': 'productos',
    'provider-comparator': 'comparador'
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
  if (internalProductCatalog.length || internalProductCatalogRequest) return internalProductCatalogRequest;
  if (readCachedInternalProductCatalog()) return Promise.resolve(internalProductCatalog);
  internalProductCatalogRequest = db
    .from('ferre_inventario')
    .select('id, codigo, producto, unidad_paquete, precio, precio_proveedor, zona')
    .order('codigo', { ascending: true })
    .then(({ data, error }) => {
      if (error) throw error;
      internalProductCatalog = data || [];
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
  if (!relationId || !window.confirm('¿Desvincular este producto de este proveedor? Solo se eliminará la relación.')) return;
  button.disabled = true;
  try {
    await posApiRequest(`/api/purchases/v2/product-providers/${encodeURIComponent(relationId)}`, { method: 'DELETE' });
    await loadProductProviders({ force: true });
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
});

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
        });
        priceInput.addEventListener('input', () => {
          const value = Number(priceInput.value);
          if (Number.isFinite(value) && value >= 0) item.sale_price = Math.round(value * 100) / 100;
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
  return fetch(path, {
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
    const result = await response.json();
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
    showError(error.message);
    return false;
  } finally {
    setBusy(false);
  }
}

function resetInvoice() {
  clearInvoiceIntakeCache();
  currentDraft = null;
  matchedProvider = null;
  attemptedKey = '';
  failedSriAttempts = 0;
  elements.accessKeyInput.value = '';
  elements.xmlFileInput.value = '';
  elements.review.hidden = true;
  clearError();
  updateKeyState();
  if (!elements.appShell.hidden) elements.accessKeyInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

elements.accessKeyInput.addEventListener('input', updateKeyState);
elements.accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = elements.accessKeyInput.value;
  if (!isValidAccessKey(key)) return;
  const succeeded = await requestPreview('/api/sri/fetch', { access_key: key });
  if (succeeded) failedSriAttempts = 0;
  else if (elements.accessKeyInput.value === attemptedKey) failedSriAttempts += 1;
  updateKeyState();
});
elements.clearKeyButton.addEventListener('click', resetInvoice);
elements.sampleButton.addEventListener('click', () => requestPreview('/api/sample'));
elements.resetButton.addEventListener('click', resetInvoice);
elements.uploadButton.addEventListener('click', () => elements.xmlFileInput.click());
elements.xmlFileInput.addEventListener('change', async () => {
  const file = elements.xmlFileInput.files[0];
  elements.xmlFileInput.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return showError('El archivo supera el límite de 5 MB.');
  if (!file.name.toLowerCase().endsWith('.xml')) return showError('Selecciona un archivo XML.');
  const succeeded = await requestPreview('/api/xml/preview', {
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

updateKeyState();
initializeSession();
