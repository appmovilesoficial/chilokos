# 🌮 Chilokos — Tacos, birria y antojitos

Aplicativo de pedidos para **Chilokos**: los clientes piden **desde su mesa escaneando el QR** o **para llevar desde la carta pública**, y el equipo gestiona todo desde el panel de administración con **6 perfiles** y distintos niveles de vista.

## Arrancar

```bash
npm install   # solo la primera vez
npm start
```

Abre **http://localhost:3000**

- **Carta pública (para llevar):** `http://localhost:3000/#/carta`
- **Cliente en mesa (QR):** `http://localhost:3000/#/mesa/mesa-1`

> Los clientes no inician sesión. Entran escaneando el QR de su mesa o desde el botón **«Ver la carta y pedir para llevar»**.

## La carta

Tacos · Flautas · Burritos · Birria · Enchiladas · Antojitos · Bebidas · Postres

Especialidades: **taco al pastor**, **taco de birria**, **flautas de birria**, **burrito de birria**, **ramen de birria**, **quesabirria**, **enchiladas rojas/verdes/de mole**, **gomitas enchiladas**, aguas frescas y churros con cajeta. Se administra por completo desde el panel (crear, editar, ocultar, precio en €).

## Comer aquí o para llevar

Cada pedido guarda su **tipo**:

- **🍽️ Comer aquí:** requiere la mesa (QR). La mesa se marca ocupada y se libera al cobrar.
- **🛍️ Para llevar:** disponible desde la carta pública sin mesa, o desde una mesa si el cliente quiere llevarse algo. Pide el **nombre** del cliente y se recoge/paga en caja.

Cocina, cajero y reportes muestran el destino de cada pedido (`Mesa 4` o `Para llevar · Ana`).

## Perfiles (contraseña `1234`)

| Perfil | Usuario | Qué ve / qué puede hacer |
|---|---|---|
| 👑 **Dueño** | `dueno` | Todo: dashboard, **reportes de ventas**, menú, mesas y **códigos QR**, gestión de personal, pedidos. |
| 📋 **Encargado** | `encargado` | Resumen operativo, pedidos (puede cancelar), alta/edición de menú, mesas y QR, llamados. **No** ve reportes de negocio ni gestiona usuarios. |
| 🧑‍🍳 **Mesero** | `mesero` | Mesas, todos los pedidos, entregar pedidos listos, agregar platillos, atender llamados. |
| 🔥 **Cocinero** | `cocina` | Solo el panel de cocina (kanban): nuevos → en preparación → listos. |
| 💰 **Cajero** | `caja` | Pedidos entregados/por pagar (de mesa o para llevar), cobra y ve su resumen del día. |
| 📱 **Cliente** | *sin cuenta* | Menú, carrito con cantidades, tipo de pedido, seguimiento del estado y llamados (solo si está en mesa). |

En la pantalla de login hay botones rápidos para entrar con cada perfil de prueba.

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
- **Llamar al mesero / pedir la cuenta** desde la mesa: el mesero recibe el aviso al instante con badge 🔔.
- **Roles y permisos verificados en el servidor**: cada endpoint valida el perfil; un cliente solo ve sus propios pedidos.
- **Reportes del dueño**: ventas del día/históricas, ticket promedio, ventas por método de pago, ventas por hora y top 5 de platillos.
- **Persistencia** en `data/db.json` (se crea automáticamente y migra la carta antigua a la de Chilokos).

## 💱 Precios en divisa (€) + bolívares (Bs.) con tasa BCV

- Todos los precios se muestran en **euros (€)** como divisa principal y, **abajo en letra pequeña**, su equivalente en **bolívares (Bs.)**.
- La tasa se consulta al **Banco Central de Venezuela (BCV)** automáticamente y se muestra como `1 € = Bs. …` en cada pantalla.
- **Regla del fin de semana**: viernes después de las 5:00 p. m., sábados, domingos y lunes se usa *la tasa del día lunes*; martes, miércoles y jueves la tasa vigente.
- Si el BCV no responde se usa la última tasa guardada en `data/db.json` (`eur.pubs`).
- La consulta usa el almacén de certificados de Windows (`npm start` ejecuta `node --use-system-ca`).

## Pruebas

```bash
npm start            # en una terminal
node test/smoke.js   # en otra: 27 aserciones (flujo, permisos y pedidos para llevar)
node test/rate.js    # lógica de la tasa BCV (19 aserciones)
```

## 🗂️ Respaldo en Google Sheets (clasp)

La base de datos vive en `data/db.json`; este flujo la copia al Sheet **chilokos** para consultarla y compartirla.

```bash
npm run sheet:export   # regenera apps-script/Datos.js desde data/db.json
npm run sheet:push     # sube el código al Sheet con clasp
```

Después, en el Sheet: menú **🌮 Chilokos → Cargar base de datos** (la primera vez pide autorizar).

Crea estas hojas: **Resumen** (ventas, pedidos abiertos, tasa BCV), **Menu**, **Usuarios**, **Mesas**, **Pedidos**, **Detalle de pedidos**, **Llamados** y **Tasas BCV**. Puedes volver a ejecutarlo cuando quieras: reescribe el contenido.

> ⚠️ La hoja **Usuarios** incluye la columna *Contraseña* (tal como están en `db.json`). Comparte el Sheet solo con quien deba verlas, o pide que se guarden con hash.

## Tecnologías

- **Backend**: Node.js + Express, QR con `qrcode`, autenticación por token, datos en JSON.
- **Frontend**: SPA sin frameworks (HTML/CSS/JS) con identidad de taquería, actualización automática cada 6 s que solo repinta si hay cambios.
