# Helpdesk independiente

Mesa de ayuda autónoma construida con Node.js, Express y SQL Server. Incluye panel web, API REST, autenticación de usuarios, roles y permisos, adjuntos, SLA, auditoría, reportes y una integración para crear tickets desde otros sistemas o desde Postman.

## Requisitos

- Node.js 20 o superior.
- npm 10 o superior.
- SQL Server 2019 o superior, SQL Server Developer o Azure SQL.
- Opcional: Docker y Docker Compose para levantar aplicación y base de datos juntos.

## Instalación rápida con Docker

1. Copia el entorno de ejemplo:

   ```bash
   cp .env.example .env
   ```

   En Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Cambia `MSSQL_SA_PASSWORD` en `.env`. Debe tener mayúsculas, minúsculas, números y símbolos.
3. Inicia los servicios:

   ```bash
   docker compose up --build -d
   ```

4. Comprueba el estado:

   ```bash
   curl http://localhost:3200/api/v1/health
   ```

El contenedor ejecuta automáticamente las migraciones antes de iniciar el servidor. La interfaz queda disponible en `http://localhost:3200`.

## Instalación local sin Docker

1. Instala las dependencias y crea el archivo de entorno:

   ```bash
   npm ci
   cp .env.example .env
   ```

2. Edita `.env` con los datos de tu SQL Server. Ejemplo local:

   ```dotenv
   DB_SERVER=127.0.0.1
   DB_PORT=1433
   DB_NAME=GLOBAL_HELPDESK
   DB_USER=sa
   DB_PASSWORD=TuClaveSegura
   DB_ENCRYPT=false
   DB_TRUST_SERVER_CERTIFICATE=true
   DB_AUTO_CREATE=true
   ```

3. Crea la base de datos y aplica todas las migraciones:

   ```bash
   npm run migrate
   ```

4. Crea el primer administrador:

   ```bash
   npm run user -- admin@example.com "ClaveSegura123!" "Administrador" ADMIN
   ```

5. Inicia la aplicación:

   ```bash
   npm start
   ```

Para desarrollo con recarga automática usa `npm run dev`.

## Migraciones

`npm run migrate` realiza estas tareas de forma idempotente:

1. Crea `DB_NAME` si no existe y `DB_AUTO_CREATE=true`.
2. Crea la tabla de control `dbo.hd_schema_migrations`.
3. Ejecuta, en orden, los archivos `database/001_*.sql` a `database/008_*.sql`.
4. Guarda nombre y checksum de cada migración para no repetirla ni aceptar cambios accidentales.

Las migraciones crean tickets, mensajes, tokens, usuarios, sesiones, adjuntos, tipos, asignaciones, roles, SLA, eventos, recuperación de contraseña y auditoría. Para revisar su estado:

```sql
SELECT filename, checksum, applied_at
FROM dbo.hd_schema_migrations
ORDER BY filename;
```

No edites una migración ya aplicada. Agrega una nueva con el siguiente número, por ejemplo `database/009_nueva_funcion.sql`.

## Crear un token para Postman

La ruta de integración no usa la contraseña de un usuario. Usa un token independiente que se guarda en la base de datos como hash SHA-256.

```bash
npm run token -- "Postman local" "postman" INTEGRATION
```

La salida contiene el token completo una sola vez. Copia el valor de `token` y guárdalo en la variable `apiToken` de Postman. No lo agregues al repositorio ni al `.env` público.

## Crear un ticket desde Postman

En el repositorio se incluyen:

- `postman/Helpdesk.postman_collection.json`
- `postman/Local.postman_environment.json`

Importa ambos archivos en Postman, selecciona el entorno **Helpdesk local** y configura:

- `baseUrl`: `http://localhost:3200`
- `apiToken`: el token generado con `npm run token`

### Petición JSON

- Método: `POST`
- URL: `{{baseUrl}}/api/v1/integrations/tickets`
- Autorización: **Bearer Token** con `{{apiToken}}`
- Encabezado: `Content-Type: application/json`
- Body → raw → JSON:

```json
{
  "externalId": "POSTMAN-0001",
  "title": "No puedo ingresar al sistema",
  "description": "El usuario recibe un mensaje de acceso denegado.",
  "requestType": "ACCESS",
  "priority": "HIGH",
  "requester": {
    "name": "Ana Pérez",
    "email": "ana@example.com",
    "company": "Empresa Demo",
    "contact": "Ana Pérez"
  }
}
```

Valores admitidos:

- `requestType`: `BUG`, `FEATURE`, `QUESTION`, `ACCESS` u `OTHER`.
- `priority`: `LOW`, `MEDIUM`, `HIGH` o `URGENT`.
- `externalId`: opcional, pero recomendado. Evita tickets duplicados para la misma fuente.

Respuesta esperada: HTTP `201 Created`.

```json
{
  "message": "Ticket creado",
  "duplicate": false,
  "ticket": {
    "id": 1,
    "number": "HD-000001",
    "title": "No puedo ingresar al sistema",
    "priority": "HIGH",
    "status": "OPEN"
  },
  "attachments": []
}
```

Si repites el mismo `externalId`, la API devuelve el ticket existente con HTTP `200`.

### Petición con archivos

Usa el mismo método, URL y token, pero selecciona **Body → form-data**. Agrega estos campos de tipo texto:

- `externalId`
- `title`
- `description`
- `requestType`
- `priority`
- `requester`, como JSON en una sola línea: `{"name":"Ana Pérez","email":"ana@example.com"}`

Agrega uno o varios campos `attachments` de tipo **File**. Se permiten máximo 10 archivos, 50 MB por archivo y 100 MB en total.

### Ejemplo con curl

```bash
curl -X POST "http://localhost:3200/api/v1/integrations/tickets" \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "externalId":"CURL-0001",
    "title":"Error al generar reporte",
    "description":"La descarga termina con error.",
    "requestType":"BUG",
    "priority":"MEDIUM",
    "requester":{"name":"Usuario Demo","email":"demo@example.com"}
  }'
```

## Variables de entorno principales

| Variable | Uso |
| --- | --- |
| `HOST`, `PORT` | Dirección y puerto del servidor HTTP. |
| `DB_SERVER`, `DB_PORT`, `DB_NAME` | Ubicación de SQL Server. |
| `DB_USER`, `DB_PASSWORD` | Credenciales de la base de datos. |
| `DB_ENCRYPT` | Activa cifrado de la conexión SQL. |
| `DB_TRUST_SERVER_CERTIFICATE` | Permite certificados locales/autofirmados. |
| `DB_AUTO_CREATE` | Permite que el migrador cree la base de datos. |
| `CORS_ORIGINS` | Orígenes web permitidos, separados por coma. |
| `HELPDESK_PUBLIC_URL` | URL usada en enlaces y correos. |
| `SMTP_*` | Correo opcional. La aplicación funciona sin SMTP. |
| `R2_*` | Almacenamiento R2/S3 opcional para adjuntos. |

Consulta `.env.example` para ver todas las variables y valores seguros de desarrollo.

## Comandos útiles

```bash
npm run migrate   # aplica migraciones pendientes
npm run user -- correo clave nombre ADMIN
npm run token -- nombre fuente INTEGRATION
npm test          # pruebas unitarias del migrador
npm run dev       # servidor con recarga automática
npm start         # servidor normal
```

## Seguridad

- `.env`, adjuntos, estados y respaldos están excluidos de Git.
- No se incluyeron respaldos ni datos productivos en esta copia.
- Los tokens y sesiones se almacenan como hashes.
- Cambia las contraseñas de ejemplo antes de desplegar.
- En producción usa HTTPS, `DB_ENCRYPT=true`, una cuenta SQL con privilegios mínimos y almacenamiento persistente para `storage/`.

## Licencia y origen

Copia independiente basada en el proyecto original `santiago0128/Helpdesk`, preparada para instalación reproducible y pruebas con Postman.
