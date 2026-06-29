# ContaPilot Cloudflare Simple

Versión simplificada sin FastAPI/Render.

## Qué cambia

Todo queda dentro de Cloudflare:

```txt
Frontend: Cloudflare Pages
API: Cloudflare Pages Functions
Base de datos: Cloudflare D1
```

Así evitamos Python, uvicorn, Render y servidores externos.

## Limitación inicial

Esta versión procesa XML/HTML/TXT. El soporte ZIP directo se puede agregar después con una librería JS o descomprimiendo en el navegador antes de enviar.

## Pasos

1. Instala Wrangler:

```bash
npm install -g wrangler
```

2. Login:

```bash
wrangler login
```

3. Crear D1:

```bash
wrangler d1 create contapilot_db
```

4. Copia el `database_id` que te da Cloudflare y pégalo en `wrangler.toml`.

5. Ejecutar migración local:

```bash
wrangler d1 migrations apply contapilot_db --local
```

6. Probar local:

```bash
wrangler pages dev public --d1 DB=contapilot_db
```

7. Publicar:

```bash
wrangler pages deploy public --project-name contapilot
```

Para producción aplica migración remota:

```bash
wrangler d1 migrations apply contapilot_db --remote
```

## Abrir

```txt
/app.html
/centro-facturas.html
```
