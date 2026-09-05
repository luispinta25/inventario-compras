'use strict';

// Comparador de precios: módulo nativo de Inventario y Compras.
// Solo lectura. Los datos llegan por el backend autenticado
// (`GET /api/purchases/v2/inventory/search`); no consulta Supabase directamente
// ni usa manejadores en línea.
(function () {
  const IVA_RATE = 0.15;
  const MARGEN = 0.38;
  const RENTA = 0.02;
  const SEARCH_DEBOUNCE_MS = 250;
  const MIN_QUERY_LENGTH = 2;

  const money = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' });

  let listenersBound = false;
  let searchTimer = null;
  let searchToken = 0;
  let lastResults = [];
  let selected = null;
  let withTax = true;

  const el = (id) => document.getElementById(id);

  function setStatus(message) {
    const node = el('comparatorStatus');
    if (node) node.textContent = message || '';
  }

  function toDisplayCost(rawCost) {
    return withTax ? rawCost * (1 + IVA_RATE) : rawCost;
  }

  function suggestedSellingPrice(displayCost) {
    const withTaxBase = withTax ? displayCost : displayCost * (1 + IVA_RATE);
    return withTaxBase * (1 + MARGEN) * (1 + RENTA);
  }

  function clearResults() {
    const container = el('comparatorResults');
    if (!container) return;
    container.replaceChildren();
    container.hidden = true;
  }

  function renderResults(results) {
    const container = el('comparatorResults');
    if (!container) return;
    container.replaceChildren();

    if (!results.length) {
      const empty = document.createElement('p');
      empty.className = 'comparator-empty';
      empty.textContent = 'Sin coincidencias. Prueba con otro código o nombre.';
      container.append(empty);
      container.hidden = false;
      return;
    }

    for (const item of results) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'comparator-result';
      row.dataset.codigo = item.codigo;

      const info = document.createElement('span');
      info.className = 'comparator-result-info';

      const name = document.createElement('strong');
      name.textContent = item.nombre;

      const meta = document.createElement('span');
      meta.className = 'comparator-result-meta';
      meta.textContent = `Código ${item.codigo} · ${item.proveedor}`;

      const price = document.createElement('span');
      price.className = 'comparator-result-price';
      price.textContent = `${withTax ? 'Con IVA' : 'Sin IVA'}: ${money.format(toDisplayCost(item.costo))}`;

      info.append(name, meta, price);

      const chevron = document.createElement('i');
      chevron.className = 'fa-solid fa-arrow-right';
      chevron.setAttribute('aria-hidden', 'true');

      row.append(info, chevron);
      container.append(row);
    }
    container.hidden = false;
  }

  async function runSearch(rawQuery) {
    const query = rawQuery.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      clearResults();
      setStatus('');
      return;
    }

    const token = ++searchToken;
    setStatus('Buscando…');
    try {
      const response = await window.posApiRequest(
        `/api/purchases/v2/inventory/search?query=${encodeURIComponent(query)}`
      );
      if (token !== searchToken) return;
      lastResults = (response?.data || []).map((item) => ({
        codigo: String(item.codigo ?? ''),
        nombre: String(item.producto ?? item.nombre ?? '').trim() || 'Producto sin nombre',
        costo: Number(item.precio_proveedor) || 0,
        proveedor: String(item.proveedor_nombre || '').trim() || 'Sin proveedor'
      }));
      renderResults(lastResults);
      setStatus(lastResults.length ? `${lastResults.length} resultado(s)` : '');
    } catch (error) {
      if (token !== searchToken) return;
      clearResults();
      setStatus(error.message || 'No fue posible buscar productos.');
    }
  }

  function scheduleSearch(value) {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
  }

  function selectByCode(codigo) {
    const product = lastResults.find((item) => item.codigo === codigo);
    if (!product) return;
    selected = product;

    el('comparatorCode').textContent = product.codigo;
    el('comparatorName').textContent = product.nombre;
    el('comparatorProvider').textContent = product.proveedor;
    renderCurrentPrice();

    clearResults();
    setStatus('');
    el('comparatorSearch').value = '';
    el('comparatorNewPrice').value = '';
    el('comparatorVerdict').hidden = true;
    el('comparatorAnalysis').hidden = false;
    el('comparatorNewPrice').focus();
  }

  function renderCurrentPrice() {
    if (!selected) return;
    el('comparatorTaxNote').textContent = withTax ? '(con IVA)' : '(sin IVA)';
    el('comparatorCurrentPrice').textContent = money.format(toDisplayCost(selected.costo));
  }

  function clearSelection() {
    selected = null;
    el('comparatorAnalysis').hidden = true;
    el('comparatorVerdict').hidden = true;
    el('comparatorNewPrice').value = '';
    el('comparatorSearch').focus();
  }

  function updateVerdict() {
    const verdict = el('comparatorVerdict');
    const newValue = parseFloat(el('comparatorNewPrice').value);
    if (!selected || !Number.isFinite(newValue) || newValue <= 0) {
      verdict.hidden = true;
      return;
    }

    const currentDisplay = toDisplayCost(selected.costo);
    const diffPercent = ((newValue - currentDisplay) / currentDisplay) * 100;

    const messageNode = el('comparatorVerdictMessage');
    verdict.classList.remove('is-better', 'is-worse', 'is-equal');
    if (newValue < currentDisplay) {
      messageNode.textContent = `Ahorro del ${Math.abs(diffPercent).toFixed(1)} %`;
      verdict.classList.add('is-better');
    } else if (newValue > currentDisplay) {
      messageNode.textContent = `Más caro en ${diffPercent.toFixed(1)} %`;
      verdict.classList.add('is-worse');
    } else {
      messageNode.textContent = 'Mismo costo';
      verdict.classList.add('is-equal');
    }

    el('comparatorVerdictCurrent').textContent = money.format(currentDisplay);
    el('comparatorVerdictNew').textContent = money.format(newValue);

    const sellingCurrent = suggestedSellingPrice(currentDisplay);
    const sellingNew = suggestedSellingPrice(newValue);
    el('comparatorSellingCurrent').textContent = money.format(sellingCurrent);

    const sellingNewNode = el('comparatorSellingNew');
    sellingNewNode.textContent = money.format(sellingNew);
    sellingNewNode.classList.toggle('is-better', sellingNew < sellingCurrent);
    sellingNewNode.classList.toggle('is-worse', sellingNew > sellingCurrent);

    verdict.hidden = false;
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;

    el('comparatorSearch').addEventListener('input', (event) => scheduleSearch(event.target.value));
    el('comparatorSearch').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      window.clearTimeout(searchTimer);
      const value = event.target.value.trim();
      const exact = lastResults.find((item) => item.codigo === value);
      if (exact) selectByCode(exact.codigo);
      else if (lastResults.length === 1) selectByCode(lastResults[0].codigo);
      else runSearch(value);
    });

    el('comparatorResults').addEventListener('click', (event) => {
      const row = event.target.closest('.comparator-result');
      if (row) selectByCode(row.dataset.codigo);
    });

    el('comparatorNewPrice').addEventListener('input', updateVerdict);
    el('comparatorClear').addEventListener('click', clearSelection);

    document.querySelectorAll('input[name="comparatorTax"]').forEach((radio) => {
      radio.addEventListener('change', (event) => {
        withTax = event.target.value === 'con';
        if (selected) renderCurrentPrice();
        updateVerdict();
        if (lastResults.length && !el('comparatorResults').hidden) renderResults(lastResults);
      });
    });
  }

  async function initComparador() {
    bindListeners();
    withTax = (document.querySelector('input[name="comparatorTax"]:checked')?.value ?? 'con') === 'con';
    lastResults = [];
    selected = null;
    clearResults();
    setStatus('');
    el('comparatorAnalysis').hidden = true;
    el('comparatorSearch').value = '';
    el('comparatorSearch').focus();
  }

  window.initComparador = initComparador;
})();
