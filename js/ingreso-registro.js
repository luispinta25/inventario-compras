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
  // Al desglosar / cambiar presentación, lo suelto se vende más caro que su
  // parte proporcional del precio de la caja (la caja va "en promo"). Son dos
  // recargos distintos: "añadir unidades" (paquete -> UNIDADES) siempre un 50%
  // más; "cambiar presentación" (cualquier otra unidad: metros, libras, fundas,
  // etc.) un 30% más.
  const UNIDADES_MARKUP = 1.50;
  const PRESENTACION_MARKUP = 1.30;
  // Debe coincidir con la restriccion inventario_unidad_paquete_check en
  // ferre_inventario -- si se agrega una opcion aqui sin agregarla tambien
  // a esa restriccion, el guardado falla con un 500 en cuanto alguien la
  // elija (paso con estas 12 antes de ampliar la restriccion el 2026-09-18).
  const EMPAQUE_OPTIONS = [
    'CAJA', 'UNIDADES', 'PAQUETES', 'PAR', 'DOCENA', 'MEDIA DOCENA', 'CIENTOS',
    'MILLAR', 'GRUESA', 'FUNDA', 'BLISTER', 'PACK', 'JUEGO', 'KIT', 'SET',
    'ROLLOS', 'METROS', 'PLIEGO', 'BALDE', 'GALONES', 'LITROS',
    'LIBRAS', 'KILO', 'GRAMOS', 'ENTERO'
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
  // Costo neto por unidad FACTURADA (todavia no por unidad de inventario):
  // resta el descuento de ESA linea tal como ya viene en precioTotalSinImpuesto
  // del XML (el SRI exige que ese campo venga neto). Con proveedores que dan
  // buen descuento por linea (ej. American Home) usar el precio unitario
  // crudo infla el costo y, con el, el precio sugerido y lo que se guarda en
  // inventario. El reparto entre lo recibido / la presentacion lo hace el
  // backend con la misma cantidad que ya recibe en el payload.
  function unitNetCost(item) {
    const quantity = Number(item.quantity) || 1;
    const subtotal = Number(item.subtotal) || 0;
    return round(quantity > 0 && subtotal > 0 ? subtotal / quantity : Number(item.unit_cost) || 0, 4);
  }
  // Precio de venta equivalente de UNA unidad facturada (caja/bulto) para usar
  // como base al desglosar o cambiar presentacion. Si el producto ya existe, es
  // su precio actual de inventario; si es nuevo, se calcula desde el costo neto
  // al 38%. Nunca se usa item.sale_price aqui: cuando la linea ya tiene
  // presentacion ese valor es el precio POR UNIDAD suelta, no por caja.
  function equivalentBoxSalePrice(item) {
    const linkedPrice = Number(item.match?.inventory?.precio) || 0;
    if (linkedPrice > 0) return round(linkedPrice, 2);
    const cost = unitNetCost(item);
    return cost > 0 ? computeSalePrice(cost, DEFAULT_PCT) : 0;
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
  const newProduct = { grids: {}, resolver: null, empaque: 'UNIDADES', zona: null, existe: false, codeToken: 0 };

  // Nunca se permiten 2 productos con el mismo código: verifica en vivo si el
  // código ya existe (el backend igual lo rechaza si se intenta registrar,
  // pero avisar aquí evita perder la línea al momento de registrar la factura).
  async function checkNewProductCodigo() {
    const codigo = stripLeadingZeros($('npCodigo').value.trim());
    if ($('npCodigo').value.trim() !== codigo) $('npCodigo').value = codigo;
    const token = ++newProduct.codeToken;
    const node = $('npCodigoEstado');
    if (!codigo) {
      newProduct.existe = false;
      node.textContent = '';
      node.className = 'reg-hint reg-un-estado';
      return;
    }
    node.textContent = 'Verificando código…';
    node.className = 'reg-hint reg-un-estado';
    const fromCatalog = (app().inventoryCatalog?.get?.() || [])
      .find((product) => String(product.codigo) === codigo);
    let hit = fromCatalog || null;
    if (!hit) {
      try {
        const response = await app().posApiRequest(
          `/api/purchases/v2/inventory/lookup?${new URLSearchParams({ code: codigo })}`, { method: 'GET' }
        );
        hit = response?.data || null;
      } catch (_) { hit = null; }
    }
    if (token !== newProduct.codeToken) return;
    newProduct.existe = Boolean(hit);
    if (hit) {
      node.textContent = `Ese código ya es "${hit.producto}": no se puede crear como nuevo. Usa otro código o vincula la línea a ese producto.`;
      node.className = 'reg-hint reg-un-estado is-warn';
    } else {
      node.textContent = 'Código disponible: se creará un producto nuevo.';
      node.className = 'reg-hint reg-un-estado is-ok';
    }
  }

  function openNewProduct({ code = '', description = '', cost = 0 } = {}) {
    return new Promise((resolve) => {
      newProduct.resolver = resolve;
      newProduct.empaque = 'UNIDADES';
      newProduct.zona = null;
      newProduct.existe = false;
      $('npCodigo').value = String(code || '').trim();
      $('npNombre').value = String(description || '').trim().toUpperCase();
      $('npCosto').value = Number(cost || 0).toFixed(2);
      $('npStockMin').value = '';
      $('npError').textContent = '';
      $('npCodigoEstado').textContent = '';
      $('npCodigoEstado').className = 'reg-hint reg-un-estado';
      newProduct.grids.empaque.select('UNIDADES');
      newProduct.grids.zona.select('');
      $('newProductModal').hidden = false;
      if (!String(code || '').trim()) {
        app().posApiRequest?.('/api/purchases/v2/inventory/next-code', { method: 'GET' })
          .then((response) => {
            if (!$('npCodigo').value) $('npCodigo').value = response?.data?.codigo || '';
            checkNewProductCodigo();
          })
          .catch(() => {});
      } else {
        checkNewProductCodigo();
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
    if (newProduct.existe) {
      return void ($('npError').textContent = 'Ese código ya existe. Usa otro código o vincula la línea a ese producto en vez de crear uno nuevo.');
    }
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
  const unidades = { grid: null, resolver: null, zona: null, codeToken: 0, existe: false, defaultNombre: '' };

  const stripLeadingZeros = (value) => (/^0\d/.test(value) ? value.replace(/^0+(?=\d)/, '') : value);

  function setUnidadesEstado(text, kind) {
    const node = $('unCodigoEstado');
    node.textContent = text;
    node.className = `reg-hint reg-un-estado${kind ? ` is-${kind}` : ''}`;
  }

  // Indica en vivo si el código de las unidades ya existe (se actualizará) o si
  // se creará un producto nuevo. Match por código exacto.
  async function checkUnidadesCodigo() {
    const codigo = stripLeadingZeros($('unCodigo').value.trim());
    if ($('unCodigo').value.trim() !== codigo) $('unCodigo').value = codigo;
    const token = ++unidades.codeToken;
    if (!codigo) {
      setUnidadesEstado('', '');
      unidades.existe = false;
      $('unNombre').readOnly = false;
      return;
    }
    setUnidadesEstado('Verificando código…', '');
    const fromCatalog = (app().inventoryCatalog?.get?.() || [])
      .find((product) => String(product.codigo) === codigo);
    let hit = fromCatalog || null;
    if (!hit) {
      try {
        const response = await app().posApiRequest(
          `/api/purchases/v2/inventory/lookup?${new URLSearchParams({ code: codigo })}`, { method: 'GET' }
        );
        hit = response?.data || null;
      } catch (_) { hit = null; }
    }
    if (token !== unidades.codeToken) return;
    if (hit) {
      unidades.existe = true;
      const nombre = hit.producto || hit.nombre || '';
      const precioActual = Number(hit.precio);
      const precioTxt = Number.isFinite(precioActual) && precioActual > 0 ? ` (venta actual ${money(precioActual)})` : '';
      setUnidadesEstado(`Ya existe: ${nombre}${precioTxt} · se actualizará stock, costo y precio (el nombre no cambia).`, 'ok');
      $('unNombre').value = nombre.toUpperCase();
      $('unNombre').readOnly = true;
    } else {
      unidades.existe = false;
      setUnidadesEstado('No existe: se creará un producto nuevo con este código.', 'new');
      if ($('unNombre').readOnly) {
        $('unNombre').value = unidades.defaultNombre;
        $('unNombre').readOnly = false;
      }
    }
  }

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
      $('unNombre').readOnly = false;
      unidades.defaultNombre = baseNombre.toUpperCase();
      unidades.existe = false;
      setUnidadesEstado('', '');
      $('unPrecioVenta').value = existing?.precio_venta_unitario
        ? Number(existing.precio_venta_unitario).toFixed(2)
        : '';
      $('unPrecioVenta').dataset.touched = existing?.precio_venta_unitario ? '1' : '';
      $('unError').textContent = '';
      $('unQuitar').hidden = !existing;
      unidades._current = current;
      unidades.grid.select(unidades.zona);
      syncUnidades();
      checkUnidadesCodigo();
      $('unidadesModal').hidden = false;
      window.setTimeout(() => $('unPaquetes').focus(), 60);
    });
  }

  function syncUnidades() {
    const current = unidades._current || {};
    const upp = Number($('unUpp').value) || 0;
    const paquetes = Number($('unPaquetes').value) || 0;
    const cost = Number(current.costo) || 0;
    // Precio de venta equivalente de UNA caja/paquete facturado (no el precio
    // por unidad suelta): se reparte entre las unidades que trae y se le suma
    // el 50% porque la unidad suelta se vende mas cara que la caja "en promo".
    const ventaPaquete = Number(current.precio_venta) || 0;
    const costUnit = upp > 0 ? round(cost / upp, 4) : 0;
    const sugVenta = upp > 0 ? round((ventaPaquete / upp) * UNIDADES_MARKUP, 2) : 0;
    $('unResumen').textContent = upp > 0
      ? `${paquetes} paq. → ${round(paquetes * upp, 3)} unidades · costo unitario ${money(costUnit)}`
      : 'Indica cuántas unidades vienen por paquete.';
    const input = $('unPrecioVenta');
    if (!input.dataset.touched && sugVenta > 0) input.value = sugVenta.toFixed(2);
    $('unPrecioVentaHint').textContent = sugVenta > 0
      ? `Sugerido ${money(sugVenta)} (precio de una caja ${money(ventaPaquete)} ÷ ${upp} + 50%, editable)`
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
    const codigo = stripLeadingZeros($('unCodigo').value.trim());
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

  // ======================= Modal: cambiar presentación ==================
  // SOLO interno: la línea entra al inventario con otra cantidad / unidad /
  // costo que la facturada (ej. 3 KILOS -> 360 UNIDADES). El factor se escribe
  // a mano por línea (no hay valor fijo). La factura no se altera.
  const presentacion = { grid: null, resolver: null, unidad: 'UNIDADES' };

  function openPresentacion(current) {
    return new Promise((resolve) => {
      presentacion.resolver = resolve;
      presentacion._current = current;
      const existing = current.presentacion || null;
      const recibida = Number(current.cantidad_recibida) || 0;
      presentacion.unidad = (existing?.unidad_paquete || current.unidad_actual || 'UNIDADES').toUpperCase();
      $('presTitulo').textContent = `${current.codigo || ''} · ${current.nombre || ''}`;
      $('presFacturado').textContent =
        `Facturado: ${current.cantidad_facturada} · recibidas: ${recibida}`;
      $('presFactor').value = '';
      $('presCantidad').value = existing?.cantidad_inventario
        ? String(existing.cantidad_inventario)
        : String(recibida || '');
      $('presPrecioVenta').value = existing?.precio_venta_unitario
        ? Number(existing.precio_venta_unitario).toFixed(2)
        : '';
      $('presPrecioVenta').dataset.touched = existing?.precio_venta_unitario ? '1' : '';
      $('presError').textContent = '';
      $('presQuitar').hidden = !existing;
      presentacion.grid.select(presentacion.unidad);
      syncPresentacion();
      $('presModal').hidden = false;
      window.setTimeout(() => $('presCantidad').focus(), 60);
    });
  }

  function syncPresentacion() {
    const current = presentacion._current || {};
    const recibida = Number(current.cantidad_recibida) || 0;
    const costo = Number(current.costo) || 0;
    // Precio de venta equivalente de UNA caja/bulto facturado (aunque haya
    // llegado sólo 1 de 10, el subtotal del XML cubría las 10). El sugerido
    // reparte ESE precio entre las fundas/paquetes que salen de una caja.
    const ventaCaja = Number(current.precio_venta) || 0;
    const total = Number($('presCantidad').value) || 0;
    const costUnit = total > 0 ? round((recibida * costo) / total, 4) : 0;
    const porCaja = (total > 0 && recibida > 0) ? round(total / recibida, 2) : 0;
    $('presResumen').textContent = total > 0
      ? `${recibida} recibidas → ${total} ${presentacion.unidad} en inventario · costo unitario ${money(costUnit)}`
      : 'Indica cuántas unidades entran al inventario.';
    // Sugerido: precio de una caja ÷ fundas por caja + 30% (promo por caja).
    const sug = (porCaja > 0 && ventaCaja > 0)
      ? round((ventaCaja / porCaja) * PRESENTACION_MARKUP, 2)
      : (costUnit > 0 ? computeSalePrice(costUnit, DEFAULT_PCT) : 0);
    const input = $('presPrecioVenta');
    if (!input.dataset.touched && sug > 0) input.value = sug.toFixed(2);
    $('presPrecioVentaHint').textContent = sug > 0
      ? `Sugerido ${money(sug)} (precio de una caja ${money(ventaCaja)} ÷ ${porCaja || '—'} + 30%, editable)`
      : '';
  }

  function onPresFactorInput() {
    const current = presentacion._current || {};
    const recibida = Number(current.cantidad_recibida) || 0;
    const factor = Number($('presFactor').value) || 0;
    if (factor > 0 && recibida > 0) {
      $('presCantidad').value = String(round(recibida * factor, 3));
    }
    syncPresentacion();
  }

  function closePresentacion(result) {
    $('presModal').hidden = true;
    const resolver = presentacion.resolver;
    presentacion.resolver = null;
    if (resolver) resolver(result || null);
  }

  function confirmPresentacion() {
    const current = presentacion._current || {};
    const total = Number($('presCantidad').value);
    const venta = Number($('presPrecioVenta').value);
    if (!(total > 0)) return void ($('presError').textContent = 'La cantidad para inventario debe ser mayor a 0.');
    if (total === Number(current.cantidad_recibida)) {
      return void ($('presError').textContent = 'Esa es la misma cantidad facturada; no hace falta cambiar la presentación.');
    }
    if (!(venta > 0)) return void ($('presError').textContent = 'El precio de venta unitario debe ser mayor a 0.');
    closePresentacion({
      apply: {
        cantidad_inventario: round(total, 3),
        unidad_paquete: presentacion.unidad,
        precio_venta_unitario: round(venta, 2)
      }
    });
  }

  // ======================= Acciones por fila =============================
  // Llamado desde renderItems (app.js). item = linea del draft; rerender = redibuja.
  async function rowAction(action, { item, rerender }) {
    if (action === 'sugerido') {
      item.sale_margin_percent = DEFAULT_PCT;
      item.sale_price = computeSalePrice(unitNetCost(item), DEFAULT_PCT);
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
        costo: unitNetCost(item),
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
        costo: unitNetCost(item),
        precio_venta: equivalentBoxSalePrice(item),
        zona: item.line_overrides?.zona ?? nuevo?.zona ?? linked?.zona ?? 1,
        cantidad_recibida: recibida,
        desglose: item.desglose || null
      };
      const result = await openUnidades(current);
      if (!result) return;
      item.desglose = result.remove ? null : result.apply;
      if (item.desglose) item.presentacion = null; // excluyentes
      rerender();
      return;
    }
    if (action === 'presentacion') {
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
        costo: unitNetCost(item),
        precio_venta: equivalentBoxSalePrice(item),
        cantidad_facturada: quantity,
        cantidad_recibida: recibida,
        unidad_actual: item.line_overrides?.unidad_paquete || nuevo?.unidad_paquete || linked?.unidad_paquete || 'UNIDADES',
        presentacion: item.presentacion || null
      };
      const result = await openPresentacion(current);
      if (!result) return;
      if (result.remove) {
        item.presentacion = null;
      } else {
        item.presentacion = result.apply;
        item.desglose = null; // excluyentes
        // El precio de venta unitario se fija en el modal (por unidad de inventario).
        item.sale_margin_percent = 'manual';
        item.sale_price = result.apply.precio_venta_unitario;
        // Se marca como ya inicializado para este código para que renderMatch no
        // lo vuelva a sobrescribir con el precio antiguo ni con el sugerido.
        item._priceForCode = linked?.codigo || nuevo?.codigo || item.internal_code || null;
      }
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
        // costo = precio unitario tal como esta en la factura (bruto, para
        // que el detalle historico coincida con el documento del proveedor).
        // costo_neto = ese mismo costo ya restado el descuento de esta linea:
        // es lo que el backend usa para el costo real que queda en inventario.
        costo: round(Number(item.unit_cost) || 0, 4),
        costo_neto: unitNetCost(item),
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
        // El backend rechaza toda la factura si este codigo ya existe, en vez
        // de fusionar la linea con el producto existente.
        base.producto_nuevo = true;
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
      if (item.presentacion) {
        base.presentacion = {
          cantidad_inventario: round(Number(item.presentacion.cantidad_inventario) || 0, 3),
          unidad_paquete: item.presentacion.unidad_paquete || 'UNIDADES',
          // Informativo: sigue el precio vigente de la fila (item.sale_price),
          // que es la única fuente de verdad (la actualizan el campo de precio,
          // la ganancia y las cápsulas Sugerido/Actual). Antes se congelaba aquí
          // el valor del modal al confirmarlo y luego pisaba base.precio_venta
          // si el usuario editaba el precio después de aplicar la presentación.
          precio_venta_unitario: base.precio_venta
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
      // El total autoritativo del comprobante del SRI; el backend lo usa tal cual.
      total_factura: round(Number(draft.totals?.total) || 0, 2),
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
      body: JSON.stringify({ text: message, delay: 800, linkPreview: false })
    });
  }

  // ======================= Wiring de modales =============================
  function bindOnce() {
    if (state.bound) return;
    state.bound = true;

    newProduct.grids.empaque = buildButtonGrid($('npEmpaque'), EMPAQUE_OPTIONS, (v) => v, (v) => { newProduct.empaque = v; });
    newProduct.grids.zona = buildButtonGrid($('npZona'), ZONA_OPTIONS, (v) => String(v), (v) => { newProduct.zona = v; });
    let npCodigoTimer;
    $('npCodigo').addEventListener('input', () => {
      window.clearTimeout(npCodigoTimer);
      npCodigoTimer = window.setTimeout(checkNewProductCodigo, 260);
    });
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
    let unCodigoTimer;
    $('unCodigo').addEventListener('input', () => {
      window.clearTimeout(unCodigoTimer);
      unCodigoTimer = window.setTimeout(checkUnidadesCodigo, 260);
    });
    $('unPrecioVenta').addEventListener('input', (event) => { event.target.dataset.touched = '1'; });
    $('unCancel').addEventListener('click', () => closeUnidades(null));
    $('unClose').addEventListener('click', () => closeUnidades(null));
    $('unConfirm').addEventListener('click', confirmUnidades);
    $('unQuitar').addEventListener('click', () => closeUnidades({ remove: true }));
    $('unidadesModal').addEventListener('mousedown', (event) => {
      if (event.target === $('unidadesModal')) closeUnidades(null);
    });

    presentacion.grid = buildButtonGrid($('presUnidad'), EMPAQUE_OPTIONS, (v) => v, (v) => { presentacion.unidad = v; syncPresentacion(); });
    $('presCantidad').addEventListener('input', syncPresentacion);
    $('presFactor').addEventListener('input', onPresFactorInput);
    $('presPrecioVenta').addEventListener('input', (event) => { event.target.dataset.touched = '1'; });
    $('presCancel').addEventListener('click', () => closePresentacion(null));
    $('presClose').addEventListener('click', () => closePresentacion(null));
    $('presConfirm').addEventListener('click', confirmPresentacion);
    $('presQuitar').addEventListener('click', () => closePresentacion({ remove: true }));
    $('presModal').addEventListener('mousedown', (event) => {
      if (event.target === $('presModal')) closePresentacion(null);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!$('newProductModal').hidden) closeNewProduct(null);
      else if (!$('editLineModal').hidden) closeEditLine(null);
      else if (!$('unidadesModal').hidden) closeUnidades(null);
      else if (!$('presModal').hidden) closePresentacion(null);
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
