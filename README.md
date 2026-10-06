# Inventario y Compras

Frontend independiente del POS para los flujos de inventario y compras de
Ferrisoluciones. El código es público, pero la aplicación requiere una cuenta
autorizada y no contiene secretos del servidor.

Documentación contrastada con el despliegue el 5 de octubre de 2026 y actualizada
con el despliegue de Pedidos del mismo día. Frontend estático de HTML, CSS y JavaScript, sin paso de compilación.

## Estado actual

- Autenticación con Supabase Auth mediante correo y contraseña.
- Autorización por perfil en `ferre_usuarios_ferreteria`.
- Se requiere un perfil existente; la consulta del frontend recupera nombre y
  rol. Los permisos de cada operación los valida el backend.
- Consulta y revisión de facturas autorizadas del SRI.
- Fallback de carga XML después de tres consultas fallidas de la misma clave.
- La consulta SRI, vinculación XML, catálogo producto-proveedor y comprobación
  de WhatsApp se ejecutan en el backend autenticado de
  `api.ferrisoluciones.com`.
- La revisión conserva hasta doce borradores locales, asociados al usuario y
  a la clave de acceso, durante siete días. También permanece una ruta de
  restauración del formulario heredado, con la limitación CSP descrita abajo.
- La aplicación muestra versión y build en pantalla. Un service worker usa
  network-first para HTML, JavaScript, CSS y vistas, con caché solo como
  respaldo cuando la red no está disponible; nunca intercepta el API.
- En teléfonos, después del inicio de sesión se fuerza el módulo exclusivo
  `Cargar factura`: solicita permiso de cámara y escanea la clave SRI del código
  de barras. Si el RUC no existe, obliga a vincular un proveedor antes.
- Cuando la factura no trae código de barras legible, `Tomar foto` o `Elegir de
  galería` abren un recuadro ajustable sobre la línea de la clave y un OCR local
  (Tesseract.js alojado en `vendor/tesseract/`, la foto no se sube) reconstruye
  la clave de 49 dígitos: valida el dígito verificador módulo 11 y cuadra RUC,
  serie y secuencial contra el número de factura impreso. El escáner sigue
  siendo la vía principal.
- Antes de guardar cualquier factura se muestra un resumen con la lista de
  productos para verificar; el guardado en Pendientes ocurre solo al confirmar.
  Aplica al escaneo por código de barras, a la foto y al ingreso por PC
  (`Consultar SRI` hace una vista previa; `Guardar en pendientes` persiste).
- La detección de teléfono combina `navigator.userAgentData`, tokens de teléfono
  en el user agent y un respaldo físico estricto (`pointer: coarse` +
  `hover: none` + pantalla de tamaño real de teléfono). Las tablets y las
  laptops táctiles reciben la interfaz completa. Ante la duda no se fuerza el
  módulo. `?vista=escritorio` recupera la interfaz completa en un equipo mal
  clasificado y lo recuerda; `?vista=auto` revierte esa preferencia.
- `Pendientes` aparece en escritorio cuando existe al menos un XML por revisar.
  Al abrir uno se bloquea temporalmente para el usuario; al guardar la factura
  se marca como registrado. Solo `admin` puede borrar el documento pendiente y
  sus líneas asociadas.
- Navegación superior con módulos independientes.
- `Ingresar facturas`: consulta la clave/XML, vincula el proveedor por RUC y
  revisa las líneas en la interfaz nativa. Permite vincular SKU, crear productos,
  ajustar precios, desglose y presentación y registrar recepción completa,
  parcial o no recibida con motivos. `js/ingreso-registro.js` registra contado
  o crédito mediante `POST /api/purchases/v2/invoices/register`, con clave de
  idempotencia. Las novedades de recepción generan un intento de aviso por WhatsApp.
  También existe un asistente para construir la clave de acceso por campos.
- `Comparador`: módulo nativo (`js/comparador.js`). Reutiliza el catálogo interno
  que precarga la app (`GET /api/purchases/v2/inventory/catalog`, compartido con
  Ingresar facturas), así la búsqueda es instantánea y por palabras, no solo por
  frase. Mientras el catálogo aún carga cae a `GET /api/purchases/v2/inventory/search`.
  Muestra costo y proveedor actual y calcula el ahorro y el precio de venta
  sugerido (38 % margen + 2 % renta) frente a un costo hipotético de otro
  proveedor. Solo lectura; sin manejadores en línea ni acceso directo a Supabase.
- `Dashboard`: módulo nativo visible (`js/dashboard.js`). Consulta
  `/api/purchases/v2/dashboard/providers` y presenta saldos, vencimientos,
  compras y ventas asociadas, con prioridades de seguimiento por proveedor.
- `Facturas`: módulo nativo visible (`js/facturas.js`). Incluye filtros por
  proveedor, emisor y estado, detalle, historial y registro de pagos, cuentas
  bancarias, notas de crédito y resolución de novedades de recepción. Integra
  notas pendientes y eventualidades del proveedor; permite resolver notas y
  previsualizar el estado del proveedor antes de notificar su visita por WhatsApp.
- `Compra express`: módulo nativo (`js/compra-express.js`) para compras sin
  factura ni IVA, al contado en efectivo, a proveedores sin RUC ni emisores
  vinculados. Registra mediante `/api/purchases/v2/express` para incrementar
  stock y dejar la compra pagada.
- `Productos y proveedores`: módulo reservado en la interfaz a roles cuyo
  nombre contiene `admin`, protegido por el
  backend, que agrupa las alternativas de compra por SKU interno. Muestra alias
  y códigos del proveedor, costo neto, presentación, múltiplos y plazo cuando
  estén registrados. Permite desvincular relaciones con confirmación mediante
  `DELETE /api/purchases/v2/product-providers/:id`. No genera pedidos.

`views/` y `js/ingreso-factura.js` conservan implementaciones heredadas del POS.
El registro normal ya usa `js/ingreso-registro.js`. Sin embargo, `app.js`
mantiene un cargador de `views/proveedores.html` para restaurar el formulario
heredado: intenta ejecutar scripts en línea que la CSP actual bloquea.
Las vistas heredadas no deben confundirse con los módulos nativos actuales.

La identidad legal del proveedor se guarda en `ruc` y `razon_social`. El campo
`empresa` permanece como alias o nombre comercial.

Los módulos clonados todavía contienen lecturas y escrituras heredadas directas
a Supabase bajo RLS. Deben migrarse gradualmente al backend antes de restringir
las políticas generales que también utiliza el POS antiguo.
`app.js` también consulta directamente el perfil y el proveedor por RUC.

## Pedidos a proveedores

Nuevo módulo nativo en `js/pedidos.js`: contadores por necesidad, entrada por
proveedor, comparación de vínculos por costo equivalente, agrupación, borradores,
PDF al grupo interno y seguimiento de entregas. Una factura se asocia a un pedido
o a compra sin pedido previo; un pedido acepta varias facturas del mismo proveedor.
La elección se solicita al guardar la captura y se revisa al registrar la factura.

Consultar [diseño, pruebas y activación](docs/pedidos-proveedores.md). La migración
`20261005b_pedidos_proveedores.sql` está aplicada y el backend utiliza
`ferrisoluciones-inventory-api:20261005-pedidos`. Build `20261005.1`; versión,
build y caché están sincronizados. El estado previo se conserva abajo como
referencia y el [registro de despliegue](docs/despliegue-20261005.md) documenta la entrega.

## Organización

- `index.html`: acceso, navegación, paneles y modales.
- `app.js`: sesión, navegación, SRI/XML, captura móvil, pendientes, catálogo,
  borradores y coordinación del registro.
- `js/`: módulos nativos descritos arriba y `ocr-clave.js` para OCR local.
- `styles.css` y `provider-base.css`: estilos actuales y base heredada.
- `vendor/`: Supabase, Font Awesome, jsPDF, ZXing y Tesseract locales.
- `sw.js`, `manifest.webmanifest` y `version.json`: caché, instalación y versión.

## Estado previo verificado en producción (antes de Pedidos)

Comprobaciones de solo lectura mediante Teleport con `codexadmin`:

- El frontend público devuelve HTTP 200 desde GitHub Pages. Los hashes SHA-256
  de `index.html`, `app.js`, `js/facturas.js`, `js/dashboard.js` y
  `js/ingreso-registro.js` coincidían con los archivos locales antes de implementar Pedidos.
- `version.json` publicado indica `0.2.0`, build `20260930.3`.
- El service worker publicado conserva el nombre de caché
  `ferrisoluciones-inventario-0.2.0-20260911.6`; la copia local ya usa el build nuevo.
- El servicio Swarm `inventory-api_inventory_api` tiene una réplica activa
  (`1/1`) y usa `ferrisoluciones-inventory-api:20260930-provider-notices`.
  Traefik dirige `api.ferrisoluciones.com/api/purchases*` a este servicio,
  puerto interno 3020. Su stack está en `/opt/inventory-api/docker-stack.yml`;
  el código de ejecución está en `/app` dentro del contenedor.
- `src/routes/purchases.js` del contenedor coincidía por SHA-256 con la copia
  local en `../inventory-api`. Contiene rutas de registro, compra express,
  pagos, notas de crédito, novedades, dashboard y documentos pendientes.
- `GET /api/purchases/v2/providers` sin credenciales devuelve HTTP 401.
- `PURCHASES_V2_WRITE_ENABLED=false` en el servicio. Esa bandera controla
  `/v2/commit`; registro de facturas y compra express son rutas distintas,
  protegidas por `purchases:write`, sin consultar esa bandera.

Estas comprobaciones no incluyen escrituras de prueba, envío de mensajes ni
validación integral de funciones SQL o permisos con una sesión de negocio.

## Prueba local

Desde `ferrisoluciones/api-pos`:

```sh
npm run dev:purchases:preview
```

Abrir `http://127.0.0.1:8091/` e iniciar sesión con una cuenta existente del POS.

Revisar `api-pos/scripts/purchase-preview-dev-server.mjs` antes de probar
escrituras: varias rutas del preview se delegan al backend de producción.
La URL local no implica datos aislados.

La prueba de navegador con API simulada está en `test/pedidos-browser.cjs`.
Comprobación de sintaxis:

```sh
for f in app.js sw.js js/*.js; do node --check "$f" || exit; done
```

El respaldo del service worker no garantiza operación de negocio sin conexión.
El OCR y sus modelos se cargan bajo demanda y no están en el precache inicial.

## Publicación

GitHub Pages publica automáticamente la raíz de la rama `main`. El dominio
esperado está definido en `CNAME` como `inventario.ferrisoluciones.com`.

Antes de publicar, verifica que el backend admita exactamente estos orígenes:

- `https://pos.ferrisoluciones.com`
- `https://inventario.ferrisoluciones.com`

No agregues comodines a CORS y revisa [SECURITY.md](SECURITY.md) antes de cada
publicación.

Para una entrega nueva se actualizan juntos `APP_VERSION` y `APP_BUILD` en
`app.js`, `version.json` y el nombre de caché de `sw.js`.
