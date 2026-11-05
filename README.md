# 🌮 Chilokos — Tacos, birria y antojitos

Aplicativo de pedidos para **Chilokos**: los clientes piden **desde su mesa escaneando el QR** o **para llevar desde la carta pública**, y el equipo gestiona todo desde el panel de administración con **6 perfiles** y distintos niveles de vista.

## 🌐 En producción (en la nube)

| Qué | Dónde |
|---|---|
| **App (clientes y personal)** | **https://appmovilesoficial.github.io/chilokos/** |
| **Carta para llevar** | https://appmovilesoficial.github.io/chilokos/#/carta |
| **Mesa 1 (QR)** | https://appmovilesoficial.github.io/chilokos/#/mesa/mesa-1 |
| **Backend (API)** | Google Apps Script (Web App publicado) |
| **Datos** | `PropertiesService` del script (sin permisos de Google) |
| **Código** | GitHub → `docs/` se publica automáticamente en GitHub Pages |

Todo el sitio se actualiza **solo con hacer `git push` a `main`**: GitHub Pages publica la carpeta `docs/` y el frontend usa la API del Apps Script, que también se actualiza con `clasp push` + `clasp deploy`.

### Credenciales de prueba (contraseña `1234`)

`dueno` · `encargado` · `mesero` · `cocina` · `caja`

> Los clientes no inician sesión. Entran escaneando el QR de su mesa o desde **«Ver la carta y pedir para llevar»**.

## Cómo está armado

```
GitHub Pages (docs/)                Google Apps Script (apps-script/chilokos/)
┌──────────────────────┐   POST    ┌───────────────────────────────────────┐
│ SPA HTML/CSS/JS      │ ────────▶ │ doPost → router → Api.gs              │
│ QR generado en JS    │  text/plain│ Db.gs (PropertiesService troceado)   │
└──────────────────────┘ ◀──────── └───────────────────────────────────────┘
                          JSON (el estado HTTP viaja como __status)
```

- Las peticiones viajan como **POST simple** con `Content-Type: text/plain` y la ruta/método/token en la query (`path`, `_method`, `token`). Así se evita el *preflight* CORS.
- El Apps Script responde `text/javascript`/JSON con `Access-Control-Allow-Origin: *`.
- El **QR se genera en el navegador** con `docs/vendor/qrcode-generator.js` (el servidor solo devuelve la URL de la mesa).
- La **tasa del euro del BCV** se consulta desde el navegador y se cachea 6 h en `localStorage`; si no hay red se conserva la última tasa conocida.
- La base de datos (usuarios, carta, mesas, pedidos, sesiones, llamados) se guarda en **propiedades del script** en bloques de 8 KB; al crecer, se recortan los pedidos cerrados más antiguos.

## Arrancar en local (opcional)

```bash
npm install
npm start          # http://localhost:3000
```

El frontend local también apunta al backend de la nube (`docs/config.js`). Si quieres usar el servidor Node local, deja `window.CHILOKOS_API = ''` en `docs/config.js`.

## La carta

Tacos · Flautas · Burritos · Birria · Enchiladas · Antojitos · Bebidas · Postres

Especialidades: **taco al pastor**, **taco de birria**, **flautas de birria**, **burrito de birria**, **ramen de birria**, **quesabirria**, **enchiladas rojas/verdes/de mole**, **gomitas enchiladas**, aguas frescas y churros con cajeta. Se administra por completo desde el panel (crear, editar, ocultar, precio en €).

## Comer aquí o para llevar

Cada pedido guarda su **tipo**:

- **🍽️ Comer aquí:** requiere la mesa (QR). La mesa se marca ocupada y se libera al cobrar.
- **🛍️ Para llevar:** disponible desde la carta pública sin mesa, o desde una mesa si el cliente quiere llevarse algo. Pide el **nombre** del cliente y se recoge/paga en caja.

Cocina, cajero y reportes muestran el destino de cada pedido (`Mesa 4` o `Para llevar · Ana`).

## Perfiles

| Perfil | Usuario | Qué ve / qué puede hacer |
|---|---|---|
| 👑 **Dueño** | `dueno` | Todo: dashboard, **reportes de ventas**, menú, mesas y **códigos QR**, gestión de personal, pedidos. |
| 📋 **Encargado** | `encargado` | Resumen operativo, pedidos (puede cancelar), alta/edición de menú, mesas y QR, llamados. **No** ve reportes de negocio ni gestiona usuarios. |
| 🧑‍🍳 **Mesero** | `mesero` | Mesas, todos los pedidos, entregar pedidos listos, agregar platillos, atender llamados. |
| 🔥 **Cocinero** | `cocina` | Solo el panel de cocina (kanban): nuevos → en preparación → listos. |
| 💰 **Cajero** | `caja` | Pedidos entregados/por pagar (de mesa o para llevar), cobra y ve su resumen del día. |
| 📱 **Cliente** | *sin cuenta* | Menú, carrito con cantidades, tipo de pedido, seguimiento del estado y llamados (solo si está en mesa). |

## Flujo completo

```
Cliente escanea QR (o entra a la carta) → elige platillos y cantidades
        → elige comer aquí / para llevar → envía pedido
        → 🍳 Cocinero: nuevo → preparando → listo
        → 🧑‍🍳 Mesero: entrega (servido)
        → 📱 Cliente: pide la cuenta (en mesa)
        → 💰 Cajero: cobra → mesa libre
```

## Funciones clave

- **QR emitido por el aplicativo**: pestaña *Mesas y QR* (dueño/encargado) → genera, **imprime** o **descarga en SVG** un QR por mesa con la URL `#/mesa/<id>`.
- **Carta pública para llevar** sin mesa ni cuenta: menú, carrito y pedido con nombre del cliente.
- **Llamar al mesero / pedir la cuenta** desde la mesa: el mesero recibe el aviso con badge 🔔.
- **Roles y permisos verificados en el backend**: cada endpoint valida el perfil; un cliente solo ve sus propios pedidos.
- **Reportes del dueño**: ventas del día/históricas, ticket promedio, ventas por método de pago, ventas por hora y top 5 de platillos.
- **Actualización automática** cada 15 s (se pausa con la pestaña en segundo plano para no gastar cuota).

## 💱 Precios en divisa (€) + bolívares (Bs.) con tasa BCV

- Todos los precios se muestran en **euros (€)** como divisa principal y, **abajo en letra pequeña**, su equivalente en **bolívares (Bs.)**.
- La tasa se consulta al **Banco Central de Venezuela (BCV)** desde el navegador y se muestra como `1 € = Bs. …` en cada pantalla.
- Se guarda en `localStorage` durante 6 h; si la consulta falla se usa la última tasa conocida.

## 🚀 Publicar cambios

### Frontend (GitHub Pages)

```bash
git add -A
git commit -m "mis cambios"
git push origin main
```

GitHub Pages reconstruye el sitio desde `docs/` en 1–2 minutos.

### Backend (Google Apps Script)

```bash
cd apps-script/chilokos
clasp push -f
clasp deploy --description "nueva version"
```

Si la URL `/exec` cambia, actualízala en `docs/config.js` y haz push.

## Pruebas

```bash
node test/smoke.js   # flujo, permisos y pedidos para llevar (contra el servidor local)
node test/rate.js    # lógica de la tasa BCV
```

## 🗂️ Respaldo en Google Sheets (opcional)

```bash
npm run sheet:export   # regenera apps-script/Datos.js desde data/db.json
npm run sheet:push     # sube el código al Sheet con clasp
```

## Tecnologías

- **Frontend**: SPA sin frameworks (HTML/CSS/JS), GitHub Pages, QR generado en el navegador.
- **Backend**: Google Apps Script (Web App), datos en `PropertiesService`, sin dependencias externas.
- **Servidor local opcional**: Node.js + Express (`server.js`), datos en `data/db.json`.
