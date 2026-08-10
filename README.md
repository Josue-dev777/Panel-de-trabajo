# Vento Hosting Control

Servidor Node.js/Express para administrar multiples paginas web desde un panel centralizado oscuro.

## Inicio rapido

```bash
cd hosting-control-panel
npm install
cp .env.example .env
npm start
```

Abre `http://localhost:3000` e inicia sesion con:

- Usuario: `josue_dev`
- Contrasena: `kaled_deverloper777`

En produccion cambia `JWT_SECRET` y `ADMIN_PASSWORD_HASH` en `.env`. Genera el hash con:

```bash
node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync('tu_contrasena',12))"
```

## Seguridad reforzada

- JWT con sesiones revocables contra usuarios activos.
- Cookie de sesion `HttpOnly`, `SameSite=Lax` y `secure` en produccion.
- Token CSRF para acciones sensibles desde el panel.
- Rate limit para login y API.
- Cabeceras de seguridad con Helmet, `Permissions-Policy` y `Referrer-Policy`.
- HSTS queda activo cuando `NODE_ENV=production`.

## Funciones incluidas

- Login protegido con JWT, cookie `httpOnly`, rate limit y hashing de contrasena con bcrypt.
- Roles JWT: super-admin maestro y clientes secundarios asignados a una sola web.
- Hosting multi-sitio con proyectos por nombre, puertos internos automaticos y proxy en `/sites/<slug>/`.
- Mapeo de dominios limpios/subdominios por proyecto para proxy inverso externo.
- Sitios HTML/CSS/JS estaticos y sitios Node.js Express.
- Acciones por sitio: iniciar, detener, reiniciar, actualizar codigo y ver logs en vivo.
- Integracion GitHub por proyecto: crear desde repositorio, guardar PAT cifrado, sincronizar en un clic y webhook unico de auto-deploy.
- Despliegue GitHub sin depender de `git`: descarga ZIP por API, valida repo/rama/token, ejecuta `npm install` y `npm run build` si el proyecto lo necesita.
- Health checker cada 60 segundos con auto-reinicio si una web cae o responde HTTP 5xx.
- Rollback en 1 clic con historial automatico de las ultimas 5 versiones por sitio.
- Monitor de CPU, RAM, almacenamiento y red.
- Backup ZIP por sitio y restauracion desde ZIP.
- Marketing Studio con generador Canvas exportable a PNG/JPG, copywriting y codigos QR reales.
- Generador SEO: meta tags, Open Graph, sitemap, `seo-pack.json` y copys para X, Discord, WhatsApp y TikTok.
- Ping de sitemap a motores de busqueda.
- Inyector de popups/anuncios en una web o todas las webs.
- Optimizador de recursos: minificacion HTML/CSS/JS al publicar y conversion WebP para imagenes restauradas o existentes.
- Analitica ligera por sitio y explorador JSON de datos internos.
- Archivos para PM2, Docker Compose y Caddy/Let's Encrypt.

## Modo 24/7

Con PM2:

```bash
npm run pm2:start
pm2 save
pm2 startup
```

Con Docker:

```bash
docker compose up -d --build
```

El `docker-compose.yml` incluye Caddy en los puertos `80` y `443`, usando el dominio `josue-hc-developer.abrdns.com` y renovacion automatica de HTTPS.

## SSL automatico

Usa `Caddyfile` o `Caddyfile.example` como base. El dominio oficial configurado es `josue-hc-developer.abrdns.com`. Ejecuta Caddy frente al contenedor o proceso Node. Caddy pedira y renovara certificados Let's Encrypt automaticamente.

## Convertirlo en pagina oficial normal

Para que abra en Chrome como una web normal y no como una ruta temporal:

```bash
NODE_ENV=production
BASE_URL=https://josue-hc-developer.abrdns.com
JWT_SECRET=un_valor_largo_unico_y_privado
ALLOWED_ORIGINS=https://josue-hc-developer.abrdns.com
```

Luego apunta el DNS `A`/`AAAA` de `josue-hc-developer.abrdns.com` a la IP del servidor y deja Caddy/Nginx haciendo proxy inverso al puerto del panel. Los sitios alojados pueden usar dominios propios desde el boton `Dominio/Popup` de cada tarjeta.

## Integracion GitHub

En `Nuevo sitio` selecciona `Repositorio de GitHub`, pega `usuario/repositorio` o la URL completa, define la rama si no es `main`/`master` y agrega un PAT solo si el repo es privado o necesitas evitar limites de API. Si marcas `Guardar credenciales`, el token queda cifrado con AES-256-GCM usando una clave derivada de `JWT_SECRET`.

Cada sitio GitHub muestra commit desplegado, fecha de sincronizacion y un webhook unico:

```text
https://tu-dominio.com/api/webhooks/github/<sitio>/<secreto>
```

Configuralo en GitHub como webhook `push` con contenido JSON para activar auto-deploy cuando subas cambios a la rama configurada.

## Estructura

```text
src/server.js              API, auth, proxy y WebSocket de logs
src/services/siteManager.js Gestion de procesos, puertos, codigo, backups
src/runtime/static-site-server.js Runtime para sitios estaticos
public/                    Panel web
sites/                     Codigo de cada web alojada
data/                      Registro de proyectos
logs/                      Logs por sitio
backups/                   ZIPs generados
```

## Nota sobre IA de imagenes

El Marketing Studio incluye generacion local por Canvas basada en prompts. Para imagenes fotograficas reales, conecta un proveedor de IA en `/api/marketing/prompt` usando una clave guardada de forma segura en variables de entorno o en tu gestor de secretos.
