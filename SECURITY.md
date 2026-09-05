# Seguridad

Esta aplicación es una interfaz pública con acceso funcional restringido por
Supabase Auth y por los permisos del backend de Ferrisoluciones.

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

## Reportes

No abras un issue público con datos sensibles. Comunica el hallazgo directamente
al administrador de Ferrisoluciones.
