"use strict";
(function () {
  const API = "/api/purchases/v2/orders";
  const labels = {
    BORRADOR: "Borrador",
    PREPARADO: "Preparado",
    ENVIANDO: "Enviando",
    ENVIO_INCIERTO: "Envío por verificar",
    ENVIADO: "Enviado al grupo",
    CONFIRMADO: "Confirmado",
    PARCIAL: "Recibido parcialmente",
    COMPLETADO: "Completado",
    CANCELADO: "Cancelado",
  };
  const state = {
    data: null,
    orders: [],
    providers: [],
    cart: new Map(),
    drafts: new Map(),
    filter: null,
    provider: null,
    current: null,
    busy: false,
    limit: 60,
    view: "home",
    trail: [],
  };
  const el = (id) => document.getElementById(id),
    money = (n) => window.app.formatCurrency(n),
    num = (n) => Number(n) || 0;
  const api = async (path = "", options = {}) =>
    (await window.app.posApiRequest(API + path, options)).data;
  function node(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function button(text, fn, cls = "button button-secondary") {
    const b = node("button", text, cls);
    b.type = "button";
    b.addEventListener("click", () => run(fn));
    return b;
  }
  async function run(fn) {
    if (state.busy) return;
    state.busy = true;
    el("ordersStatus").textContent = "Procesando…";
    try {
      await fn();
      el("ordersStatus").textContent = "";
    } catch (e) {
      el("ordersStatus").textContent = e.message;
      await window.app.askAlert(e.message);
    } finally {
      state.busy = false;
    }
  }
  function option(value, text) {
    const o = node("option", text);
    o.value = value;
    return o;
  }
  function input(type, value, min) {
    const e = node("input");
    e.type = type;
    e.value = value ?? "";
    if (min != null) e.min = min;
    return e;
  }
  function showView(view, remember = true) {
    if (remember && state.view !== view) state.trail.push(state.view);
    state.view = view;
    document.querySelectorAll("[data-order-view]").forEach((section) => {
      section.hidden = section.dataset.orderView !== view;
    });
    el("ordersNavigation").hidden = view === "home";
    el("orderBreadcrumb").textContent =
      {
        products: state.provider ? "Proveedores / Productos" : "Productos",
        providers: "Proveedores",
        cart: "Revisión del pedido",
        history: "Seguimiento",
        detail: "Detalle del pedido",
        settings: "Configuración",
      }[view] || "";
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function back() {
    showView(state.trail.pop() || "home", false);
  }
  function startProducts(provider = null) {
    if (!state.data) return;
    state.provider = provider;
    state.filter = "todos";
    state.limit = 60;
    el("orderSearch").value = "";
    render();
    showView("products");
  }
  const supplierById = (id) =>
    state.data.productos.flatMap((p) => p.proveedores).find((r) => r.id === id);
  function cartKey(product) {
    return product.id;
  }
  function choose(product, relationId, quantity) {
    state.cart.set(cartKey(product), { product, relationId, quantity });
    renderCart();
  }
  async function refresh() {
    const params = new URLSearchParams({
      dias: el("orderDays").value,
      cobertura: el("orderCoverage").value,
      seguridad: el("orderSafety").value,
    });
    const [data, orders, providers] = await Promise.all([
      api("/catalog?" + params),
      api(),
      window.app
        .posApiRequest("/api/purchases/v2/providers")
        .then((r) => r.data),
    ]);
    state.data = data;
    state.orders = orders;
    state.providers = providers;
    render();
  }
  function render() {
    const home = el("ordersHome");
    home.replaceChildren();
    for (const [key, title] of [
      ["agotados", "Agotados"],
      ["riesgo", "Riesgo de agotarse"],
      ["bajo", "Bajo mínimo"],
      ["sin_vinculo", "Sin proveedor vinculado"],
    ]) {
      const b = button("", () => {
        state.filter = key;
        renderProducts();
      });
      b.className = "order-count";
      b.dataset.filter = key;
      const count = state.provider
        ? state.data.productos.filter(
            (p) =>
              p.proveedores.some((r) => r.proveedor_id === state.provider) &&
              (key === "sin_vinculo"
                ? !p.proveedores.length
                : p.categoria === key),
          ).length
        : state.data.contadores[key];
      b.append(node("strong", count), node("span", title));
      home.append(b);
    }
    home.append(
      button("Ver todos los productos", () => {
        state.filter = "todos";
        renderProducts();
      }),
    );
    renderProviders();
    const table = el("ordersHistory");
    table.replaceChildren();
    state.orders.forEach((o) => {
      const row = node("div", null, "order-history-row");
      row.append(
        node(
          "span",
          `P-${o.numero} · ${o.proveedor?.empresa || ""} · ${labels[o.estado]} · ${o.fecha_esperada || "Sin fecha prevista"}`,
        ),
        button("Abrir", () => openOrder(o.id)),
      );
      table.append(row);
    });
    if (!state.orders.length)
      table.append(node("p", "Todavía no hay pedidos guardados."));
    renderProducts();
    renderCart();
  }
  function renderProviders() {
    const box = el("ordersProviders");
    box.replaceChildren();
    const search = el("orderProviderSearch").value.toLocaleLowerCase();
    state.providers.forEach((p) => {
      if (!p.empresa.toLocaleLowerCase().includes(search)) return;
      const products = state.data.productos.filter((i) =>
        i.proveedores.some((r) => r.proveedor_id === p.id),
      );
      if (!products.length) return;
      const card = button(
        "",
        () => startProducts(p.id),
        "orders-provider-card",
      );
      const monogram = node(
        "span",
        p.empresa.slice(0, 2).toUpperCase(),
        "orders-provider-monogram",
      );
      const content = node("span", null, "orders-provider-content");
      content.append(
        node("strong", p.empresa),
        node("span", `${products.length} productos vinculados`),
      );
      card.append(
        monogram,
        content,
        node(
          "span",
          `${products.filter((i) => i.categoria !== "normal").length} por revisar`,
          "orders-provider-badge",
        ),
        node("span", "→"),
      );
      box.append(card);
    });
    if (!box.children.length)
      box.append(
        node(
          "p",
          "No hay proveedores con productos vinculados para esta búsqueda.",
          "orders-empty",
        ),
      );
  }
  function renderProducts() {
    const box = el("ordersProducts");
    box.replaceChildren();
    if (!state.filter) return;
    const search = el("orderSearch").value.toLocaleLowerCase();
    el("orderProductsTitle").textContent = state.provider
      ? state.providers.find((p) => p.id === state.provider)?.empresa ||
        "Productos del proveedor"
      : "Necesidades de compra";
    document.querySelectorAll(".order-count").forEach((b) => {
      b.classList.toggle("is-selected", b.dataset.filter === state.filter);
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
    });
    const rows = state.data.productos.filter(
      (p) =>
        (!state.provider ||
          p.proveedores.some((r) => r.proveedor_id === state.provider)) &&
        (state.filter === "todos" ||
          (state.filter === "sin_vinculo"
            ? !p.proveedores.length
            : p.categoria === state.filter)) &&
        `${p.codigo} ${p.nombre}`.toLocaleLowerCase().includes(search),
    );
    for (const p of rows.slice(0, state.limit)) {
      const card = node("article", null, "order-product");
      const heading = node("div", null, "order-product-heading");
      heading.append(
        node("h4", `${p.codigo} · ${p.nombre}`),
        node(
          "span",
          {
            agotados: "Agotado",
            riesgo: "En riesgo",
            bajo: "Bajo mínimo",
            normal: "Stock suficiente",
          }[p.categoria] || p.categoria,
          "order-stock-badge " + p.categoria,
        ),
      );
      card.append(
        heading,
        node(
          "p",
          `Stock ${p.stock} ${p.unidad || ""} · mínimo ${p.stock_minimo} · vendido ${p.vendido} (${el("orderDays").value} días) · en camino confirmado ${p.en_camino}`,
        ),
      );
      card.append(
        node(
          "p",
          `Cobertura: ${p.cobertura_dias == null ? "sin ventas recientes" : p.cobertura_dias + " días"} · ${p.categoria === "normal" ? "Stock suficiente" : p.categoria}`,
        ),
      );
      p.anotaciones.forEach((a) =>
        card.append(
          node(
            "p",
            `Anotación POS: ${a.cantidad_sugerida} · ${a.producto_nombre}`,
            "order-warning",
          ),
        ),
      );
      if (!p.proveedores.length) {
        card.append(
          node(
            "p",
            "Vincula el producto a un proveedor antes de pedirlo.",
            "order-warning",
          ),
        );
        box.append(card);
        continue;
      }
      const select = node("select");
      select.setAttribute("aria-label", `Proveedor de ${p.nombre}`);
      const available = p.proveedores.filter(
        (r) => !state.provider || r.proveedor_id === state.provider,
      );
      select.append(option("", "Selecciona y revisa un proveedor"));
      available.forEach((r) =>
        select.append(
          option(
            r.id,
            `${r.proveedor} · ${r.costo_base == null ? "sin costo" : money(r.costo_base) + "/ " + (p.unidad || "unidad interna")} · ${r.unidad_compra || "presentación por revisar"} × ${r.factor_conversion} · ${r.aviso || "costo reciente"}`,
          ),
        ),
      );
      select.value =
        state.cart.get(p.id)?.relationId ||
        (available.some((r) => r.id === p.sugerido_id) ? p.sugerido_id : "");
      const qty = input("number", state.cart.get(p.id)?.quantity || 0, 0);
      qty.step = "any";
      qty.setAttribute("aria-label", `Cantidad a comprar de ${p.nombre}`);
      const info = node("p", null, "order-line-help");
      function sync() {
        const r = available.find((r) => r.id === select.value);
        if (r) {
          if (!state.cart.has(p.id)) qty.value = r.cantidad_sugerida;
          info.textContent = `Sugerencia ${r.cantidad_sugerida} ${r.unidad_compra || "unidades de compra"} = ${num(r.cantidad_sugerida) * num(r.factor_conversion)} ${p.unidad || "unidades internas"}. Objetivo ${r.objetivo}; mínimo de compra ${r.cantidad_minima_compra || "no informado"}, múltiplo ${r.multiplo_compra || "no informado"}, entrega ${r.tiempo_entrega_dias ?? "sin plazo"} días. ${r.comparable ? "Comparación por costo neto equivalente." : "Costo o conversión requieren revisión."}`;
        } else {
          info.textContent =
            "No hay una recomendación automática con costo reciente comparable.";
        }
      }
      select.addEventListener("change", () => {
        state.cart.delete(p.id);
        sync();
        renderCart();
      });
      sync();
      card.append(
        select,
        info,
        node("label", "Cantidad en presentación del proveedor"),
        qty,
        button(
          "Añadir al pedido",
          () => {
            const r = available.find((r) => r.id === select.value),
              value = Number(qty.value);
            if (
              !r ||
              !(Number(r.factor_conversion) > 0) ||
              !Number.isFinite(value) ||
              value <= 0
            )
              throw Error(
                "Selecciona proveedor, conversión válida y cantidad.",
              );
            if (
              value < num(r.cantidad_minima_compra) ||
              (num(r.multiplo_compra) > 0 &&
                Math.abs(
                  value / num(r.multiplo_compra) -
                    Math.round(value / num(r.multiplo_compra)),
                ) > 1e-6)
            )
              throw Error(
                "La cantidad debe respetar el mínimo y múltiplo del proveedor.",
              );
            choose(p, r.id, value);
          },
          "button button-primary",
        ),
      );
      box.append(card);
    }
    if (rows.length > state.limit)
      box.append(
        button(`Mostrar más (${rows.length - state.limit} restantes)`, () => {
          state.limit += 60;
          renderProducts();
        }),
      );
    if (!rows.length)
      box.append(node("p", "No hay productos para este filtro."));
    const unassigned = state.data.anotaciones.filter((a) => !a.codigo_producto);
    if (unassigned.length) {
      box.append(node("h4", "Anotaciones de productos nuevos por vincular"));
      unassigned.forEach((a) =>
        box.append(
          node("p", `${a.producto_nombre} · cantidad ${a.cantidad_sugerida}`),
        ),
      );
    }
  }
  function renderCart() {
    const box = el("ordersCart");
    box.replaceChildren();
    el("orderCartNav").textContent = `Revisar selección (${state.cart.size})`;
    const groups = new Map();
    for (const item of state.cart.values()) {
      const r = supplierById(item.relationId);
      if (!r) continue;
      if (!groups.has(r.proveedor_id)) groups.set(r.proveedor_id, []);
      groups.get(r.proveedor_id).push({ ...item, r });
    }
    for (const [providerId, items] of groups) {
      const card = node("article", null, "order-product");
      card.append(node("h3", `Pedido a ${items[0].r.proveedor}`));
      let total = 0,
        unknown = false;
      for (const i of items) {
        if (i.r.costo == null) unknown = true;
        else total += i.quantity * i.r.costo;
        const row = node("div", null, "order-history-row");
        row.append(
          node(
            "span",
            `${i.r.codigo_principal_proveedor || i.product.codigo} · ${i.product.nombre} · ${i.quantity} ${i.r.unidad_compra || ""} = ${i.quantity * num(i.r.factor_conversion)} ${i.product.unidad || ""}`,
          ),
          button("Quitar", () => {
            state.cart.delete(i.product.id);
            renderCart();
          }),
        );
        card.append(row);
      }
      card.append(
        node(
          "p",
          `Estimado neto ${money(total)}${unknown ? " · hay líneas sin costo" : ""}. Impuestos y transporte sujetos a revisión.`,
        ),
      );
      const notes = node("textarea");
      notes.placeholder = "Notas del pedido";
      notes.setAttribute("aria-label", "Notas del pedido");
      const expected = input("date", "");
      expected.setAttribute("aria-label", "Fecha esperada");
      card.append(
        notes,
        node("label", "Entrega esperada"),
        expected,
        button(
          "Guardar borrador",
          async () => {
            let draft = state.drafts.get(providerId);
            if (!draft) {
              draft = { idempotency_key: crypto.randomUUID() };
              state.drafts.set(providerId, draft);
            }
            const lines = items.map((i) => ({
              relacion_id: i.relationId,
              cantidad: i.quantity,
              anotacion_id:
                i.product.anotaciones.find(
                  (a) =>
                    a.proveedor_principal_id === providerId ||
                    a.proveedor_alternativo_id === providerId,
                )?.id || null,
            }));
            const order = await api("", {
              method: "POST",
              body: JSON.stringify({
                ...draft,
                proveedor_id: providerId,
                lineas: lines,
                notas: notes.value,
                fecha_esperada: expected.value,
              }),
            });
            state.drafts.delete(providerId);
            items.forEach((i) => state.cart.delete(i.product.id));
            await refresh();
            await openOrder(order.id);
          },
          "button button-primary",
        ),
      );
      box.append(card);
    }
    if (!groups.size)
      box.append(
        node(
          "p",
          "Selecciona productos para agruparlos en pedidos por proveedor.",
        ),
      );
  }
  async function action(order, accion, motivo = "") {
    return api("/" + order.id + "/action", {
      method: "POST",
      body: JSON.stringify({ version: order.version, accion, motivo }),
    });
  }
  function pdf(order) {
    const doc = new window.jspdf.jsPDF();
    doc.setFontSize(18);
    doc.text(`Ferrisoluciones · Pedido P-${order.numero}`, 14, 20);
    doc.setFontSize(11);
    doc.text(order.proveedor, 14, 30);
    doc.text(
      `Entrega prevista: ${order.fecha_esperada || "por confirmar"}`,
      14,
      38,
    );
    doc.autoTable({
      startY: 45,
      head: [
        [
          "Código proveedor",
          "Producto / presentación",
          "Cantidad",
          "Costo neto",
        ],
      ],
      body: order.lineas.map((l) => [
        l.codigo_proveedor || l.codigo,
        `${l.descripcion_proveedor || l.nombre}\n${l.unidad_compra || ""} × ${l.factor_conversion}`,
        l.cantidad,
        l.costo == null ? "Por confirmar" : money(l.costo),
      ]),
      styles: { fontSize: 9 },
    });
    let y = doc.lastAutoTable.finalY + 10;
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    doc.text(
      doc.splitTextToSize(
        `Notas: ${order.notas || "Sin notas"}\nValores estimados; impuestos, transporte y disponibilidad por confirmar.`,
        180,
      ),
      14,
      y,
    );
    return doc;
  }
  async function send(order) {
    if (
      !(await window.app.askConfirm(
        `Enviar P-${order.numero} al grupo interno de compras?`,
        { confirmText: "Enviar al grupo" },
      ))
    )
      return;
    const sending = await action(order, "ENVIAR");
    try {
      const media = pdf(sending).output("datauristring").split(",")[1];
      const response = await window.app.posApiRequest(
        "/api/whatsapp/send-media",
        {
          method: "POST",
          body: JSON.stringify({
            media: {
              media,
              mediatype: "document",
              mimetype: "application/pdf",
              fileName: `Pedido_P-${order.numero}.pdf`,
              caption: `Pedido P-${order.numero} · ${order.proveedor}\n${order.lineas.length} líneas · Entrega ${order.fecha_esperada || "por confirmar"}`,
            },
          }),
        },
      );
      if (
        response?.success === false ||
        response?.ok === false ||
        response?.data?.success === false
      )
        throw Error("No se confirmó el envío al grupo.");
      await action(sending, "ENVIADO");
    } catch (e) {
      try {
        await action(sending, "ENVIO_INCIERTO", e.message);
      } catch (_) {}
      throw Error(
        "El envío requiere verificación. Revisa el grupo antes de marcarlo como enviado; el sistema no lo reenviará automáticamente.",
      );
    }
    await refresh();
    await openOrder(order.id);
  }
  async function openOrder(id) {
    state.current = await api("/" + id);
    renderDetail();
    showView("detail");
  }
  function renderDetail() {
    const o = state.current,
      box = el("ordersDetail");
    box.replaceChildren();
    if (!o) return;
    box.append(
      node("h3", `P-${o.numero} · ${o.proveedor} · ${labels[o.estado]}`),
      node(
        "p",
        `${o.notas || "Sin notas"} · Entrega ${o.fecha_esperada || "por confirmar"}`,
      ),
    );
    const t = node("table", null, "orders-table"),
      head = node("tr");
    [
      "Producto",
      "Pedido (base)",
      "Recibido",
      "Pendiente",
      "Costo pedido",
    ].forEach((v) => head.append(node("th", v)));
    const th = node("thead");
    th.append(head);
    const tb = node("tbody");
    o.lineas.forEach((l) => {
      const tr = node("tr");
      [
        `${l.codigo_proveedor || l.codigo} · ${l.nombre}`,
        `${num(l.cantidad) * num(l.factor_conversion)} ${l.unidad_interna || ""}`,
        l.recibido_base,
        l.pendiente_base,
        l.costo == null ? "Sin costo" : money(l.costo),
      ].forEach((v) => tr.append(node("td", v)));
      tb.append(tr);
    });
    t.append(th, tb);
    box.append(t);
    const actions = node("div", null, "orders-actions");
    actions.append(
      button("Descargar PDF", () => pdf(o).save(`Pedido_P-${o.numero}.pdf`)),
    );
    if (o.estado === "BORRADOR") {
      actions.append(
        button("Editar borrador", () => {
          if (
            o.lineas.some(
              (l) =>
                !state.data.productos.some(
                  (p) =>
                    p.id === l.producto_id &&
                    p.proveedores.some((r) => r.id === l.relacion_id),
                ),
            )
          )
            throw Error(
              "Hay vínculos retirados. Revisa el catálogo antes de editar este borrador.",
            );
          state.cart.clear();
          state.drafts.set(o.proveedor_id, {
            id: o.id,
            version: o.version,
            idempotency_key: o.idempotency_key,
          });
          o.lineas.forEach((l) => {
            const p = state.data.productos.find((p) => p.id === l.producto_id);
            if (p && p.proveedores.some((r) => r.id === l.relacion_id))
              state.cart.set(p.id, {
                product: p,
                relationId: l.relacion_id,
                quantity: num(l.cantidad),
              });
          });
          renderCart();
          showView("cart");
          const notes = el("ordersCart").querySelector("textarea"),
            date = el("ordersCart").querySelector("input[type=date]");
          if (notes) notes.value = o.notas;
          if (date) date.value = o.fecha_esperada || "";
        }),
        button("Preparar pedido", async () => {
          if (
            o.lineas.some((l) => l.costo == null) &&
            !(await window.app.askConfirm(
              "Hay costos sin confirmar. Preparar igualmente?",
              { confirmText: "Preparar" },
            ))
          )
            return;
          state.current = await action(o, "PREPARAR");
          renderDetail();
          await refresh();
        }),
      );
    }
    if (o.estado === "PREPARADO")
      actions.append(
        button(
          "Enviar al grupo interno",
          () => send(o),
          "button button-primary",
        ),
      );
    if (["ENVIANDO", "ENVIO_INCIERTO"].includes(o.estado))
      actions.append(
        button("Verifiqué que llegó al grupo", async () => {
          if (
            await window.app.askConfirm(
              "Confirma que verificaste el PDF en el grupo interno.",
              { confirmText: "Marcar enviado" },
            )
          ) {
            state.current = await action(o, "ENVIADO");
            renderDetail();
            await refresh();
          }
        }),
      );
    if (["ENVIANDO", "ENVIO_INCIERTO"].includes(o.estado)) {
      actions.append(
        button("Verifiqué que no llegó; permitir reintento", async () => {
          if (
            await window.app.askConfirm(
              "Comprueba el grupo y espera a que termine el intento anterior. ¿Confirmas que el PDF no llegó?",
              { confirmText: "No llegó; habilitar envío" },
            )
          ) {
            state.current = await action(
              o,
              "REINTENTAR",
              "Verificación manual: el PDF no llegó al grupo",
            );
            renderDetail();
            await refresh();
          }
        }),
      );
    }
    if (o.estado === "ENVIADO")
      actions.append(
        button("Confirmado por proveedor", async () => {
          state.current = await action(o, "CONFIRMAR");
          renderDetail();
          await refresh();
        }),
      );
    const reason = node("textarea");
    reason.placeholder = "Motivo de cierre o cancelación";
    reason.setAttribute("aria-label", "Motivo de cierre o cancelación");
    if (["ENVIADO", "CONFIRMADO", "PARCIAL"].includes(o.estado))
      actions.append(
        button("Cerrar saldo pendiente", async () => {
          if (reason.value.trim().length < 3) throw Error("Indica el motivo.");
          if (
            await window.app.askConfirm(
              "Cerrar el pedido conservando sus faltantes e historial?",
              { confirmText: "Cerrar pedido" },
            )
          ) {
            state.current = await action(o, "CERRAR", reason.value);
            renderDetail();
            await refresh();
          }
        }),
      );
    if (
      ["BORRADOR", "PREPARADO", "ENVIADO", "CONFIRMADO"].includes(o.estado) &&
      !o.facturas.length
    )
      actions.append(
        button("Cancelar pedido", async () => {
          if (reason.value.trim().length < 3) throw Error("Indica el motivo.");
          if (
            await window.app.askConfirm("Cancelar el pedido?", {
              confirmText: "Cancelar pedido",
            })
          ) {
            state.current = await action(o, "CANCELAR", reason.value);
            renderDetail();
            await refresh();
          }
        }),
      );
    box.append(actions, reason, node("h4", "Facturas y entregas"));
    o.facturas.forEach((f) => {
      const row = node("div", null, "order-history-row");
      row.append(
        node(
          "span",
          `${f.numero_factura} · ${f.fecha_emision} · ${money(f.total)}`,
        ),
        button("Ver factura", () => window.openInvoiceFromOrder(f.id)),
      );
      box.append(row);
    });
    if (!o.facturas.length)
      box.append(
        node(
          "p",
          "Sin facturas asociadas. Al registrar una factura podrás seleccionar este pedido.",
        ),
      );
    o.recepciones.forEach((r) => {
      const l = o.lineas.find((l) => l.id === r.linea_id);
      box.append(
        node(
          "p",
          `${r.nombre || r.codigo_proveedor || "Producto"} · recibido ${r.cantidad_recibida} × ${r.factor_conversion}${l && l.costo != null ? " · variación costo/base " + money(num(r.costo_neto) / num(r.factor_conversion) - num(l.costo) / num(l.factor_conversion)) : ""}${!l ? " · adicional al pedido" : ""}`,
        ),
      );
    });
    box.append(node("h4", "Historial"));
    o.eventos.forEach((e) =>
      box.append(
        node(
          "p",
          `${new Date(e.created_at).toLocaleString("es-EC")} · ${e.accion} · ${e.usuario}${e.detalle ? " · " + e.detalle : ""}`,
        ),
      ),
    );
  }
  window.initPedidos = async () => {
    if (!el("ordersHome")) return;
    if (!el("orderRefresh").dataset.bound) {
      el("orderRefresh").dataset.bound = "1";
      el("orderRefresh").addEventListener("click", () =>
        run(async () => {
          await refresh();
          back();
        }),
      );
      el("orderProductsNav").addEventListener("click", () => startProducts());
      el("orderProvidersNav").addEventListener("click", () =>
        showView("providers"),
      );
      el("orderCartNav").addEventListener("click", () => showView("cart"));
      el("orderHistoryNav").addEventListener("click", () =>
        showView("history"),
      );
      el("orderSettingsNav").addEventListener("click", () =>
        showView("settings"),
      );
      el("orderBack").addEventListener("click", back);
      el("orderHomeNav").addEventListener("click", () => {
        state.trail = [];
        showView("home", false);
      });
      el("orderProviderSearch").addEventListener("input", () => {
        if (state.data) renderProviders();
      });
      el("orderSearch").addEventListener("input", () => {
        if (state.data) renderProducts();
      });
    }
    state.trail = [];
    showView("home", false);
    await run(refresh);
  };

  // La elección se pide al registrar, cuando ya se conocen proveedor y SKU finales.
  window.selectInvoicePurchaseOrder = async (payload) => {
    const orders = await api(
      "?" +
        new URLSearchParams({
          proveedor_id: payload.proveedor_id,
          abiertos: "1",
        }),
    );
    return new Promise((resolve) => {
      const dialog = node("dialog", null, "order-invoice-dialog"),
        form = node("div"),
        title = node("h2", "¿A qué pedido pertenece esta factura?");
      const select = node("select");
      select.setAttribute("aria-label", "Pedido de la factura");
      select.append(
        option("", "Selecciona una opción"),
        option("directa", "Compra sin pedido previo"),
      );
      orders.forEach((o) =>
        select.append(
          option(
            o.id,
            `P-${o.numero} · ${labels[o.estado]} · ${o.fecha_esperada || "sin fecha"}`,
          ),
        ),
      );
      function modalButton(text, fn, cls = "button button-secondary") {
        const b = node("button", text, cls);
        b.type = "button";
        b.addEventListener("click", async () => {
          try {
            await fn();
          } catch (e) {
            status.textContent = e.message;
          }
        });
        return b;
      }
      const content = node("div"),
        status = node("p"),
        cancel = modalButton("Cancelar", () => finish(null)),
        confirm = modalButton(
          "Confirmar asociación",
          () => {
            if (!select.value)
              throw Error("Selecciona un pedido o compra sin pedido previo.");
            if (select.value !== "directa" && !detail)
              throw Error("Espera a que cargue el pedido.");
            const mapping = controls.map((c, index) => ({
              index,
              linea_id: c.select.value || null,
              factor: Number(c.factor.value),
            }));
            if (
              mapping.some(
                (m) =>
                  m.linea_id && (!Number.isFinite(m.factor) || m.factor <= 0),
              )
            )
              throw Error("Revisa las conversiones de las líneas.");
            finish({
              pedido_id: select.value === "directa" ? null : select.value,
              mapping,
            });
          },
          "button button-primary",
        );
      let detail = null,
        controls = [],
        token = 0;
      function finish(value) {
        dialog.close();
        dialog.remove();
        resolve(value);
      }
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(null);
      });
      select.addEventListener("change", async () => {
        const current = ++token;
        detail = null;
        controls = [];
        content.replaceChildren();
        status.textContent = "";
        confirm.disabled = true;
        if (!select.value || select.value === "directa") {
          confirm.disabled = !select.value;
          return;
        }
        try {
          const d = await api("/" + select.value);
          if (current !== token) return;
          detail = d;
          content.append(
            node(
              "p",
              "Revisa cada correspondencia y conversión. Las cantidades recibidas se acumulan en unidades internas del pedido. Los adicionales no reducen sus faltantes.",
            ),
          );
          payload.items.forEach((item, index) => {
            const row = node("div", null, "order-match-row");
            const match = node("select");
            match.setAttribute(
              "aria-label",
              `Línea de pedido para ${item.nombre_proveedor}`,
            );
            match.append(
              option("", "Producto adicional / sin correspondencia"),
            );
            d.lineas.forEach((l) =>
              match.append(
                option(
                  l.id,
                  `${l.codigo} · ${l.nombre} · pendiente ${l.pendiente_base} ${l.unidad_interna || ""}`,
                ),
              ),
            );
            const candidates = d.lineas.filter(
              (l) =>
                (item.inventory_id && l.producto_id === item.inventory_id) ||
                (item.codigo && l.codigo === item.codigo) ||
                (item.recepcion === "NO_RECIBIDO" &&
                  item.codigo_proveedor &&
                  l.codigo_proveedor === item.codigo_proveedor),
            );
            const exact = candidates.length === 1 ? candidates[0] : null;
            if (exact) match.value = exact.id;
            const received =
              item.recepcion === "NO_RECIBIDO"
                ? 0
                : item.recepcion === "PARCIAL"
                  ? num(item.cantidad_recibida)
                  : num(item.cantidad);
            const factor = input("number", 1, 0.000001);
            factor.step = "any";
            factor.setAttribute(
              "aria-label",
              `Unidades internas por unidad facturada, línea ${index + 1}`,
            );
            const summary = node("p");
            function sync() {
              const l = d.lineas.find((l) => l.id === match.value);
              if (l) {
                factor.value =
                  item.presentacion && received > 0
                    ? num(item.presentacion.cantidad_inventario) / received
                    : item.codigo_proveedor &&
                        item.codigo_proveedor === l.codigo_proveedor
                      ? l.factor_conversion
                      : 1;
              }
              factor.disabled = !l;
              update();
            }
            function update() {
              const l = d.lineas.find((l) => l.id === match.value);
              summary.textContent = l
                ? `Recibido: ${received} × ${factor.value} = ${(received * num(factor.value)).toFixed(3)} ${l.unidad_interna || ""}. Pedido original: ${l.cantidad} × ${l.factor_conversion}. Costo facturado/base ${money(num(item.costo_neto) / Math.max(num(factor.value), 0.000001))}; pedido/base ${l.costo == null ? "sin costo" : money(num(l.costo) / num(l.factor_conversion))}.`
                : "Se registrará como producto adicional.";
            }
            match.addEventListener("change", sync);
            factor.addEventListener("input", update);
            sync();
            controls.push({ select: match, factor });
            row.append(
              node(
                "h4",
                `${index + 1}. ${item.nombre_proveedor || item.codigo || "Producto"} · facturado ${item.cantidad}`,
              ),
              match,
              node(
                "label",
                "Unidades internas del pedido por unidad facturada",
              ),
              factor,
              summary,
            );
            content.append(row);
          });
          confirm.disabled = false;
        } catch (e) {
          status.textContent = e.message;
        }
      });
      form.append(title, select, status, content, cancel, confirm);
      dialog.append(form);
      document.body.append(dialog);
      dialog.showModal();
      if (payload.pedido_seleccionado) {
        select.value = payload.pedido_id || "directa";
        if (select.value) select.dispatchEvent(new Event("change"));
        else
          status.textContent =
            "El pedido seleccionado ya no está abierto. Revisa la asociación.";
      }
    });
  };
})();
