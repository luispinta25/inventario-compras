'use strict';

// Compra express: compra informal en efectivo al contado a un proveedor que no
// emite factura (sin RUC vinculado). Se cargan productos escaneando o buscando,
// con precio de compra y de venta; al registrar sube el stock y la factura
// queda pagada. Sin IVA. Todo pasa por inventory-api (POST /v2/express).
(function () {
  const API = '/api/purchases/v2/express';
  const PROVIDERS_API = '/api/purchases/v2/providers';
  const MARGEN_SUGERIDO = 0.38;
  const UNIDADES = ['UNIDADES', 'CAJA', 'PAQUETES', 'PAR', 'FUNDA', 'CIENTOS', 'ENTERO',
    'LITROS', 'GALONES', 'LIBRAS', 'METROS', 'ROLLOS'];

  const state = {
    bound: false,
    providersLoaded: false,
    providers: [],
    items: [],
    idem: null,
    reader: null
  };

  const el = (id) => document.getElementById(id);
  const money = (v) => window.app.formatCurrency(Number(v) || 0);
  const num = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

  function newIdem() {
    const rnd = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID().replace(/-/g, '')
      : (Date.now().toString(36) + Math.random().toString(36).slice(2)).padEnd(40, '0').slice(0, 40);
    return `express:${rnd}`;
  }

  function catalog() {
    try { return window.app.inventoryCatalog.get() || []; } catch (_) { return []; }
  }

  function suggestVenta(costo) {
    const c = Number(costo) || 0;
    if (c <= 0) return 0;
    return round2(c * (1 + MARGEN_SUGERIDO));
  }

  // ---- Proveedores (solo sin RUC vinculado) -----------------------------
  async function loadProviders() {
    const select = el('expProveedor');
    try {
      const response = await window.app.posApiRequest(PROVIDERS_API, { method: 'GET' });
      const rows = Array.isArray(response?.data) ? response.data : [];
      state.providers = rows
        .filter((p) => !String(p.ruc || '').trim() && !(Array.isArray(p.emisores) && p.emisores.length))
        .map((p) => ({ id: p.id, empresa: p.empresa || p.razon_social || 'Proveedor' }))
        .sort((a, b) => a.empresa.localeCompare(b.empresa, 'es'));
      select.replaceChildren();
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = state.providers.length ? 'Selecciona un proveedor…' : 'No hay proveedores sin RUC';
      select.appendChild(ph);
      state.providers.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.empresa;
        select.appendChild(o);
      });
      state.providersLoaded = true;
    } catch (error) {
      select.replaceChildren();
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'No fue posible cargar proveedores';
      select.appendChild(o);
    }
  }

  function providerName() {
    const id = el('expProveedor').value;
    return state.providers.find((p) => p.id === id)?.empresa || '';
  }

  // ---- Agregar productos ------------------------------------------------
  function findByCodigo(codigo) {
    const c = String(codigo || '').trim().toLowerCase();
    if (!c) return null;
    return catalog().find((p) => String(p.codigo || '').trim().toLowerCase() === c) || null;
  }

  function searchByText(query) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    try {
      const ranked = window.app.inventoryCatalog.rank(q);
      if (Array.isArray(ranked) && ranked.length) return ranked.slice(0, 8);
    } catch (_) { /* fallback abajo */ }
    const nq = q.toLowerCase();
    return catalog().filter((p) => `${p.codigo} ${p.producto}`.toLowerCase().includes(nq)).slice(0, 8);
  }

  function addExisting(product) {
    const existing = state.items.find((it) => it.inventory_id === product.id);
    if (existing) {
      existing.cantidad = round2(existing.cantidad + 1);
    } else {
      state.items.push({
        inventory_id: product.id,
        codigo: product.codigo || '',
        nombre: product.producto || '',
        cantidad: 1,
        costo: round2(product.precio_proveedor || 0),
        precio_venta: round2(product.precio || 0),
        ventaEditada: true,
        es_nuevo: false,
        zona: product.zona || null,
        unidad: product.unidad_paquete || 'UNIDADES'
      });
    }
    el('expScanInput').value = '';
    el('expSearchResults').hidden = true;
    render();
  }

  function addNew(codigo) {
    state.items.push({
      inventory_id: null,
      codigo: String(codigo || '').trim(),
      nombre: '',
      cantidad: 1,
      costo: 0,
      precio_venta: 0,
      ventaEditada: false,
      es_nuevo: true,
      zona: null,
      unidad: 'UNIDADES'
    });
    el('expScanInput').value = '';
    el('expSearchResults').hidden = true;
    render();
  }

  function handleInput(rawValue, { fromScanner = false } = {}) {
    const raw = String(rawValue || '').trim();
    if (!raw) return;
    const exact = findByCodigo(raw);
    if (exact) { addExisting(exact); return; }
    const looksLikeBarcode = /^[0-9]{6,}$/.test(raw);
    if (looksLikeBarcode || fromScanner) {
      addNew(raw);
      showError('Producto nuevo: completa nombre, zona y precio de venta en la fila.');
      return;
    }
    const results = searchByText(raw);
    if (results.length === 1) { addExisting(results[0]); return; }
    renderResults(results, raw);
  }

  function renderResults(list, query) {
    const box = el('expSearchResults');
    box.replaceChildren();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'express-search-empty';
      p.textContent = `Sin coincidencias para “${query}”. Escanea el código para crearlo como producto nuevo.`;
      box.appendChild(p);
      box.hidden = false;
      return;
    }
    list.forEach((product) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'express-search-item';
      btn.innerHTML = `<strong>${esc(product.codigo || '-')}</strong> · ${esc(product.producto || '')}`
        + `<span>P. compra ${money(product.precio_proveedor)} · P. venta ${money(product.precio)}</span>`;
      btn.addEventListener('click', () => addExisting(product));
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  // Escapa para uso seguro tanto en texto como en atributos (incluye comillas).
  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  // ---- Render de la tabla ---------------------------------------------------
  function zonaSelect(idx, current) {
    const opts = ['<option value="">Zona…</option>'];
    for (let z = 1; z <= 18; z += 1) opts.push(`<option value="${z}"${Number(current) === z ? ' selected' : ''}>Zona ${z}</option>`);
    return `<select data-idx="${idx}" data-field="zona" class="express-mini-select">${opts.join('')}</select>`;
  }

  function unidadSelect(idx, current) {
    const cur = String(current || 'UNIDADES').toUpperCase();
    const opts = UNIDADES.map((u) => `<option value="${u}"${u === cur ? ' selected' : ''}>${u}</option>`);
    return `<select data-idx="${idx}" data-field="unidad" class="express-mini-select">${opts.join('')}</select>`;
  }

  function render() {
    const body = el('expBody');
    body.replaceChildren();
    state.items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      if (it.es_nuevo) tr.className = 'is-new';
      const productoCell = it.es_nuevo
        ? `<input type="text" data-idx="${idx}" data-field="nombre" value="${esc(it.nombre)}" placeholder="Nombre del producto nuevo" class="express-name-input">`
          + `<div class="express-new-extra">${zonaSelect(idx, it.zona)} ${unidadSelect(idx, it.unidad)}</div>`
        : esc(it.nombre);
      tr.innerHTML = `
        <td class="express-code">${esc(it.codigo || '-')}${it.es_nuevo ? '<span class="express-tag">nuevo</span>' : ''}</td>
        <td class="express-product">${productoCell}</td>
        <td class="number"><input type="number" min="0.001" step="0.001" inputmode="decimal" data-idx="${idx}" data-field="cantidad" value="${it.cantidad}"></td>
        <td class="number"><input type="number" min="0" step="0.01" inputmode="decimal" data-idx="${idx}" data-field="costo" value="${Number(it.costo).toFixed(2)}"></td>
        <td class="number"><input type="number" min="0" step="0.01" inputmode="decimal" data-idx="${idx}" data-field="precio_venta" value="${Number(it.precio_venta).toFixed(2)}"></td>
        <td class="number express-subtotal">${money(round2(it.cantidad * it.costo))}</td>
        <td><button type="button" class="express-remove" data-idx="${idx}" aria-label="Quitar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></td>`;
      body.appendChild(tr);
    });
    recompute();
  }

  function recompute() {
    const total = state.items.reduce((sum, it) => sum + round2(it.cantidad * it.costo), 0);
    el('expTotal').textContent = money(round2(total));
    el('expLineCount').textContent = String(state.items.length);
    el('expEmpty').hidden = state.items.length > 0;
    const ready = state.items.length > 0 && !!el('expProveedor').value && round2(total) > 0;
    el('expSubmit').disabled = !ready;
  }

  function onFieldInput(event) {
    const target = event.target;
    const idx = Number(target.dataset.idx);
    const field = target.dataset.field;
    const it = state.items[idx];
    if (!it || !field) return;
    if (field === 'nombre') { it.nombre = target.value; return; }
    if (field === 'unidad') { it.unidad = target.value; return; }
    if (field === 'zona') { it.zona = target.value ? Number(target.value) : null; return; }
    const value = num(target.value);
    if (field === 'cantidad') it.cantidad = value;
    else if (field === 'costo') {
      it.costo = value;
      if (!it.ventaEditada) {
        it.precio_venta = suggestVenta(value);
        const ventaInput = el('expBody').querySelector(`[data-idx="${idx}"][data-field="precio_venta"]`);
        if (ventaInput) ventaInput.value = it.precio_venta.toFixed(2);
      }
    } else if (field === 'precio_venta') {
      it.precio_venta = value;
      it.ventaEditada = true;
    }
    const sub = target.closest('tr')?.querySelector('.express-subtotal');
    if (sub) sub.textContent = money(round2(it.cantidad * it.costo));
    recompute();
  }

  function removeItem(idx) {
    state.items.splice(idx, 1);
    render();
  }

  function clearAll() {
    state.items = [];
    el('expNotas').value = '';
    el('expSearchResults').hidden = true;
    hideError();
    render();
  }

  // ---- Escáner de código de barras ------------------------------------------
  function createReader() {
    const zx = window.ZXingBrowser;
    if (!zx || !zx.BrowserMultiFormatReader) return null;
    try {
      const { DecodeHintType, BarcodeFormat } = zx;
      if (DecodeHintType && BarcodeFormat) {
        const hints = new Map();
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE
        ]);
        return new zx.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      }
    } catch (_) { /* lector por defecto */ }
    return new zx.BrowserMultiFormatReader();
  }

  async function startScan() {
    hideError();
    if (state.reader) return;
    const reader = createReader();
    if (!reader) { showError('El lector de códigos no está disponible en este navegador.'); return; }
    state.reader = reader;
    el('expScannerWrap').hidden = false;
    try {
      await reader.decodeFromVideoDevice(undefined, el('expScannerVideo'), (result) => {
        if (!result) return;
        const text = String(result.getText ? result.getText() : result).trim();
        if (text) { stopScan(); handleInput(text, { fromScanner: true }); }
      });
    } catch (error) {
      stopScan();
      showError('No se pudo abrir la cámara.');
    }
  }

  function stopScan() {
    try { state.reader?.reset(); } catch (_) { /* noop */ }
    state.reader = null;
    el('expScannerWrap').hidden = true;
  }

  // ---- Guardar -----------------------------------------------------------
  function showError(msg) { const b = el('expError'); b.textContent = msg; b.hidden = false; }
  function hideError() { el('expError').hidden = true; }

  function validate() {
    if (!el('expProveedor').value) return 'Selecciona el proveedor.';
    if (!state.items.length) return 'Agrega al menos un producto.';
    for (const it of state.items) {
      if (!(it.cantidad > 0)) return `Cantidad inválida en ${it.codigo || it.nombre || 'un producto'}.`;
      if (!(it.costo >= 0)) return `Precio de compra inválido en ${it.codigo || it.nombre}.`;
      if (it.es_nuevo) {
        if (!String(it.nombre).trim()) return `Falta el nombre del producto nuevo ${it.codigo}.`;
        if (!it.zona) return `Falta la zona del producto nuevo ${it.codigo}.`;
        if (!(it.precio_venta > 0)) return `Falta el precio de venta del producto nuevo ${it.codigo}.`;
      }
    }
    const total = state.items.reduce((s, it) => s + round2(it.cantidad * it.costo), 0);
    if (!(round2(total) > 0)) return 'El total debe ser mayor a 0.';
    return null;
  }

  async function submit() {
    hideError();
    const err = validate();
    if (err) { showError(err); return; }
    const total = round2(state.items.reduce((s, it) => s + round2(it.cantidad * it.costo), 0));
    const confirmed = await window.app.askConfirm(
      `Registrar la compra express de ${money(total)} a ${providerName()}? Se paga en efectivo y el stock sube de inmediato.`,
      { confirmText: 'Registrar y pagar' }
    );
    if (!confirmed) return;

    if (!state.idem) state.idem = newIdem();
    const btn = el('expSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Registrando';
    try {
      const response = await window.app.posApiRequest(API, {
        method: 'POST',
        body: JSON.stringify({
          provider_id: el('expProveedor').value,
          notas: el('expNotas').value.trim() || undefined,
          idempotency_key: state.idem,
          items: state.items.map((it) => ({
            inventory_id: it.inventory_id || undefined,
            codigo: it.codigo || undefined,
            nombre: it.es_nuevo ? it.nombre.trim() : undefined,
            cantidad: it.cantidad,
            costo: round2(it.costo),
            precio_venta: it.precio_venta > 0 ? round2(it.precio_venta) : undefined,
            zona: it.es_nuevo ? it.zona : undefined,
            unidad_paquete: it.es_nuevo ? it.unidad : undefined
          }))
        })
      });
      const data = response?.data || {};
      state.idem = newIdem();
      state.items = [];
      el('expNotas').value = '';
      render();
      await window.app.askAlert(
        `Compra ${data.numero_factura || 'express'} registrada y pagada por ${money(data.total ?? total)}. `
        + `${data.productos_nuevos || 0} productos nuevos, ${data.productos_actualizados || 0} actualizados.`
      );
    } catch (error) {
      showError(error?.message || 'No fue posible registrar la compra.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cash-register" aria-hidden="true"></i> Registrar compra pagada';
    }
  }

  // ---- Wiring ---------------------------------------------------------------
  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    state.idem = newIdem();

    el('expProveedor').addEventListener('change', recompute);
    el('expScanButton').addEventListener('click', () => (state.reader ? stopScan() : startScan()));
    el('expScannerStop').addEventListener('click', stopScan);
    el('expAddButton').addEventListener('click', () => handleInput(el('expScanInput').value));
    el('expScanInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); handleInput(el('expScanInput').value); }
    });
    el('expBody').addEventListener('input', onFieldInput);
    el('expBody').addEventListener('change', onFieldInput);
    el('expBody').addEventListener('click', (event) => {
      const rm = event.target.closest('.express-remove');
      if (rm) removeItem(Number(rm.dataset.idx));
    });
    el('expClear').addEventListener('click', clearAll);
    el('expSubmit').addEventListener('click', submit);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.reader) stopScan();
    });
  }

  window.initCompraExpress = async function initCompraExpress() {
    bindOnce();
    try { await window.app.inventoryCatalog.preload(); } catch (_) { /* se reintenta al buscar */ }
    if (!state.providersLoaded) await loadProviders();
    render();
  };
})();
