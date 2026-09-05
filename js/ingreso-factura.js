// =====================================================
// MÓDULO: INGRESO DE FACTURAS DE PROVEEDORES
// =====================================================

var ingresoFacturaState = ingresoFacturaState || {
    pasoActual: 1,
    proveedorSeleccionado: null,
    metodoPago: null,
    productosEnFactura: [],
    inventarioCompleto: [],
    proveedoresDisponibles: [],
    descuento: 0,
    origenXml: false,
    nuevoProveedorWhatsapp: {
        valido: null,
        numero: ''
    }
};

// Índice del producto para cambiar zona desde el modal
var productoIndexParaZona = (typeof productoIndexParaZona !== 'undefined') ? productoIndexParaZona : -1;

// Porcentajes usados para los botones de ganancia
var PORCENTAJES_GANANCIA = [20, 28, 30, 35, 38, 45, 50];
// Utilidad: normaliza valores de fecha para asignar a inputs type=date (YYYY-MM-DD)
function normalizeDateForInput(value) {
    if (!value) return '';
    // Si ya viene en formato ISO yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    // Si viene en formato mm/dd/yyyy o similar
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
        const parts = value.split('/'); // mm/dd/yyyy
        const mm = parts[0].padStart(2, '0');
        const dd = parts[1].padStart(2, '0');
        const yyyy = parts[2];
        return `${yyyy}-${mm}-${dd}`;
    }
    // Intentar parsear con Date y formatear
    const d = new Date(value);
    if (!isNaN(d)) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    return '';
}

// =====================================================
// INICIALIZACIÓN
// =====================================================

async function initIngresoFactura(proveedores) {
    
    ingresoFacturaState.proveedoresDisponibles = proveedores || [];
    
    // Mover modales al body para evitar problemas de z-index
    moverModalesAlBody();
    
    // Cargar proveedores en el paso 1 inmediatamente
    cargarProveedoresIngreso();
    
    // Cargar lista de proveedores para el modal de actualizar inventario
    cargarListaProveedoresIngreso();
    
    // Configurar event listeners
    setupEventListenersIngreso();
    
    // Intentar cargar caché inmediatamente (sin esperar inventario)
    const cacheRestaurado = cargarCacheIngreso();
    
    // Si no hay caché, ir al paso 1
    if (!cacheRestaurado) {
        mostrarPasoIngreso(1);
    }
    
    // Cargar inventario en paralelo (no bloquea la UI)
    cargarInventarioCompleto().catch(err => {
        console.error('❌ [INIT] Error al cargar inventario:', err);
    });
}

function moverModalesAlBody() {
    // Mover todos los modales de ingreso-factura al body para que tengan el z-index correcto
    const modales = [
        'modalNuevoProveedorIngreso',
        'modalNuevoProductoIngreso',
        'modalCambiarZona',
        'modalConfirmacionIngreso'
    ];
    
    modales.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal && modal.parentElement.id !== 'body') {
            document.body.appendChild(modal);
        }
    });
}

function setupEventListenersIngreso() {
    // Form de nuevo proveedor
    const formNuevoProveedor = document.getElementById('formNuevoProveedorIngreso');
    if (formNuevoProveedor) {
        formNuevoProveedor.addEventListener('submit', guardarNuevoProveedorIngreso);
    }
    document.getElementById('contactoProveedorIngreso')?.addEventListener('input', () => {
        ingresoFacturaState.nuevoProveedorWhatsapp = { valido: null, numero: '' };
        setWhatsappEstadoNuevoProveedorIngreso('muted', 'Ingresa un número para comprobar WhatsApp.', 'fa-circle-info');
    });
    
    // Form de nuevo producto
    const formNuevoProducto = document.getElementById('formNuevoProductoIngreso');
    if (formNuevoProducto) {
        formNuevoProducto.addEventListener('submit', agregarNuevoProductoIngreso);
    }
    
    // Listeners para cálculos automáticos
    document.getElementById('precioProveedorNuevoProducto')?.addEventListener('input', calcularPrecioVentaSugerido);
    
    // Listeners para navegación directa desde la barra superior
    document.querySelectorAll('.paso-nav-item').forEach((item, index) => {
        item.addEventListener('click', () => {
            const pasoDestino = index + 1;
            // Solo permitir ir a pasos anteriores o al siguiente inmediato si está validado
            if (pasoDestino < ingresoFacturaState.pasoActual || 
                (pasoDestino === ingresoFacturaState.pasoActual + 1 && validarPasoActual())) {
                mostrarPasoIngreso(pasoDestino);
            } else if (pasoDestino === ingresoFacturaState.pasoActual) {
                // Ya está en este paso
                return;
            }
            // Si no cumple las condiciones, simplemente no hace nada (sin notificación)
        });
    });
}

// =====================================================
// NAVEGACIÓN ENTRE PASOS
// =====================================================

function mostrarPasoIngreso(paso) {
    if (paso === 1 && ingresoFacturaState.origenXml && typeof window.volverAConsultaFactura === 'function') {
        window.volverAConsultaFactura();
        return;
    }
    
    // Ocultar todos los pasos
    document.querySelectorAll('.paso-container').forEach(p => p.classList.remove('active'));
    
    // Mostrar el paso actual
    const pasoElemento = document.getElementById(`paso${paso}Ingreso`);
    if (pasoElemento) {
        pasoElemento.classList.add('active');
        ingresoFacturaState.pasoActual = paso;
    }
    
    // Configurar listeners específicos del paso
    if (paso === 2) {
        // Poblar selects de fecha y sincronizar con los inputs ocultos
        populateDateSelectors();
        setSelectorsFromHidden('fechaEmision');
        setSelectorsFromHidden('fechaVencimiento');
        configurarListenersPaso2();
        mostrarInfoProveedorSeleccionado();
    }
    
    // Actualizar navegación visual en la barra superior
    actualizarNavegacionPasos(paso);
    
    // Actualizar botones flotantes
    actualizarBotonesNavegacion(paso);
    
    // Actualizar datos si es paso 5 (resumen)
    if (paso === 5) {
        actualizarResumenFactura();
    }
}

function configurarListenersPaso2() {
    // Remover listeners anteriores para evitar duplicados
    const numero = document.getElementById('numeroFacturaIngreso');
    const fechaEmision = document.getElementById('fechaEmisionIngreso');
    const fechaVencimiento = document.getElementById('fechaVencimientoIngreso');
    const notas = document.getElementById('notasFacturaIngreso');
    
    if (numero) {
        numero.removeEventListener('input', validarYActualizarPaso2);
        numero.addEventListener('input', validarYActualizarPaso2);
    }
    
    if (fechaEmision) {
        fechaEmision.removeEventListener('change', validarYActualizarPaso2);
        fechaEmision.addEventListener('change', validarYActualizarPaso2);
    }
    
    if (fechaVencimiento) {
        fechaVencimiento.removeEventListener('change', validarYActualizarPaso2);
        fechaVencimiento.addEventListener('change', validarYActualizarPaso2);
    }
    
    if (notas) {
        notas.removeEventListener('input', validarYActualizarPaso2);
        notas.addEventListener('input', validarYActualizarPaso2);
    }

    // Listeners for new select-based date pickers
    // Emisión
    const emiDay = document.getElementById('fechaEmisionDia');
    const emiMonth = document.getElementById('fechaEmisionMes');
    const emiYear = document.getElementById('fechaEmisionAnio');
    if (emiDay && emiMonth && emiYear) {
        [emiDay, emiMonth, emiYear].forEach(el => {
            el.removeEventListener('change', onFechaEmisionSelectChange);
            el.addEventListener('change', onFechaEmisionSelectChange);
        });
    }

    // Vencimiento
    const venDay = document.getElementById('fechaVencimientoDia');
    const venMonth = document.getElementById('fechaVencimientoMes');
    const venYear = document.getElementById('fechaVencimientoAnio');
    if (venDay && venMonth && venYear) {
        [venDay, venMonth, venYear].forEach(el => {
            el.removeEventListener('change', onFechaVencimientoSelectChange);
            el.addEventListener('change', onFechaVencimientoSelectChange);
        });
    }
}

function onFechaEmisionSelectChange() {
    syncSelectsToHidden('fechaEmision');
    validarYActualizarPaso2();
    guardarCacheIngreso();
}

function onFechaVencimientoSelectChange() {
    syncSelectsToHidden('fechaVencimiento');
    validarYActualizarPaso2();
    guardarCacheIngreso();
}

// Pobla los selects de día, mes y año para ambos selectores.
function populateDateSelectors() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const years = [currentYear, currentYear - 1];

    const months = [
        {v: '01', t: 'Enero'}, {v: '02', t: 'Febrero'}, {v: '03', t: 'Marzo'}, {v: '04', t: 'Abril'},
        {v: '05', t: 'Mayo'}, {v: '06', t: 'Junio'}, {v: '07', t: 'Julio'}, {v: '08', t: 'Agosto'},
        {v: '09', t: 'Septiembre'}, {v: '10', t: 'Octubre'}, {v: '11', t: 'Noviembre'}, {v: '12', t: 'Diciembre'}
    ];

    ['fechaEmision', 'fechaVencimiento'].forEach(prefix => {
        const dayEl = document.getElementById(prefix + 'Dia');
        const monthEl = document.getElementById(prefix + 'Mes');
        const yearEl = document.getElementById(prefix + 'Anio');
        if (!dayEl || !monthEl || !yearEl) return;

        // Día
        dayEl.innerHTML = '<option value="">Día</option>' + Array.from({length:31}, (_,i)=>{
            const d = String(i+1).padStart(2,'0');
            return `<option value="${d}">${i+1}</option>`;
        }).join('');

        // Mes
        monthEl.innerHTML = '<option value="">Mes</option>' + months.map(m=>`<option value="${m.v}">${m.t}</option>`).join('');

        // Año (actual y anterior)
        yearEl.innerHTML = '<option value="">Año</option>' + years.map(y=>`<option value="${y}">${y}</option>`).join('');

        // Por defecto seleccionar año actual
        yearEl.value = String(currentYear);
    });
}

// Sincroniza selects (dia/mes/anio) hacia el input hidden con id = prefix + 'Ingreso'
function syncSelectsToHidden(prefix) {
    const day = document.getElementById(prefix + 'Dia')?.value;
    const month = document.getElementById(prefix + 'Mes')?.value;
    const year = document.getElementById(prefix + 'Anio')?.value;
    const hidden = document.getElementById(prefix + 'Ingreso');
    if (!hidden) return;

    if (day && month && year) {
        hidden.value = `${year}-${month}-${day}`;
    } else {
        hidden.value = '';
    }
}

// Establece selects (dia/mes/anio) en base al hidden input si tiene valor yyyy-mm-dd
function setSelectorsFromHidden(prefix) {
    const hiddenVal = document.getElementById(prefix + 'Ingreso')?.value || '';
    const dayEl = document.getElementById(prefix + 'Dia');
    const monthEl = document.getElementById(prefix + 'Mes');
    const yearEl = document.getElementById(prefix + 'Anio');
    if (!dayEl || !monthEl || !yearEl) return;

    if (/^\d{4}-\d{2}-\d{2}$/.test(hiddenVal)) {
        const [y,m,d] = hiddenVal.split('-');
        yearEl.value = y;
        monthEl.value = m;
        dayEl.value = d;
    } else {
        // si no hay valor en caché: dejar día y mes vacíos, sólo seleccionar año actual
        const now = new Date();
        yearEl.value = String(now.getFullYear());
        monthEl.value = '';
        dayEl.value = '';
        // NO actualizar el input hidden: queremos que inputs estén vacíos hasta que el usuario seleccione día/mes
    }
}

function validarYActualizarPaso2() {
    validarFechas();
    actualizarBotonesNavegacion(2);
}

function actualizarBotonesNavegacion(pasoActual) {
    // Validar si el paso indicado es válido
    const esValido = isPasoValido(pasoActual);
    
    // Actualizar botones en el header de cada paso
    const btnPaso1Siguiente = document.getElementById('btnPaso1Siguiente');
    const btnPaso2Siguiente = document.getElementById('btnPaso2Siguiente');
    const btnPaso3Siguiente = document.getElementById('btnPaso3Siguiente');
    const btnPaso4Siguiente = document.getElementById('btnPaso4Siguiente');
    
    if (pasoActual === 1 && btnPaso1Siguiente) {
        btnPaso1Siguiente.disabled = !esValido;
    } else if (pasoActual === 2 && btnPaso2Siguiente) {
        btnPaso2Siguiente.disabled = !esValido;
    } else if (pasoActual === 3 && btnPaso3Siguiente) {
        btnPaso3Siguiente.disabled = !esValido;
    } else if (pasoActual === 4 && btnPaso4Siguiente) {
        btnPaso4Siguiente.disabled = !esValido;
    }
}

function actualizarNavegacionPasos(pasoActual) {
    // Actualizar estados visuales de los pasos en la navegación
    document.querySelectorAll('.paso-nav-item').forEach((item, index) => {
        const numeroPaso = index + 1;
        
        // Remover clases previas
        item.classList.remove('active', 'completado');
        
        // Marcar paso actual
        if (numeroPaso === pasoActual) {
            item.classList.add('active');
        }
        // Marcar pasos completados
        else if (numeroPaso < pasoActual) {
            item.classList.add('completado');
        }
    });
}

function avanzarPasoIngreso(siguientePaso) {
    // Validar el paso actual antes de avanzar
    if (!validarPasoActual()) {
        return;
    }
    
    mostrarPasoIngreso(siguientePaso);
}

function volverPasoIngreso(pasoAnterior) {
    mostrarPasoIngreso(pasoAnterior);
}

function validarPasoActual() {
    return isPasoValido(ingresoFacturaState.pasoActual);
}

// Valida un paso específico sin depender del estado.pasoActual
function isPasoValido(paso) {
    switch (paso) {
        case 1:
            return !!ingresoFacturaState.proveedorSeleccionado;

        case 2: {
            // Requerir proveedor seleccionado
            if (!ingresoFacturaState.proveedorSeleccionado) return false;

            const numeroEl = document.getElementById('numeroFacturaIngreso');
            const num = numeroEl ? (numeroEl.value || '').toString().trim() : '';

            const fechaEmision = document.getElementById('fechaEmisionIngreso')?.value || '';
            const fechaVencimiento = document.getElementById('fechaVencimientoIngreso')?.value || '';

            if (!num || !fechaEmision || !fechaVencimiento) return false;

            // Para habilitar el botón "Siguiente" con rapidez solo comprobamos
            // que ambas fechas y el número existan. La verificación de orden
            // se mantiene en validarFechas() para mostrar mensajes, pero no
            // bloqueará la navegación.
            return true;
        }

        case 3:
            return !!ingresoFacturaState.metodoPago;

        case 4:
            return ingresoFacturaState.productosEnFactura && ingresoFacturaState.productosEnFactura.length > 0
                && validarRecepcionProductos(ingresoFacturaState.productosEnFactura).length === 0;

        default:
            return true;
    }
}

// =====================================================
// PASO 1: PROVEEDORES
// =====================================================

function cargarProveedoresIngreso() {
    const grid = document.getElementById('proveedoresGridIngreso');
    
    if (!ingresoFacturaState.proveedoresDisponibles || ingresoFacturaState.proveedoresDisponibles.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No hay proveedores disponibles</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = ingresoFacturaState.proveedoresDisponibles.map(proveedor => `
        <button class="proveedor-btn-ingreso" 
                data-id="${proveedor.id}" 
                data-codigo="${proveedor.codigo}"
                data-empresa="${proveedor.empresa}"
                onclick="seleccionarProveedorIngreso('${proveedor.id}', '${proveedor.codigo}', '${proveedor.empresa}')">
            <strong>${proveedor.empresa}</strong>
        </button>
    `).join('');
}

function seleccionarProveedorIngreso(id, codigo, empresa) {
    
    ingresoFacturaState.proveedorSeleccionado = { id, codigo, empresa };
    
    // Actualizar UI
    document.querySelectorAll('.proveedor-btn-ingreso').forEach(btn => {
        if (btn.dataset.id === id) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    
    // Guardar caché
    guardarCacheIngreso();
    
    // Actualizar botones de navegación
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);

    // Avanzar automáticamente al paso 2
    setTimeout(() => {
        avanzarPasoIngreso(2);
        mostrarInfoProveedorSeleccionado();
    }, 300);
}

function mostrarInfoProveedorSeleccionado() {
    const container = document.getElementById('infoProveedorIngreso');
    const proveedor = ingresoFacturaState.proveedorSeleccionado;
    
    if (!proveedor) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px; width: 100%;">
            <div style="
                width: 50px;
                height: 50px;
                background: linear-gradient(135deg, var(--color-accent) 0%, #e6b800 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(255, 193, 7, 0.3);
            ">
                <i class="fas fa-building" style="font-size: 1.5em; color: white;"></i>
            </div>
            <div style="flex: 1;">
                <strong style="font-size: 1.3em; color: var(--text-primary); display: block; margin-bottom: 3px;">
                    ${escapeHtml(proveedor.empresa)}
                </strong>
                <span style="color: var(--text-secondary); font-size: 0.95em;">
                    <i class="fas fa-barcode"></i> Código: <strong>${escapeHtml(proveedor.codigo)}</strong>
                </span>
                ${proveedor.ruc ? `<span style="display:block;color:var(--text-secondary);font-size:0.9em;margin-top:3px;">RUC: <strong>${escapeHtml(proveedor.ruc)}</strong>${proveedor.razon_social ? ` · ${escapeHtml(proveedor.razon_social)}` : ''}</span>` : ''}
            </div>
            <button onclick="cambiarProveedorIngreso()" class="btn btn-secondary" style="padding: 8px 15px; font-size: 0.9em;">
                <i class="fas fa-exchange-alt"></i> Cambiar
            </button>
        </div>
    `;
}

function cambiarProveedorIngreso() {
    // Limpiar selección actual
    ingresoFacturaState.proveedorSeleccionado = null;
    
    // Volver al paso 1
    mostrarPasoIngreso(1);
    
    // Guardar cambio en caché
    guardarCacheIngreso();
}

function iniciarIngresoFacturaDesdeXml(draft, proveedor) {
    if (!draft || !proveedor?.id) {
        throw new Error('No se recibió una factura con proveedor vinculado.');
    }

    const productosXml = (draft.items || []).map((item) => {
        const inventario = item.match?.inventory;
        if (!inventario?.id) {
            throw new Error(`La línea ${item.line || ''} no tiene un SKU interno validado.`);
        }
        const cantidad = Number(item.quantity) || 0;
        const costo = Number(item.unit_cost) || 0;
        const costoNetoUnitario = Number(item.subtotal) > 0 ? Number(item.subtotal) / cantidad : costo;
        const margenBase = costoNetoUnitario * 1.15 * 1.05;
        const margen = item.sale_margin_percent === 'manual'
            ? (margenBase > 0 ? ((Number(item.sale_price) / margenBase) - 1) * 100 : 0)
            : (Number(item.sale_margin_percent) || 38);
        const precioVenta = Number(item.sale_price) || redondearPrecio(costoNetoUnitario * 1.15 * 1.05 * (1 + margen / 100));
        return {
            producto_id: inventario.id,
            codigo: inventario.codigo,
            nombre: inventario.producto,
            cantidad,
            cantidad_recibida: Number.isFinite(Number(item.cantidad_recibida)) ? Number(item.cantidad_recibida) : cantidad,
            recepcion_estado: item.recepcion_estado === 'INCOMPLETA' ? 'INCOMPLETA' : 'COMPLETA',
            nota_recepcion: String(item.nota_recepcion || ''),
            precio_proveedor: costo,
            precio_venta: precioVenta,
            porcentaje_ganancia: margen,
            zona: inventario.zona ? String(inventario.zona) : '',
            es_producto_nuevo: false,
            subtotal: cantidad * costo,
            xml_vinculo: {
                codigo_principal_proveedor: item.provider_primary_code || null,
                codigo_auxiliar_proveedor: item.provider_auxiliary_code || null,
                descripcion_proveedor: item.description || null,
                ultimo_costo_neto: costo
            }
        };
    });

    limpiarCacheIngreso();
    ingresoFacturaState = {
        pasoActual: 2,
        proveedorSeleccionado: {
            id: proveedor.id,
            codigo: proveedor.codigo,
            empresa: proveedor.empresa,
            ruc: proveedor.ruc || draft.provider?.tax_id || null,
            razon_social: draft.provider?.legal_name || proveedor.razon_social || null
        },
        metodoPago: null,
        productosEnFactura: productosXml,
        inventarioCompleto: ingresoFacturaState.inventarioCompleto,
        proveedoresDisponibles: ingresoFacturaState.proveedoresDisponibles,
        descuento: Number(draft.totals?.discount) || 0,
        origenXml: true,
        nuevoProveedorWhatsapp: { valido: null, numero: '' }
    };

    document.querySelectorAll('.proveedor-btn-ingreso').forEach((button) => {
        button.classList.toggle('selected', button.dataset.id === proveedor.id);
    });
    document.getElementById('numeroFacturaIngreso').value = draft.invoice?.number || '';
    document.getElementById('fechaEmisionIngreso').value = normalizeDateForInput(draft.invoice?.issue_date);
    document.getElementById('fechaVencimientoIngreso').value = normalizeDateForInput(draft.invoice?.issue_date);
    document.getElementById('notasFacturaIngreso').value = `Importada desde XML SRI. Clave: ${draft.tax_information?.access_key || ''}`;

    mostrarPasoIngreso(2);
    mostrarInfoProveedorSeleccionado();
    renderizarTablaProductos();
    guardarCacheIngreso();
}

// =====================================================
// PASO 2: DATOS DE FACTURA
// =====================================================

function validarFechas() {
    const fechaEmision = document.getElementById('fechaEmisionIngreso').value;
    const fechaVencimiento = document.getElementById('fechaVencimientoIngreso').value;
    
    if (fechaEmision && fechaVencimiento) {
        if (new Date(fechaVencimiento) < new Date(fechaEmision)) {
            document.getElementById('fechaVencimientoIngreso').setCustomValidity('Debe ser posterior a la fecha de emisión');
        } else {
            document.getElementById('fechaVencimientoIngreso').setCustomValidity('');
        }
    }
}

// =====================================================
// PASO 3: MÉTODO DE PAGO
// =====================================================

function seleccionarMetodoPagoIngreso(metodo) {
    // (Deprecated) kept for backward compatibility
    ingresoFacturaState.metodoPago = metodo;
    guardarCacheIngreso();
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
}

// Selecciona el tipo principal: CONTADO o PLAZO
function seleccionarTipoPagoIngreso(tipo) {
    // Limpiar selecciones previas visuales
    document.querySelectorAll('.metodo-pago-btn[data-tipo]').forEach(btn => btn.classList.remove('selected'));
    // Marcar el seleccionado
    const btn = document.querySelector(`.metodo-pago-btn[data-tipo="${tipo}"]`);
    if (btn) btn.classList.add('selected');

    if (tipo === 'CONTADO') {
        // Mostrar submetodos
        document.getElementById('submetodosContado').style.display = 'block';
        // No establecer metodoPago todavía hasta que el usuario elija efectivo/transferencia
        ingresoFacturaState.metodoPago = null;
    } else {
        // PLAZO: ocultar submetodos y guardar como PLAZO
        const cont = document.getElementById('submetodosContado');
        if (cont) cont.style.display = 'none';
        ingresoFacturaState.metodoPago = 'PLAZO';
        // Limpiar any selected submetodo
        document.querySelectorAll('#submetodosContado .metodo-pago-btn').forEach(b => b.classList.remove('selected'));
    }

    guardarCacheIngreso();
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
}

// Selecciona el submetodo cuando tipo CONTADO fue elegido
function seleccionarSubMetodoPagoIngreso(sub) {
    // Visual
    document.querySelectorAll('#submetodosContado .metodo-pago-btn').forEach(b => b.classList.remove('selected'));
    const btn = document.querySelector(`#submetodosContado .metodo-pago-btn[data-submetodo="${sub}"]`);
    if (btn) btn.classList.add('selected');

    // Guardar en formato "CONTADO - SUB"
    ingresoFacturaState.metodoPago = `CONTADO - ${sub}`;

    guardarCacheIngreso();
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
}

// =====================================================
// PASO 4: PRODUCTOS
// =====================================================

async function cargarInventarioCompleto() {
    try {
        const client = window.app?.db || window.supabaseClient;
        const { data, error } = await client
            .from('ferre_inventario')
            .select('*')
            .order('producto', { ascending: true });
        
        if (error) throw error;
        
        ingresoFacturaState.inventarioCompleto = data || [];
    } catch (error) {
    }
}

function buscarProductoIngreso(event) {
    const termino = event.target.value.trim();
    const terminoLower = termino.toLowerCase();
    const resultados = document.getElementById('resultadosBusquedaIngreso');

    // If user pressed Enter, handle special behaviors
    const isEnter = event.key === 'Enter';

    // If less than 2 chars, clear results (avoid aggressive searches)
    if (termino.length < 2) {
        resultados.innerHTML = '';
        return;
    }

    const isNumeric = /^\d+$/.test(termino);

    // Handle numeric-only input specially to avoid accidental additions from fragmented scanner input
    if (isNumeric) {
        // If barcode-like input (5 or more digits) treat as scan: try exact match and add, otherwise open 'nuevo producto' modal prefilled
        if (termino.length >= 5) {
            const productoCodigo = ingresoFacturaState.inventarioCompleto.find(p => (p.codigo || '').toString() === termino);
            if (productoCodigo) {
                agregarProductoDesdeInventario(productoCodigo);
                return;
            } else {
                // No match: wait for explicit Enter from user before opening the create-modal
                if (isEnter) {
                    mostrarModalNuevoProductoIngreso(termino);
                    return;
                } else {
                    resultados.innerHTML = `
                        <div class="resultado-item" style="text-align: center; color: var(--text-secondary);">
                            Código no encontrado. Presione Enter para crear un nuevo producto con este código.
                        </div>
                    `;
                    return;
                }
            }
        }

        // If exactly 4 digits: only add if user pressed Enter (avoid auto-adding while typing)
        if (termino.length === 4) {
            const productoCodigo = ingresoFacturaState.inventarioCompleto.find(p => (p.codigo || '').toString() === termino);
            if (productoCodigo) {
                if (isEnter) {
                    agregarProductoDesdeInventario(productoCodigo);
                    return;
                } else {
                    // show a compact suggestion but do not auto-add
                    resultados.innerHTML = `
                        <div class="resultado-item" onclick='agregarProductoDesdeInventario(${JSON.stringify(productoCodigo)})'>
                            <strong>${productoCodigo.codigo}</strong> - ${productoCodigo.producto}
                            <br>
                            <small>Presiona Enter para agregar</small>
                        </div>
                    `;
                    return;
                }
            } else {
                resultados.innerHTML = `
                    <div class="resultado-item" style="text-align: center; color: var(--text-secondary);">
                        Código no encontrado
                    </div>
                `;
                return;
            }
        }
        // For numeric lengths of 2 or 3, fall through to search behavior below.
    }

    // Búsqueda flexible por palabras no necesariamente seguidas
    // Permite buscar "candado viro" y encontrar "CANDADO 30MM BARRIL VIRO"
    const palabras = terminoLower.split(/\s+/).filter(p => p.length > 0);
    
    const productosFiltrados = ingresoFacturaState.inventarioCompleto.filter(p => {
        const codigo = (p.codigo || '').toString().toLowerCase();
        const nombre = (p.producto || '').toString().toLowerCase();
        
        // Búsqueda por código: debe incluir el término completo
        const codigoMatch = codigo.includes(terminoLower);
        
        // Búsqueda por nombre: TODAS las palabras deben estar presentes (en cualquier orden)
        const nombreMatch = palabras.every(palabra => nombre.includes(palabra));
        
        return codigoMatch || nombreMatch;
    }).slice(0, 15);

    if (productosFiltrados.length === 0) {
        resultados.innerHTML = `
            <div class="resultado-item" style="text-align: center; color: var(--text-secondary);">
                No se encontraron productos
            </div>
        `;
        return;
    }

    // If user pressed Enter and term contains letters, add the first displayed result
    if (isEnter && /[a-zA-Z]/.test(termino)) {
        agregarProductoDesdeInventario(productosFiltrados[0]);
        return;
    }

    resultados.innerHTML = productosFiltrados.map((p, idx) => {
        const firstBadge = idx === 0 ? `<span class="first-badge">1</span>` : '';
        return `
        <div class="resultado-item" onclick='agregarProductoDesdeInventario(${JSON.stringify(p)})'>
            ${firstBadge}
            <strong>${p.codigo}</strong> - ${p.producto}
            <br>
            <small>Precio: $${parseFloat(p.precio_proveedor || 0).toFixed(2)} | Stock: ${p.stock || 0}</small>
        </div>
    `;
    }).join('');
}

function agregarProductoDesdeInventario(producto) {
    
    // Verificar si ya existe
    const existeIndex = ingresoFacturaState.productosEnFactura.findIndex(p => p.codigo === producto.codigo);
    if (existeIndex !== -1) {
        // Si ya existe, incrementar cantidad y mover al inicio
        ingresoFacturaState.productosEnFactura[existeIndex].cantidad += 1;
        ingresoFacturaState.productosEnFactura[existeIndex].subtotal = ingresoFacturaState.productosEnFactura[existeIndex].cantidad * ingresoFacturaState.productosEnFactura[existeIndex].precio_proveedor;
        // Mover elemento al inicio
        const [item] = ingresoFacturaState.productosEnFactura.splice(existeIndex, 1);
        ingresoFacturaState.productosEnFactura.unshift(item);
        renderizarTablaProductos();
        guardarCacheIngreso();
        
        // Mostrar notificación
        if (window.app && window.app.showToast) {
            window.app.showToast('<i class="fas fa-info-circle"></i> Cantidad incrementada', 'info', 2000);
        }
        return;
    }

    // Para productos nuevos, mostrar modal de actualizar inventario
    abrirModalActualizarInventarioIngreso(producto);
    
    // Limpiar búsqueda
    document.getElementById('busquedaProductoIngreso').value = '';
    document.getElementById('resultadosBusquedaIngreso').innerHTML = '';
}

function renderizarTablaProductos() {
    const tbody = document.getElementById('productosIngresoCuerpo');
    if (!tbody) {
        return;
    }

    if (ingresoFacturaState.productosEnFactura.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="8">
                    <div class="empty-state">
                        <i class="fas fa-box-open"></i>
                        <p>No hay productos agregados</p>
                    </div>
                </td>
            </tr>
        `;
        const btnContinuar = document.getElementById('btnContinuarPaso4');
        if (btnContinuar) btnContinuar.disabled = true;
        return;
    }
    
    tbody.innerHTML = ingresoFacturaState.productosEnFactura.map((p, index) => {
        // Asegurar mayúsculas en el nombre antes de renderizar
        p.nombre = (p.nombre || '').toString().toUpperCase();
        // Generar botones de porcentaje
        let botonesPorcentajeHTML = '<div class="flex flex-wrap justify-center items-center gap-1">';
        PORCENTAJES_GANANCIA.forEach(percent => {
            const isActive = p.porcentaje_ganancia === percent;
            botonesPorcentajeHTML += `
                <button type="button" class="percentage-button ${isActive ? 'active' : ''}" onclick="aplicarPorcentaje(${index}, ${percent})" title="Aplicar ${percent}%">${percent}%</button>`;
        });
        botonesPorcentajeHTML += '</div>';
        const cantidadFacturada = parseFloat(p.cantidad) || 0;
        const recepcionIncompleta = p.recepcion_estado === 'INCOMPLETA';
        if (!p.recepcion_estado) p.recepcion_estado = 'COMPLETA';
        if (p.cantidad_recibida === undefined || p.cantidad_recibida === null) p.cantidad_recibida = cantidadFacturada;
        const notaRecepcion = escapeHtml(p.nota_recepcion || '');

        return `
        <tr class="${p.es_producto_nuevo ? 'producto-nuevo' : ''}">
            <td>${p.codigo || ''}</td>
<td class="col-nombre-producto">
    <textarea
        rows="2"
        wrap="soft"
        class="input-nombre-producto"
        oninput="this.value = this.value.toUpperCase(); autoResizeNombreProducto(this)"
        onchange="actualizarProducto(${index}, 'nombre', this.value)"
        onblur="actualizarProducto(${index}, 'nombre', this.value)"
    >${p.nombre || ''}</textarea>
</td>
            <td>
                <div class="xml-receipt-cell">
                    <input type="number" class="xml-billed-quantity" value="${cantidadFacturada}" min="1" step="1"
                           onchange="actualizarProducto(${index}, 'cantidad', this.value)">
                    <small>facturada</small>
                    <div class="xml-receipt-buttons">
                        <button type="button" class="xml-receipt-button complete ${!recepcionIncompleta ? 'selected' : ''}"
                                title="Recibí toda la cantidad y está en buen estado"
                                onclick="actualizarRecepcionProducto(${index}, 'COMPLETA')">
                            <i class="fas fa-check" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="xml-receipt-button incomplete ${recepcionIncompleta ? 'selected' : ''}"
                                title="Recibí una cantidad diferente o hay novedades"
                                onclick="actualizarRecepcionProducto(${index}, 'INCOMPLETA')">
                            <i class="fas fa-times" aria-hidden="true"></i>
                        </button>
                    </div>
                    <input type="number" class="xml-received-quantity" min="0" max="${cantidadFacturada}" step="1"
                           placeholder="Recibidas" value="${recepcionIncompleta && p.cantidad_recibida !== null ? p.cantidad_recibida : ''}"
                           ${recepcionIncompleta ? '' : 'hidden'}
                           oninput="actualizarRecepcionProducto(${index}, 'CANTIDAD', this.value)">
                    <input type="text" class="xml-receipt-note ${recepcionIncompleta && !String(p.nota_recepcion || '').trim() ? 'invalid' : ''}"
                           maxlength="500" placeholder="${recepcionIncompleta ? 'Motivo obligatorio' : 'Nota (opcional)'}"
                           value="${notaRecepcion}"
                           oninput="actualizarRecepcionProducto(${index}, 'NOTA', this.value)">
                </div>
            </td>
            <td>
                <div class=\"currency-input\"><span>$</span>
                <input type=\"number\" value=\"${(p.precio_proveedor || 0).toFixed(2)}\" min=\"0\" step=\"0.01\" onchange=\"actualizarProducto(${index}, 'precio_proveedor', this.value)\"></div>
            </td>
            <td class=\"text-center\">${botonesPorcentajeHTML}</td>
            <td>
                <div class=\"currency-input\"><span>$</span>
                <input type=\"number\" value=\"${(p.precio_venta || 0).toFixed(2)}\" min=\"0\" step=\"0.01\" onchange=\"actualizarProducto(${index}, 'precio_venta', this.value)\"></div>
            </td>
            <td><strong>$${(p.subtotal || 0).toFixed(2)}</strong></td>
            <td>
                <div style="display:flex;gap:6px;justify-content:center;align-items:center;">
                    <button class="btn-action" title="Precio Sugerido (38%)" onclick="calcularSugerido(${index})" style="background:#e6f0ff;border:1px solid #cfe0ff;padding:6px;border-radius:6px;">
                        <i class="fas fa-calculator" style="color:#1e40af"></i>
                    </button>
                    <button class="btn-action" title="Agregar UNIDADES" onclick="agregarUnidades(${index})" ${ (p.codigo||'').toString().length >= 6 ? 'disabled' : '' } style="background:#ecfdf5;border:1px solid #d1f5e0;padding:6px;border-radius:6px;">
                        <i class="fas fa-plus-square" style="color:#059669"></i>
                    </button>
                    <button class="btn-action" title="Cambiar Zona" onclick="mostrarModalCambiarZona(${index})" style="background:#fff7ed;border:1px solid #ffe4b5;padding:6px;border-radius:6px;">
                        <i class="fas fa-map-pin" style="color:#d97706"></i>
                    </button>
                    <button class="btn-eliminar-producto" onclick="eliminarProducto(${index})" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
    
    // Ajustar altura inicial de inputs/areas si es necesario (compat)
    // Recalcular totales
        setTimeout(() => {
        document.querySelectorAll('.input-nombre-producto').forEach(el => {
            autoResizeNombreProducto(el);
        });
    }, 0);
    calcularTotal();

    // Actualizar botones de navegación
    try {
        actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
    } catch (err) {
    }
}

function autoResizeNombreProducto(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Acción: calcular precio sugerido (38%) para la fila
function calcularSugerido(index) {
    const producto = ingresoFacturaState.productosEnFactura[index];
    if (!producto) return;
    const precioCompra = parseFloat(producto.precio_proveedor) || 0;
    producto.precio_venta = calcularPrecioVentaSugeridoCompra(precioCompra);
    producto.porcentaje_ganancia = encontrarPorcentajeMasCercano(precioCompra, producto.precio_venta) || 38;
    producto.subtotal = (parseFloat(producto.precio_proveedor) || 0) * (parseFloat(producto.cantidad) || 1);
    renderizarTablaProductos();
    guardarCacheIngreso();
}

// Acción: mostrar modal para cambiar zona
function mostrarModalCambiarZona(index) {
    productoIndexParaZona = index;
    const producto = ingresoFacturaState.productosEnFactura[index];
    const modal = document.getElementById('modalCambiarZonaIngreso');
    const info = document.getElementById('modalZonaProductoInfo');
    const container = document.getElementById('zonaBotonesModal');
    if (!modal || !container) return;
    // Mostrar la zona en formato "ZONA X" pero guardar internamente solo el número
    const zonaDisplay = producto && producto.zona ? (`ZONA ${producto.zona}`) : '';
    info.textContent = `Producto: ${producto.codigo} - ${producto.nombre} ${zonaDisplay ? ' | ' + zonaDisplay : ''}`;
    container.innerHTML = '';
    const zonas = Array.from({length: 18}, (_, i) => `ZONA ${i+1}`);
    zonas.forEach(z => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-zona';
        btn.textContent = z;
        btn.onclick = () => actualizarZonaProducto(index, z);
        container.appendChild(btn);
    });
    modal.classList.add('active');
}

function cerrarModalCambiarZona() {
    const modal = document.getElementById('modalCambiarZonaIngreso');
    if (modal) modal.classList.remove('active');
    productoIndexParaZona = -1;
}

function actualizarZonaProducto(index, nuevaZona) {
    if (index === undefined || !ingresoFacturaState.productosEnFactura[index]) return;
    // nuevaZona viene como "ZONA 5" desde el modal; almacenar solo el número "5"
    const m = (nuevaZona || '').toString().match(/(\d+)/);
    ingresoFacturaState.productosEnFactura[index].zona = m ? m[1] : nuevaZona;
    cerrarModalCambiarZona();
    renderizarTablaProductos();
    guardarCacheIngreso();
    mostrarNotificacionIngreso(`Zona actualizada a ${nuevaZona} para el producto.`, 'success');
}

// Acción: agregar versión UNIDADES
function agregarUnidades(index) {
    const producto = ingresoFacturaState.productosEnFactura[index];
    if (!producto) return;
    if ((producto.codigo || '').toString().length >= 6 || producto.presentacion === 'UNIDADES') {
        mostrarNotificacionIngreso('No se puede agregar versión "UNIDADES" para este tipo de código o presentación.', 'info');
        return;
    }

    const codigoUnidades = String(producto.codigo) + '001';
    const nombreBase = (producto.nombre || '').replace(/ -[^-]+$/, '').trim();

    if (ingresoFacturaState.productosEnFactura.some(p => p.codigo === codigoUnidades)) {
        mostrarNotificacionIngreso(`El producto ${nombreBase} -UNIDADES ya está en la factura.`, 'info');
        return;
    }

    // Buscar en inventario
    let productoUnidades = ingresoFacturaState.inventarioCompleto.find(p => (p.codigo || '').toString() === codigoUnidades);
    if (!productoUnidades) {
        // Crear como nuevo en inventario
        productoUnidades = {
            id: null,
            codigo: codigoUnidades,
            producto: `${nombreBase} -UNIDADES`,
            precio_proveedor: 0,
            precio: 0,
            zona: producto.zona || '',
            stock: 0
        };
        ingresoFacturaState.inventarioCompleto.push(productoUnidades);
    }

    // Agregar a la factura usando la función existente que normaliza la estructura
    agregarProductoDesdeInventario(productoUnidades);
}

function calcularTotal() {
    const subtotal = ingresoFacturaState.productosEnFactura.reduce((sum, p) => sum + (parseFloat(p.subtotal) || 0), 0);
    const iva = subtotal * 0.15; // IVA 15%
    const total = subtotal + iva;

    // Actualizar resumen si existe
    const resumenSubEl = document.getElementById('resumenSubtotal');
    const resumenTotalEl = document.getElementById('resumenTotal');
    if (resumenSubEl) resumenSubEl.textContent = '$' + subtotal.toFixed(2);
    if (resumenTotalEl) resumenTotalEl.textContent = '$' + total.toFixed(2);

    // También actualizar campos de totales si existen (compatibilidad con antiguo layout)
    const subtotalEl = document.getElementById('subtotal');
    const ivaEl = document.getElementById('iva');
    const totalEl = document.getElementById('total');
    if (subtotalEl) subtotalEl.value = subtotal.toFixed(2);
    if (ivaEl) ivaEl.value = iva.toFixed(2);
    if (totalEl) totalEl.value = total.toFixed(2);

    // Guardar cache y revalidar
    guardarCacheIngreso();
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
}

function actualizarProducto(index, campo, valor) {
    const producto = ingresoFacturaState.productosEnFactura[index];
    if (!producto) return;

    if (campo === 'cantidad' || campo === 'precio_proveedor' || campo === 'precio_venta') {
        valor = parseFloat(valor) || 0;
    }

    if (campo === 'nombre') {
        valor = (valor || '').toString().trim().toUpperCase();
        producto[campo] = valor;
        guardarCacheIngreso();
        return;
    }

    producto[campo] = valor;

    if (campo === 'cantidad' && producto.recepcion_estado !== 'INCOMPLETA') {
        producto.cantidad_recibida = producto.cantidad;
    }

    producto.subtotal = producto.cantidad * producto.precio_proveedor;

    if (campo === 'precio_proveedor') {
        if (producto.porcentaje_ganancia) {
            aplicarPorcentaje(index, producto.porcentaje_ganancia);
            return;
        } else {
            producto.precio_venta = calcularPrecioVentaSugeridoCompra(producto.precio_proveedor);
            producto.porcentaje_ganancia = encontrarPorcentajeMasCercano(producto.precio_proveedor, producto.precio_venta);
        }
    } else if (campo === 'precio_venta') {
        producto.porcentaje_ganancia = encontrarPorcentajeMasCercano(producto.precio_proveedor, producto.precio_venta);
    }

    renderizarTablaProductos();
    guardarCacheIngreso();
}

function actualizarRecepcionProducto(index, campo, valor) {
    const producto = ingresoFacturaState.productosEnFactura[index];
    if (!producto) return;

    if (campo === 'COMPLETA') {
        producto.recepcion_estado = 'COMPLETA';
        producto.cantidad_recibida = Number(producto.cantidad) || 0;
        renderizarTablaProductos();
    } else if (campo === 'INCOMPLETA') {
        producto.recepcion_estado = 'INCOMPLETA';
        if (Number(producto.cantidad_recibida) === Number(producto.cantidad)) producto.cantidad_recibida = null;
        renderizarTablaProductos();
    } else if (campo === 'CANTIDAD') {
        producto.cantidad_recibida = valor === '' ? null : parseFloat(valor);
    } else if (campo === 'NOTA') {
        producto.nota_recepcion = String(valor || '');
    }

    guardarCacheIngreso();
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
}

function validarRecepcionProductos(productos) {
    const errores = [];
    (productos || []).forEach((producto, index) => {
        const facturada = Number(producto.cantidad);
        const estado = producto.recepcion_estado || 'COMPLETA';
        const recibida = estado === 'COMPLETA' ? facturada : Number(producto.cantidad_recibida);
        if (!Number.isFinite(recibida) || recibida < 0 || recibida > facturada) {
            errores.push(`Línea ${index + 1}: la cantidad recibida debe estar entre 0 y ${facturada}.`);
        }
        if (estado === 'INCOMPLETA' && !String(producto.nota_recepcion || '').trim()) {
            errores.push(`Línea ${index + 1}: debes indicar el motivo de la recepción incompleta.`);
        }
    });
    return errores;
}

function eliminarProducto(index) {
    ingresoFacturaState.productosEnFactura.splice(index, 1);
    renderizarTablaProductos();
    guardarCacheIngreso();
    
    // Actualizar botones de navegación
    actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
}

function calcularPorcentajeGanancia(precioCompra, precioVenta) {
    if (precioCompra <= 0) return 0;
    return ((precioVenta - precioCompra) / precioCompra) * 100;
}

// --- Lógica de precios y porcentajes (compatibilidad con código antiguo) ---
function calcularPrecioVentaConFactores(precioCompra, porcentaje) {
    if (precioCompra <= 0 || porcentaje <= 0) return 0;
    const precioFinal = precioCompra * 1.15 * 1.05 * (1 + parseFloat(porcentaje) / 100);
    return precioFinal;
}

function redondearPrecio(precio) {
    if (precio <= 0) return 0;
    let parteEntera = Math.floor(precio);
    let parteDecimal = precio - parteEntera;

    let decimalX10 = Math.round(parteDecimal * 100) / 10;

    if (decimalX10 % 1 < 0.5 && decimalX10 > 0) {
        return parteEntera + Math.floor(decimalX10) / 10;
    } else {
        return parteEntera + Math.ceil(decimalX10) / 10;
    }
}

function aplicarPorcentaje(index, porcentaje) {
    const producto = ingresoFacturaState.productosEnFactura[index];
    if (!producto) return;
    const precioCompra = parseFloat(producto.precio_proveedor) || 0;
    const precioVentaCalculado = calcularPrecioVentaConFactores(precioCompra, porcentaje);
    producto.precio_venta = redondearPrecio(precioVentaCalculado);
    producto.porcentaje_ganancia = porcentaje;
    producto.subtotal = (parseFloat(producto.precio_proveedor) || 0) * (parseFloat(producto.cantidad) || 1);
    renderizarTablaProductos();
    guardarCacheIngreso();
}

function calcularPrecioVentaSugeridoCompra(precioCompra) {
    const precioCalculado = calcularPrecioVentaConFactores(precioCompra, 38);
    return redondearPrecio(precioCalculado);
}

function encontrarPorcentajeMasCercano(precioCompra, precioVenta) {
    if (precioCompra <= 0 || precioVenta <= 0) return null;

    let porcentajeMasCercano = null;
    let diferenciaMinima = Infinity;

    PORCENTAJES_GANANCIA.forEach(p => {
        const precioCalculado = redondearPrecio(calcularPrecioVentaConFactores(precioCompra, p));
        const diferencia = Math.abs(precioVenta - precioCalculado);

        if (diferencia < 0.01) {
            porcentajeMasCercano = p;
            diferenciaMinima = 0;
            return;
        }

        if (diferencia < diferenciaMinima) {
            diferenciaMinima = diferencia;
            porcentajeMasCercano = p;
        }
    });

    if (diferenciaMinima > 0.05) return null;
    return porcentajeMasCercano;
}

function calcularPrecioVentaSugerido() {
    const precioProveedor = parseFloat(document.getElementById('precioProveedorNuevoProducto').value) || 0;
    const precioVentaInput = document.getElementById('precioVentaNuevoProducto');
    // Usar la lógica con factores y 38% por defecto para sugerir el precio de venta
    const precioSugerido = calcularPrecioVentaSugeridoCompra(precioProveedor);
    if (precioVentaInput) precioVentaInput.value = precioSugerido.toFixed(2);
}

// =====================================================
// PASO 5: RESUMEN
// =====================================================

function actualizarResumenFactura() {
    const proveedor = ingresoFacturaState.proveedorSeleccionado;
    const productos = ingresoFacturaState.productosEnFactura;
    
    // Datos básicos
    document.getElementById('resumenProveedor').textContent = proveedor.empresa;
    document.getElementById('resumenNumero').textContent = document.getElementById('numeroFacturaIngreso').value;
    document.getElementById('resumenFechaEmision').textContent = formatDate(document.getElementById('fechaEmisionIngreso').value);
    document.getElementById('resumenFechaVencimiento').textContent = formatDate(document.getElementById('fechaVencimientoIngreso').value);
    document.getElementById('resumenMetodoPago').textContent = formatMetodoPagoDisplay(ingresoFacturaState.metodoPago);
    document.getElementById('resumenTotalItems').textContent = productos.length;
    
    // Cálculos
    const subtotal = productos.reduce((sum, p) => sum + p.subtotal, 0);
    // El IVA es fijo al 15% según requerimiento
    const iva = subtotal * 0.15;
    const descuento = ingresoFacturaState.descuento || 0;
    
    // El total no puede ser negativo
    let total = subtotal + iva - descuento;
    if (total < 0) total = 0;

    document.getElementById('resumenSubtotal').textContent = '$' + subtotal.toFixed(2);
    document.getElementById('resumenIva').textContent = '$' + iva.toFixed(2);
    
    const descuentoInput = document.getElementById('descuentoInput');
    if (descuentoInput && !descuentoInput.matches(':focus')) {
        // Solo actualizar el valor del input si no tiene el foco para no interrumpir al usuario
        descuentoInput.value = descuento > 0 ? descuento.toFixed(2) : '';
    }

    document.getElementById('resumenTotal').textContent = '$' + total.toFixed(2);
}

// Funciones para manejar cambios en Descuento con normalización (coma a punto)
function actualizarDescuento(valor) {
    // Normalizar: cambiar comas por puntos y eliminar caracteres no numéricos excepto el punto
    let valorNormalizado = valor.toString().replace(/,/g, '.').replace(/[^0-9.]/g, '');
    
    // Si hay más de un punto, quedarse solo con el primero
    const partes = valorNormalizado.split('.');
    if (partes.length > 2) {
        valorNormalizado = partes[0] + '.' + partes.slice(1).join('');
    }

    const num = parseFloat(valorNormalizado) || 0;
    ingresoFacturaState.descuento = num;
    
    // Recalcular solo los totales sin redibujar todo el input si es posible
    const subtotal = ingresoFacturaState.productosEnFactura.reduce((sum, p) => sum + p.subtotal, 0);
    const iva = subtotal * 0.15;
    let total = subtotal + iva - num;
    if (total < 0) total = 0;
    
    document.getElementById('resumenTotal').textContent = '$' + total.toFixed(2);
    
    // Guardar en caché
    guardarCacheIngreso();
}

// Formatea el método de pago para mostrarlo de forma legible en el resumen
function formatMetodoPagoDisplay(metodo) {
    if (!metodo) return '-';
    // Ejemplos de entrada: 'PLAZO' o 'CONTADO - EFECTIVO' o 'CONTADO - TRANSFERENCIA'
    if (metodo.startsWith('CONTADO')) {
        if (metodo.includes('EFECTIVO')) return 'Contado (Efectivo)';
        if (metodo.includes('TRANSFERENCIA')) return 'Contado (Transferencia)';
        // fallback
        return 'Contado';
    }
    if (metodo === 'PLAZO') return 'Plazo';
    // fallback: capitalizar y reemplazar guiones
    return metodo
        .toLowerCase()
        .split(' - ')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' - ');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// =====================================================
// GUARDAR FACTURA
// =====================================================

// Normaliza la información del usuario actual desde distintas fuentes globales
function getCurrentUserInfo() {
    try {
        const fromApp = (window.app && window.app.currentUser) ? window.app.currentUser : null;
        const fromWindow = window.currentUser || null;
        const fromData = window.currentUserData || null;

        let fromGlobal = null;
        try {
            // eslint-disable-next-line no-undef
            if (typeof currentUser !== 'undefined' && currentUser) {
                // eslint-disable-next-line no-undef
                fromGlobal = currentUser;
            }
        } catch (e) {}

        const u = fromApp || fromWindow || fromGlobal || fromData || null;

        if (!u) return { email: null, id: null, name: null };

        const email = u.email || u.correo || null;
        const id = u.id || u.user_id || null;

        let name = null;
        // Primero intentar obtener del elemento userName en el navbar
        const userNameElement = document.getElementById('userName');
        if (userNameElement && userNameElement.textContent.trim() && userNameElement.textContent.trim() !== 'Usuario') {
            name = userNameElement.textContent.trim();
        }
        // Si no está en el elemento, intentar de los metadatos del usuario
        else if (u.nombres && u.apellidos) name = `${u.nombres} ${u.apellidos}`;
        else if (u.full_name) name = u.full_name;
        else if (u.name) name = u.name;
        else if (u.displayName) name = u.displayName;
        // Importante: aquí ya NO caemos al correo como nombre, así el webhook no muestra email

        return { email, id, name };
    } catch (e) {
        return { email: null, id: null, name: null };
    }
}

async function guardarFacturaIngreso() {
    try {
        // Prevenir clics duplicados
        const btnGuardar = document.querySelector('button[onclick="guardarFacturaIngreso()"]');
        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        }

        // Mostrar overlay de progreso con mensaje inicial
        showSavingProduct('Iniciando registro...', 1, 5);
        
        const client = window.app?.db || window.supabaseClient;
        const proveedor = ingresoFacturaState.proveedorSeleccionado;
        if (!proveedor || !proveedor.id) throw new Error('Proveedor no seleccionado');
        const productos = ingresoFacturaState.productosEnFactura;
        const erroresRecepcion = validarRecepcionProductos(productos);
        if (erroresRecepcion.length) throw new Error(erroresRecepcion.join(' '));
        
        // Calcular total
        const subtotal = productos.reduce((sum, p) => sum + p.subtotal, 0);
        const iva = subtotal * 0.15; // IVA 15% fijo
        const descuento = ingresoFacturaState.descuento || 0;
        
        // El total no puede ser negativo
        let totalFactura = subtotal + iva - descuento;
        if (totalFactura < 0) totalFactura = 0;

        showSavingProduct('Guardando cabecera de factura...', 2, 5);

        // Determinar si es crédito/plazo: el método puede venir como 'PLAZO' o 'CONTADO - EFECTIVO'
        const metodoPagoRaw = (ingresoFacturaState.metodoPago || '').toString().toUpperCase();
        const esCredito = metodoPagoRaw.includes('PLAZO') || metodoPagoRaw.includes('CREDITO');

        // Preparar datos de la factura
        const facturaData = {
            numero_factura: document.getElementById('numeroFacturaIngreso').value,
            fecha_emision: document.getElementById('fechaEmisionIngreso').value,
            fecha_vencimiento: document.getElementById('fechaVencimientoIngreso').value,
            proveedor_id: proveedor.id,
            total_factura: totalFactura,
            iva: iva,
            descuento: descuento,
            // Si es a plazo/crédito, el saldo pendiente es el total; si es contado, es 0
            saldo_pendiente: esCredito ? totalFactura : 0,
            notas: document.getElementById('notasFacturaIngreso').value || null
        };
        
        // Insertar factura
        const { data: facturaInsertada, error: errorFactura } = await client
            .from('ferre_facturas_proveedores')
            .insert([facturaData])
            .select()
            .single();
        
        if (errorFactura) throw errorFactura;
        
        showSavingProduct('Registrando detalles de productos...', 3, 5);

        // Insertar detalles de productos
        const detallesData = productos.map(p => ({
            factura_id: facturaInsertada.id,
            producto_id: p.producto_id,
            codigo_producto: p.codigo,
            nombre_producto: p.nombre,
            cantidad: p.cantidad,
            cantidad_recibida: p.recepcion_estado === 'COMPLETA' ? p.cantidad : p.cantidad_recibida,
            notas: p.nota_recepcion || null,
            precio_proveedor: p.precio_proveedor,
            precio_venta: p.precio_venta,
            porcentaje_ganancia: p.porcentaje_ganancia,
            zona: p.zona,
            es_producto_nuevo: p.es_producto_nuevo
        }));
        
        const { error: errorDetalles } = await client
            .from('ferre_detalle_facturas_proveedores')
            .insert(detallesData);
        
        if (errorDetalles) throw errorDetalles;

        let advertenciaVinculosXml = null;
        if (ingresoFacturaState.origenXml && typeof window.posApiRequest === 'function') {
            try {
                const vinculos = productos
                    .filter((producto) => producto.xml_vinculo)
                    .map((producto) => ({
                        producto_id: producto.producto_id,
                        ...producto.xml_vinculo,
                        ultimo_costo_neto: Number(producto.precio_proveedor) || 0
                    }));
                if (vinculos.length) {
                    await window.posApiRequest('/api/purchases/v2/product-providers/sync-xml', {
                        method: 'POST',
                        body: JSON.stringify({ proveedor_id: proveedor.id, vinculos })
                    });
                }
            } catch (errorVinculos) {
                console.error('La factura se guardó, pero no se sincronizaron los vínculos XML:', errorVinculos);
                advertenciaVinculosXml = errorVinculos.message || 'No fue posible sincronizar los vínculos XML.';
            }
        }
        
        // Si el pago no es a crédito, registrar el pago
        if (!esCredito) {
            showSavingProduct('Registrando pago de contado...', 4, 5);
            const pagoData = {
                factura_id: facturaInsertada.id,
                monto_pago: totalFactura,
                metodo_pago: ingresoFacturaState.metodoPago,
                tipo_pago: 'Total',
                referencia_pago: facturaInsertada.numero_factura,
                saldo_nuevo: 0
            };

            // Insert pago_proveedores as usual
            const { error: errorPago } = await client
                .from('ferre_pagos_proveedores')
                .insert([pagoData]);

            if (errorPago) throw errorPago;

            // Si el método de pago incluye TRANSFERENCIA, además registrar en tabla `transferencias`
            try {
                const metodoUpper = (ingresoFacturaState.metodoPago || '').toString().toUpperCase();
                if (metodoUpper.includes('TRANSFER')) {
                    // preparar motivo
                    const proveedorNombre = (proveedor && (proveedor.empresa || proveedor.nombre || proveedor.nombre_proveedor)) || (proveedor && proveedor.empresa) || 'PROVEEDOR';
                    const motivo = `Pago a ${proveedorNombre} por el pago de la factura ${facturaData.numero_factura} con el valor de $${totalFactura.toFixed(2)}`;

                    // generar imagen PNG en base64 con un comprobante simple
                    const fotoDataUrl = generarComprobantePagoCanvas({proveedor: proveedorNombre, numeroFactura: facturaData.numero_factura, monto: totalFactura, fecha: facturaData.fecha_emision});

                    // construir objeto para transferencias
                    // NOTE: la columna `foto_url` no existe en el esquema; evitar enviarla.
                    // Usar un placeholder URL pública para `fotografia` tal como solicitó el usuario.
                    const { email: userEmail, id: userId, name: userName } = getCurrentUserInfo();
                    const transferenciaRow = {
                        caso: 'egreso',
                        monto: totalFactura,
                        motivo: motivo,
                        fotografia: 'https://urlnodisponible.com', // placeholder solicitado
                        fechahora: new Date().toISOString(),
                        subido_por: userEmail,
                        user_id: userId
                    };

                    // insertar en tabla transferencias
                    try {
                        const { data: transferenciaInsertada, error: errTrans } = await client
                            .from('ferre_transferencias')
                            .insert([transferenciaRow])
                            .select()
                            .single();

                        if (errTrans) {
                        } else {
                            // notificar (webhook) de forma asíncrona
                            try {
                                // Enviar la notificación usando la imagen base64 generada (fotoDataUrl)
                                const transferenciaConFoto = Object.assign({}, transferenciaInsertada, {
                                    foto_url: fotoDataUrl,
                                    subido_por_nombre: userName || userEmail || transferenciaInsertada.subido_por || null
                                });
                                enviarNotificacionTransferencia(transferenciaConFoto, client).then(r => {
                                });
                            } catch (notifyErr) {
                            }
                        }
                    } catch (insErr) {
                    }
                } else if (metodoUpper.includes('EFECTIVO')) {
                    try {
                        const proveedorNombre = (proveedor && (proveedor.empresa || proveedor.nombre || proveedor.nombre_proveedor)) || (proveedor && proveedor.empresa) || 'PROVEEDOR';
                        const { name: userName } = getCurrentUserInfo();
                        const fotoDataUrl = generarComprobantePagoEfectivoCanvas({
                            proveedor: proveedorNombre,
                            numeroFactura: facturaData.numero_factura,
                            monto: totalFactura,
                            fecha: facturaData.fecha_emision
                        });

                        enviarNotificacionPagoEfectivo({
                            proveedor: proveedorNombre,
                            numeroFactura: facturaData.numero_factura,
                            monto: totalFactura,
                            fechahora: new Date().toISOString(),
                            foto_url: fotoDataUrl,
                            subido_por_nombre: userName || 'Usuario'
                        }, client).then(r => {
                        });
                    } catch (notifyCashErr) {
                    }
                }
            } catch (innerErr) {
            }
        }

        showSavingProduct('Actualizando inventarios...', 5, 5);
        
        // Actualizar inventario para productos nuevos y obtener resumen
        const procResults = await procesarProductosNuevos(productos);

        hideSavingProduct();

        // Limpiar caché después de guardado exitoso
        try {
            limpiarCacheIngreso();
            if (typeof window.clearInvoiceIntakeCache === 'function') window.clearInvoiceIntakeCache();
        } catch (err) {
        }

        // Construir resumen de inventario para mostrar en la alerta de éxito
        try {
            let updatedLines = [];
            let insertedLines = [];
            let failedLines = [];

            if (Array.isArray(procResults)) {
                procResults.forEach(r => {
                    if (r.action === 'updated') {
                        updatedLines.push(`${r.codigo}: ${r.previousStock} → ${r.nuevoStock}`);
                    } else if (r.action === 'inserted') {
                        insertedLines.push(`${r.codigo} - ${r.producto} (stock ${r.cantidad})`);
                    } else if (r.action && r.action.endsWith('_failed')) {
                        failedLines.push(`${r.codigo}: ${r.action}`);
                    }
                });
            }

            // Construir tabla HTML de detalles
            let filasHtml = '';
            if (updatedLines.length > 0) {
                updatedLines.forEach(line => {
                    const parts = line.split(':');
                    const codigo = parts[0] || '';
                    const stocks = (parts[1] || '').split('→').map(s => s.trim());
                    filasHtml += `<tr class="updated"><td>Actualizado</td><td>${escapeHtml(codigo)}</td><td>-</td><td>${escapeHtml(stocks[0]||'')}</td><td>${escapeHtml(stocks[1]||'')}</td><td>OK</td></tr>`;
                });
            }
            if (insertedLines.length > 0) {
                insertedLines.forEach(line => {
                    const m = line.match(/^(.*?) - (.*?) \(stock (.*?)\)$/);
                    const codigo = m ? m[1] : '';
                    const nombre = m ? m[2] : '';
                    const cantidad = m ? m[3] : '';
                    filasHtml += `<tr class="inserted"><td>Nuevo</td><td>${escapeHtml(codigo)}</td><td>${escapeHtml(nombre)}</td><td>-</td><td>${escapeHtml(cantidad)}</td><td>OK</td></tr>`;
                });
            }
            if (failedLines.length > 0) {
                failedLines.forEach(line => {
                    const parts = line.split(':');
                    const codigo = parts[0] || '';
                    const estado = parts[1] || '';
                    filasHtml += `<tr class="failed"><td>Error</td><td>${escapeHtml(codigo)}</td><td>-</td><td>-</td><td>-</td><td>${escapeHtml(estado)}</td></tr>`;
                });
            }

            const detallesHtml = `
                <div style="font-size: 1.1em; margin-bottom: 20px; color: #1e293b; font-weight: 600;">
                    ¡Factura N° ${facturaData.numero_factura} registrada correctamente por $${totalFactura.toFixed(2)}!
                </div>
                <div class="alert-details-table">
                    <table class="alert-table">
                        <thead>
                            <tr><th>Tipo</th><th>Código</th><th>Producto</th><th>Stock anterior</th><th>Stock actual</th><th>Estado</th></tr>
                        </thead>
                        <tbody>
                            ${filasHtml || '<tr><td colspan="6">Sin cambios en inventario</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;

            if (advertenciaVinculosXml) {
                detallesHtml += `<p style="margin:16px 0 0;color:#8a4b00;font-weight:600;">La factura quedó registrada, pero debes revisar la vinculación automática: ${escapeHtml(advertenciaVinculosXml)}</p>`;
            }
            await proveedoresAlert('El proceso de ingreso de factura ha finalizado con éxito.', advertenciaVinculosXml ? 'warning' : 'success', advertenciaVinculosXml ? 'Factura registrada con advertencia' : '¡Registro Exitoso!', detallesHtml);
        } catch (errAlert) {
            await proveedoresAlert('Factura guardada exitosamente', 'success', '¡Éxito!');
        }

        // Reiniciar y volver al modo facturas
        reiniciarIngresoFacturaTotal();
        
    } catch (error) {
        hideSavingProduct();
        console.error('Error al guardar:', error);
        
        // Reactivar botón en caso de error
        const btnGuardar = document.querySelector('button[onclick="guardarFacturaIngreso()"]');
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = '<i class="fas fa-save"></i> Guardar Factura';
        }

        await proveedoresAlert('Error al guardar la factura: ' + error.message, 'error', 'Error de Guardado');
    }
}

// Función auxiliar para reiniciar todo el estado después de un guardado exitoso
function reiniciarIngresoFacturaTotal() {
    try {
        ingresoFacturaState = {
            pasoActual: 1,
            proveedorSeleccionado: null,
            metodoPago: null,
            productosEnFactura: [],
            inventarioCompleto: ingresoFacturaState.inventarioCompleto,
            proveedoresDisponibles: ingresoFacturaState.proveedoresDisponibles,
            descuento: 0
        };

        const fields = ['numeroFacturaIngreso', 'fechaEmisionIngreso', 'fechaVencimientoIngreso', 'notasFacturaIngreso', 'busquedaProductoIngreso'];
        fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

        document.querySelectorAll('.proveedor-btn-ingreso.selected').forEach(b => b.classList.remove('selected'));
        
        mostrarPasoIngreso(1);
        cargarProveedoresIngreso();
    } catch (err) {
        console.error('Error al reiniciar:', err);
        // Fallback: recargar la página si falla el reinicio manual
        location.reload();
    }
}

// Genera un sencillo comprobante en canvas y devuelve un dataURL PNG
function generarComprobantePagoCanvas({proveedor, numeroFactura, monto, fecha}){
    try{
        const canvas = document.createElement('canvas');
        const width = 800, height = 400;
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        // fondo
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,width,height);
        // título
        ctx.fillStyle = '#111827';
        ctx.font = '700 28px Arial';
        ctx.fillText('Comprobante de Transferencia', 40, 60);
        ctx.font = '600 20px Arial';
        ctx.fillText(`Proveedor: ${proveedor}`, 40, 110);
        ctx.fillText(`Factura: ${numeroFactura}`, 40, 150);
        ctx.fillText(`Monto: $${(monto||0).toFixed(2)}`, 40, 190);
        ctx.fillText(`Fecha: ${fecha || new Date().toISOString().split('T')[0]}`, 40, 230);
        ctx.font = '16px Arial';
        ctx.fillStyle = '#374151';
        ctx.fillText('Generado por FERRETERIA App', 40, 320);
        return canvas.toDataURL('image/png');
    }catch(e){
        return null;
    }
}

function generarComprobantePagoEfectivoCanvas({proveedor, numeroFactura, monto, fecha}){
    try{
        const canvas = document.createElement('canvas');
        const width = 800, height = 360;
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,width,height);

        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 5;
        ctx.strokeRect(16, 16, width - 32, height - 32);

        ctx.fillStyle = '#2563eb';
        ctx.font = '700 28px Arial';
        ctx.fillText('Comprobante de Pago en Efectivo', 40, 60);

        ctx.strokeStyle = '#dbeafe';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(40, 82);
        ctx.lineTo(width - 40, 82);
        ctx.stroke();

        ctx.font = '600 20px Arial';
        ctx.fillStyle = '#111827';
        ctx.fillText(`Proveedor: ${proveedor}`, 40, 125);
        ctx.fillText(`Factura: ${numeroFactura}`, 40, 165);

        ctx.font = '700 24px Arial';
        ctx.fillStyle = '#2563eb';
        ctx.fillText(`Monto: $${(monto||0).toFixed(2)}`, 40, 210);

        ctx.font = '18px Arial';
        ctx.fillStyle = '#374151';
        ctx.fillText(`Fecha: ${fecha || new Date().toISOString().split('T')[0]}`, 40, 250);

        ctx.font = '16px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('Generado por FERRETERIA App', 40, 310);
        return canvas.toDataURL('image/png');
    }catch(e){
        return null;
    }
}

async function enviarNotificacionPagoEfectivo(pago, supabaseClient){
    try{
        const fecha = new Date(pago.fechahora);
        const fechaFormateada = fecha.toLocaleDateString('es-EC', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const horaFormateada = fecha.toLocaleTimeString('es-EC', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const montoFormateado = parseFloat(pago.monto).toFixed(2);

        const mensaje = `💵 *Pago a Proveedor en Efectivo*\n\n📅 *Fecha:* ${fechaFormateada}\n🕐 *Hora:* ${horaFormateada}\n\n🏢 *Proveedor:* ${pago.proveedor}\n🧾 *Factura:* ${pago.numeroFactura}\n💵 *Monto:* $${montoFormateado}\n\n👤 *Registrado por:*\n${pago.subido_por_nombre || 'N/A'}\n\n📸 *Comprobante adjunto*\n\n_Sistema de Gestión Ferrisoluciones_`;

        let mediaToSend = pago.foto_url || '';
        if (typeof mediaToSend === 'string' && mediaToSend.startsWith('data:')) {
            const commaIdx = mediaToSend.indexOf(',');
            if (commaIdx !== -1) mediaToSend = mediaToSend.substring(commaIdx + 1);
        }

        const payloadObject = {
            mediatype: 'image',
            mimetype: 'image/png',
            caption: mensaje,
            media: mediaToSend,
            fileName: `PAGO_EFECTIVO_${fechaFormateada.replace(/\//g, '-')}_${horaFormateada.replace(/:/g, '-')}.png`,
            delay: 1000,
            linkPreview: false
        };

        const data = await posApiRequest('/api/whatsapp/send-media', {
            method: 'POST',
            body: JSON.stringify({ media: payloadObject })
        });

        return { success: true, data };
    }catch(error){
        return { success: false, error: error.message };
    }
}

// Enviar notificación de transferencia usando el módulo de TRANSFERENCIAS/whatsapp-webhook.js
async function enviarNotificacionTransferencia(transferencia, supabaseClient){
    try{
        // intentamos usar una función global del módulo transferencias si existe
        if (window && typeof window.notificarTransferencia === 'function'){
            return await window.notificarTransferencia(transferencia, supabaseClient);
        }

        // si no existe, intentamos llamar a la función exportada `notificarTransferencia` si está definida
        if (typeof notificarTransferencia === 'function'){
            return await notificarTransferencia(transferencia, supabaseClient);
        }

        // Si no hay módulo externo, usar la implementación local replicada del webhook
        if (typeof notificarTransferenciaLocal === 'function') {
            return await notificarTransferenciaLocal(transferencia, supabaseClient);
        }

        // fallback: intentar cargar el endpoint directo conocido (se respetan CORS y credenciales)
        // si no podemos notificar, devolvemos un objeto indicando que no se envió
        return { success: false, reason: 'no_notifier_available' };
    }catch(err){
        return { success: false, reason: err };
    }
}

// --- Implementación local segura por backend ---
async function enviarNotificacionWhatsAppLocal(transferencia) {
    try {
        // Formatear la fecha y hora
        const fecha = new Date(transferencia.fechahora);
        const fechaFormateada = fecha.toLocaleDateString('es-EC', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const horaFormateada = fecha.toLocaleTimeString('es-EC', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const emoji = transferencia.caso === 'ingreso' ? '💰' : '💸';
        const tipoMovimiento = transferencia.caso === 'ingreso' ? 'INGRESO' : 'EGRESO';
        const montoFormateado = parseFloat(transferencia.monto).toFixed(2);

        const mensaje = `${emoji} *Nueva Transferencia Registrada*\n\n*DETALLES DEL MOVIMIENTO*\n\n\n📅 *Fecha:* ${fechaFormateada}\n🕐 *Hora:* ${horaFormateada}\n\n${transferencia.caso === 'ingreso' ? '✅' : '❌'} *Tipo:* ${tipoMovimiento}\n💵 *Monto:* $${montoFormateado}\n\n📝 *Motivo:*\n${transferencia.motivo}\n\n👤 *Registrado por:*\n${transferencia.subido_por_nombre || transferencia.subido_por || 'N/A'}\n\n📸 *Comprobante adjunto*\n\n_Sistema de Gestión Ferrisoluciones_\n_Powered by Ferrisoluciones Tech_`;

        // Detectar si el media es un data URL (base64) y ajustar mimetype/extension
        let mediaValue = transferencia.foto_url || transferencia.fotografia || '';
        let detectedMimetype = 'image/jpeg';
        let extension = 'jpg';
        if (typeof mediaValue === 'string' && mediaValue.startsWith('data:')) {
            // ejemplo: data:image/png;base64,iVBORw0KG...
            const m = mediaValue.match(/^data:([^;]+);base64,/);
            if (m && m[1]) {
                detectedMimetype = m[1];
                // extraer extensión a partir del mimetype
                extension = detectedMimetype.split('/')[1] || extension;
            }
        } else {
            // si es una URL terminada en extensión conocida, inferir
            try {
                const urlLower = String(mediaValue).toLowerCase();
                if (urlLower.endsWith('.png')) { detectedMimetype = 'image/png'; extension = 'png'; }
                else if (urlLower.endsWith('.jpeg') || urlLower.endsWith('.jpg')) { detectedMimetype = 'image/jpeg'; extension = 'jpg'; }
                else if (urlLower.endsWith('.webp')) { detectedMimetype = 'image/webp'; extension = 'webp'; }
            } catch(e){}
        }

        const fileName = `TRANSFERENCIA_${fechaFormateada.replace(/\//g, '-')}_${horaFormateada.replace(/:/g, '-')}.${extension}`;

        // Enviar SOLO base64 cuando mediaValue es data URL (la API requiere 'url' o 'base64')
        let mediaToSend = mediaValue;
        if (typeof mediaToSend === 'string' && mediaToSend.startsWith('data:')) {
            const commaIdx = mediaToSend.indexOf(',');
            if (commaIdx !== -1) mediaToSend = mediaToSend.substring(commaIdx + 1);
        }

        const payloadObject = {
            mediatype: 'image',
            mimetype: detectedMimetype,
            caption: mensaje,
            media: mediaToSend,
            fileName: fileName,
            delay: 1000,
            linkPreview: false
        };

        const data = await posApiRequest('/api/whatsapp/send-media', {
            method: 'POST',
            body: JSON.stringify({ media: payloadObject })
        });

        return { success: true, data };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function notificarTransferenciaLocal(transferencia, supabase) {
    try {
        const resultado = await enviarNotificacionWhatsAppLocal(transferencia);
        return resultado;
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function procesarProductosNuevos(productos) {
    // Optimized processing:
    // 1) Query existing inventory rows for all códigos en una sola llamada
    // 2) Preparar dos arrays: upsertRows (metadata + new rows with stock) y stockIncrements (codigo,cantidad)
    // 3) Ejecutar un upsert para metadata (nombre, precio, zona) usando onConflict='codigo'
    // 4) Intentar llamar a una RPC 'increment_stock' para aplicar los incrementos de stock en el servidor
    //    (evita múltiples roundtrips). Si RPC no existe, hacer un fallback con actualizaciones paralelas.

    if (!productos || productos.length === 0) return [];

    const client = window.app?.db || window.supabaseClient;
    const proveedorId = ingresoFacturaState.proveedorSeleccionado ? ingresoFacturaState.proveedorSeleccionado.id : null;

    const results = [];

    // Helper: progress UI for inventory updates
    function showInventoryProgress() {
        try {
            const overlay = document.getElementById('inventarioProgress');
            const bar = document.getElementById('inventarioProgressBar');
            const text = document.getElementById('inventarioProgressText');
            if (overlay) overlay.classList.remove('hidden');
            if (bar) { bar.style.width = '5%'; }
            if (text) text.textContent = '5%';
        } catch (e) { }
    }

    function setInventoryProgress(percent, label) {
        try {
            const bar = document.getElementById('inventarioProgressBar');
            const text = document.getElementById('inventarioProgressText');
            if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
            if (text) text.textContent = Math.round(Math.max(0, Math.min(100, percent))) + '%';
            if (label) {
                const title = document.querySelector('#inventarioProgress .progress-title');
                if (title) title.textContent = label;
            }
        } catch (e) { }
    }

    function hideInventoryProgress() {
        try {
            const overlay = document.getElementById('inventarioProgress');
            if (overlay) {
                // small delay to let 100% show
                setTimeout(()=> overlay.classList.add('hidden'), 350);
            }
        } catch (e) { }
    }

    // show progress overlay
    showInventoryProgress();

    // Normalizar códigos y obtener lista única
    const codes = Array.from(new Set(productos.map(p => (p && p.codigo) ? p.codigo.toString() : '').filter(Boolean)));
    if (codes.length === 0) return results;

    // 1) Traer filas existentes usando chunks para evitar URLs largas
    let existingRows = [];
    try {
        const chunkSize = 15; // Tamaño conservador para evitar errores 400
        for (let i = 0; i < codes.length; i += chunkSize) {
            const chunk = codes.slice(i, i + chunkSize);
            const { data, error } = await client
                .from('ferre_inventario')
                .select('id,codigo,stock,precio,producto,zona')
                .in('codigo', chunk);
            if (error) throw error;
            if (data) existingRows = existingRows.concat(data);
        }
    } catch (err) {
        existingRows = [];
    }

    const existingMap = {};
    existingRows.forEach(r => { if (r && r.codigo) existingMap[r.codigo.toString()] = r; });

    // Preparar arrays
    const upsertRows = [];
    const stockIncrements = [];

    productos.forEach(p => {
        try {
            const codigo = (p.codigo || '').toString();
            if (!codigo) {
                results.push({ codigo: null, action: 'skipped', reason: 'sin codigo' });
                return;
            }

            const cantidad = parseFloat(p.cantidad_recibida ?? p.cantidad) || 0;
            // zona en el estado puede ser '5' (num) o vacío; asegurarse de extraer dígitos
            const zonaNumMatch = (p.zona || '').toString().match(/(\d+)/);
            const zonaNum = zonaNumMatch ? parseInt(zonaNumMatch[1], 10) : null;
            const precioProveedor = parseFloat(p.precio_proveedor) || 0;
            const precioVenta = parseFloat(p.precio_venta) || precioProveedor || 0;

            const existing = existingMap[codigo];

            if (existing) {
                // Para filas existentes: preparar metadata para upsert usando valores existentes
                // y garantizar que todos los campos NOT NULL estén presentes con defaults seguros.
                upsertRows.push({
                    codigo: codigo,
                    producto: p.nombre || existing.producto || codigo,
                    precio: precioVenta || parseFloat(existing.precio) || 0,
                    precio_proveedor: precioProveedor || parseFloat(existing.precio_proveedor) || 0,
                    zona: zonaNum !== null ? zonaNum : (existing.zona !== undefined && existing.zona !== null ? existing.zona : 0),
                    proveedor_id: (existing.proveedor_id && existing.proveedor_id !== '') ? existing.proveedor_id : (proveedorId || ''),
                    unidad_paquete: existing.unidad_paquete || p.unidad_paquete || 'UNIDADES',
                    stock_minimo: (existing.stock_minimo !== undefined && existing.stock_minimo !== null) ? existing.stock_minimo : 0,
                    // preserve existing stock to avoid sending null to upsert for existing rows
                    stock: (existing.stock !== undefined && existing.stock !== null) ? Number(existing.stock) : 0
                });

                stockIncrements.push({ codigo, cantidad });

                // Registrar provisionalmente el resultado updated (se confirmará tras el incremento)
                results.push({ codigo, action: 'to_update', previousStock: parseFloat(existing.stock) || 0, increment: cantidad });
            } else {
                // Nuevo registro: incluir stock para la inserción
                upsertRows.push({
                    codigo: codigo,
                    producto: p.nombre || p.producto || codigo,
                    precio: precioVenta || 0,
                    precio_proveedor: precioProveedor || 0,
                    zona: zonaNum !== null ? zonaNum : 0,
                    proveedor_id: proveedorId || '',
                    stock: cantidad,
                    stock_minimo: 1,
                    unidad_paquete: p.unidad_paquete || 'UNIDADES'
                });

                // Registrar provisional insert
                results.push({ codigo, action: 'to_insert', cantidad });
            }
        } catch (err) {
            results.push({ codigo: p && p.codigo ? p.codigo : null, action: 'exception_prepare', error: err });
        }
        // update simple progress while preparing rows
        try {
            const prepared = upsertRows.length;
            const pct = 10 + Math.floor((prepared / (productos.length || 1)) * 40); // prepare phase: 10%->50%
            setInventoryProgress(pct, 'Preparando datos...');
        } catch(e){}
    });

    // 2) Ejecutar upsert para metadata y nuevas filas
    if (upsertRows.length > 0) {
        try {

            // move progress to upsert phase
            try { setInventoryProgress(55, 'Enviando cambios al servidor...'); } catch(e){}

            // Validate upsertRows: ensure required NOT NULL columns are present.
            // We do NOT want to silently force stock to 0; instead, detect missing stock and abort so user can correct.
            const missingStockCodes = [];
            upsertRows.forEach((row) => {
                // proveedor_id ensure string
                if (row.proveedor_id === undefined || row.proveedor_id === null) row.proveedor_id = '';

                // producto ensure not null
                if (!row.producto) row.producto = row.codigo || '';

                // stock_minimo default to 0 if absent (safe)
                if (row.stock_minimo === undefined || row.stock_minimo === null || Number.isNaN(Number(row.stock_minimo))) {
                    row.stock_minimo = 0;
                } else {
                    row.stock_minimo = Number(row.stock_minimo);
                }

                // Only require 'stock' for rows that are NEW inserts (no existing row in DB)
                const existed = existingMap && existingMap[row.codigo];
                if (!existed) {
                    // For inserts we expect 'stock' to be a valid number (coming from cantidad).
                    if (row.stock === undefined || row.stock === null || Number.isNaN(Number(row.stock))) {
                        // try to fallback to cantidad from productos list if available
                        const prodObj = productos.find(pp => (pp && pp.codigo && pp.codigo.toString()) === (row.codigo && row.codigo.toString()));
                        const fallbackCantidad = prodObj ? (parseFloat(prodObj.cantidad) || null) : null;
                        if (fallbackCantidad !== null && !Number.isNaN(Number(fallbackCantidad))) {
                            row.stock = Number(fallbackCantidad);
                        } else {
                            missingStockCodes.push(row.codigo || '(sin codigo)');
                        }
                    } else {
                        row.stock = Number(row.stock);
                    }
                }
            });

            if (missingStockCodes.length > 0) {
                // Mark results entries for these codes as failed due to missing stock
                missingStockCodes.forEach(code => {
                    results.push({ codigo: code, action: 'failed', reason: 'stock_missing' });
                });
                // Inform user to review quantities before saving
                try { proveedoresAlert('No se pudo crear/actualizar algunos productos: faltan cantidades (stock). Revise los productos y vuelva a intentar.', 'warning', 'Faltan cantidades'); } catch(e) { }
                return results;
            }

            const { data: upsertedData, error: upsertErr } = await client
                .from('ferre_inventario')
                .upsert(upsertRows, { onConflict: 'codigo' })
                .select();

            if (upsertErr) {
                // Mostrar error completo para facilitar diagnóstico (PostgREST devuelve objeto con code/message/details)
            } else {
                // Actualizar existingMap con filas devueltas (si las hay)
                if (Array.isArray(upsertedData)) {
                    upsertedData.forEach(r => { if (r && r.codigo) existingMap[r.codigo.toString()] = r; });
                }
            }
        } catch (err) {
        }
            // after upsert, set progress forward
            try { setInventoryProgress(75, 'Actualizando stocks...'); } catch(e){}
    }

    // 3) Aplicar incrementos de stock
    // Nota: Se eliminó el intento de RPC 'increment_stock' para evitar error 404 en consola.
    // El sistema usa el método de actualización directa que ya funciona correctamente.
    if (stockIncrements.length > 0) {
        try {
            const codesToUpdate = stockIncrements.map(s => s.codigo);
            let latestRows = [];
            const chunkSize = 15; // Tamaño conservador para evitar errores 400
            for (let i = 0; i < codesToUpdate.length; i += chunkSize) {
                const chunk = codesToUpdate.slice(i, i + chunkSize);
                const { data, error } = await client
                    .from('ferre_inventario')
                    .select('id,codigo,stock')
                    .in('codigo', chunk);
                if (error) throw error;
                if (data) latestRows = latestRows.concat(data);
            }

            const latestMap = {};
            latestRows.forEach(r => { if (r && r.codigo) latestMap[r.codigo.toString()] = r; });

            // Ejecutar actualizaciones en paralelo
            await Promise.all(stockIncrements.map(async si => {
                const row = latestMap[si.codigo];
                if (!row || !row.id) {
                    // No existe a pesar del upsert: registrar error
                    const idx = results.findIndex(x => x.codigo === si.codigo);
                    if (idx !== -1) results[idx] = { codigo: si.codigo, action: 'update_failed', error: 'row_not_found' };
                    return;
                }
                const previousStock = parseFloat(row.stock) || 0;
                const nuevoStock = previousStock + (parseFloat(si.cantidad) || 0);
                try {
                    const { error: updErr } = await client
                        .from('ferre_inventario')
                        .update({ stock: nuevoStock, updated_at: new Date().toISOString() })
                        .eq('id', row.id);
                    if (updErr) {
                        const idx = results.findIndex(x => x.codigo === si.codigo);
                        if (idx !== -1) results[idx] = { codigo: si.codigo, action: 'update_failed', error: updErr };
                    } else {
                        const idx = results.findIndex(x => x.codigo === si.codigo);
                        if (idx !== -1) results[idx] = { codigo: si.codigo, action: 'updated', previousStock, nuevoStock };
                    }
                } catch (uerr) {
                    const idx = results.findIndex(x => x.codigo === si.codigo);
                    if (idx !== -1) results[idx] = { codigo: si.codigo, action: 'update_failed', error: uerr };
                }
                // update progress per stock increment
                try {
                    window.__lastStockInc = (window.__lastStockInc || 0) + 1;
                    const pct = 75 + Math.floor((window.__lastStockInc / (stockIncrements.length || 1)) * 20); // 75->95
                    setInventoryProgress(pct, 'Actualizando stocks...');
                } catch(e){}
            }));
        } catch (uerr) {
            // Marcar todos los to_update como failed
            results.forEach((r, i) => { if (r.action === 'to_update') results[i] = { codigo: r.codigo, action: 'update_failed', error: uerr }; });
        }
    }

    // Finalmente, transformar los 'to_insert' en 'inserted' si el upsert creó filas
    try {
        // Buscar en existingMap/ upserted data para confirmar inserts
        results.forEach((r, i) => {
            if (r.action === 'to_insert') {
                const codigo = r.codigo;
                const row = existingMap[codigo];
                if (row && row.id) {
                    results[i] = { codigo, action: 'inserted', producto: row.producto || '', cantidad: r.cantidad };
                }
            }
        });
    } catch (err) {
        // noop
    }

    // finalize progress
    try { setInventoryProgress(100, 'Completado'); } catch(e){}
    hideInventoryProgress();

    return results;
}

function reiniciarIngresoFactura() {
    ingresoFacturaState = {
        pasoActual: 1,
        proveedorSeleccionado: null,
        metodoPago: null,
        productosEnFactura: [],
        inventarioCompleto: ingresoFacturaState.inventarioCompleto,
        proveedoresDisponibles: ingresoFacturaState.proveedoresDisponibles,
        descuento: 0
    };
    
    // Limpiar formularios
    document.getElementById('numeroFacturaIngreso').value = '';
    document.getElementById('fechaEmisionIngreso').value = '';
    document.getElementById('fechaVencimientoIngreso').value = '';
    document.getElementById('notasFacturaIngreso').value = '';
    document.getElementById('busquedaProductoIngreso').value = '';
    
    mostrarPasoIngreso(1);
}

// =====================================================
// MODALES
// =====================================================

function mostrarModalNuevoProveedorIngreso() {
    const modal = document.getElementById('modalNuevoProveedorIngreso');
    modal.classList.add('active');
}

function cerrarModalNuevoProveedorIngreso() {
    const modal = document.getElementById('modalNuevoProveedorIngreso');
    modal.classList.remove('active');
}

function normalizarTelefonoProveedorIngreso(value) {
    if (typeof window.normalizarTelefonoProveedor === 'function') {
        return window.normalizarTelefonoProveedor(value);
    }
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 10) return `593${digits.slice(1)}`;
    if (digits.length === 9 && digits.startsWith('9')) return `593${digits}`;
    if (digits.startsWith('593') && digits.length >= 12) return digits;
    return digits;
}

function setWhatsappEstadoNuevoProveedorIngreso(tipo, texto, icono = 'fa-circle-info') {
    const estado = document.getElementById('whatsappEstadoProveedorIngreso');
    if (!estado) return;
    const colores = {
        muted: '#6b7280',
        checking: '#0ea5e9',
        ok: '#15803d',
        error: '#b91c1c'
    };
    estado.style.color = colores[tipo] || colores.muted;
    estado.innerHTML = `<i class="fas ${icono}"></i> ${texto}`;
}

async function validarWhatsappProveedorIngreso(whatsapp) {
    if (typeof window.validarWhatsappProveedor === 'function') {
        return window.validarWhatsappProveedor(whatsapp);
    }

    try {
        if (typeof window.posApiRequest !== 'function') {
            throw new Error('Backend seguro no disponible');
        }
        const respuesta = await window.posApiRequest('/api/whatsapp/check-number', {
            method: 'POST',
            body: JSON.stringify({ number: whatsapp })
        });
        const item = respuesta?.data || {};

        return {
            whatsapp,
            exists: item?.exists === true,
            number: item?.number || whatsapp,
            jid: item?.jid || null,
            mensaje: item?.exists === true ? 'WhatsApp confirmado' : 'Este numero no tiene WhatsApp'
        };
    } catch (error) {
        console.error('Error validando WhatsApp proveedor:', error);
        return {
            whatsapp,
            exists: null,
            number: whatsapp,
            mensaje: 'No fue posible verificar WhatsApp en este momento',
            error: true
        };
    }
}

async function comprobarWhatsappNuevoProveedorIngreso() {
    const contactoInput = document.getElementById('contactoProveedorIngreso');
    const boton = document.getElementById('btnComprobarWhatsappIngreso');
    const numero = normalizarTelefonoProveedorIngreso(contactoInput?.value);

    ingresoFacturaState.nuevoProveedorWhatsapp = { valido: null, numero };

    if (!numero || numero.length < 11) {
        setWhatsappEstadoNuevoProveedorIngreso('error', 'Número incompleto. Usa 0999999999 o 593999999999.', 'fa-triangle-exclamation');
        return false;
    }

    try {
        if (boton) {
            boton.disabled = true;
            boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Comprobando';
        }
        setWhatsappEstadoNuevoProveedorIngreso('checking', 'Comprobando WhatsApp...', 'fa-spinner fa-spin');

        const result = await validarWhatsappProveedorIngreso(numero);
        const exists = Boolean(result?.exists);
        const checkedNumber = result?.number || numero;
        ingresoFacturaState.nuevoProveedorWhatsapp = { valido: exists, numero: checkedNumber };

        if (exists) {
            contactoInput.value = checkedNumber;
            setWhatsappEstadoNuevoProveedorIngreso('ok', 'WhatsApp confirmado para este número.', 'fa-circle-check');
            return true;
        }

        setWhatsappEstadoNuevoProveedorIngreso('error', 'Este número no aparece registrado en WhatsApp.', 'fa-circle-xmark');
        return false;
    } catch (error) {
        ingresoFacturaState.nuevoProveedorWhatsapp = { valido: null, numero };
        setWhatsappEstadoNuevoProveedorIngreso('error', `No se pudo comprobar: ${error.message}`, 'fa-triangle-exclamation');
        return false;
    } finally {
        if (boton) {
            boton.disabled = false;
            boton.innerHTML = '<i class="fab fa-whatsapp"></i> Comprobar';
        }
    }
}

async function guardarNuevoProveedorIngreso(e) {
    e.preventDefault();
    
    try {
        showAppLoader();
        const contactoNormalizado = normalizarTelefonoProveedorIngreso(document.getElementById('contactoProveedorIngreso').value.trim());
        if (ingresoFacturaState.nuevoProveedorWhatsapp?.valido !== true ||
            ingresoFacturaState.nuevoProveedorWhatsapp?.numero !== contactoNormalizado) {
            hideAppLoader();
            const confirmado = await comprobarWhatsappNuevoProveedorIngreso();
            if (!confirmado) {
                mostrarNotificacionIngreso('Confirma un número de WhatsApp válido antes de guardar', 'warning');
                return;
            }
            showAppLoader();
        }
        
        const client = window.app?.db || window.supabaseClient;
        const proveedorData = {
            codigo: document.getElementById('codigoProveedorIngreso').value.trim(),
            empresa: document.getElementById('empresaProveedorIngreso').value.trim(),
            vendedor: document.getElementById('vendedorProveedorIngreso').value.trim() || null,
            contacto: ingresoFacturaState.nuevoProveedorWhatsapp?.numero || contactoNormalizado
        };
        
        const { data, error } = await client
            .from('ferre_proveedores')
            .insert([proveedorData])
            .select()
            .single();
        
        if (error) throw error;
        
        // Agregar a la lista
        ingresoFacturaState.proveedoresDisponibles.push(data);
        
        // Recargar grid
        cargarProveedoresIngreso();
        if (typeof cargarProveedoresData === 'function') {
            cargarProveedoresData();
        }
        
        cerrarModalNuevoProveedorIngreso();
        hideAppLoader();
        mostrarNotificacionIngreso('Proveedor guardado exitosamente', 'success');
        
    } catch (error) {
        hideAppLoader();
        mostrarNotificacionIngreso('Error al guardar proveedor: ' + error.message, 'error');
    }
}

window.comprobarWhatsappNuevoProveedorIngreso = comprobarWhatsappNuevoProveedorIngreso;

async function mostrarModalNuevoProductoIngreso(initialCode = null) {
    // Al abrir el modal, solicitar al servidor (Supabase) el siguiente código sugerido
    const modal = document.getElementById('modalNuevoProductoIngreso');
    const codigoInput = document.getElementById('codigoNuevoProducto');
    try {
        showAppLoader && showAppLoader();
        const client = window.app?.db || window.supabaseClient;
        if (client && typeof client.rpc === 'function') {
            // Llamada RPC a la función sugerir_siguiente_codigo en Supabase
            const { data, error } = await client.rpc('sugerir_siguiente_codigo');
            if (error) {
            } else if (data) {
                // data puede venir como cadena o como objeto; soportar ambos
                let codigo = (typeof data === 'string') ? data : (data.codigo || JSON.stringify(data));

                // Ajustar código si es numérico siguiendo la lógica de códigos manuales (1001-9999)
                const numericMatch = codigo.match(/^0*(\d+)$/);
                if (numericMatch) {
                    const suggestedNum = parseInt(numericMatch[1], 10);

                    // Buscar códigos numéricos manuales (1001-9999) en productosEnFactura e inventario
                    const tableCodes = (ingresoFacturaState.productosEnFactura || []).map(p => (p.codigo || '').toString());
                    const invCodes = (ingresoFacturaState.inventarioCompleto || []).map(p => (p.codigo || '').toString());
                    const combined = tableCodes.concat(invCodes);
                    
                    const numsManuales = combined
                        .filter(c => /^\d+$/.test(c))
                        .map(c => parseInt(c, 10))
                        .filter(n => n >= 1001 && n <= 9999);

                    if (numsManuales.length > 0) {
                        const maxManual = Math.max(...numsManuales);
                        const next = Math.min(maxManual + 1, 9999);
                        codigo = String(next);
                    } else {
                        // Si no hay códigos manuales previos y el sugerido es menor a 1001,
                        // iniciamos el rango manual en 1001
                        if (suggestedNum < 1001) {
                            codigo = '1001';
                        }
                    }
                }

                // If an initial code was provided (e.g. scanned barcode), prefer that value
                if (codigoInput) {
                    if (initialCode && typeof initialCode === 'string' && initialCode.trim().length > 0) {
                        codigoInput.value = initialCode.trim();
                    } else {
                        codigoInput.value = codigo;
                    }
                }
            }
        } else {
        }
    } catch (err) {
    } finally {
        hideAppLoader && hideAppLoader();
        // Mostrar modal siempre, aunque falle la sugerencia
        // Población dinámica de botones de presentación y zona
        try {
            const presentaciones = ['CAJA','CIENTOS','ENTERO','FUNDA','GALONES','LIBRAS','LITROS','METROS','PAQUETES','PAR','ROLLOS','UNIDADES','KILO'];
            const presContainer = document.getElementById('presentacionBotonesNuevoProducto');
            const unidadHidden = document.getElementById('unidadNuevoProducto');
            if (presContainer) {
                presContainer.innerHTML = '';
                presentaciones.forEach(pres => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn-small btn-outline';
                    btn.textContent = pres;
                    btn.onclick = () => {
                        unidadHidden.value = pres;
                        // marcar activo
                        presContainer.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
                        btn.classList.add('active');
                    };
                    presContainer.appendChild(btn);
                });
                // marcar UNIDADES por defecto
                setTimeout(()=>{
                    const defaultBtn = presContainer.querySelector('button');
                    if (defaultBtn) defaultBtn.click();
                }, 10);
            }

            const zonasContainer = document.getElementById('zonaBotonesNuevoProducto');
            const zonaHidden = document.getElementById('zonaNuevoProducto');
            if (zonasContainer) {
                zonasContainer.innerHTML = '';
                const zonas = Array.from({length:18}, (_,i)=>i+1);
                zonas.forEach(z => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'btn-small btn-outline';
                    // Mostrar solo el número de zona para ahorrar espacio vertical
                    b.textContent = String(z);
                    b.onclick = () => {
                        zonaHidden.value = String(z);
                        zonasContainer.querySelectorAll('button').forEach(bb=>bb.classList.remove('active'));
                        b.classList.add('active');
                    };
                    zonasContainer.appendChild(b);
                });
                // seleccionar zona 1 por defecto
                setTimeout(()=>{
                    const first = zonasContainer.querySelector('button');
                    if (first) first.click();
                }, 10);
            }

            // Poner foco en el nombre del producto para acelerar ingreso
            setTimeout(() => {
                const name = document.getElementById('nombreNuevoProducto');
                if (name) name.focus();
            }, 120);
            // Forzar mayúsculas mientras el usuario escribe en el modal
            setTimeout(() => {
                try {
                    const nameInput = document.getElementById('nombreNuevoProducto');
                    if (nameInput) {
                        // transformar en mayúsculas en cada entrada
                        nameInput.addEventListener('input', (e) => {
                            const el = e.target;
                            const pos = el.selectionStart;
                            el.value = el.value.toUpperCase();
                            // mantener caret
                            el.setSelectionRange(pos, pos);
                        });
                        // limpiar y asegurar mayúsculas en blur
                        nameInput.addEventListener('blur', (e) => {
                            e.target.value = (e.target.value || '').toString().trim().toUpperCase();
                        });
                    }
                } catch (errUpper) {  }
            }, 200);
        } catch (innerErr) {
            modal.classList.add('active');
        }

        // Finalmente mostrar modal
        modal.classList.add('active');
    }
}

function cerrarModalNuevoProductoIngreso() {
    const modal = document.getElementById('modalNuevoProductoIngreso');
    modal.classList.remove('active');
}

function agregarNuevoProductoIngreso(e) {
    e.preventDefault();
    
    const producto = {
        producto_id: null,
        codigo: document.getElementById('codigoNuevoProducto').value.trim(),
        nombre: (document.getElementById('nombreNuevoProducto').value || '').toString().trim().toUpperCase(),
        cantidad: parseFloat(document.getElementById('cantidadNuevoProducto').value) || 1,
        precio_proveedor: parseFloat(document.getElementById('precioProveedorNuevoProducto').value) || 0,
        precio_venta: parseFloat(document.getElementById('precioVentaNuevoProducto').value) || 0,
        zona: document.getElementById('zonaNuevoProducto').value.trim() || '',
        stock_minimo: parseInt(document.getElementById('stockMinimoNuevoProducto')?.value) || 0,
        unidad_paquete: document.getElementById('unidadNuevoProducto')?.value || 'UNIDADES',
        es_producto_nuevo: true,
        porcentaje_ganancia: 0,
        subtotal: 0
    };
    
        // Si no se ingresó precio de venta, sugerir usando la lógica con factores (38%)
        if (!producto.precio_venta || producto.precio_venta === 0) {
            producto.precio_venta = calcularPrecioVentaSugeridoCompra(producto.precio_proveedor);
        }

        let porcentajeGanancia = calcularPorcentajeGanancia(producto.precio_proveedor, producto.precio_venta);
        let subtotal = producto.cantidad * producto.precio_proveedor;
        // Para productos nuevos preferimos marcar 38% por defecto
        producto.porcentaje_ganancia = producto.es_producto_nuevo ? 38 : porcentajeGanancia;
        producto.subtotal = subtotal;
    
    // Agregar el nuevo producto al inicio para que aparezca en la primera fila
    ingresoFacturaState.productosEnFactura.unshift(producto);
    
    cerrarModalNuevoProductoIngreso();
    renderizarTablaProductos();
    guardarCacheIngreso();
    
    // Limpiar formulario
    e.target.reset();
}

// =====================================================
// NOTIFICACIONES
// =====================================================

function mostrarNotificacionIngreso(mensaje, tipo = 'info') {
    // Usar el sistema de notificaciones global si existe
    if (typeof mostrarNotificacionProveedor === 'function') {
        mostrarNotificacionProveedor(mensaje, tipo);
    } else {
        proveedoresAlert(mensaje, tipo);
    }
}

// =====================================================
// SISTEMA DE ALERTAS PERSONALIZADO
// =====================================================

function proveedoresAlert(mensaje, tipo = 'info', titulo = null, detallesHtml = null) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalAlertaProveedores');
        const icono = document.getElementById('alertaIcono');
        const tituloEl = document.getElementById('alertaTitulo');
        const mensajeEl = document.getElementById('alertaMensaje');
        const detallesEl = document.getElementById('alertaDetalles');
        const btnConfirmar = document.getElementById('alertaBtnConfirmar');
        const btnCancelar = document.getElementById('alertaBtnCancelar');
        const btnDetalles = document.getElementById('alertaBtnDetalles');

        // Configurar icono según tipo
        icono.className = 'alerta-icono ' + tipo;
        const iconos = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle'
        };
        icono.querySelector('i').className = 'fas ' + (iconos[tipo] || iconos.info);

        // Configurar título
        if (!titulo) {
            const titulos = {
                info: 'Información',
                success: 'Éxito',
                warning: 'Advertencia',
                error: 'Error'
            };
            titulo = titulos[tipo] || 'Mensaje';
        }
        tituloEl.textContent = titulo;

        // Configurar mensaje (acepta texto o HTML)
        if (typeof mensaje === 'string' && mensaje.indexOf('<') !== -1) {
            mensajeEl.innerHTML = mensaje;
        } else {
            mensajeEl.textContent = mensaje;
        }

        // Preparar detalles (HTML) y botón
        if (detallesHtml) {
            detallesEl.innerHTML = detallesHtml;
            detallesEl.style.display = 'none';
            btnDetalles.style.display = 'inline-flex';
            btnDetalles.textContent = 'Ver detalles';
            btnDetalles.onclick = () => {
                if (detallesEl.style.display === 'none') {
                    detallesEl.style.display = 'block';
                    btnDetalles.textContent = 'Ocultar detalles';
                } else {
                    detallesEl.style.display = 'none';
                    btnDetalles.textContent = 'Ver detalles';
                }
            };
        } else {
            detallesEl.innerHTML = '';
            detallesEl.style.display = 'none';
            btnDetalles.style.display = 'none';
            btnDetalles.onclick = null;
        }

        // Ocultar botón cancelar (solo para alertas simples)
        btnCancelar.style.display = 'none';

        // Configurar botón confirmar
        btnConfirmar.textContent = 'Aceptar';
        btnConfirmar.className = 'btn btn-accent';

        btnConfirmar.onclick = () => {
            modal.classList.remove('active');
            resolve(true);
        };

        // Mostrar modal
        modal.classList.add('active');
    });
}

function proveedoresConfirm(mensaje, titulo = '¿Confirmar?', textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalAlertaProveedores');
        const icono = document.getElementById('alertaIcono');
        const tituloEl = document.getElementById('alertaTitulo');
        const mensajeEl = document.getElementById('alertaMensaje');
        const btnConfirmar = document.getElementById('alertaBtnConfirmar');
        const btnCancelar = document.getElementById('alertaBtnCancelar');
        
        // Configurar icono warning para confirmaciones
        icono.className = 'alerta-icono warning';
        icono.querySelector('i').className = 'fas fa-question-circle';
        
        // Configurar contenido
        tituloEl.textContent = titulo;
        mensajeEl.textContent = mensaje;
        
        // Mostrar ambos botones
        btnCancelar.style.display = 'inline-flex';
        btnCancelar.textContent = textoCancelar;
        btnConfirmar.textContent = textoConfirmar;
        btnConfirmar.className = 'btn btn-accent';
        
        const cleanup = () => {
            modal.classList.remove('active');
            btnConfirmar.onclick = null;
            btnCancelar.onclick = null;
        };
        
        btnCancelar.onclick = () => {
            cleanup();
            resolve(false);
        };
        
        btnConfirmar.onclick = () => {
            cleanup();
            resolve(true);
        };
        
        // Mostrar modal
        modal.classList.add('active');
    });
}

// Helper para escapar HTML en strings construidos dinámicamente
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Mostrar/ocultar overlay con producto que se está guardando
function showSavingProduct(nombre, index, total) {
    try {
        let el = document.getElementById('savingProductOverlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'savingProductOverlay';
            el.innerHTML = `
                <div class="saving-card">
                    <div class="saving-left"><i class="fas fa-truck"></i></div>
                    <div class="saving-main">
                        <div class="saving-text" id="savingProductText"></div>
                        <div class="saving-sub" id="savingProductSub"></div>
                        <div class="progress-track" id="savingProductTrack">
                            <div class="progress-fill" id="savingProductFill"></div>
                            <div class="truck" id="savingProductTruck"><i class="fas fa-truck"></i></div>
                        </div>
                    </div>
                    <div class="saving-left"><i class="fas fa-house"></i></div>
                </div>`;
            document.body.appendChild(el);
        }
        const text = document.getElementById('savingProductText');
        const sub = document.getElementById('savingProductSub');
        const fill = document.getElementById('savingProductFill');
        if (text) text.textContent = `Guardando: ${nombre || ''}`;
        if (sub) sub.textContent = index && total ? `${index} / ${total}` : '';
        if (fill && index && total) {
            const pct = Math.round((index / total) * 100);
            fill.style.width = pct + '%';
            // Aplicar color / gradiente aleatorio para hacer dinámico el avance
            try {
                fill.style.background = generateRandomGradient();
            } catch (err) {
                // fallback a color simple
                fill.style.background = '#06b6d4';
            }

            // Ocultar el camión móvil (no habrá animación móvil)
            const truck = document.getElementById('savingProductTruck');
            if (truck) truck.style.display = 'none';

        } else if (fill) {
            fill.style.width = '0%';
            try { fill.style.background = generateRandomGradient(); } catch (e) { fill.style.background = '#06b6d4'; }
            const truck = document.getElementById('savingProductTruck');
            if (truck) truck.style.display = 'none';
        }
        el.style.display = 'flex';
        // asegurar ajuste de posición tras render
        setTimeout(() => adjustSavingTruckPosition(), 60);
    } catch (err) {
    }
}

function hideSavingProduct() {
    try {
        const el = document.getElementById('savingProductOverlay');
        if (el) el.style.display = 'none';
    } catch (err) {
    }
}

// Ensure truck initial position is set when modal shown (in case track size not immediately available)
function adjustSavingTruckPosition() {
    const fill = document.getElementById('savingProductFill');
    const truck = document.getElementById('savingProductTruck');
    const track = document.getElementById('savingProductTrack');
    if (!truck || !track || !fill) return;
    try {
        const w = track.getBoundingClientRect().width;
        const pct = parseFloat(fill.style.width) || 0;
        const leftPx = (pct / 100) * w;
        truck.style.left = `${leftPx}px`;
    } catch (e) {
        // ignore
    }
}

// Generar gradiente aleatorio para la barra de progreso
function generateRandomGradient() {
    function randColor(){
        const r = Math.floor(Math.random()*200)+30; // evitar colores demasiado oscuros
        const g = Math.floor(Math.random()*200)+30;
        const b = Math.floor(Math.random()*200)+30;
        return `rgb(${r}, ${g}, ${b})`;
    }
    const c1 = randColor();
    const c2 = randColor();
    return `linear-gradient(90deg, ${c1}, ${c2})`;
}

// =====================================================
// GESTIÓN DE CACHÉ
// =====================================================

function guardarCacheIngreso() {
    try {
        const cache = {
            version: 2,
            savedAt: Date.now(),
            userId: window.currentUser?.id || null,
            pasoActual: ingresoFacturaState.pasoActual,
            proveedorSeleccionado: ingresoFacturaState.proveedorSeleccionado,
            metodoPago: ingresoFacturaState.metodoPago,
            productosEnFactura: ingresoFacturaState.productosEnFactura,
            descuento: ingresoFacturaState.descuento,
            origenXml: Boolean(ingresoFacturaState.origenXml),
            datosFactura: {
                numero: document.getElementById('numeroFacturaIngreso')?.value || '',
                // Normalizar fechas al formato ISO (yyyy-mm-dd) para inputs type=date
                fechaEmision: normalizeDateForInput(document.getElementById('fechaEmisionIngreso')?.value || ''),
                fechaVencimiento: normalizeDateForInput(document.getElementById('fechaVencimientoIngreso')?.value || ''),
                notas: document.getElementById('notasFacturaIngreso')?.value || ''
            },
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('ingresoFacturaCache', JSON.stringify(cache));
    } catch (error) {
    }
}

function cargarCacheIngreso() {
    try {
        const cacheString = localStorage.getItem('ingresoFacturaCache');
        if (!cacheString) return false;
        
        const cache = JSON.parse(cacheString);
        
        // Los borradores se conservan siete días y nunca se comparten entre usuarios.
        const savedAt = Number(cache.savedAt || Date.parse(cache.timestamp));
        const expired = !Number.isFinite(savedAt) || Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000;
        const belongsToAnotherUser = cache.userId && cache.userId !== window.currentUser?.id;
        if (expired || belongsToAnotherUser) {
            limpiarCacheIngreso();
            return false;
        }
        
        // Restaurar estado
        if (cache.proveedorSeleccionado) {
            ingresoFacturaState.proveedorSeleccionado = cache.proveedorSeleccionado;
        }
        
        if (cache.metodoPago) {
            ingresoFacturaState.metodoPago = cache.metodoPago;
        }
        
        if (cache.productosEnFactura && cache.productosEnFactura.length > 0) {
            ingresoFacturaState.productosEnFactura = cache.productosEnFactura;
        }

        if ('descuento' in cache) {
            ingresoFacturaState.descuento = cache.descuento;
        }
        ingresoFacturaState.origenXml = Boolean(cache.origenXml);
        
        // Restaurar campos del formulario y UI inmediatamente
        if (cache.datosFactura) {
            const numeroInput = document.getElementById('numeroFacturaIngreso');
            const fechaEmisionInput = document.getElementById('fechaEmisionIngreso');
            const fechaVencimientoInput = document.getElementById('fechaVencimientoIngreso');
            const notasInput = document.getElementById('notasFacturaIngreso');
            
            if (numeroInput && cache.datosFactura.numero) numeroInput.value = cache.datosFactura.numero;
            if (fechaEmisionInput && cache.datosFactura.fechaEmision) {
                fechaEmisionInput.value = normalizeDateForInput(cache.datosFactura.fechaEmision);
            }
            if (fechaVencimientoInput && cache.datosFactura.fechaVencimiento) {
                fechaVencimientoInput.value = normalizeDateForInput(cache.datosFactura.fechaVencimiento);
            }
            if (notasInput && cache.datosFactura.notas) notasInput.value = cache.datosFactura.notas;
        }
        
        // Actualizar UI del proveedor en el grid
        if (cache.proveedorSeleccionado) {
            const proveedorBtn = document.querySelector(`.proveedor-btn-ingreso[data-id="${cache.proveedorSeleccionado.id}"]`);
            if (proveedorBtn) {
                proveedorBtn.classList.add('selected');
            }
            mostrarInfoProveedorSeleccionado();
        }
        
        // Actualizar UI del método de pago
        if (cache.metodoPago) {
            // Soportar formatos: 'PLAZO' o 'CONTADO - EFECTIVO'
            const mp = cache.metodoPago;
            if (mp.startsWith('CONTADO')) {
                // seleccionar tipo CONTADO y mostrar submetodos
                const tipoBtn = document.querySelector(`.metodo-pago-btn[data-tipo="CONTADO"]`);
                if (tipoBtn) tipoBtn.classList.add('selected');
                const cont = document.getElementById('submetodosContado');
                if (cont) cont.style.display = 'block';

                if (mp.includes('EFECTIVO')) {
                    const sub = document.querySelector(`#submetodosContado .metodo-pago-btn[data-submetodo="EFECTIVO"]`);
                    if (sub) sub.classList.add('selected');
                } else if (mp.includes('TRANSFERENCIA')) {
                    const sub = document.querySelector(`#submetodosContado .metodo-pago-btn[data-submetodo="TRANSFERENCIA"]`);
                    if (sub) sub.classList.add('selected');
                }
            } else {
                // PLAZO u otros
                const tipoBtn = document.querySelector(`.metodo-pago-btn[data-tipo="${mp}"]`);
                if (tipoBtn) tipoBtn.classList.add('selected');
            }
        }
        
        // Renderizar tabla de productos si hay
        if (cache.productosEnFactura && cache.productosEnFactura.length > 0) {
            renderizarTablaProductos();
        }
        
        // Ir al paso guardado
        const pasoAMostrar = cache.pasoActual || 1;
        mostrarPasoIngreso(pasoAMostrar);

        // Si restauramos el paso 2, validar fechas para que los mensajes y customValidity se apliquen
        if (pasoAMostrar === 2) validarFechas();

        // Actualizar botones de navegación
        actualizarBotonesNavegacion(pasoAMostrar);
        
        // Mostrar alerta solo si no estamos en paso 1
        // if (pasoAMostrar > 1) {
        //     proveedoresAlert('Se ha restaurado una sesión anterior', 'info', 'Sesión Restaurada');
        // }
        
        return true;
        
    } catch (error) {
        limpiarCacheIngreso();
        return false;
    }
}

function limpiarCacheIngreso() {
    try {
        localStorage.removeItem('ingresoFacturaCache');
    } catch (error) {
    }
}

// =====================================================
// FUNCIONES DE NAVEGACIÓN Y REINICIO
// =====================================================

async function reiniciarIngresoFactura() {
    const confirmado = await proveedoresConfirm(
        '¿Estás seguro de que deseas reiniciar el proceso? Se perderán todos los datos ingresados.',
        '¿Reiniciar Proceso?',
        'Sí, Reiniciar',
        'Cancelar'
    );
    
    if (!confirmado) return;
    
    // Limpiar caché
    limpiarCacheIngreso();
    if (typeof window.clearInvoiceIntakeCache === 'function') window.clearInvoiceIntakeCache();
    
    // Reiniciar estado
    ingresoFacturaState = {
        pasoActual: 1,
        proveedorSeleccionado: null,
        metodoPago: null,
        productosEnFactura: [],
        inventarioCompleto: ingresoFacturaState.inventarioCompleto,
        proveedoresDisponibles: ingresoFacturaState.proveedoresDisponibles,
        descuento: 0
    };
    
    // Limpiar formularios
    document.getElementById('numeroFacturaIngreso').value = '';
    document.getElementById('fechaEmisionIngreso').value = '';
    document.getElementById('fechaVencimientoIngreso').value = '';
    document.getElementById('notasFacturaIngreso').value = '';
    
    // Volver al paso 1
    mostrarPasoIngreso(1);
    
    proveedoresAlert('El proceso ha sido reiniciado', 'success', 'Reiniciado');
}

async function cerrarIngresoFactura() {
    // Simplemente cerrar sin confirmar (el caché guarda el progreso)
    if (ingresoFacturaState.origenXml && typeof window.volverAConsultaFactura === 'function') {
        await window.volverAConsultaFactura();
        return;
    }
    cambiarModoProveedor('facturas');
}

function volverAFacturas() {
    cerrarIngresoFactura();
}

// =====================================================
// GUARDAR CON CACHÉ AUTOMÁTICO
// =====================================================

// =====================================================
// MODAL ACTUALIZAR INVENTARIO - INGRESO FACTURA
// =====================================================

// Estado para el modal de actualizar inventario en ingreso
var ingresoModalState = {
    productoSeleccionado: null,
    pendienteActualizacion: null,
    listaProveedores: []
};

// Variables auxiliares
var productoParaAgregarATabla = null;

// Cargar lista de proveedores para el select
async function cargarListaProveedoresIngreso() {
    try {
        const db = window.app ? window.app.db : (typeof getSupabaseClient === 'function' ? getSupabaseClient() : (window.supabaseClient || null));
        if (!db) return;

        const { data, error } = await db
            .from('ferre_proveedores')
            .select('id, empresa')
            .order('empresa');

        if (error) throw error;
        ingresoModalState.listaProveedores = data || [];
    } catch (error) {
        console.error('Error al cargar proveedores para ingreso:', error);
    }
}

// Abrir modal de actualizar inventario cuando se selecciona un producto
function abrirModalActualizarInventarioIngreso(producto) {
    // Guardar el producto seleccionado
    ingresoModalState.productoSeleccionado = producto;
    productoParaAgregarATabla = producto;

    // Llenar datos en el modal de actualización
    document.getElementById('ingresoProductoCodigoInfo').textContent = `Código: ${producto.codigo}`;
    document.getElementById('ingresoProductoNombreInfo').textContent = producto.producto;
    document.getElementById('ingresoStockActualDisplay').value = `${producto.stock} ${producto.unidad_paquete || 'und'}`;
    document.getElementById('ingresoCalculosCantidadInput').value = 1;
    document.getElementById('ingresoNuevoStockInput').value = producto.stock || 0;
    document.getElementById('ingresoNuevaZonaInput').value = producto.zona || '';
    document.getElementById('ingresoNuevoStockMinimoInput').value = producto.stock_minimo || '';

    // Poblar select de proveedores
    const provSelect = document.getElementById('ingresoNuevoProveedorIdInput');
    if (provSelect) {
        provSelect.innerHTML = '<option value="">Sin Proveedor</option>';
        if (ingresoModalState.listaProveedores) {
            ingresoModalState.listaProveedores.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.empresa;
                // Autoseleccionar el proveedor del ingreso actual
                if (ingresoFacturaState.proveedorSeleccionado && p.id === ingresoFacturaState.proveedorSeleccionado.id) {
                    opt.selected = true;
                } else if (p.id === producto.proveedor_id) {
                    // Si no hay proveedor de ingreso, usar el del producto
                    opt.selected = true;
                }
                provSelect.appendChild(opt);
            });
        }
    }

    // Mostrar modal de actualización
    const modal = document.getElementById('modalActualizarInventarioIngreso');
    modal.classList.add('active');

    // Enfocar el input de cantidad
    setTimeout(() => {
        document.getElementById('ingresoCalculosCantidadInput').focus();
        document.getElementById('ingresoCalculosCantidadInput').select();
    }, 150);
}

function cerrarModalActualizarInventarioIngreso() {
    document.getElementById('modalActualizarInventarioIngreso').classList.remove('active');
    ingresoModalState.productoSeleccionado = null;
    productoParaAgregarATabla = null;
}

// Confirmar actualización del inventario
function confirmarActualizacionInventarioIngreso() {
    const producto = ingresoModalState.productoSeleccionado;
    if (!producto) return;

    const cantidadFactura = parseFloat(document.getElementById('ingresoCalculosCantidadInput').value) || 1;
    const nuevoStock = parseFloat(document.getElementById('ingresoNuevoStockInput').value) || 0;
    const nuevaZona = document.getElementById('ingresoNuevaZonaInput').value.trim();
    const nuevoStockMinimo = parseFloat(document.getElementById('ingresoNuevoStockMinimoInput').value) || 0;
    const nuevoProvId = document.getElementById('ingresoNuevoProveedorIdInput').value;

    // Validar que hay al menos un cambio
    const stockCambio = nuevoStock !== producto.stock;
    const zonaCambio = nuevaZona !== (producto.zona || '');
    const stockMinimoCambio = nuevoStockMinimo !== (producto.stock_minimo || 0);
    const provCambio = nuevoProvId !== (producto.proveedor_id ? producto.proveedor_id.toString() : '');

    if (!stockCambio && !zonaCambio && !stockMinimoCambio && !provCambio) {
        // Si no hay cambios, simplemente agregar a tabla sin actualizar
        cerrarModalActualizarInventarioIngreso();
        if (productoParaAgregarATabla) {
            agregarProductoATablaDirecto(productoParaAgregarATabla, cantidadFactura);
        }
        return;
    }

    // Guardar datos pendientes (incluyendo cantidad)
    ingresoModalState.pendienteActualizacion = {
        codigo: producto.codigo,
        producto: producto.producto,
        cantidadFactura: cantidadFactura,
        cambios: {
            stock: stockCambio ? { anterior: producto.stock, nuevo: nuevoStock } : null,
            zona: zonaCambio ? { anterior: producto.zona || '-', nuevo: nuevaZona || '-' } : null,
            stock_minimo: stockMinimoCambio ? { anterior: producto.stock_minimo || 0, nuevo: nuevoStockMinimo } : null,
            proveedor_id: provCambio ? { anterior: producto.proveedor_id, nuevo: nuevoProvId || null } : null
        }
    };

    // Construir mensaje de confirmación
    let changesHtml = `
        <h4><i class="fas fa-info-circle"></i> Se actualizará: ${producto.producto}</h4>
        <ul class="ingreso-confirm-changes">
    `;

    if (stockCambio) {
        changesHtml += `
            <li>
                <span class="ingreso-change-label">Stock Verificado</span>
                <span class="ingreso-change-value">
                    <span class="ingreso-old-value">${producto.stock}</span>
                    <i class="fas fa-arrow-right"></i>
                    <span class="ingreso-new-value">${nuevoStock}</span>
                </span>
            </li>
        `;
    }

    if (zonaCambio) {
        changesHtml += `
            <li>
                <span class="ingreso-change-label">Zona</span>
                <span class="ingreso-change-value">
                    <span class="ingreso-old-value">${producto.zona || '-'}</span>
                    <i class="fas fa-arrow-right"></i>
                    <span class="ingreso-new-value">${nuevaZona || '-'}</span>
                </span>
            </li>
        `;
    }

    if (stockMinimoCambio) {
        changesHtml += `
            <li>
                <span class="ingreso-change-label">Stock Mínimo</span>
                <span class="ingreso-change-value">
                    <span class="ingreso-old-value">${producto.stock_minimo || 0}</span>
                    <i class="fas fa-arrow-right"></i>
                    <span class="ingreso-new-value">${nuevoStockMinimo}</span>
                </span>
            </li>
        `;
    }

    if (provCambio) {
        const oldProv = ingresoModalState.listaProveedores.find(p => p.id == producto.proveedor_id)?.empresa || 'Sin Proveedor';
        const newProv = ingresoModalState.listaProveedores.find(p => p.id == nuevoProvId)?.empresa || 'Sin Proveedor';
        changesHtml += `
            <li>
                <span class="ingreso-change-label">Proveedor</span>
                <span class="ingreso-change-value">
                    <span class="ingreso-old-value">${oldProv}</span>
                    <i class="fas fa-arrow-right"></i>
                    <span class="ingreso-new-value">${newProv}</span>
                </span>
            </li>
        `;
    }

    changesHtml += '</ul>';

    document.getElementById('ingresoConfirmMessage').innerHTML = changesHtml;
    document.getElementById('btnEjecutarActualizacionIngreso').onclick = ejecutarActualizacionInventarioIngreso;
    
    // Mostrar modal de confirmación
    document.getElementById('ingresoConfirmModalInventario').classList.add('active');
}

function cancelarConfirmacionInventarioIngreso() {
    document.getElementById('ingresoConfirmModalInventario').classList.remove('active');
    ingresoModalState.pendienteActualizacion = null;
}

// Ejecutar actualización en la BD
async function ejecutarActualizacionInventarioIngreso() {
    const pendiente = ingresoModalState.pendienteActualizacion;
    if (!pendiente) return;

    // Guardar producto antes de cerrar modalS
    const productoAgregar = productoParaAgregarATabla;

    // Cerrar modal de confirmación
    document.getElementById('ingresoConfirmModalInventario').classList.remove('active');

    // Mostrar screen blocker
    mostrarScreenBlockerIngreso('Actualizando inventario...');

    try {
        const db = window.app ? window.app.db : (typeof getSupabaseClient === 'function' ? getSupabaseClient() : supabaseClient);
        
        if (!db) {
            throw new Error('Base de datos no disponible');
        }

        // Construir objeto de actualización
        const updateData = {};
        
        if (pendiente.cambios.stock) {
            updateData.stock = pendiente.cambios.stock.nuevo;
        }
        if (pendiente.cambios.zona) {
            updateData.zona = pendiente.cambios.zona.nuevo === '-' ? null : pendiente.cambios.zona.nuevo;
        }
        if (pendiente.cambios.stock_minimo) {
            updateData.stock_minimo = pendiente.cambios.stock_minimo.nuevo;
        }
        if (pendiente.cambios.proveedor_id) {
            updateData.proveedor_id = pendiente.cambios.proveedor_id.nuevo;
        }

        // Ejecutar actualización
        const { data, error } = await db
            .from('ferre_inventario')
            .update(updateData)
            .eq('codigo', pendiente.codigo)
            .select()
            .single();

        if (error) throw error;

        // Actualizar caché si existe
        if (window.inventarioCache && window.inventarioCache.productos) {
            const index = window.inventarioCache.productos.findIndex(p => p.codigo === pendiente.codigo);
            if (index !== -1) {
                window.inventarioCache.productos[index] = { ...window.inventarioCache.productos[index], ...updateData };
            }
        }

        // Actualizar en el estado local también
        if (ingresoFacturaState.inventarioCompleto) {
            const index = ingresoFacturaState.inventarioCompleto.findIndex(p => p.codigo === pendiente.codigo);
            if (index !== -1) {
                ingresoFacturaState.inventarioCompleto[index] = { ...ingresoFacturaState.inventarioCompleto[index], ...updateData };
            }
        }

        // Ocultar screen blocker
        ocultarScreenBlockerIngreso();

        // Cerrar modal de actualización
        cerrarModalActualizarInventarioIngreso();

        // Mostrar mensaje de éxito
        if (window.app && window.app.showToast) {
            window.app.showToast('<i class="fas fa-check-circle"></i> Inventario actualizado correctamente', 'success', 3000);
        }

        // Agregar el producto a la tabla con la cantidad ingresada
        if (productoAgregar) {
            const cantidad = pendiente.cantidadFactura || 1;
            agregarProductoATablaDirecto(productoAgregar, cantidad);
        }

        // Limpiar estado
        ingresoModalState.pendienteActualizacion = null;

    } catch (error) {
        console.error('Error al actualizar inventario:', error);
        ocultarScreenBlockerIngreso();
        
        if (window.app && window.app.showToast) {
            window.app.showToast('<i class="fas fa-exclamation-triangle"></i> Error al actualizar: ' + error.message, 'danger', 5000);
        }
    }
}

// Funciones de utilidad para screen blocker
function mostrarScreenBlockerIngreso(mensaje = 'Procesando...') {
    const blocker = document.getElementById('ingresoScreenBlocker');
    const text = document.getElementById('ingresoBlockerText');
    if (text) text.textContent = mensaje;
    if (blocker) blocker.classList.add('active');
}

function ocultarScreenBlockerIngreso() {
    const blocker = document.getElementById('ingresoScreenBlocker');
    if (blocker) blocker.classList.remove('active');
}

// Función para agregar producto a tabla sin el modal (si no hay cambios)
function agregarProductoATablaDirecto(producto, cantidad = 1) {
    // Verificar si ya existe
    const existeIndex = ingresoFacturaState.productosEnFactura.findIndex(p => p.codigo === producto.codigo);
    if (existeIndex !== -1) {
        // Si ya existe, incrementar cantidad y mover al inicio
        ingresoFacturaState.productosEnFactura[existeIndex].cantidad += cantidad;
        ingresoFacturaState.productosEnFactura[existeIndex].subtotal = ingresoFacturaState.productosEnFactura[existeIndex].cantidad * ingresoFacturaState.productosEnFactura[existeIndex].precio_proveedor;
        // Mover elemento al inicio
        const [item] = ingresoFacturaState.productosEnFactura.splice(existeIndex, 1);
        ingresoFacturaState.productosEnFactura.unshift(item);
        renderizarTablaProductos();
        guardarCacheIngreso();
        return;
    }

    // Agregar nuevo producto al inicio
    ingresoFacturaState.productosEnFactura.unshift({
        producto_id: producto.id,
        codigo: producto.codigo,
        nombre: producto.producto,
        cantidad: cantidad,
        precio_proveedor: parseFloat(producto.precio_proveedor) || 0,
        precio_venta: parseFloat(producto.precio) || calcularPrecioVentaSugeridoCompra(parseFloat(producto.precio_proveedor) || 0),
        porcentaje_ganancia: encontrarPorcentajeMasCercano(parseFloat(producto.precio_proveedor) || 0, parseFloat(producto.precio) || calcularPrecioVentaSugeridoCompra(parseFloat(producto.precio_proveedor) || 0)),
        zona: producto.zona ? producto.zona.toString() : '',
        es_producto_nuevo: false,
        subtotal: cantidad * (parseFloat(producto.precio_proveedor) || 0)
    });
    
    // Limpiar búsqueda
    document.getElementById('busquedaProductoIngreso').value = '';
    document.getElementById('resultadosBusquedaIngreso').innerHTML = '';
    
    renderizarTablaProductos();
    guardarCacheIngreso();
    
    // Actualizar botones de navegación
    try {
        actualizarBotonesNavegacion(ingresoFacturaState.pasoActual);
    } catch (err) {
    }
}

// Agregar listeners a campos de formulario para guardar caché
setTimeout(() => {
    const campos = ['numeroFacturaIngreso', 'fechaEmisionIngreso', 'fechaVencimientoIngreso', 'notasFacturaIngreso'];
    campos.forEach(id => {
        const campo = document.getElementById(id);
        if (campo) {
            campo.addEventListener('input', guardarCacheIngreso);
            campo.addEventListener('change', guardarCacheIngreso);
            campo.addEventListener('blur', guardarCacheIngreso);
        }
    });
}, 1000);

// Exponer función globalmente
window.initIngresoFactura = initIngresoFactura;
window.reiniciarIngresoFactura = reiniciarIngresoFactura;
window.cerrarIngresoFactura = cerrarIngresoFactura;
window.volverAFacturas = volverAFacturas;
window.proveedoresAlert = proveedoresAlert;
window.proveedoresConfirm = proveedoresConfirm;
window.guardarCacheIngreso = guardarCacheIngreso;
window.cargarCacheIngreso = cargarCacheIngreso;
window.limpiarCacheIngreso = limpiarCacheIngreso;
window.iniciarIngresoFacturaDesdeXml = iniciarIngresoFacturaDesdeXml;
window.actualizarDescuento = actualizarDescuento;
// Nuevas funciones para modal de actualizar inventario
window.abrirModalActualizarInventarioIngreso = abrirModalActualizarInventarioIngreso;
window.cerrarModalActualizarInventarioIngreso = cerrarModalActualizarInventarioIngreso;
window.confirmarActualizacionInventarioIngreso = confirmarActualizacionInventarioIngreso;
window.cancelarConfirmacionInventarioIngreso = cancelarConfirmacionInventarioIngreso;
window.ejecutarActualizacionInventarioIngreso = ejecutarActualizacionInventarioIngreso;
window.cargarListaProveedoresIngreso = cargarListaProveedoresIngreso;
window.agregarProductoATablaDirecto = agregarProductoATablaDirecto;
