# Seguridad

Esta aplicación es una interfaz pública con acceso funcional restringido por
Supabase Auth y por los permisos del backend de Ferrisoluciones.

Revisado contra el código local y el despliegue el 5 de octubre de 2026.

## Acceso y permisos

El frontend requiere un perfil en `ferre_usuarios_ferreteria` y envía el JWT
de la sesión en `Authorization: Bearer` para las llamadas al API. Ocultar
módulos o botones no sustituye la autorización del servidor.

Los módulos nativos de Facturas, Dashboard, Comparador, Compra express y
registro utilizan el backend. `app.js` conserva consultas directas del perfil
y del proveedor por RUC; las vistas heredadas y `js/ingreso-factura.js`
contienen otras operaciones directas sujetas a RLS. Revisar su uso y el POS
antes de cambiar políticas compartidas.

En producción, el endpoint de proveedores rechaza solicitudes sin credenciales
con HTTP 401. La bandera `PURCHASES_V2_WRITE_ENABLED=false` controla el commit
V2; no deshabilita globalmente las escrituras. Las rutas nativas de registro
y compra express exigen `purchases:write` por separado.

## Pedidos

Las tablas y funciones de pedidos quedan restringidas a `service_role`. El
backend valida proveedor, vínculos activos, cantidades, estado y versión del
pedido. El registro con pedido usa una transacción para guardar factura y
recepción juntas. No se permite asociar una factura a un pedido de otro proveedor.

El guard de permisos del servicio actualmente admite cualquier perfil habilitado;
`purchases:write` no representa una restricción adicional de rol en su implementación
actual. Las rutas nuevas reutilizan ese comportamiento, sin cambiarlo.

Los envíos van al grupo interno configurado en el API. Una respuesta incierta
requiere verificación manual y no provoca reenvío automático. Las pruebas usan
un servidor local, API simulada y una base sintética; no ejecutan envíos reales.

## Datos que nunca deben publicarse

- claves `service_role` de Supabase;
- contraseñas, tokens o archivos `.env`;
- credenciales de Evolution, SRI, SSH o Teleport;
- respaldos o exportaciones de la base de datos;
- datos reales de clientes, proveedores o facturas usados como fixtures.

La clave `anon` incluida en el navegador es una credencial pública de cliente.
No es una credencial administrativa. Los flujos nuevos sensibles pasan por
`https://api.ferrisoluciones.com`, se autentican con el JWT del usuario y quedan
protegidos por permisos, validación y auditoría del backend. Algunos módulos
heredados aún acceden a Supabase bajo RLS y están en migración gradual para no
interrumpir el POS existente.

## Navegador y datos locales

La CSP de `index.html` bloquea scripts y manejadores en línea. Los módulos
nativos vinculan eventos desde archivos JavaScript; el cargador de la vista
heredada de Proveedores intenta ejecutar scripts en línea incompatibles con
esa política. Tratar los datos remotos como contenido no confiable.

Los borradores contienen datos de facturas en `localStorage`, asociados al
usuario y con caducidad de siete días y un máximo de doce. La asociación
controla su restauración en la aplicación; no cifra los datos ni los aísla de
otros scripts del mismo origen. El botón de cierre de sesión limpia los
borradores de ingreso. El catálogo también se almacena localmente.

El OCR procesa la foto en el dispositivo sin subirla al servidor. Las consultas
y capturas sí envían la clave o el XML al backend correspondiente.
El service worker excluye otros orígenes y rutas `/api/`; no debe almacenar
respuestas autenticadas de negocio.

## Pruebas y publicación

El servidor local de preview puede delegar operaciones a producción. Revisar
su configuración antes de registrar compras, pagos o enviar avisos. Mantener
orígenes de CORS explícitos y credenciales del servidor fuera del frontend.

## Reportes

No abras un issue público con datos sensibles. Comunica el hallazgo directamente
al administrador de Ferrisoluciones.
