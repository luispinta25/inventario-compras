# Inventario y Compras

Frontend independiente del POS para los flujos de inventario y compras de
Ferrisoluciones. El código es público, pero la aplicación requiere una cuenta
autorizada y no contiene secretos del servidor.

## Estado actual

- Autenticación con Supabase Auth mediante correo y contraseña.
- Autorización por perfil en `ferre_usuarios_ferreteria`.
- Cualquier rol con perfil activo puede ingresar.
- Consulta y revisión de facturas autorizadas del SRI.
- Fallback de carga XML después de tres consultas fallidas de la misma clave.
- La consulta SRI, vinculación XML, catálogo producto-proveedor y comprobación
  de WhatsApp se ejecutan en el backend autenticado de
  `api.ferrisoluciones.com`.
- El ingreso conserva un borrador local por usuario durante siete días y
  recupera tanto la revisión XML como el formulario posterior tras una recarga
  o cierre accidental.
- La aplicación muestra versión y build en pantalla. Un service worker usa
  network-first para HTML, JavaScript, CSS y vistas, con caché solo como
  respaldo cuando la red no está disponible; nunca intercepta el API.
- En teléfonos, después del inicio de sesión se fuerza el módulo exclusivo
  `Cargar factura`: solicita permiso de cámara, escanea la clave SRI y guarda el
  XML en la cola. Si el RUC no existe, obliga a vincular un proveedor antes.
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
  continúa en el formulario tradicional con proveedor y datos básicos precargados.
- `Comparador`: módulo nativo (`js/comparador.js`). Reutiliza el catálogo interno
  que precarga la app (`GET /api/purchases/v2/inventory/catalog`, compartido con
  Ingresar facturas), así la búsqueda es instantánea y por palabras, no solo por
  frase. Mientras el catálogo aún carga cae a `GET /api/purchases/v2/inventory/search`.
  Muestra costo y proveedor actual y calcula el ahorro y el precio de venta
  sugerido (38 % margen + 2 % renta) frente a un costo hipotético de otro
  proveedor. Solo lectura; sin manejadores en línea ni acceso directo a Supabase.
- `Dashboard` y `Facturas`: ocultos por ahora. Eran copias del módulo de
  Proveedores del POS y quedaron inservibles bajo la CSP estricta (arranque por
  `<script>` en línea bloqueado). Se reconstruirán como módulos nativos, uno por
  vez, antes de volver a mostrarse.
- `Productos y proveedores`: consulta de solo lectura, protegida por el
  backend, que agrupa las alternativas de compra por SKU interno. Muestra alias
  y códigos del proveedor, costo neto, presentación, múltiplos y plazo cuando
  estén registrados. No permite editar ni generar pedidos en esta fase.

`views/proveedores.html` y `views/comparador.html` son copias del POS y ya no se
cargan. `views/ingreso-factura.html` todavía lo abre el botón `Continuar
ingreso`, pero su arranque por `<script>` en línea está bloqueado por la CSP
estricta: ese paso queda pendiente de reconstrucción nativa. Todas las copias se
conservan como referencia. El módulo original de Proveedores continúa intacto en
el POS de producción.

La identidad legal del proveedor se guarda en `ruc` y `razon_social`. El campo
`empresa` permanece como alias o nombre comercial.

Los módulos clonados todavía contienen lecturas y escrituras heredadas directas
a Supabase bajo RLS. Deben migrarse gradualmente al backend antes de restringir
las políticas generales que también utiliza el POS antiguo.

## Prueba local

Desde `ferrisoluciones/api-pos`:

```sh
npm run dev:purchases:preview
```

Abrir `http://127.0.0.1:8091/` e iniciar sesión con una cuenta existente del POS.

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
