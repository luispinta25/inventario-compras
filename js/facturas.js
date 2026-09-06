'use strict';

// Gestión de facturas registradas (reconstrucción nativa del módulo heredado
// "proveedores"). Solo la vista de Facturas: lista con filtros, detalle,
// historial de pagos, productos y registro de pagos. El Dashboard se rebuilds
// aparte. Sin db.from() en el navegador: todo pasa por inventory-api.
(function () {
  const API = '/api/purchases/v2/invoices';
  const WHATSAPP_API = '/api/whatsapp/send-text';
  const PAYMENT_IVA = 1.15;

  const VISIT_BUCKET_TITLES = [
    'Por vencer',
    'Vencidas: 1 a 30 días',
    'Vencidas: 31 a 60 días',
    'Vencidas: más de 60 días'
  ];

  const state = {
    bound: false,
    loading: false,
    items: [],
    providers: [],
    providersLoaded: false,
    current: null,
    visitToken: 0
  };

  const el = (id) => document.getElementById(id);
  const money = (value) => window.app.formatCurrency(Number(value) || 0);

  function fmtDate(value) {
    if (!value) return '-';
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : String(value);
  }

  function fmtDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : String(value);
  }

  function estadoClass(estado) {
    if (estado === 'Pendiente') return 'is-pendiente';
    if (estado === 'Abonada') return 'is-abonada';
    if (estado === 'Pagada') return 'is-pagada';
    return '';
  }

  function vencimientoLabel(invoice) {
    if (invoice.archivada) return 'Datos archivados';
    if (invoice.dias_vencimiento == null) return 'Sin fecha de vencimiento';
    if (invoice.esta_vencida) return `Vencida hace ${Math.abs(invoice.dias_vencimiento)} días`;
    return `Vence en ${invoice.dias_vencimiento} días`;
  }

  // ---- Lista -------------------------------------------------------------
  async function loadInvoices() {
    if (state.loading) return;
    state.loading = true;
    const grid = el('invoicesGrid');
    const summary = el('invoicesSummary');
    summary.textContent = 'Cargando facturas…';
    try {
      const proveedor = el('invProveedorFilter').value;
      const estado = el('invEstadoFilter').value;
      const params = new URLSearchParams({ estado });
      if (proveedor && proveedor !== 'todos') params.set('proveedor_id', proveedor);
      const response = await window.app.posApiRequest(`${API}?${params.toString()}`, { method: 'GET' });
      const data = response?.data || {};
      state.items = Array.isArray(data.items) ? data.items : [];

      if (Array.isArray(data.providers) && data.providers.length) {
        state.providers = data.providers;
      }
      if (!state.providersLoaded && state.providers.length) {
        fillProviderFilter(state.providers);
        fillVisitProviders(state.providers);
        state.providersLoaded = true;
      }

      renderTotals(data.totals || {});
      renderGrid();
      summary.textContent = state.items.length === 1
        ? '1 factura'
        : `${state.items.length} facturas`;
    } catch (error) {
      state.items = [];
      grid.replaceChildren();
      summary.textContent = error?.message || 'No fue posible cargar las facturas.';
    } finally {
      state.loading = false;
    }
  }

  function fillProviderFilter(providers) {
    const select = el('invProveedorFilter');
    const current = select.value;
    select.replaceChildren();
    const todos = document.createElement('option');
    todos.value = 'todos';
    todos.textContent = 'Todos los proveedores';
    select.appendChild(todos);
    providers
      .slice()
      .sort((a, b) => String(a.empresa || '').localeCompare(String(b.empresa || ''), 'es'))
      .forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.empresa || 'Proveedor';
        select.appendChild(option);
      });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderTotals(totals) {
    el('invTotalFacturas').textContent = money(totals.total_facturas);
    el('invTotalPendiente').textContent = money(totals.total_pendiente);
    el('invTotalVencido').textContent = money(totals.total_vencido);
  }

  function renderGrid() {
    const grid = el('invoicesGrid');
    grid.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('p');
      empty.className = 'invoices-empty';
      empty.textContent = 'No hay facturas para los filtros elegidos.';
      grid.appendChild(empty);
      return;
    }
    state.items.forEach((invoice) => grid.appendChild(invoiceCard(invoice)));
  }

  function row(label, value, valueClass) {
    const wrap = document.createElement('div');
    wrap.className = 'invoice-card-row';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('strong');
    val.textContent = value;
    if (valueClass) val.className = valueClass;
    wrap.append(key, val);
    return wrap;
  }

  function invoiceCard(invoice) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'invoice-card';
    if (invoice.archivada) card.classList.add('is-archived');
    card.dataset.invoiceId = invoice.id;

    const head = document.createElement('div');
    head.className = 'invoice-card-head';
    const number = document.createElement('span');
    number.className = 'invoice-card-number';
    number.textContent = invoice.numero_factura || 'Sin número';
    const badge = document.createElement('span');
    badge.className = `invoice-badge ${estadoClass(invoice.estado)}`;
    badge.textContent = invoice.estado || '-';
    head.append(number, badge);

    const body = document.createElement('div');
    body.className = 'invoice-card-body';
    body.append(
      row('Proveedor', invoice.proveedor_empresa || '-'),
      row('Total', money(invoice.total_factura)),
      row('Saldo', money(invoice.saldo_pendiente), invoice.saldo_pendiente > 0 ? 'is-info' : ''),
      row('Emisión', fmtDate(invoice.fecha_emision)),
      row('Vencimiento', fmtDate(invoice.fecha_vencimiento))
    );

    const foot = document.createElement('div');
    foot.className = 'invoice-card-foot';
    if (invoice.esta_vencida && !invoice.archivada) foot.classList.add('is-danger');
    foot.textContent = vencimientoLabel(invoice);

    card.append(head, body, foot);
    card.addEventListener('click', () => openInvoice(invoice.id));
    return card;
  }

  // ---- Detalle ---------------------------------------------------------------
  async function openInvoice(invoiceId) {
    const modal = el('invoiceModal');
    modal.hidden = false;
    setTab('detalles');
    el('invModalTitle').textContent = 'Cargando…';
    try {
      const response = await window.app.posApiRequest(`${API}/${encodeURIComponent(invoiceId)}`, { method: 'GET' });
      state.current = response?.data || null;
      if (!state.current?.invoice) throw new Error('No fue posible cargar la factura.');
      renderDetail(state.current);
    } catch (error) {
      closeModal();
      await window.app.askAlert(error?.message || 'No fue posible abrir la factura.');
    }
  }

  function renderDetail(payload) {
    const invoice = payload.invoice;
    el('invModalTitle').textContent = `Factura ${invoice.numero_factura || ''}`.trim();
    el('invDetNumero').textContent = invoice.numero_factura || '-';
    el('invDetProveedor').textContent = invoice.proveedor_empresa || '-';
    el('invDetEmision').textContent = fmtDate(invoice.fecha_emision);
    el('invDetVencimiento').textContent = fmtDate(invoice.fecha_vencimiento);
    el('invDetSubtotal').textContent = money(invoice.subtotal);
    el('invDetIva').textContent = money(invoice.iva);
    el('invDetDescuento').textContent = invoice.descuento ? `-${money(invoice.descuento)}` : money(0);
    el('invDetTotal').textContent = money(invoice.total_factura);
    el('invDetSaldo').textContent = money(invoice.saldo_pendiente);
    const estado = el('invDetEstado');
    estado.textContent = invoice.estado || '-';
    estado.className = `invoice-badge ${estadoClass(invoice.estado)}`;
    el('invDetDias').textContent = vencimientoLabel(invoice);
    el('invDetNotas').textContent = invoice.notas || 'Sin notas';

    renderHistorial(payload.pagos || []);
    renderProductos(payload.productos || []);
    preparePagoForm(invoice);
  }

  function renderHistorial(pagos) {
    const body = el('invHistorialBody');
    body.replaceChildren();
    el('invHistorialEmpty').hidden = pagos.length > 0;
    pagos.forEach((pago) => {
      const tr = document.createElement('tr');
      const cells = [
        fmtDateTime(pago.fecha_pago),
        money(pago.monto_pago),
        pago.metodo_pago || '-',
        pago.referencia_pago || '-',
        money(pago.saldo_nuevo)
      ];
      cells.forEach((text, index) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (index === 1 || index === 4) td.className = 'number';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function renderProductos(productos) {
    const body = el('invProductosBody');
    body.replaceChildren();
    el('invProductosEmpty').hidden = productos.length > 0;
    productos.forEach((producto) => {
      const precioIva = (Number(producto.precio_proveedor) || 0) * PAYMENT_IVA;
      const subtotalIva = (Number(producto.cantidad) || 0) * precioIva;
      const tr = document.createElement('tr');
      const cells = [
        producto.codigo_producto || '-',
        producto.nombre_producto || '-',
        (Number(producto.cantidad) || 0).toLocaleString('es-EC', { maximumFractionDigits: 2 }),
        money(precioIva),
        money(subtotalIva),
        producto.zona || '-'
      ];
      cells.forEach((text, index) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (index === 2 || index === 3 || index === 4) td.className = 'number';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  // ---- Registro de pagos ---------------------------------------------------
  function preparePagoForm(invoice) {
    const form = el('invPagoForm');
    form.reset();
    el('invPagoError').hidden = true;
    el('invPagoSaldo').textContent = money(invoice.saldo_pendiente);
    const monto = el('invPagoMonto');
    monto.max = String(invoice.saldo_pendiente);
    monto.placeholder = Number(invoice.saldo_pendiente || 0).toFixed(2);
    monto.readOnly = false;
    el('invPagoTipo').value = 'Abono';
    const settled = !(invoice.saldo_pendiente > 0) || invoice.archivada;
    el('invPagoSubmit').disabled = settled;
    el('invPagoForm').classList.toggle('is-locked', settled);
  }

  function syncPagoTipo() {
    const invoice = state.current?.invoice;
    if (!invoice) return;
    const monto = el('invPagoMonto');
    if (el('invPagoTipo').value === 'Total') {
      monto.value = Number(invoice.saldo_pendiente || 0).toFixed(2);
      monto.readOnly = true;
    } else {
      monto.readOnly = false;
      if (Number(monto.value) === Number(invoice.saldo_pendiente)) monto.value = '';
    }
  }

  function validatePago() {
    const invoice = state.current?.invoice;
    if (!invoice) return null;
    const saldo = Number(invoice.saldo_pendiente) || 0;
    const tipo = el('invPagoTipo').value;
    const referencia = el('invPagoReferencia').value.trim();
    if (!referencia) return { error: 'Escribe la referencia o número de recibo.' };
    let monto = tipo === 'Total' ? saldo : Number(String(el('invPagoMonto').value).replace(',', '.'));
    if (!Number.isFinite(monto) || monto <= 0) return { error: 'El monto del pago no es válido.' };
    if (monto > saldo + 0.01) return { error: 'El monto no puede superar el saldo pendiente.' };
    monto = Math.min(monto, saldo);
    return {
      monto,
      metodo_pago: el('invPagoMetodo').value,
      tipo_pago: tipo,
      referencia_pago: referencia,
      notas: el('invPagoNotas').value.trim() || undefined
    };
  }

  async function submitPago(event) {
    event.preventDefault();
    const invoice = state.current?.invoice;
    if (!invoice) return;
    const errorBox = el('invPagoError');
    errorBox.hidden = true;

    const parsed = validatePago();
    if (!parsed) return;
    if (parsed.error) {
      errorBox.textContent = parsed.error;
      errorBox.hidden = false;
      return;
    }

    const confirmed = await window.app.askConfirm(
      `Registrar un pago de ${money(parsed.monto)} (${parsed.tipo_pago.toLowerCase()}) a ${invoice.proveedor_empresa}?`,
      { confirmText: 'Registrar pago' }
    );
    if (!confirmed) return;

    const submit = el('invPagoSubmit');
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Registrando';
    try {
      const response = await window.app.posApiRequest(`${API}/${encodeURIComponent(invoice.id)}/pagos`, {
        method: 'POST',
        body: JSON.stringify(parsed)
      });
      const data = response?.data || {};
      if (data.invoice) {
        state.current.invoice = data.invoice;
      }
      if (data.pago) {
        state.current.pagos = [data.pago, ...(state.current.pagos || [])];
      }
      renderDetail(state.current);
      setTab('historial');
      await loadInvoices();
    } catch (error) {
      errorBox.textContent = error?.message || 'No fue posible registrar el pago.';
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Registrar pago';
    }
  }

  // ---- Notificar visita (aviso al grupo de WhatsApp) ---------------------
  // Cuando un proveedor visita el local, se avisa al grupo con sus facturas
  // pendientes agrupadas por antigüedad de vencimiento.
  function fillVisitProviders(providers) {
    const select = el('visitProvider');
    if (!select) return;
    const current = select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona un proveedor';
    select.appendChild(placeholder);
    providers
      .slice()
      .sort((a, b) => String(a.empresa || '').localeCompare(String(b.empresa || ''), 'es'))
      .forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.empresa || 'Proveedor';
        select.appendChild(option);
      });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  // "011-002-000142353" -> "#142353" (el prefijo estab-emisión y los ceros del
  // secuencial son solo referencia).
  function shortInvoiceNumber(numero) {
    const parts = String(numero || '').split('-');
    if (parts.length === 3) {
      const seq = parts[2].replace(/^0+/, '') || '0';
      return `#${seq}`;
    }
    return `#${numero || '?'}`;
  }

  function visitBucketIndex(dias) {
    if (dias == null || Number.isNaN(dias)) return 3;
    if (dias >= 0) return 0;
    if (dias >= -30) return 1;
    if (dias >= -60) return 2;
    return 3;
  }

  function visitDayText(dias) {
    if (dias == null || Number.isNaN(dias)) return 'sin fecha de vencimiento';
    if (dias > 1) return `vence en ${dias} días`;
    if (dias === 1) return 'vence mañana';
    if (dias === 0) return 'vence hoy';
    if (dias === -1) return 'vencida hace 1 día';
    return `vencida hace ${Math.abs(dias)} días`;
  }

  function buildVisitMessage(providerName, items, motivo) {
    const pendientes = (items || []).filter((invoice) => Number(invoice.saldo_pendiente) > 0);
    const total = pendientes.reduce((sum, invoice) => sum + (Number(invoice.saldo_pendiente) || 0), 0);

    const lines = [
      '*VISITA DE PROVEEDOR*',
      '',
      `Proveedor: *${providerName}*`
    ];

    if (!pendientes.length) {
      lines.push('Sin facturas pendientes.');
    } else {
      lines.push(`Saldo pendiente: *${money(total)}*  (${pendientes.length} ${pendientes.length === 1 ? 'factura' : 'facturas'})`);
      const buckets = [[], [], [], []];
      pendientes.forEach((invoice) => buckets[visitBucketIndex(invoice.dias_vencimiento)].push(invoice));
      buckets.forEach((bucket, index) => {
        if (!bucket.length) return;
        bucket.sort((a, b) => (a.dias_vencimiento ?? 0) - (b.dias_vencimiento ?? 0));
        lines.push('', `*${VISIT_BUCKET_TITLES[index]}*`);
        bucket.forEach((invoice) => {
          lines.push(`- ${shortInvoiceNumber(invoice.numero_factura)} · ${visitDayText(invoice.dias_vencimiento)} · ${money(invoice.saldo_pendiente)}`);
        });
      });
    }

    const motivoText = String(motivo || '').trim();
    if (motivoText) lines.push('', `Motivo: ${motivoText}`);
    return lines.join('\n');
  }

  async function renderVisitPreview() {
    const providerId = el('visitProvider').value;
    const providerName = el('visitProvider').selectedOptions[0]?.textContent || '';
    el('visitError').hidden = true;
    if (!providerId) {
      el('visitPreview').textContent = 'Selecciona un proveedor para ver el mensaje.';
      el('visitSend').disabled = true;
      return;
    }
    const token = ++state.visitToken;
    el('visitPreview').textContent = 'Preparando mensaje…';
    el('visitSend').disabled = true;
    try {
      const params = new URLSearchParams({ estado: 'pendientes', proveedor_id: providerId });
      const response = await window.app.posApiRequest(`${API}?${params.toString()}`, { method: 'GET' });
      if (token !== state.visitToken) return;
      const items = Array.isArray(response?.data?.items) ? response.data.items : [];
      state.visitItems = items;
      el('visitPreview').textContent = buildVisitMessage(providerName, items, el('visitMotivo').value);
      el('visitSend').disabled = false;
    } catch (error) {
      if (token !== state.visitToken) return;
      el('visitPreview').textContent = 'Selecciona un proveedor para ver el mensaje.';
      el('visitError').textContent = error?.message || 'No fue posible cargar las facturas del proveedor.';
      el('visitError').hidden = false;
    }
  }

  function openVisitModal() {
    fillVisitProviders(state.providers);
    el('visitProvider').value = '';
    el('visitMotivo').value = '';
    el('visitError').hidden = true;
    el('visitPreview').textContent = 'Selecciona un proveedor para ver el mensaje.';
    el('visitSend').disabled = true;
    el('visitModal').hidden = false;
  }

  function closeVisitModal() {
    el('visitModal').hidden = true;
    state.visitToken += 1;
  }

  async function sendVisitNotification() {
    const providerName = el('visitProvider').selectedOptions[0]?.textContent || '';
    if (!providerName) return;
    const message = buildVisitMessage(providerName, state.visitItems || [], el('visitMotivo').value);

    const confirmed = await window.app.askConfirm(
      `Enviar al grupo de WhatsApp el aviso de visita de ${providerName}?`,
      { confirmText: 'Enviar al grupo' }
    );
    if (!confirmed) return;

    const send = el('visitSend');
    send.disabled = true;
    send.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Enviando';
    el('visitError').hidden = true;
    try {
      const response = await window.app.posApiRequest(WHATSAPP_API, {
        method: 'POST',
        body: JSON.stringify({ text: message, delay: 1000, linkPreview: false })
      });
      const data = response?.data || response;
      if (!data?.key?.id) throw new Error('El grupo no confirmó la recepción del mensaje.');
      closeVisitModal();
      await window.app.askAlert(`Aviso de visita de ${providerName} enviado al grupo.`);
    } catch (error) {
      el('visitError').textContent = error?.message || 'No fue posible enviar el aviso al grupo.';
      el('visitError').hidden = false;
    } finally {
      send.disabled = false;
      send.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Enviar al grupo';
    }
  }

  // ---- Modal / tabs ------------------------------------------------------
  function setTab(name) {
    document.querySelectorAll('#invoiceModal .invoice-tab').forEach((tab) => {
      const active = tab.dataset.invTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('#invoiceModal .invoice-tab-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.invPanel === name);
    });
  }

  function closeModal() {
    el('invoiceModal').hidden = true;
    state.current = null;
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;

    el('invRefreshButton').addEventListener('click', loadInvoices);
    el('invProveedorFilter').addEventListener('change', loadInvoices);
    el('invEstadoFilter').addEventListener('change', loadInvoices);

    el('invModalClose').addEventListener('click', closeModal);
    el('invoiceModalOverlay').addEventListener('click', closeModal);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!el('invoiceModal').hidden) closeModal();
      if (!el('visitModal').hidden) closeVisitModal();
    });

    el('invNotifyButton').addEventListener('click', openVisitModal);
    el('visitModalClose').addEventListener('click', closeVisitModal);
    el('visitModalOverlay').addEventListener('click', closeVisitModal);
    el('visitCancel').addEventListener('click', closeVisitModal);
    el('visitProvider').addEventListener('change', renderVisitPreview);
    el('visitMotivo').addEventListener('input', () => {
      if (el('visitProvider').value && !el('visitSend').disabled) {
        el('visitPreview').textContent = buildVisitMessage(
          el('visitProvider').selectedOptions[0]?.textContent || '',
          state.visitItems || [],
          el('visitMotivo').value
        );
      }
    });
    el('visitSend').addEventListener('click', sendVisitNotification);
    document.querySelectorAll('#invoiceModal .invoice-tab').forEach((tab) => {
      tab.addEventListener('click', () => setTab(tab.dataset.invTab));
    });

    el('invPagoTipo').addEventListener('change', syncPagoTipo);
    el('invPagoCancel').addEventListener('click', closeModal);
    el('invPagoForm').addEventListener('submit', submitPago);
  }

  window.initFacturas = async function initFacturas() {
    bindOnce();
    await loadInvoices();
  };
})();
