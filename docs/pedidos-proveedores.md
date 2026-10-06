# Pedidos a proveedores

Entrega del 5 de octubre de 2026, build `20261005.1`. La migración y el backend
se activaron antes de publicar el frontend. Consultar el
[registro de despliegue](despliegue-20261005.md).

## Uso

El módulo Pedidos ofrece contadores de agotados, riesgo de agotamiento, bajo
mínimo y productos sin vínculo. Las tres categorías de stock son excluyentes:
un agotado no se cuenta también como riesgo. Sin vínculo es un contador
independiente. Se puede profundizar por necesidad o seleccionar un proveedor.

Las cantidades sugeridas usan ventas netas recientes (restando devoluciones),
stock mínimo, cobertura, seguridad y plazo de entrega del proveedor. Los
pendientes de pedidos confirmados o parcialmente recibidos reducen la necesidad.
Los pedidos solamente enviados al grupo no se consideran confirmados.

La comparación usa costo neto por unidad interna, con la conversión del vínculo.
Solo se recomienda automáticamente entre costos con fecha de compra de hasta
90 días y conversión válida. Se conservan las alternativas para elegirlas
manualmente. El costo cero es válido; un costo desconocido no equivale a cero.
Los impuestos y transporte se muestran sujetos a revisión; el estimado no es
una cotización final. Sin información reciente de ventas se utiliza el mínimo.

Las anotaciones de productos existentes del POS se incorporan a la necesidad.
Las de productos nuevos quedan visibles para vincular antes de pedir. Al guardar
un borrador se puede asociar una anotación del producto/proveedor; al marcar el
pedido enviado se actualiza esa anotación a pedido. Si se cancela sin facturas,
se restaura a pendiente cuando no existe otro pedido abierto asociado.

Se añade cada producto a un proveedor y cantidad. El carrito se agrupa por
proveedor y cada grupo se guarda como un borrador independiente en el servidor.
Los vínculos deben estar activos y las cantidades respetar mínimos y múltiplos.
Se conserva una copia de códigos, descripción, unidades, conversión, precio y
fecha del costo; modificar luego el catálogo no altera el pedido histórico.

## Estados y entregas

Borrador → Preparado → Enviando → Enviado → Confirmado → Parcial → Completado.
Se puede completar automáticamente por recepción o cerrar manualmente el saldo
con motivo. La cancelación requiere motivo y se permite solo antes de vincular
facturas. Los cambios usan una versión para rechazar ediciones concurrentes.

El PDF se envía únicamente al destino interno configurado por el API de WhatsApp.
Si no se confirma la respuesta, queda Envío por verificar. Un envío interrumpido
puede quedar Enviando: se debe comprobar el grupo antes de marcarlo enviado.
No hay reenvío automático, porque un timeout no prueba que el mensaje no llegó.
Si se verifica que no llegó, se puede habilitar un nuevo intento manual. Para
un intento que quedó Enviando se exige esperar al menos cinco minutos.

Al guardar una captura en Pendientes se elige pedido o Compra sin pedido previo.
La elección se conserva en los datos extraídos. Al registrar la factura se revisa
nuevamente y se muestra la correspondencia por línea, conversión, recepción y
costo equivalente. Los productos adicionales quedan en el historial sin reducir
faltantes de otra línea. Solo se ofrecen pedidos abiertos del mismo proveedor.

Un pedido admite múltiples facturas. Una factura se asocia a un único pedido.
La recepción se acumula en unidades internas del pedido, usando la cantidad
realmente recibida, no la cantidad facturada. La conversión propuesta debe
revisarse cuando la factura cambia de presentación. Pedido y factura se guardan
en la misma transacción y los reintentos idempotentes no duplican la recepción.
Este seguimiento no modifica el stock: el ingreso existente de la factura lo hace.

## Archivos y API

- Frontend: `js/pedidos.js`, navegación y panel de `index.html`.
- Integración de captura: `app.js`; registro: `js/ingreso-registro.js`.
- Backend: `../inventory-api/src/routes/orders.js` y el registro existente.
- SQL: `../../base-de-datos/migraciones/20261005b_pedidos_proveedores.sql`.

Rutas autenticadas bajo `/api/purchases/v2/orders`:

| Método | Ruta | Operación |
| --- | --- | --- |
| GET | `/catalog` | Necesidades y alternativas; días, cobertura y seguridad. |
| GET | `/` | Historial; filtros `proveedor_id` y `abiertos=1`. |
| GET | `/:id` | Líneas, entregas, facturas y eventos. |
| POST | `/` | Crear o editar borrador con idempotencia y versión. |
| POST | `/:id/action` | Preparar, registrar envío, confirmar, cerrar o cancelar. |

El registro existente selecciona `ferre_registrar_factura_con_pedido` cuando
recibe `pedido_id`; las compras sin pedido mantienen la función anterior.
Las nuevas tablas tienen RLS y las funciones están reservadas a `service_role`.
El control de acceso reutiliza el del servicio: actualmente cualquier perfil
habilitado pasa `requirePermission`; no se introdujo una nueva restricción de rol.

## Verificación realizada

- Suite Node del API: 66 pruebas aprobadas, incluyendo ocho de pedidos.
- PostgreSQL 16 temporal local: migración aplicada a esquema sintético y pruebas
  de snapshots, versión obsoleta, proveedor ajeno, dos facturas, reintentos y RLS.
  La función de ingreso anterior se simula en estas pruebas; no sustituyen la
  validación del ingreso completo en un entorno con el esquema real.
- Chrome con API simulada: navegación por contador, agrupación, guardado,
  asociación parcial, conversión, compra directa y texto remoto tratado como texto.
- No se registraron compras ni se enviaron mensajes a producción durante las pruebas.

Las pruebas SQL de `../inventory-api/test/orders-fixture.sql` solo se ejecutan
en una base vacía de pruebas. Nunca deben aplicarse a producción. Después se
aplica la migración y `orders-transaction.sql`; este último revierte sus datos.
La prueba de navegador está en `../test/pedidos-browser.cjs` y requiere Playwright.

## Activación y reversión

Orden requerido: respaldo → migración SQL → Inventory API → frontend.
El frontend nuevo necesita las rutas de pedidos incluso para elegir compra
sin pedido previo; no debe publicarse antes de habilitar el backend.

1. Crear un respaldo recuperable de la base de datos y guardar la imagen actual
   del servicio (`ferrisoluciones-inventory-api:20260930-provider-notices`).
2. Aplicar una sola vez `20261005b_pedidos_proveedores.sql`. Es aditiva: crea cinco
   tablas y cinco funciones; no reemplaza la función de ingreso existente.
3. Construir y desplegar una nueva imagen de Inventory API desde el workspace.
   Mantener configuración, secretos y rutas Traefik existentes. Verificar salud
   y rechazo de peticiones sin sesión antes de publicar la interfaz.
4. Publicar el frontend y comprobar versión, navegación y flujo con sesión.
   Probar envío únicamente con autorización para enviar al grupo interno.
5. Verificar recepción con datos de prueba acordados y conservar evidencia.

Para revertir, restaurar primero el frontend anterior y después la imagen
anterior del API. Conservar las nuevas tablas, facturas y eventos: no eliminar
seguimiento ni reingresar facturas. Si es necesario volver a habilitar la
versión nueva, sus datos permanecen disponibles. La migración no debe repetirse.
