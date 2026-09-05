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
- `Pendientes` aparece en escritorio cuando existe al menos un XML por revisar.
  Al abrir uno se bloquea temporalmente para el usuario; al guardar la factura
  se marca como registrado. Solo `admin` puede borrar el documento pendiente y
  sus líneas asociadas.
- Navegación superior con módulos independientes.
- `Ingresar facturas`: consulta la clave/XML, vincula el proveedor por RUC y
  continúa en el formulario tradicional con proveedor y datos básicos precargados.
- `Dashboard`, `Facturas` y `Comparador`: módulos superiores independientes
  respaldados por la copia local del módulo de Proveedores del POS.
- `Productos y proveedores`: consulta de solo lectura, protegida por el
  backend, que agrupa las alternativas de compra por SKU interno. Muestra alias
  y códigos del proveedor, costo neto, presentación, múltiplos y plazo cuando
  estén registrados. No permite editar ni generar pedidos en esta fase.

El módulo original de Proveedores continúa intacto en el POS de producción. La
copia vive en `views/` y `js/` dentro de esta aplicación para permitir una
migración gradual.

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
