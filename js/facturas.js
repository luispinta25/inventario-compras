'use strict';

// Gestión de facturas registradas (reconstrucción nativa del módulo heredado
// "proveedores"). Solo la vista de Facturas: lista con filtros, detalle,
// historial de pagos, productos y registro de pagos. El Dashboard se rebuilds
// aparte. Sin db.from() en el navegador: todo pasa por inventory-api.
(function () {
  const API = '/api/purchases/v2/invoices';
  const WHATSAPP_API = '/api/whatsapp/send-text';
  const WHATSAPP_MEDIA_API = '/api/whatsapp/send-media';
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
    // Si ya hay contenido (precargado o recarga), se refresca sin parpadeo.
    if (!state.items.length) summary.textContent = 'Cargando facturas…';
    try {
      const proveedor = el('invProveedorFilter').value;
      const emisor = el('invEmisorFilter') ? el('invEmisorFilter').value : '';
      const estado = el('invEstadoFilter').value;
      const params = new URLSearchParams({ estado });
      if (proveedor && proveedor !== 'todos') params.set('proveedor_id', proveedor);
      if (emisor && emisor !== 'todas') params.set('emisor_id', emisor);
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
      refreshEmisorFilter();

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

  // Filtro secundario por razón social: solo aparece cuando el proveedor elegido
  // factura con más de un emisor legal (varias razones sociales / RUC).
  function refreshEmisorFilter() {
    const wrap = el('invEmisorFilterWrap');
    const select = el('invEmisorFilter');
    if (!wrap || !select) return;
    const providerId = el('invProveedorFilter').value;
    const provider = state.providers.find((item) => item.id === providerId);
    const emisores = provider && Array.isArray(provider.emisores) ? provider.emisores : [];
    if (emisores.length <= 1) {
      wrap.hidden = true;
      select.value = 'todas';
      return;
    }
    const current = select.value;
    select.replaceChildren();
    const todas = document.createElement('option');
    todas.value = 'todas';
    todas.textContent = 'Todas las razones sociales';
    select.appendChild(todas);
    emisores.forEach((emisor) => {
      const option = document.createElement('option');
      option.value = emisor.id;
      option.textContent = `${emisor.razon_social}${emisor.es_principal ? ' (principal)' : ''} · ${emisor.ruc}`;
      select.appendChild(option);
    });
    select.value = [...select.options].some((option) => option.value === current) ? current : 'todas';
    wrap.hidden = false;
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
    body.append(row('Proveedor', invoice.proveedor_empresa || '-'));
    if (invoice.emisor_razon_social && invoice.emisor_razon_social !== invoice.proveedor_empresa) {
      body.append(row('Razón social', invoice.emisor_razon_social));
    }
    body.append(
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
    const razonWrap = el('invDetRazonSocialWrap');
    if (razonWrap) {
      const showRazon = Boolean(invoice.emisor_razon_social);
      razonWrap.hidden = !showRazon;
      el('invDetRazonSocial').textContent = showRazon
        ? `${invoice.emisor_razon_social}${invoice.emisor_ruc ? ` · RUC ${invoice.emisor_ruc}` : ''}`
        : '-';
    }
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
    prepareNcForm(invoice);
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
      const accion = document.createElement('td');
      const resend = document.createElement('button');
      resend.type = 'button';
      resend.className = 'invoice-resend-btn';
      resend.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Reenviar';
      resend.addEventListener('click', () => resendMovimiento(pago));
      accion.appendChild(resend);
      tr.appendChild(accion);
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

    const saldoAntes = Number(invoice.saldo_pendiente) || 0;
    const submit = el('invPagoSubmit');
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Registrando';
    let pagoData = null;
    try {
      const response = await window.app.posApiRequest(`${API}/${encodeURIComponent(invoice.id)}/pagos`, {
        method: 'POST',
        body: JSON.stringify(parsed)
      });
      const data = response?.data || {};
      pagoData = data;
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
    // El aviso al grupo es obligatorio; si falla no invalida el pago ya registrado.
    if (pagoData?.pago) {
      try {
        await sendPaymentNotification(state.current.invoice, pagoData.pago, saldoAntes);
      } catch (avisoError) {
        await window.app.askAlert('El pago se registró, pero el aviso al grupo falló. Usa "Reenviar" en el historial.');
      }
    }
  }

  // ---- Nota de crédito -----------------------------------------------------
  // Flujo: se marcan los productos afectados (cada uno con su valor, por defecto
  // el costo de la línea, editable), luego el motivo, y el valor de la nota =
  // suma de esos productos (automático) con opción de ajuste manual. Número y
  // motivo obligatorios. Nunca puede superar el saldo pendiente.
  const NC_API_SUFFIX = '/notas-credito';

  function ncLineCost(producto) {
    return Math.round(((Number(producto.cantidad) || 0) * (Number(producto.precio_proveedor) || 0)) * 100) / 100;
  }

  function prepareNcForm(invoice) {
    const form = el('invNcForm');
    form.reset();
    el('invNcError').hidden = true;
    el('invNcSaldo').textContent = money(invoice.saldo_pendiente);
    el('invNcAuto').checked = true;
    el('invNcNumero').value = '';
    el('invNcMotivo').value = '';
    const valor = el('invNcValor');
    valor.max = String(invoice.saldo_pendiente);
    valor.value = '0.00';
    valor.readOnly = true;
    form.classList.toggle('is-locked', !(invoice.saldo_pendiente > 0) || invoice.archivada);
    renderNcProductos();
    recomputeNcTotal();
  }

  function renderNcProductos() {
    const box = el('invNcProductos');
    box.replaceChildren();
    const productos = state.current?.productos || [];
    if (!productos.length) {
      const empty = document.createElement('p');
      empty.className = 'invoice-nc-productos-empty';
      empty.textContent = 'La factura no tiene productos registrados.';
      box.appendChild(empty);
      return;
    }
    productos.forEach((producto, index) => {
      const row = document.createElement('div');
      row.className = 'invoice-nc-producto';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.ncProducto = String(index);
      const nombre = document.createElement('span');
      nombre.className = 'invoice-nc-producto-nombre';
      nombre.textContent = `${producto.codigo_producto || '-'} · ${producto.nombre_producto || 'Producto'}`;
      const valor = document.createElement('input');
      valor.type = 'number';
      valor.step = '0.01';
      valor.min = '0';
      valor.inputMode = 'decimal';
      valor.className = 'invoice-nc-producto-valor';
      valor.dataset.ncProductoValor = String(index);
      valor.disabled = true;
      row.append(check, nombre, valor);
      box.appendChild(row);
    });
  }

  function ncCheckedRows() {
    const productos = state.current?.productos || [];
    return [...el('invNcProductos').querySelectorAll('[data-nc-producto]')]
      .map((input) => {
        const i = Number(input.dataset.ncProducto);
        return { input, i, producto: productos[i], valorInput: el('invNcProductos').querySelector(`[data-nc-producto-valor="${i}"]`) };
      })
      .filter((entry) => entry.input.checked && entry.producto && entry.valorInput);
  }

  function sumNcLines() {
    return Math.round(ncCheckedRows().reduce((sum, entry) => {
      const v = Number(String(entry.valorInput.value).replace(',', '.'));
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0) * 100) / 100;
  }

  // Al marcar un producto, su valor de línea arranca en el costo (editable).
  function onNcProductoToggle(index) {
    const check = el('invNcProductos').querySelector(`[data-nc-producto="${index}"]`);
    const valorInput = el('invNcProductos').querySelector(`[data-nc-producto-valor="${index}"]`);
    const producto = (state.current?.productos || [])[index];
    if (!check || !valorInput || !producto) return;
    if (check.checked) {
      valorInput.disabled = false;
      if (!valorInput.value) valorInput.value = ncLineCost(producto).toFixed(2);
    } else {
      valorInput.disabled = true;
      valorInput.value = '';
    }
    recomputeNcTotal();
  }

  function recomputeNcTotal() {
    if (el('invNcAuto').checked) el('invNcValor').value = sumNcLines().toFixed(2);
    const invoice = state.current?.invoice;
    el('invNcSubmit').disabled = !invoice || !(invoice.saldo_pendiente > 0) || invoice.archivada;
  }

  function syncNcAuto() {
    const valor = el('invNcValor');
    if (el('invNcAuto').checked) {
      valor.readOnly = true;
      valor.value = sumNcLines().toFixed(2);
    } else {
      valor.readOnly = false;
      valor.focus();
    }
  }

  function collectNcProductos() {
    return ncCheckedRows().map((entry) => {
      const v = Math.round(Number(String(entry.valorInput.value).replace(',', '.')) * 100) / 100;
      return {
        detalle_id: entry.producto.id || undefined,
        codigo: entry.producto.codigo_producto || undefined,
        nombre: entry.producto.nombre_producto || undefined,
        valor: Number.isFinite(v) && v > 0 ? v : 0
      };
    });
  }

  function validateNc() {
    const invoice = state.current?.invoice;
    if (!invoice) return null;
    const saldo = Number(invoice.saldo_pendiente) || 0;
    const numero = el('invNcNumero').value.trim();
    if (!numero) return { error: 'El número de la nota de crédito es obligatorio.' };
    const productos = collectNcProductos();
    if (!productos.length) return { error: 'Marca al menos un producto afectado.' };
    const motivo = el('invNcMotivo').value.trim();
    if (motivo.length < 3) return { error: 'Escribe el motivo de la nota de crédito.' };
    const auto = el('invNcAuto').checked;
    let valor = auto ? sumNcLines() : Number(String(el('invNcValor').value).replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) return { error: 'El valor de la nota de crédito no es válido.' };
    if (valor > saldo + 0.01) return { error: `El valor no puede superar el saldo pendiente (${money(saldo)}).` };
    valor = Math.min(valor, saldo);
    return { auto, valor, motivo, numero, productos };
  }

  // Imagen (1:1, PNG base64) con el detalle de la NC, para el aviso al grupo.
  function buildCreditNoteImage(invoice, nc, productos, saldoAntes) {
    const S = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    const COND = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Narrow", "Helvetica Neue", sans-serif';
    const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    const INK = '#171410';
    const MUTED = '#6a6456';
    const fecha = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });

    ctx.fillStyle = '#f4f1e9';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(41, 41, S - 82, S - 82);
    ctx.fillStyle = '#2f7a44';
    ctx.fillRect(41, 41, S - 82, 12);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MUTED;
    setCanvasLS(ctx, 4);
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText('FERRISOLUCIONES · MACHACHI', S / 2, 132);

    ctx.fillStyle = INK;
    setCanvasLS(ctx, 5);
    fitCanvasFont(ctx, 'NOTA DE CRÉDITO', COND, '400', 118, S - 160);
    ctx.fillText('NOTA DE CRÉDITO', S / 2, 250);
    setCanvasLS(ctx, 0);

    ctx.strokeStyle = 'rgba(23, 20, 16, .32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(180, 322);
    ctx.lineTo(S - 180, 322);
    ctx.stroke();

    const proveedor = String(invoice.proveedor_empresa || 'Proveedor').toUpperCase();
    const fitted = fitProviderLines(ctx, proveedor, SANS, '800', S - 200, 2);
    ctx.fillStyle = INK;
    ctx.font = `800 ${fitted.px}px ${SANS}`;
    let ny = 400 - (fitted.lines.length - 1) * fitted.px * 0.55;
    fitted.lines.forEach((line) => { ctx.fillText(line, S / 2, ny); ny += fitted.px * 1.08; });

    ctx.fillStyle = MUTED;
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(`Factura ${invoice.numero_factura || '-'}`, S / 2, Math.max(ny + 18, 470));

    ctx.fillStyle = '#2f7a44';
    setCanvasLS(ctx, 1);
    fitCanvasFont(ctx, money(nc.valor), COND, '400', 150, S - 220);
    ctx.fillText(money(nc.valor), S / 2, 590);
    setCanvasLS(ctx, 0);

    ctx.fillStyle = INK;
    ctx.font = `500 26px ${SANS}`;
    const motivoLines = wrapCanvasText(ctx, `Motivo: ${nc.motivo}`, S - 260).slice(0, 3);
    let my = 690;
    motivoLines.forEach((line) => { ctx.fillText(line, S / 2, my); my += 34; });

    const conProducto = (productos || []).filter((p) => Number(p.valor) > 0);
    if (conProducto.length) {
      ctx.fillStyle = MUTED;
      ctx.font = `600 22px ${SANS}`;
      let py = my + 16;
      conProducto.slice(0, 4).forEach((p) => {
        const linea = wrapCanvasText(ctx, `• ${p.nombre || p.codigo || 'Producto'}  ${money(p.valor)}`, S - 260)[0] || '';
        ctx.fillText(linea, S / 2, py);
        py += 28;
      });
      if (conProducto.length > 4) {
        ctx.fillText(`y ${conProducto.length - 4} más`, S / 2, py);
      }
    }

    const saldoNuevo = Number(invoice.saldo_pendiente) || 0;
    const saldoPrevio = Number.isFinite(Number(saldoAntes)) ? Number(saldoAntes) : saldoNuevo + Number(nc.valor || 0);

    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Registrada · ${fecha}`, S / 2, 858);

    ctx.fillStyle = '#2f7a44';
    ctx.fillRect(0, 900, S, 180);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 900);
    ctx.lineTo(S, 900);
    ctx.stroke();

    const ink = inkOn('#2f7a44');
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    setCanvasLS(ctx, 3);
    ctx.font = `700 20px ${SANS}`;
    ctx.fillText('SALDO ANTERIOR', 70, 952);
    ctx.fillText('SALDO NUEVO', 70, 1040);
    setCanvasLS(ctx, 0);
    ctx.textAlign = 'right';
    ctx.font = `600 40px ${COND}`;
    ctx.fillText(money(saldoPrevio), S - 70, 952);
    setCanvasLS(ctx, 1);
    fitCanvasFont(ctx, money(saldoNuevo), COND, '400', 72, 420);
    ctx.fillText(money(saldoNuevo), S - 70, 1042);
    setCanvasLS(ctx, 0);

    return canvas.toDataURL('image/png');
  }

  function buildCreditNoteMessage(invoice, nc, productos, saldoAntes) {
    const saldoNuevo = Number(invoice.saldo_pendiente) || 0;
    const saldoPrevio = Number.isFinite(Number(saldoAntes)) ? Number(saldoAntes) : saldoNuevo + Number(nc.valor || 0);
    const lines = [
      '*NOTA DE CRÉDITO*',
      '',
      `Proveedor: *${invoice.proveedor_empresa || '-'}*`,
      `Factura: *${invoice.numero_factura || '-'}*`,
      `Valor: *${money(nc.valor)}*`,
      `Saldo anterior: ${money(saldoPrevio)}`,
      `Saldo nuevo: *${money(saldoNuevo)}*`
    ];
    const conProducto = (productos || []).filter((p) => Number(p.valor) > 0);
    if (conProducto.length) {
      lines.push('', 'Productos:');
      conProducto.forEach((p) => lines.push(`- ${p.nombre || p.codigo || 'Producto'} · ${money(p.valor)}`));
    }
    lines.push('', `Motivo: ${nc.motivo}`);
    return lines.join('\n');
  }

  // Envía una imagen (o solo texto si la imagen falla) al grupo de WhatsApp.
  async function sendGroupImage(fileName, message, dataUrlFactory) {
    try {
      const dataUrl = dataUrlFactory();
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      await window.app.posApiRequest(WHATSAPP_MEDIA_API, {
        method: 'POST',
        body: JSON.stringify({
          media: {
            mediatype: 'image', mimetype: 'image/png', media: base64,
            fileName, caption: message, delay: 1000
          }
        })
      });
    } catch (imageError) {
      await window.app.posApiRequest(WHATSAPP_API, {
        method: 'POST',
        body: JSON.stringify({ text: message, delay: 1000, linkPreview: false })
      });
    }
  }

  async function sendCreditNoteNotification(invoice, nc, productos, saldoAntes) {
    await sendGroupImage(
      'nota-credito.png',
      buildCreditNoteMessage(invoice, nc, productos, saldoAntes),
      () => buildCreditNoteImage(invoice, nc, productos, saldoAntes)
    );
  }

  // ---- Aviso de pago a proveedor -----------------------------------------
  function buildPaymentImage(invoice, pago, saldoAntes) {
    const S = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    const COND = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Narrow", "Helvetica Neue", sans-serif';
    const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    const INK = '#171410';
    const MUTED = '#6a6456';
    const ACCENT = '#2f6f8f';
    const fecha = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
    const saldoNuevo = Number.isFinite(Number(pago.saldo_nuevo)) ? Number(pago.saldo_nuevo) : Number(invoice.saldo_pendiente) || 0;
    const saldoPrevio = Number.isFinite(Number(saldoAntes)) ? Number(saldoAntes) : saldoNuevo + Number(pago.monto_pago || 0);

    ctx.fillStyle = '#f4f1e9';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(41, 41, S - 82, S - 82);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(41, 41, S - 82, 12);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MUTED;
    setCanvasLS(ctx, 4);
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText('FERRISOLUCIONES · MACHACHI', S / 2, 132);

    ctx.fillStyle = INK;
    setCanvasLS(ctx, 5);
    fitCanvasFont(ctx, 'PAGO A PROVEEDOR', COND, '400', 116, S - 160);
    ctx.fillText('PAGO A PROVEEDOR', S / 2, 250);
    setCanvasLS(ctx, 0);

    ctx.strokeStyle = 'rgba(23, 20, 16, .32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(180, 322);
    ctx.lineTo(S - 180, 322);
    ctx.stroke();

    const proveedor = String(invoice.proveedor_empresa || 'Proveedor').toUpperCase();
    const fitted = fitProviderLines(ctx, proveedor, SANS, '800', S - 200, 2);
    ctx.fillStyle = INK;
    ctx.font = `800 ${fitted.px}px ${SANS}`;
    let ny = 400 - (fitted.lines.length - 1) * fitted.px * 0.55;
    fitted.lines.forEach((line) => { ctx.fillText(line, S / 2, ny); ny += fitted.px * 1.08; });

    ctx.fillStyle = MUTED;
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(`Factura ${invoice.numero_factura || '-'}`, S / 2, Math.max(ny + 18, 470));

    ctx.fillStyle = ACCENT;
    setCanvasLS(ctx, 1);
    fitCanvasFont(ctx, money(pago.monto_pago), COND, '400', 150, S - 220);
    ctx.fillText(money(pago.monto_pago), S / 2, 590);
    setCanvasLS(ctx, 0);

    ctx.fillStyle = INK;
    ctx.font = `500 27px ${SANS}`;
    const metodo = `${pago.metodo_pago || '-'}${pago.tipo_pago ? ` · ${pago.tipo_pago}` : ''}`;
    ctx.fillText(metodo, S / 2, 678);
    if (pago.referencia_pago) {
      ctx.fillStyle = MUTED;
      ctx.font = `500 24px ${SANS}`;
      ctx.fillText(`Ref.: ${pago.referencia_pago}`, S / 2, 716);
    }

    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${SANS}`;
    ctx.fillText(`Registrado · ${fecha}`, S / 2, 858);

    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 900, S, 180);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 900);
    ctx.lineTo(S, 900);
    ctx.stroke();
    const ink = inkOn(ACCENT);
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    setCanvasLS(ctx, 3);
    ctx.font = `700 20px ${SANS}`;
    ctx.fillText('SALDO ANTERIOR', 70, 952);
    ctx.fillText('SALDO NUEVO', 70, 1040);
    setCanvasLS(ctx, 0);
    ctx.textAlign = 'right';
    ctx.font = `600 40px ${COND}`;
    ctx.fillText(money(saldoPrevio), S - 70, 952);
    setCanvasLS(ctx, 1);
    fitCanvasFont(ctx, money(saldoNuevo), COND, '400', 72, 420);
    ctx.fillText(money(saldoNuevo), S - 70, 1042);
    setCanvasLS(ctx, 0);

    return canvas.toDataURL('image/png');
  }

  function buildPaymentMessage(invoice, pago, saldoAntes) {
    const saldoNuevo = Number.isFinite(Number(pago.saldo_nuevo)) ? Number(pago.saldo_nuevo) : Number(invoice.saldo_pendiente) || 0;
    const saldoPrevio = Number.isFinite(Number(saldoAntes)) ? Number(saldoAntes) : saldoNuevo + Number(pago.monto_pago || 0);
    const lines = [
      '*PAGO A PROVEEDOR*',
      '',
      `Proveedor: *${invoice.proveedor_empresa || '-'}*`,
      `Factura: *${invoice.numero_factura || '-'}*`,
      `Monto: *${money(pago.monto_pago)}*`,
      `Método: ${pago.metodo_pago || '-'}${pago.tipo_pago ? ` · ${pago.tipo_pago}` : ''}`
    ];
    if (pago.referencia_pago) lines.push(`Referencia: ${pago.referencia_pago}`);
    lines.push(`Saldo anterior: ${money(saldoPrevio)}`, `Saldo nuevo: *${money(saldoNuevo)}*`);
    if (pago.notas) lines.push('', `Notas: ${pago.notas}`);
    return lines.join('\n');
  }

  async function sendPaymentNotification(invoice, pago, saldoAntes) {
    await sendGroupImage(
      'pago-proveedor.png',
      buildPaymentMessage(invoice, pago, saldoAntes),
      () => buildPaymentImage(invoice, pago, saldoAntes)
    );
  }

  // Reenvía al grupo el aviso de un movimiento ya registrado (desde Historial).
  async function resendMovimiento(pago) {
    const invoice = state.current?.invoice;
    if (!invoice || !pago) return;
    const esNc = String(pago.metodo_pago || '').toUpperCase() === 'NOTA_CREDITO';
    const saldoAntes = Math.round(((Number(pago.saldo_nuevo) || 0) + (Number(pago.monto_pago) || 0)) * 100) / 100;
    const confirmed = await window.app.askConfirm(
      `Reenviar al grupo el aviso de ${esNc ? 'la nota de crédito' : 'este pago'} de ${money(pago.monto_pago)}?`,
      { confirmText: 'Reenviar al grupo' }
    );
    if (!confirmed) return;
    try {
      if (esNc) {
        const nc = (state.current?.notas_credito || []).find((item) => item.pago_id === pago.id)
          || {
            valor: pago.monto_pago,
            motivo: pago.notas || 'Nota de crédito',
            numero: String(pago.referencia_pago || '').replace(/^NC\s*/i, '') || null,
            productos: []
          };
        await sendCreditNoteNotification(invoice, nc, nc.productos || [], saldoAntes);
      } else {
        await sendPaymentNotification(invoice, pago, saldoAntes);
      }
      await window.app.askAlert('Aviso reenviado al grupo.');
    } catch (error) {
      await window.app.askAlert(error?.message || 'No fue posible reenviar el aviso.');
    }
  }

  async function submitNc(event) {
    event.preventDefault();
    const invoice = state.current?.invoice;
    if (!invoice) return;
    const errorBox = el('invNcError');
    errorBox.hidden = true;

    const parsed = validateNc();
    if (!parsed) return;
    if (parsed.error) {
      errorBox.textContent = parsed.error;
      errorBox.hidden = false;
      return;
    }

    const confirmed = await window.app.askConfirm(
      `Aplicar una nota de crédito de ${money(parsed.valor)} a la factura ${invoice.numero_factura}?`,
      { confirmText: 'Aplicar nota de crédito' }
    );
    if (!confirmed) return;

    const saldoAntes = Number(invoice.saldo_pendiente) || 0;
    const submit = el('invNcSubmit');
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Aplicando';
    let ncData = null;
    try {
      const response = await window.app.posApiRequest(`${API}/${encodeURIComponent(invoice.id)}${NC_API_SUFFIX}`, {
        method: 'POST',
        body: JSON.stringify({
          numero: parsed.numero,
          valor: parsed.valor,
          automatica: parsed.auto,
          motivo: parsed.motivo,
          productos: parsed.productos
        })
      });
      const data = response?.data || {};
      ncData = data;
      if (data.invoice) state.current.invoice = data.invoice;
      if (data.pago) state.current.pagos = [data.pago, ...(state.current.pagos || [])];
      if (data.nota_credito) state.current.notas_credito = [data.nota_credito, ...(state.current.notas_credito || [])];

      renderDetail(state.current);
      setTab('historial');
      await loadInvoices();
    } catch (error) {
      errorBox.textContent = error?.message || 'No fue posible aplicar la nota de crédito.';
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-file-invoice-dollar" aria-hidden="true"></i> Aplicar nota de crédito';
    }
    // El aviso al grupo es obligatorio; si falla no invalida la NC ya registrada.
    if (ncData?.nota_credito) {
      try {
        await sendCreditNoteNotification(state.current.invoice, ncData.nota_credito, parsed.productos, saldoAntes);
        await window.app.askAlert(`Nota de crédito de ${money(parsed.valor)} aplicada y avisada al grupo.`);
      } catch (avisoError) {
        await window.app.askAlert('La nota de crédito se aplicó, pero el aviso al grupo falló. Usa "Reenviar" en el historial.');
      }
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

  // ---- Imagen "Recordatorio" (diseño membrete) para adjuntar al aviso ------
  // Cuadrada (1:1), PNG en base64. Verde si no hay facturas o ninguna vencida;
  // de limón a rubí oscuro según los días de la factura más vencida.
  // Rubí oscuro (tope de la escala) a partir de 80 días de atraso.
  const RECORDATORIO_RAMP = [
    [0, '#1f7a3d'], [1, '#86b81b'], [12, '#b9c400'], [22, '#e8c400'],
    [35, '#f0951f'], [50, '#e5482b'], [65, '#c01526'], [80, '#6b0a17']
  ];
  const RECORDATORIO_MAX_DIAS = 80;
  const hexToRgb = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const rgbToHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function severityHex(d) {
    d = Math.max(0, Math.min(RECORDATORIO_MAX_DIAS, Number(d) || 0));
    if (d <= 0) return RECORDATORIO_RAMP[0][1];
    for (let i = 0; i < RECORDATORIO_RAMP.length - 1; i += 1) {
      const [d0, c0] = RECORDATORIO_RAMP[i];
      const [d1, c1] = RECORDATORIO_RAMP[i + 1];
      if (d >= d0 && d <= d1) {
        const t = (d - d0) / (d1 - d0);
        const a = hexToRgb(c0);
        const b = hexToRgb(c1);
        return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return RECORDATORIO_RAMP[RECORDATORIO_RAMP.length - 1][1];
  }
  function mixHex(hex, other, t) {
    const a = hexToRgb(hex);
    const b = hexToRgb(other);
    return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  function inkOn(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.45 ? '#ffffff' : '#171410';
  }
  function fitCanvasFont(ctx, text, family, weight, maxPx, maxWidth) {
    let px = maxPx;
    while (px > 22) {
      ctx.font = `${weight} ${px}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth) break;
      px -= 2;
    }
    ctx.font = `${weight} ${px}px ${family}`;
  }
  function setCanvasLS(ctx, px) { try { ctx.letterSpacing = px + 'px'; } catch (e) { /* navegador sin soporte */ } }

  // Días de atraso de la factura más vencida (0 si no hay ninguna vencida).
  function maxOverdueDays(items) {
    return (items || []).reduce((max, invoice) => {
      if (Number(invoice.saldo_pendiente) > 0 && invoice.dias_vencimiento != null && invoice.dias_vencimiento < 0) {
        return Math.max(max, -invoice.dias_vencimiento);
      }
      return max;
    }, 0);
  }

  // Reparte un texto en líneas que caben en maxWidth. Si una sola palabra no
  // cabe, se parte por caracteres (nunca se desborda).
  function wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    words.forEach((word) => {
      if (ctx.measureText(word).width > maxWidth) {
        if (current) { lines.push(current); current = ''; }
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width <= maxWidth) chunk += ch;
          else { if (chunk) lines.push(chunk); chunk = ch; }
        }
        current = chunk;
        return;
      }
      const next = current ? current + ' ' + word : word;
      if (ctx.measureText(next).width <= maxWidth) current = next;
      else { lines.push(current); current = word; }
    });
    if (current) lines.push(current);
    return lines;
  }

  // Nombre del proveedor: MAYÚSCULAS, hasta `maxLines` líneas. Si no cabe,
  // reduce el tamaño de letra hasta que quepa (se adapta, no se desborda).
  function fitProviderLines(ctx, name, family, weight, maxWidth, maxLines) {
    const capForLines = (n) => (n <= 1 ? 100 : n === 2 ? 90 : 58);
    const wrapAt = (px) => { ctx.font = `${weight} ${px}px ${family}`; return wrapCanvasText(ctx, name, maxWidth); };
    let px = 100;
    let lines = wrapAt(px);
    while (px > 34 && lines.length > maxLines) { px -= 4; lines = wrapAt(px); }
    const cap = capForLines(Math.min(lines.length, maxLines));
    if (px > cap) {
      px = cap;
      lines = wrapAt(px);
      while (px > 34 && lines.length > maxLines) { px -= 4; lines = wrapAt(px); }
    }
    return { px, lines: lines.slice(0, maxLines) };
  }

  // Diseño "ficha de taller": marco fino, RECORDATORIO en bloque y una franja
  // de color al pie con los días de atraso.
  function buildRecordatorioImage(providerName, items) {
    const S = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    const COND = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Narrow", "Helvetica Neue", sans-serif';
    const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    const INK = '#171410';
    const MUTED = '#6a6456';
    const dias = maxOverdueDays(items);
    const sev = severityHex(dias);
    const fecha = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });

    ctx.fillStyle = '#f4f1e9';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(41, 41, S - 82, S - 82);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(41, 41, S - 82, 12);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = MUTED;
    setCanvasLS(ctx, 4);
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText('FERRISOLUCIONES · MACHACHI', S / 2, 150);

    ctx.fillStyle = INK;
    setCanvasLS(ctx, 6);
    fitCanvasFont(ctx, 'RECORDATORIO', COND, '400', 150, S - 160);
    ctx.fillText('RECORDATORIO', S / 2, 336);
    setCanvasLS(ctx, 0);

    ctx.strokeStyle = 'rgba(23, 20, 16, .32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(230, 432);
    ctx.lineTo(850, 432);
    ctx.stroke();

    // Nombre del proveedor en MAYÚSCULAS, hasta 3 líneas, adaptándose.
    const nameUpper = String(providerName || 'Proveedor').toUpperCase();
    const fitted = fitProviderLines(ctx, nameUpper, SANS, '800', S - 180, 3);
    ctx.fillStyle = INK;
    ctx.font = `800 ${fitted.px}px ${SANS}`;
    const lineHeight = fitted.px * 1.08;
    let ny = 548 - (fitted.lines.length - 1) * lineHeight / 2;
    fitted.lines.forEach((line) => { ctx.fillText(line, S / 2, ny); ny += lineHeight; });

    ctx.fillStyle = MUTED;
    ctx.font = `500 30px ${SANS}`;
    ctx.fillText('Visita registrada · ' + fecha, S / 2, 704);

    // Franja inferior de color.
    ctx.fillStyle = sev;
    ctx.fillRect(0, 900, S, 180);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 900);
    ctx.lineTo(S, 900);
    ctx.stroke();

    const ink = inkOn(sev);
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    setCanvasLS(ctx, 2);
    fitCanvasFont(ctx, dias <= 0 ? 'AL DÍA' : String(dias), COND, '400', 108, 560);
    ctx.fillText(dias <= 0 ? 'AL DÍA' : String(dias), 70, 992);
    setCanvasLS(ctx, 0);
    ctx.textAlign = 'right';
    ctx.font = `600 32px ${SANS}`;
    ctx.fillText(dias <= 0 ? 'sin facturas vencidas' : 'días · factura más vencida', S - 70, 992);

    return canvas.toDataURL('image/png');
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
      // De más vencidas a menos vencidas: >60 días → 31-60 → 1-30 → por vencer.
      [3, 2, 1, 0].forEach((index) => {
        const bucket = buckets[index];
        if (!bucket.length) return;
        bucket.sort((a, b) => (a.dias_vencimiento ?? 0) - (b.dias_vencimiento ?? 0));
        const subtotal = bucket.reduce((sum, invoice) => sum + (Number(invoice.saldo_pendiente) || 0), 0);
        lines.push('', `*${VISIT_BUCKET_TITLES[index]}: ${money(subtotal)}*`);
        bucket.forEach((invoice) => {
          lines.push(`- ${shortInvoiceNumber(invoice.numero_factura)} · ${visitDayText(invoice.dias_vencimiento)} · ${money(invoice.saldo_pendiente)}`);
        });
      });
    }

    const motivoText = String(motivo || '').trim();
    if (motivoText) lines.push('', `Motivo: ${motivoText}`);
    return lines.join('\n');
  }

  // Carga las facturas pendientes del proveedor elegido (no se previsualiza:
  // el mensaje y la imagen se arman al enviar).
  async function loadVisitProvider() {
    const providerId = el('visitProvider').value;
    el('visitError').hidden = true;
    if (!providerId) {
      state.visitItems = null;
      el('visitSend').disabled = true;
      return;
    }
    const token = ++state.visitToken;
    el('visitSend').disabled = true;
    try {
      const params = new URLSearchParams({ estado: 'pendientes', proveedor_id: providerId });
      const response = await window.app.posApiRequest(`${API}?${params.toString()}`, { method: 'GET' });
      if (token !== state.visitToken) return;
      state.visitItems = Array.isArray(response?.data?.items) ? response.data.items : [];
      el('visitSend').disabled = false;
    } catch (error) {
      if (token !== state.visitToken) return;
      state.visitItems = null;
      el('visitError').textContent = error?.message || 'No fue posible cargar las facturas del proveedor.';
      el('visitError').hidden = false;
    }
  }

  function openVisitModal() {
    fillVisitProviders(state.providers);
    el('visitProvider').value = '';
    el('visitMotivo').value = '';
    el('visitError').hidden = true;
    state.visitItems = null;
    el('visitSend').disabled = true;
    el('visitModal').hidden = false;
  }

  function closeVisitModal() {
    el('visitModal').hidden = true;
    state.visitToken += 1;
  }

  async function sendVisitNotification() {
    const providerName = el('visitProvider').selectedOptions[0]?.textContent || '';
    if (!providerName || !Array.isArray(state.visitItems)) return;
    const items = state.visitItems;
    const message = buildVisitMessage(providerName, items, el('visitMotivo').value);

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
      let confirmedByGroup = false;
      try {
        // El recordatorio va como imagen con el texto de leyenda.
        const dataUrl = buildRecordatorioImage(providerName, items);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const response = await window.app.posApiRequest(WHATSAPP_MEDIA_API, {
          method: 'POST',
          body: JSON.stringify({
            media: {
              mediatype: 'image',
              mimetype: 'image/png',
              media: base64,
              fileName: 'recordatorio.png',
              caption: message,
              delay: 1000
            }
          })
        });
        const data = response?.data || response;
        confirmedByGroup = Boolean(data?.key?.id);
      } catch (imageError) {
        // Si la imagen falla, al menos se envía el texto.
        const response = await window.app.posApiRequest(WHATSAPP_API, {
          method: 'POST',
          body: JSON.stringify({ text: message, delay: 1000, linkPreview: false })
        });
        const data = response?.data || response;
        confirmedByGroup = Boolean(data?.key?.id);
      }
      if (!confirmedByGroup) throw new Error('El grupo no confirmó la recepción del mensaje.');
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
    el('invProveedorFilter').addEventListener('change', () => {
      if (el('invEmisorFilter')) el('invEmisorFilter').value = 'todas';
      refreshEmisorFilter();
      loadInvoices();
    });
    if (el('invEmisorFilter')) el('invEmisorFilter').addEventListener('change', loadInvoices);
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
    el('visitProvider').addEventListener('change', loadVisitProvider);
    el('visitSend').addEventListener('click', sendVisitNotification);
    document.querySelectorAll('#invoiceModal .invoice-tab').forEach((tab) => {
      tab.addEventListener('click', () => setTab(tab.dataset.invTab));
    });

    el('invPagoTipo').addEventListener('change', syncPagoTipo);
    el('invPagoCancel').addEventListener('click', closeModal);
    el('invPagoForm').addEventListener('submit', submitPago);

    el('invNcAuto').addEventListener('change', syncNcAuto);
    el('invNcProductos').addEventListener('change', (event) => {
      if (event.target.matches('[data-nc-producto]')) onNcProductoToggle(Number(event.target.dataset.ncProducto));
    });
    el('invNcProductos').addEventListener('input', (event) => {
      if (event.target.matches('[data-nc-producto-valor]')) recomputeNcTotal();
    });
    el('invNcCancel').addEventListener('click', closeModal);
    el('invNcForm').addEventListener('submit', submitNc);
  }

  window.initFacturas = async function initFacturas() {
    bindOnce();
    await loadInvoices();
  };
})();
