# Revex Helpdesk

Servicio independiente de mesa de ayuda para Revex. GlobalCRM no contiene la mesa: solamente consume `POST /api/v1/integrations/tickets` a través de un proxy backend.

## Operación

- Servicio local: `127.0.0.1:3200`
- URL pública prevista: `https://helpdesk.revex.com.co`
- Base de datos: `GLOBAL_HELPDESK` en el SQL Server del Linode
- Los tokens se guardan como hashes SHA-256; el valor original se muestra una sola vez al crearlo.

El token de integración debe permanecer únicamente en el `.env` del backend de GlobalCRM. El token administrativo se usa en la pantalla pública de la mesa.
