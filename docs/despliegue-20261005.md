# Despliegue de Pedidos — 5 de octubre de 2026

Entrega autorizada por el propietario en este chat. Frontend `0.2.0`, build
`20261005.1`, publicado desde `main` mediante GitHub Pages.

## Backend y base de datos

- Servicio: `inventory-api_inventory_api`.
- Imagen nueva: `ferrisoluciones-inventory-api:20261005-pedidos`.
- Imagen anterior conservada: `ferrisoluciones-inventory-api:20260930-provider-notices`.
- Fuente de la entrega: `/opt/inventory-api/releases/20261005-pedidos`.
- Stack persistente actualizado: `/opt/inventory-api/docker-stack.yml`.
- Respaldo privado: `/opt/inventory-api/backups/20261005-pedidos/database.dump`.
- Stack anterior: `/opt/inventory-api/backups/20261005-pedidos/docker-stack.yml`.
- Log de construcción: `/opt/inventory-api/backups/20261005-pedidos/build.log`.

El respaldo PostgreSQL está en formato custom y se comprobó con `pg_restore -l`.
La migración `20261005b_pedidos_proveedores.sql` se aplicó una sola vez, dentro
de una transacción; se notificó a PostgREST y se recargó su caché mediante
SIGUSR1, sin reiniciar el servicio, porque la notificación inicial no bastó. La función
de ingreso anterior no fue reemplazada. La actualización conservó la política
`start-first` del servicio y Docker confirmó convergencia.

## Verificaciones

Las 66 pruebas de Node aprobaron localmente y en la construcción Docker. Las
pruebas transaccionales y de navegador se realizaron previamente con datos
sintéticos. El catálogo nuevo también se consultó con el esquema real de
producción, sin exportar datos de negocio. La imagen nueva está `healthy`, con una réplica `1/1`. El API pudo consultar
el catálogo y el historial con `service_role`; las rutas de pedidos y
proveedores devuelven HTTP 401 sin sesión. No se crearon pedidos de prueba,
no se registraron compras y no se enviaron mensajes reales al grupo.

Los comprobantes y las funciones anteriores siguen disponibles. La bandera
`PURCHASES_V2_WRITE_ENABLED` y los secretos del servicio no se modificaron.

## Reversión

1. Restaurar los archivos del frontend del commit anterior `ed360e7` mediante
   un commit de reversión revisado, conservando el historial de Git.
2. Actualizar solo Inventory API a
   `ferrisoluciones-inventory-api:20260930-provider-notices` y restaurar su
   referencia de imagen en el stack persistente.
3. Conservar las tablas nuevas, pedidos y asociaciones de facturas. No borrar
   datos ni reingresar facturas. El respaldo se reserva para recuperación ante
   pérdida de datos; no es necesario restaurarlo para revertir la interfaz.

La validación integral con una factura real y el envío de un pedido al grupo
se realizan durante el uso operativo, con revisión del usuario.
