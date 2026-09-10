'use strict';

// ============================================================================
// Ingreso -> REGISTRO de factura de proveedor.
// Modales (producto nuevo, editar linea, desglose de unidades), deteccion de
// unidades por paquete desde la descripcion del XML, armado del payload y envio
// a POST /v2/invoices/register + aviso al grupo por cada novedad de recepcion.
// Carga perezosa desde app.js (loadRegisterModule / window.initIngresoRegistro).
// Todo CSP-safe: sin handlers inline, sin innerHTML de datos remotos.
// ============================================================================
(function () {
  const PCT_OPTIONS = [20, 28, 30, 35, 38, 45, 50];
  const DEFAULT_PCT = 38;
  const EMPAQUE_OPTIONS = [
    'CAJA', 'UNIDADES', 'PAQUETES', 'PAR', 'DOCENA', 'MEDIA DOCENA', 'CIENTOS',
    'MILLAR', 'GRUESA', 'FUNDA', 'BLISTER', 'PACK', 'JUEGO', 'KIT', 'SET', 'TIRA',
    'ROLLO', 'BOBINA', 'METROS', 'METRO CUBICO', 'PLIEGO', 'PLANCHA',
    'BALDE', 'TAMBOR', 'CUNETE', 'BIDON', 'GALONES', 'LITROS',
    'MILILITROS', 'LIBRAS', 'KILO', 'GRAMOS', 'ENTERO'
  ];
  const ZONA_OPTIONS = Array.from({ length: 18 }, (_, index) => index + 1);
  const METODOS_CONTADO = [
    ['EFECTIVO', 'Efectivo'],
    ['TRANSFERENCIA', 'Transferencia'],
    ['CONTADO - CHEQUE', 'Cheque'],
    ['CONTADO - DEPOSITO', 'Depósito'],
    ['CONTADO - TARJETA_CREDITO', 'Tarjeta de crédito'],
    ['CONTADO - TARJETA_DEBITO', 'Tarjeta de débito']
  ];

  const state = { bound: false, ctx: null };

  const app = () => window.app || {};
  const $ = (id) => document.getElementById(id);

  function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }
  function money(value) {
    return (app().formatCurrency || ((v) => `$${Number(v || 0).toFixed(2)}`))(value);
  }
  function computeSalePrice(cost, pct) {
    return round(Number(cost || 0) * 1.15 * 1.05 * (1 + Number(pct) / 100), 2);
  }

  // -- Deteccion de "unidades por paquete" desde la descripcion del XML --------
  const WORD_UPP = [
    [/\bmedias?\s+docenas?\b/, 6],
    [/\bdocenas?\b|\bdozen(?:es|s)?\b/, 12],
    [/\bpares?\b|\bpairs?\b/, 2],
    [/\bdecenas?\b/, 10],
    [/\bcientos?\b|\bcien\b|\bhundreds?\b/, 100],
    [/\bmillares?\b|\bmillar\b|\bthousands?\b/, 1000],
    [/\bgruesas?\b|\bgross\b/, 144],
    [/\bresmas?\b|\breams?\b/, 500]
  ];
  function detectUnitsPerPackage(text) {
    const value = String(text || '').toLowerCase();
    let match = value.match(/[x*]\s?(\d{1,5})\b/);
    if (match) return Number(match[1]);
    match = value.match(/(\d{1,5})\s?(?:u|und|unid|unids|uds|pza|pzas|piezas|pcs|pc|unidades)\b/);
    if (match) return Number(match[1]);
    match = value.match(/\b(?:caja|cajas|funda|fundas|paquete|paquetes|blister|bl[ií]ster|pack|packs|set|sets|juego|juegos|tira|tiras|bolsa|bolsas|display|box|boxes|bag|bags)\s*(?:de|x|\*)?\s*(\d{1,5})\b/);
    if (match) return Number(match[1]);
    for (const [re, quantity] of WORD_UPP) if (re.test(value)) return quantity;
    return null;
  }

  // -- Botoneras -------------------------------------------------------------
  function buildButtonGrid(container, values, getLabel, onPick) {
    container.replaceChildren();
    const buttons = new Map();
    values.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reg-chip';
      button.textContent = getLabel(value);
      button.addEventListener('click', () => {
        buttons.forEach((node) => node.classList.remove('is-active'));
        button.classList.add('is-active');
        onPick(value);
      });
      buttons.set(String(value), button);
      container.appendChild(button);
    });
    return {
      select(value) {
        buttons.forEach((node) => node.classList.remove('is-active'));
        const node = buttons.get(String(value));
        if (node) node.classList.add('is-active');
      }
    };
  }

  // ======================= Modal: producto nuevo =========================
  // El precio de venta y el % de ganancia NO se piden aquí: se eligen en la
  // fila, en el control "Ganancia" debajo del SKU.
  const newProduct = { grids: {}, resolver: null, empaque: 'UNIDADES', zona: null };

  function openNewProduct({ code = '', description = '', cost = 0 } = {}) {
    return new Promise((resolve) => {
      newProduct.resolver = resolve;
      newProduct.empaque = 'UNIDADES';
      newProduct.zona = null;
      $('npCodigo').value = String(code || '').trim();
      $('npNombre').value = String(description || '').trim().toUpperCase();
      $('npCosto').value = Number(cost || 0).toFixed(2);
      $('npStockMin').value = '';
      $('npError').textContent = '';
      newProduct.grids.empaque.select('UNIDADES');
      newProduct.grids.zona.select('');
      $('newProductModal').hidden = false;
      if (!String(code || '').trim()) {
        app().posApiRequest?.('/api/purchases/v2/inventory/next-code', { method: 'GET' })
          .then((response) => { if (!$('npCodigo').value) $('npCodigo').value = response?.data?.codigo || ''; })
          .catch(() => {});
      }
      window.setTimeout(() => $('npNombre').focus(), 60);
    });
  }

  function closeNewProduct(result) {
    $('newProductModal').hidden = true;
    const resolver = newProduct.resolver;
    newProduct.resolver = null;
    if (resolver) resolver(result || null);
  }

  function confirmNewProduct() {
    const codigo = $('npCodigo').value.trim();
    const nombre = $('npNombre').value.trim().toUpperCase();
    const stockMin = $('npStockMin').value === '' ? null : Number($('npStockMin').value);
    if (!codigo) return void ($('npError').textContent = 'El código es obligatorio.');
    if (!nombre) return void ($('npError').textContent = 'El nombre es obligatorio.');
    if (!newProduct.zona) return void ($('npError').textContent = 'Selecciona una zona.');
    if (stockMin !== null && !(stockMin >= 0)) return void ($('npError').textContent = 'Stock mínimo inválido.');
    closeNewProduct({
      codigo,
      nombre,
      unidad_paquete: newProduct.empaque,
      zona: newProduct.zona,
      stock_minimo: stockMin
    });
  }

  // ======================= Modal: editar linea ===========================
  const editLine = { grids: {}, resolver: null, empaque: 'UNIDADES', zona: null };

  function openEditLine(current) {
    return new Promise((resolve) => {
      editLine.resolver = resolve;
      editLine.empaque = (current.unidad_paquete || 'UNIDADES').toUpperCase();
      editLine.zona = current.zona != null && current.zona !== '' ? Number(current.zona) : null;
      $('elCodigo').textContent = current.codigo || '—';
      $('elCosto').textContent = money(Number(current.costo) || 0);
      $('elNombre').value = String(current.nombre || '').toUpperCase();
      $('elError').textContent = '';
      editLine.grids.empaque.select(editLine.empaque);
      editLine.grids.zona.select(editLine.zona == null ? '' : editLine.zona);
      $('editLineModal').hidden = false;
      window.setTimeout(() => $('elNombre').focus(), 60);
    });
  }

  function closeEditLine(result) {
    $('editLineModal').hidden = true;
    const resolver = editLine.resolver;
    editLine.resolver = null;
    if (resolver) resolver(result || null);
  }

  function confirmEditLine() {
    const nombre = $('elNombre').value.trim().toUpperCase();
    if (!nombre) return void ($('elError').textContent = 'El nombre es obligatorio.');
    if (!editLine.zona) return void ($('elError').textContent = 'Selecciona una zona.');
    closeEditLine({ nombre, unidad_paquete: editLine.empaque, zona: editLine.zona });
  }

  // ======================= Modal: desglose de unidades ===================
  const unidades = { grid: null, resolver: null, zona: null };

  function openUnidades(current) {
    return new Promise((resolve) => {
      unidades.resolver = resolve;
      const existing = current.desglose || null;
      const upp = existing?.unidades_por_paquete
        || detectUnitsPerPackage(current.descripcion_xml || current.nombre) || 12;
      const baseCodigo = existing?.codigo || `${current.codigo || ''}001`;
      const baseNombre = existing?.nombre || `${current.nombre || ''} -UNIDADES`.trim();
      unidades.zona = existing?.zona || (current.zona != null && current.zona !== '' ? Number(current.zona) : 1);

      $('unTitulo').textContent = `${current.codigo || ''} · ${current.nombre || ''}`;
      $('unRecibidas').textContent = `${current.cantidad_recibida} recibidas`;
      $('unPaquetes').value = existing?.paquetes || 1;
      $('unPaquetes').max = String(current.cantidad_recibida || 1);
      $('unUpp').value = upp;
      $('unCodigo').value = baseCodigo;
      $('unNombre').value = baseNombre.toUpperCase();
      $('unPrecioVenta').value = existing?.precio_venta_unitario
        ? Number(existing.precio_venta_unitario).toFixed(2)
        : '';
      $('unPrecioVenta').dataset.touched = existing?.precio_venta_unitario ? '1' : '';
      $('unError').textContent = '';
      $('unQuitar').hidden = !existing;
      unidades._current = current;
      unidades.grid.select(unidades.zona);
      syncUnidades();
      $('unidadesModal').hidden = false;
      window.setTimeout(() => $('unPaquetes').focus(), 60);
    });
  }

  function syncUnidades() {
    const current = unidades._current || {};
    const upp = Number($('unUpp').value) || 0;
    const paquetes = Number($('unPaquetes').value) || 0;
    const cost = Number(current.costo) || 0;
    const ventaPaquete = Number(current.precio_venta) || 0;
    const costUnit = upp > 0 ? round(cost / upp, 4) : 0;
    const sugVenta = upp > 0 ? round((ventaPaquete / upp) * 2, 2) : 0;
    $('unResumen').textContent = upp > 0
      ? `${paquetes} paq. → ${round(paquetes * upp, 3)} unidades · costo unitario ${money(costUnit)}`
      : 'Indica cuántas unidades vienen por paquete.';
    const input = $('unPrecioVenta');
    if (!input.dataset.touched && sugVenta > 0) input.value = sugVenta.toFixed(2);
    $('unPrecioVentaHint').textContent = sugVenta > 0
      ? `Sugerido ${money(sugVenta)} (venta del paquete ÷ ${upp} × 2, editable)`
      : '';
  }

  function closeUnidades(result) {
    $('unidadesModal').hidden = true;
    const resolver = unidades.resolver;
    unidades.resolver = null;
    if (resolver) resolver(result || null);
  }

  function confirmUnidades() {
    const current = unidades._current || {};
    const paquetes = Number($('unPaquetes').value);
    const upp = Number($('unUpp').value);
    const codigo = $('unCodigo').value.trim();
    const nombre = $('unNombre').value.trim().toUpperCase();
    const venta = Number($('unPrecioVenta').value);
    if (!(paquetes > 0)) return void ($('unError').textContent = 'Indica cuántos paquetes desglosar.');
    if (paquetes > Number(current.cantidad_recibida || 0)) {
      return void ($('unError').textContent = 'No puedes desglosar más paquetes de los recibidos.');
    }
    if (!(upp > 0)) return void ($('unError').textContent = 'Indica las unidades por paquete.');
    if (!codigo) return void ($('unError').textContent = 'El código de las unidades es obligatorio.');
    if (!(venta > 0)) return void ($('unError').textContent = 'El precio de venta unitario debe ser mayor a 0.');
    closeUnidades({
      apply: {
        paquetes: round(paquetes, 3),
        unidades_por_paquete: round(upp, 3),
        codigo,
        nombre,
        zona: unidades.zona,
        precio_venta_unitario: round(venta, 2)
      }
    });
  }

  // ======================= Acciones por fila =============================
  // Llamado desde renderItems (app.js). item = linea del draft; rerender = redibuja.
  async function rowAction(action, { item, rerender }) {
    if (action === 'sugerido') {
      const cost = Number(item.unit_cost) || 0;
      const quantity = Number(item.quantity) || 1;
      const unitNet = Number(item.subtotal) > 0 ? Number(item.subtotal) / quantity : cost;
      item.sale_margin_percent = DEFAULT_PCT;
      item.sale_price = computeSalePrice(unitNet, DEFAULT_PCT);
      rerender();
      return;
    }
    if (action === 'quitar') {
      const ok = await (app().askConfirm || (() => Promise.resolve(true)))(
        'Marcar esta línea como NO RECIBIDA. No entrará a inventario y quedará una novedad abierta en Gestión de facturas hasta resolverla. ¿Continuar?',
        { confirmText: 'No recibido', danger: true }
      );
      if (!ok) return;
      item.recepcion_estado = 'NO_RECIBIDO';
      item.cantidad_recibida = 0;
      item.desglose = null;
      rerender();
      return;
    }
    if (action === 'editar') {
      const linked = item.match?.inventory;
      const nuevo = item.nuevo_producto;
      const current = {
        codigo: nuevo?.codigo || linked?.codigo || item.internal_code || '',
        nombre: (item.line_overrides?.nombre || nuevo?.nombre || linked?.producto || item.description || ''),
        costo: Number(item.unit_cost) || 0,
        unidad_paquete: item.line_overrides?.unidad_paquete || nuevo?.unidad_paquete || linked?.unidad_paquete || 'UNIDADES',
        zona: item.line_overrides?.zona ?? nuevo?.zona ?? linked?.zona ?? ''
      };
      const result = await openEditLine(current);
      if (!result) return;
      if (nuevo) {
        Object.assign(nuevo, {
          nombre: result.nombre, unidad_paquete: result.unidad_paquete, zona: result.zona
        });
      } else {
        item.line_overrides = {
          nombre: result.nombre, unidad_paquete: result.unidad_paquete, zona: result.zona
        };
      }
      rerender();
      return;
    }
    if (action === 'zona' || action === 'empaque') {
      // atajos: abren el mismo modal de edicion enfocado
      return rowAction('editar', { item, rerender });
    }
    if (action === 'unidades') {
      if (item.recepcion_estado === 'NO_RECIBIDO') return;
      const linked = item.match?.inventory;
      const nuevo = item.nuevo_producto;
      const quantity = Number(item.quantity) || 0;
      const recibida = item.recepcion_estado === 'PARCIAL'
        ? Number(item.cantidad_recibida) || 0
        : quantity;
      const current = {
        codigo: nuevo?.codigo || linked?.codigo || item.internal_code || '',
        nombre: (item.line_overrides?.nombre || nuevo?.nombre || linked?.producto || item.description || ''),
        descripcion_xml: item.description || '',
        costo: Number(item.unit_cost) || 0,
        precio_venta: item.sale_price || 0,
        zona: item.line_overrides?.zona ?? nuevo?.zona ?? linked?.zona ?? 1,
        cantidad_recibida: recibida,
        desglose: item.desglose || null
      };
      const result = await openUnidades(current);
      if (!result) return;
      item.desglose = result.remove ? null : result.apply;
      rerender();
    }
  }

  // ======================= Armado del payload + envio ====================
  function lineReady(item) {
    if (item.recepcion_estado === 'NO_RECIBIDO') {
      return String(item.nota_recepcion || '').trim().length >= 3;
    }
    const hasSku = (item.match?.status === 'MATCHED' && item.match.inventory?.id)
      || (item.match?.status === 'NEW' && item.nuevo_producto?.codigo);
    if (!hasSku) return false;
    if (item.recepcion_estado === 'PARCIAL') {
      const quantity = Number(item.quantity);
      const received = Number(item.cantidad_recibida);
      return Number.isFinite(received) && received > 0 && received < quantity
        && String(item.nota_recepcion || '').trim().length >= 3;
    }
    return true;
  }

  function buildItemsPayload(draft) {
    return draft.items.map((item) => {
      const estado = item.recepcion_estado === 'PARCIAL' || item.recepcion_estado === 'NO_RECIBIDO'
        ? item.recepcion_estado : 'COMPLETA';
      const linked = item.match?.inventory || null;
      const nuevo = item.nuevo_producto || null;
      const overrides = item.line_overrides || null;
      const base = {
        recepcion: estado,
        motivo: estado === 'COMPLETA' ? null : (item.nota_recepcion || null),
        cantidad: round(Number(item.quantity) || 0, 3),
        cantidad_recibida: estado === 'PARCIAL' ? round(Number(item.cantidad_recibida) || 0, 3) : null,
        costo: round(Number(item.unit_cost) || 0, 4),
        precio_venta: round(Number(item.sale_price) || 0, 2),
        porcentaje_ganancia: item.sale_margin_percent === 'manual' ? null : (item.sale_margin_percent ?? null),
        codigo_proveedor: item.provider_primary_code || item.provider_auxiliary_code || null,
        nombre_proveedor: item.description || null
      };
      if (estado === 'NO_RECIBIDO') {
        return { ...base, inventory_id: null, codigo: null };
      }
      if (nuevo) {
        base.codigo = nuevo.codigo;
        base.nombre = nuevo.nombre;
        base.zona = nuevo.zona;
        base.unidad_paquete = nuevo.unidad_paquete;
        base.stock_minimo = nuevo.stock_minimo;
        base.inventory_id = null;
      } else {
        base.inventory_id = linked?.id || null;
        base.codigo = linked?.codigo || item.internal_code || null;
        if (overrides) {
          base.nombre = overrides.nombre;
          base.zona = overrides.zona;
          base.unidad_paquete = overrides.unidad_paquete;
        }
      }
      if (item.desglose) {
        base.desglose = {
          paquetes: round(Number(item.desglose.paquetes) || 0, 3),
          unidades_por_paquete: round(Number(item.desglose.unidades_por_paquete) || 0, 3),
          codigo: item.desglose.codigo || null,
          nombre: item.desglose.nombre || null,
          zona: item.desglose.zona || null,
          precio_venta_unitario: round(Number(item.desglose.precio_venta_unitario) || 0, 2)
        };
      }
      return base;
    });
  }

  function newIdempotencyKey() {
    const raw = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random()}`.replace(/\D/g, '').padEnd(40, '0').slice(0, 40);
    return `reg:${raw}`;
  }

  async function registrar({ draft, provider, payment, onDone }) {
    if (!draft || !provider) return;
    const notReady = draft.items.filter((item) => !lineReady(item));
    if (notReady.length) {
      await (app().askAlert || (() => {}))('Cada línea necesita un SKU (o marcarse como no recibida) y motivo donde corresponda.');
      return;
    }
    if (payment.tipo_pago === 'Contado' && !payment.metodo_pago) {
      await (app().askAlert || (() => {}))('Selecciona el método de pago.');
      return;
    }

    const idempotencyKey = draft._registerIdem || (draft._registerIdem = newIdempotencyKey());
    const payload = {
      idempotency_key: idempotencyKey,
      proveedor_id: provider.id,
      emisor_ruc: draft.provider?.tax_id || null,
      access_key: draft.tax_information?.access_key || null,
      numero_factura: draft.invoice?.number || null,
      fecha_emision: draft.invoice?.issue_date || null,
      fecha_vencimiento: payment.fecha_vencimiento || draft.invoice?.issue_date || null,
      tipo_pago: payment.tipo_pago,
      metodo_pago: payment.tipo_pago === 'Contado' ? payment.metodo_pago : null,
      referencia_pago: payment.referencia_pago || null,
      descuento: round(Number(draft.totals?.discount) || 0, 2),
      iva: round(Number(draft.totals?.tax) || 0, 2),
      notas: payment.notas || null,
      items: buildItemsPayload(draft)
    };

    const confirmText = payment.tipo_pago === 'Contado'
      ? `Registrar la factura ${payload.numero_factura} y pagarla de contado (${money(draft.totals?.total)}).`
      : `Registrar la factura ${payload.numero_factura} a crédito (saldo ${money(draft.totals?.total)}).`;
    if (!(await (app().askConfirm || (() => Promise.resolve(true)))(confirmText, { confirmText: 'Registrar' }))) return;

    let result;
    try {
      const response = await app().posApiRequest('/api/purchases/v2/invoices/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      result = response?.data || {};
    } catch (error) {
      await (app().askAlert || (() => {}))(error.message || 'No fue posible registrar la factura.');
      return;
    }

    const novedades = Array.isArray(result.novedades) ? result.novedades : [];
    if (novedades.length) {
      try {
        await sendNovedadesNotification({ draft, provider, result, novedades });
      } catch (error) {
        await (app().askAlert || (() => {}))(
          'La factura se registró, pero el aviso de novedades al grupo falló. Revísalo en Gestión de facturas.'
        );
      }
    }

    const resumen = result.duplicate
      ? `La factura ${payload.numero_factura} ya estaba registrada; no se duplicó.`
      : `Factura ${result.numero_factura} registrada. ${result.productos_nuevos || 0} productos nuevos, `
        + `${result.productos_actualizados || 0} actualizados`
        + (novedades.length ? `, ${novedades.length} novedad(es) de recepción.` : '.');
    await (app().askAlert || (() => {}))(resumen);
    if (typeof onDone === 'function') await onDone(result);
  }

  // ---- Aviso al grupo: una imagen con todas las novedades -------------------
  function buildNovedadesImage({ draft, provider, novedades }) {
    const size = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#b3541e';
    ctx.fillRect(0, 0, size, 12);
    ctx.fillStyle = '#101418';
    ctx.textBaseline = 'top';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText('NOVEDADES DE RECEPCIÓN', 60, 60);
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = '#48525c';
    ctx.fillText(`${provider.empresa || ''}`, 60, 104);
    ctx.fillText(`Factura ${draft.invoice?.number || ''} · ${draft.invoice?.issue_date || ''}`, 60, 134);

    let y = 200;
    const items = novedades.slice(0, 6);
    items.forEach((nota) => {
      ctx.fillStyle = nota.tipo === 'NO_RECIBIDO' ? '#7a1020' : '#8a5a00';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(nota.tipo === 'NO_RECIBIDO' ? 'NO RECIBIDO' : 'PARCIAL', 60, y);
      ctx.fillStyle = '#101418';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(`${nota.codigo_proveedor || 'S/C'} · ${String(nota.nombre_proveedor || '').slice(0, 46)}`, 60, y + 28);
      ctx.fillStyle = '#48525c';
      ctx.font = '400 19px system-ui, sans-serif';
      ctx.fillText(
        `Facturado ${nota.cantidad_facturada} · recibido ${nota.cantidad_recibida} · falta ${nota.cantidad_afectada}`,
        60, y + 58
      );
      ctx.fillText(`Motivo: ${String(nota.motivo || '').slice(0, 60)}`, 60, y + 84);
      y += 132;
    });
    if (novedades.length > items.length) {
      ctx.fillStyle = '#48525c';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText(`+ ${novedades.length - items.length} novedad(es) más`, 60, y);
    }
    ctx.fillStyle = '#b3541e';
    ctx.fillRect(0, size - 10, size, 10);
    return canvas.toDataURL('image/png');
  }

  function buildNovedadesMessage({ provider, draft, novedades }) {
    const lines = [
      'NOVEDADES DE RECEPCIÓN',
      `${provider.empresa || ''} · Factura ${draft.invoice?.number || ''}`,
      ''
    ];
    novedades.forEach((nota) => {
      lines.push(
        `${nota.tipo === 'NO_RECIBIDO' ? '[NO RECIBIDO]' : '[PARCIAL]'} ${nota.codigo_proveedor || 'S/C'} `
        + `${nota.nombre_proveedor || ''} — falta ${nota.cantidad_afectada} de ${nota.cantidad_facturada}. `
        + `Motivo: ${nota.motivo || ''}`
      );
    });
    lines.push('', 'Pendiente de resolver en Gestión de facturas (nota de crédito / devolución / etc.).');
    return lines.join('\n');
  }

  async function sendNovedadesNotification({ draft, provider, novedades }) {
    const message = buildNovedadesMessage({ provider, draft, novedades });
    let dataUrl = '';
    try { dataUrl = buildNovedadesImage({ draft, provider, novedades }); } catch (_) { dataUrl = ''; }
    if (dataUrl) {
      await app().posApiRequest('/api/whatsapp/send-media', {
        method: 'POST',
        body: JSON.stringify({
          media: {
            mediatype: 'image',
            mimetype: 'image/png',
            media: dataUrl.replace(/^data:image\/png;base64,/, ''),
            fileName: 'novedades-recepcion.png',
            caption: message,
            delay: 800
          }
        })
      });
      return;
    }
    await app().posApiRequest('/api/whatsapp/send-text', {
      method: 'POST',
      body: JSON.stringify({ text: message, delay: 600 })
    });
  }

  // ======================= Wiring de modales =============================
  function bindOnce() {
    if (state.bound) return;
    state.bound = true;

    newProduct.grids.empaque = buildButtonGrid($('npEmpaque'), EMPAQUE_OPTIONS, (v) => v, (v) => { newProduct.empaque = v; });
    newProduct.grids.zona = buildButtonGrid($('npZona'), ZONA_OPTIONS, (v) => String(v), (v) => { newProduct.zona = v; });
    $('npCancel').addEventListener('click', () => closeNewProduct(null));
    $('npClose').addEventListener('click', () => closeNewProduct(null));
    $('npConfirm').addEventListener('click', confirmNewProduct);
    $('newProductModal').addEventListener('mousedown', (event) => {
      if (event.target === $('newProductModal')) closeNewProduct(null);
    });

    editLine.grids.empaque = buildButtonGrid($('elEmpaque'), EMPAQUE_OPTIONS, (v) => v, (v) => { editLine.empaque = v; });
    editLine.grids.zona = buildButtonGrid($('elZona'), ZONA_OPTIONS, (v) => String(v), (v) => { editLine.zona = v; });
    $('elCancel').addEventListener('click', () => closeEditLine(null));
    $('elClose').addEventListener('click', () => closeEditLine(null));
    $('elConfirm').addEventListener('click', confirmEditLine);
    $('editLineModal').addEventListener('mousedown', (event) => {
      if (event.target === $('editLineModal')) closeEditLine(null);
    });

    unidades.grid = buildButtonGrid($('unZona'), ZONA_OPTIONS, (v) => String(v), (v) => { unidades.zona = v; });
    ['unPaquetes', 'unUpp'].forEach((id) => $(id).addEventListener('input', syncUnidades));
    $('unPrecioVenta').addEventListener('input', (event) => { event.target.dataset.touched = '1'; });
    $('unCancel').addEventListener('click', () => closeUnidades(null));
    $('unClose').addEventListener('click', () => closeUnidades(null));
    $('unConfirm').addEventListener('click', confirmUnidades);
    $('unQuitar').addEventListener('click', () => closeUnidades({ remove: true }));
    $('unidadesModal').addEventListener('mousedown', (event) => {
      if (event.target === $('unidadesModal')) closeUnidades(null);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!$('newProductModal').hidden) closeNewProduct(null);
      else if (!$('editLineModal').hidden) closeEditLine(null);
      else if (!$('unidadesModal').hidden) closeUnidades(null);
    }, true);
  }

  window.initIngresoRegistro = async function initIngresoRegistro() {
    bindOnce();
  };

  window.ingresoRegistro = {
    openNewProduct,
    openEditLine,
    openUnidades,
    rowAction,
    registrar,
    lineReady,
    detectUnitsPerPackage,
    EMPAQUE_OPTIONS,
    ZONA_OPTIONS,
    PCT_OPTIONS
  };
})();
