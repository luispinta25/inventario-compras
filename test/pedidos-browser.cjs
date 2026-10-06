// Prueba aislada: API simulada y datos sintéticos; sin llamadas a producción.
const { chromium } = require("playwright");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
  const server = createServer(async (req, res) => {
    try {
      const file = path.join(
        root,
        req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0],
      );
      let body = await readFile(file);
      if (file.endsWith("index.html"))
        body = body
          .toString()
          .replace('<script src="/app.js" defer></script>', "");
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(body);
    } catch (_) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE
        ? { executablePath: process.env.BROWSER_EXECUTABLE }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ url: "/js/pedidos.js" });
    await page.evaluate(() => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("sessionLoader").hidden = true;
      document.getElementById("appShell").hidden = false;
      document
        .querySelectorAll("[data-module-panel]")
        .forEach(
          (p) => (p.hidden = p.dataset.modulePanel !== "purchase-orders"),
        );
      const p = {
        id: "33333333-3333-4333-8333-333333333333",
        codigo: "T-1",
        nombre: "Producto <img src=x onerror=alert(1)>",
        unidad: "UNIDADES",
        stock: 0,
        stock_minimo: 12,
        vendido: 21,
        promedio_diario: 1,
        en_camino: 0,
        categoria: "agotados",
        cobertura_dias: 0,
        anotaciones: [],
        sugerido_id: "44444444-4444-4444-8444-444444444444",
        proveedores: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            proveedor_id: "11111111-1111-4111-8111-111111111111",
            proveedor: "Proveedor prueba",
            factor_conversion: 12,
            unidad_compra: "CAJA",
            costo: 24,
            costo_base: 2,
            comparable: true,
            cantidad_sugerida: 3,
            objetivo: 28,
            cantidad_minima_compra: 1,
            multiplo_compra: 1,
          },
        ],
      };
      window.saved = [];
      window.order = null;
      window.app = {
        formatCurrency: (n) => "$" + Number(n).toFixed(2),
        askAlert: async (m) => {
          window.lastAlert = m;
        },
        askConfirm: async () => true,
        posApiRequest: async (url, opt = {}) => {
          if (url.endsWith("/providers"))
            return {
              data: [
                {
                  id: p.proveedores[0].proveedor_id,
                  empresa: "Proveedor prueba",
                },
              ],
            };
          if (url.includes("/catalog?"))
            return {
              data: {
                productos: [p],
                anotaciones: [],
                contadores: { agotados: 1, riesgo: 0, bajo: 0, sin_vinculo: 0 },
              },
            };
          if (opt.method === "POST" && url.endsWith("/orders")) {
            const b = JSON.parse(opt.body);
            window.saved.push(b);
            window.order = {
              ...b,
              id: "55555555-5555-4555-8555-555555555555",
              numero: 1,
              version: 2,
              estado: "ENVIADO",
              proveedor: "Proveedor prueba",
              facturas: [],
              recepciones: [],
              eventos: [],
              lineas: [
                {
                  id: "66666666-6666-4666-8666-666666666666",
                  producto_id: p.id,
                  relacion_id: p.proveedores[0].id,
                  codigo: p.codigo,
                  nombre: p.nombre,
                  cantidad: 3,
                  factor_conversion: 12,
                  unidad_interna: "UNIDADES",
                  unidad_compra: "CAJA",
                  costo: 24,
                  recibido_base: 0,
                  pendiente_base: 36,
                },
              ],
            };
            return { data: window.order };
          }
          if (url.match(/orders\/[^/?]+$/)) return { data: window.order };
          return {
            data: window.order
              ? [
                  {
                    ...window.order,
                    proveedor: { empresa: "Proveedor prueba" },
                  },
                ]
              : [],
          };
        },
      };
    });
    await page.evaluate(() => window.initPedidos());
    assert.equal(await page.locator("#ordersEntry button:visible").count(), 2);
    assert.equal(await page.locator("[data-order-view]:visible").count(), 1);
    await page.screenshot({
      path: "/private/tmp/pedidos-home.png",
      fullPage: true,
    });
    await page.locator("#orderProvidersNav").click();
    await page.getByRole("button", { name: /PR Proveedor prueba/ }).click();
    assert.equal(
      await page.locator("#orderProductsTitle").textContent(),
      "Proveedor prueba",
    );
    await page.getByRole("button", { name: "← Volver", exact: true }).click();
    assert.equal(
      await page.locator('[data-order-view="providers"]:visible').count(),
      1,
    );
    await page
      .getByRole("button", { name: "Inicio de pedidos", exact: true })
      .click();
    await page.locator("#orderProductsNav").click();
    await page.getByRole("button", { name: "1 Agotados" }).click();
    await page.screenshot({
      path: "/private/tmp/pedidos-products.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Añadir al pedido" }).click();
    assert.equal(await page.locator("#ordersCart:visible").count(), 0);
    await page
      .getByRole("button", { name: "Revisar selección (1)", exact: true })
      .click();
    assert.equal(await page.locator("[data-order-view]:visible").count(), 1);
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await page
      .getByRole("heading", {
        name: "P-1 · Proveedor prueba · Enviado al grupo",
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.saved[0].lineas[0].cantidad),
      3,
    );
    assert.equal(await page.locator("#ordersProducts img").count(), 0);
    await page.evaluate(() => {
      window.associationPromise = window
        .selectInvoicePurchaseOrder({
          proveedor_id: "11111111-1111-4111-8111-111111111111",
          items: [
            {
              inventory_id: "33333333-3333-4333-8333-333333333333",
              codigo: "T-1",
              cantidad: 2,
              costo_neto: 25,
              nombre_proveedor: "Producto prueba",
              recepcion: "PARCIAL",
              cantidad_recibida: 1,
              presentacion: { cantidad_inventario: 12 },
            },
          ],
        })
        .then((r) => (window.association = r));
    });
    await page
      .getByLabel("Pedido de la factura")
      .selectOption("55555555-5555-4555-8555-555555555555");
    await page.getByRole("button", { name: "Confirmar asociación" }).click();
    await page.waitForFunction(() => window.association);
    assert.equal(
      await page.evaluate(() => window.association.mapping[0].factor),
      12,
    );
    assert.equal(
      await page.evaluate(() => window.association.mapping[0].linea_id),
      "66666666-6666-4666-8666-666666666666",
    );
    await page.evaluate(() => {
      window.association = null;
      window
        .selectInvoicePurchaseOrder({
          proveedor_id: "11111111-1111-4111-8111-111111111111",
          items: [],
        })
        .then((r) => (window.association = r));
    });
    await page.getByLabel("Pedido de la factura").selectOption("directa");
    await page.getByRole("button", { name: "Confirmar asociación" }).click();
    await page.waitForFunction(() => window.association);
    assert.equal(await page.evaluate(() => window.association.pedido_id), null);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Inicio de pedidos", exact: true })
      .click();
    assert.equal(await page.locator("#ordersEntry button:visible").count(), 2);
    await page.screenshot({
      path: "/private/tmp/pedidos-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: "/private/tmp/pedidos-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "OK: contador, agrupación, guardado, texto seguro, recepción parcial, conversión y compra directa.",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
