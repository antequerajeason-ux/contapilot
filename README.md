# ContaPilot Worker

Versión compatible con el flujo que Cloudflare te está mostrando: **Create a Worker**.

## Configuración Cloudflare

- Build command: `npm install`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

## D1

1. Crea base D1 `contapilot_db`.
2. Ejecuta el SQL de `migrations/0001_schema.sql` en la consola de D1.
3. Copia el `database_id` de D1.
4. Pégalo en `wrangler.toml` reemplazando `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## Si falla por token

Crea un API Token en Cloudflare con permisos:

- Account → Workers Scripts → Edit
- Account → D1 → Edit
- Account → Account Settings → Read
- Zone → Workers Routes → Edit (opcional)

Luego en el proyecto, variables de entorno:

- `CLOUDFLARE_API_TOKEN` = token creado
- `CLOUDFLARE_ACCOUNT_ID` = tu Account ID
- Update deploy

