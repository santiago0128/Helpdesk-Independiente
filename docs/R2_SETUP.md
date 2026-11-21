# Cloudflare R2 para adjuntos

La mesa de ayuda usa R2 mediante la API compatible con S3. El bucket debe permanecer privado.

Variables que se deben agregar al `.env` del servicio `helpdesk.service`:

```env
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_REGION=auto
R2_BUCKET=revex-helpdesk-attachments
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_SIGNED_URL_SECONDS=900
```

El flujo queda así:

- Los adjuntos nuevos se suben a `tickets/<id>/...` en R2.
- SQL Server conserva los metadatos del archivo.
- La descarga usa una URL firmada que vence en 15 minutos.
- Los adjuntos existentes en el disco local siguen disponibles hasta migrarlos.
- Si R2 no está configurado, la mesa continúa usando el almacenamiento local.
