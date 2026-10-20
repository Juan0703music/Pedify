# Sistema visual de Pedify

**Mundo:** la comanda de un negocio de comidas rápidas. Tiquetes de pedido con borde dentado, tinta casi negra y el amarillo mostaza de los letreros de barrio. La portada usa el color a página completa; el panel es sobrio (neutros + un acento) porque es una herramienta de trabajo diario en un mostrador con mucha luz.

Fuente única de verdad: `src/styles/app.css` (tokens en `@theme`, componentes en `@layer components`).

## Color

| Token | Valor | Uso |
|---|---|---|
| `ink` | `#17161c` | Texto principal, barra lateral, botones secundarios fuertes |
| `ink-2` / `ink-3` | `#23222a` / `#35343e` | Capas sobre la barra lateral (hover, bloques) |
| `ink-soft` | `#a9a7b3` | Texto secundario sobre tinta |
| `ground` | `#f2f2ef` | Fondo de la app |
| `paper` | `#ffffff` | Superficies, formularios |
| `line` / `line-strong` | `#e3e1db` / `#c9c6bd` | Bordes y separadores / bordes de campos |
| `muted` | `#5c5a63` | Texto secundario (≥ 4.5:1 sobre blanco) |
| `mustard` | `#ffc72c` | Marca, acción principal, ítem activo, selección de texto |
| `mustard-soft` / `mustard-deep` | `#fff4cf` / `#7a5600` | Fondos de realce / texto sobre ellos |
| `leaf` | `#1d7444` | Éxito, "recibiendo pedidos", entregado |
| `tomato` | `#be2a1f` | Errores, acciones destructivas, cancelado |
| `sky` | `#1d5bb8` | Información, confirmado |
| `whatsapp` | `#25d366` | Solo para acciones de WhatsApp |
| `chart` / `chart-active` | `#b07d00` / `#8a6200` | Marcas de las gráficas (una serie por gráfica; validado: contraste ≥ 3:1, croma y luminosidad) |

El amarillo nunca lleva texto blanco: siempre `ink` encima.

## Tipografía

Una sola familia: **Archivo** variable (peso 100–900, ancho 62–125 %), autoalojada en `public/assets/fonts`.

- `.display`: titulares de letrero — ancho 66 %, peso 860, mayúsculas, interlineado 0.9. Solo en portada, autenticación y páginas especiales (404).
- Títulos del panel: ancho 88 %, pesos 720–780. `h1` 30–38 px, `h2` de sección 18 px.
- Interfaz y cuerpo: ancho 100 %, 15–16 px. Cifras y dinero con `.num` (números tabulares).

## Componentes

- **Botones** (`.btn` + `.btn-primary` mostaza / `.btn-ink` / `.btn-ghost` / `.btn-quiet` / `.btn-danger`, `.btn-sm`, `.btn-icon`): 44 px de alto, radio 10 px, estados hover, activo, deshabilitado y `aria-busy` con spinner.
- **Campos** (`.field`, `.label`, `.input`, `.input-group` con `.addon`, `.hint`, `.field-error`): foco con borde tinta + halo mostaza; error con `aria-invalid`.
- **Interruptor** (`.switch` sobre `<input type="checkbox" role="switch">`): encendido = pista tinta con perilla mostaza.
- **Fichas de opción** (`.choice`): selección múltiple (métodos de pago).
- **Paneles** (`.panel`): blanco, borde `line`, radio 14 px. Nunca paneles dentro de paneles.
- **Tiquete** (`.ticket` + `.ticket-shadow`, `.ticket-rule`): comanda con borde inferior dentado (máscara CSS). Es el objeto característico: pedidos en vivo (fase 4), demostraciones, 404.
- **Avisos** (`toast()` en `public/js/ui.js`): pastilla tinta abajo al centro, `aria-live`.
- **Navegación del panel**: barra lateral tinta (escritorio, ítem activo mostaza) y barra inferior + cajón `<dialog>` (celular).
- **Hoja de edición** (`<dialog class="sheet">`): sube desde abajo en el celular y se centra en escritorio; encabezado, cuerpo desplazable y acciones fijas abajo. Al editar, el foco va al título (no abre el teclado).
- **Miniatura** (`.thumb`) y **zona de foto** (`.dropzone`): fondo `ground` con ícono cuando no hay imagen; se puede soltar un archivo encima.
- **Filas del menú** (panel): miniatura, nombre (hasta 2 líneas), precio, insignias `Oculto`/`Agotado` e interruptor de disponible. El modo «Ordenar» cambia los interruptores por flechas.
- **Carrito de la tienda**: botón redondo tinta con `+` mostaza (`.qty-add`) que se convierte en contador (`.stepper`: − cantidad +; con 1 unidad el − es una papelera). Barra flotante tinta (`.cart-bar`) con la cantidad en un círculo mostaza y el subtotal; la misma barra avisa de un pedido creado y aún sin enviar.
- **Botón de WhatsApp** (`.btn-whatsapp`): único uso del verde `whatsapp`, con texto tinta (contraste ≥ 7:1).
- **Confirmación del pedido**: el tiquete (`.ticket`) se imprime (`.print-in`) con el número de pedido, el detalle y el total, bajo un aviso mostaza "Falta un paso: envíalo por WhatsApp".
- **Tarjeta de pedido** (panel): tiquete con número grande (`.display`), hora y tiempo transcurrido (en tomate si un pendiente lleva más de 10 min), cliente, entrega, productos, nota mostaza, total y la acción siguiente como botón principal (mostaza para "Confirmar pedido", tinta para el resto). Columnas: Nuevos · En cocina · Listos y en camino; en celular, fichas para cambiar de columna.
- **Alerta de pedido nuevo**: tiquete que se imprime arriba de la pantalla con campana mostaza, número y total; se va solo a los 9 s. Sonido "ding-dong" generado con Web Audio, activado por el usuario desde la barra lateral (o la campana del encabezado en celular), junto al indicador "En vivo".
- **Gráficas** (`.chart-bar`, `.chart-tooltip`): columnas de máx. 24 px con 4 px redondeados arriba y base recta, cuadrícula de 1 px en `line`, valor solo en el punto más alto, tooltip tinta con el valor primero, y "Ver como tabla".
- **Aviso de suscripción** (franja bajo el encabezado del panel): mostaza claro si la prueba termina en ≤ 5 días, mostaza si venció y está en gracia, tomate si la tienda ya no recibe pedidos; botón tinta "Ver planes"/"Renovar plan" solo para el propietario.
- **Mi plan**: tarjeta tinta con el nombre del plan en `.display` y el precio en mostaza; medidores de uso (pista `mustard-soft`, relleno `chart`, tomate al 90 %); planes en tarjetas con el actual resaltado.
- **Panel central** (`/admin`): encabezado tinta con la insignia "Administración", indicadores en tarjetas y tabla de negocios con insignias de estado. Si falta configuración del servidor, recuadro mostaza claro "Pendiente de configurar en el servidor" con la lista.
- **Entorno de pruebas** (`.staging-flag`, solo con `APP_ENV=staging`): cinta de obra de 4 px (rayas mostaza y tinta a 45°) fija arriba y una etiqueta tinta con "ENTORNO DE PRUEBAS" en mostaza colgando al centro. No ocupa espacio ni recibe clics; el título de la pestaña empieza por "[Pruebas]".
- **Fichas de categoría** (`.cat-chip`) en la tienda: barra fija desplazable; la activa en tinta.
- **Íconos**: Lucide (trazo 2 px) desde `public/assets/icons/sprite.svg` con `icon(nombre)`; nunca emojis ni glifos.

## Fotografía

La comida es la protagonista: fotos grandes, con recortes generosos y esquinas redondeadas (18–30 px).

- **Banco propio**: `public/assets/images/food/` (WebP de 960 y 480 px), generado por `scripts/photos.ts` desde StockSnap y Rawpixel. Todas son de **dominio público (CC0)**; el script registra la fuente y el autor de cada una.
- Se usan con `srcset` (480w/960w), `width`/`height` para no saltar al cargar, `loading="lazy"` fuera de la primera pantalla y `object-position` cuando el plato no está centrado.
- **Las fotos de stock nunca representan a un negocio real en su tienda**: allí solo van las fotos que sube el comerciante (la excepción es el negocio ficticio de demostración del seed). En el panel, una foto de stock solo decora cuando el negocio aún no tiene portada.
- `.photo` (contenedor con fondo tinta mientras carga), `.food-card` (foto a sangre con degradado inferior y título en `.display` blanco; se acerca al pasar el mouse), `.food-placeholder` (producto sin foto: mostaza claro con puntos y el ícono de cubiertos), `.dots` (textura de puntos de letrero sobre el mostaza).

## Portada

Una portada de noche: fondo tinta con resplandor mostaza (`.glow-mustard`) y puntos mostaza que se desvanecen (`.dots-mustard`), titular gigante en `.display` con una línea en **contorno mostaza** (`.text-outline`) y la palabra «PEDIDOS» enorme y casi invisible al pie.

- **Demostración interactiva** (`[data-demo]`, `public/js/landing.js`): un teléfono con la tienda de ejemplo. El visitante toca «+», ve el contador y el total, y al enviar aparecen la burbuja de WhatsApp con el mensaje armado y la comanda que se imprime en el panel (con una campana que late). Si nadie toca, se arma sola **una vez** al aparecer en pantalla; «Repetir» la reinicia. Sin JavaScript o con «reducir movimiento» se ve el pedido de ejemplo ya enviado.
- Fotos que flotan alrededor del teléfono (`.float-a/b/c`) y se mueven un poco con el mouse (`[data-depth]`, solo con puntero fino).
- **Antes / Con Pedify**: «Se acabó el ~~desorden~~ en el chat» (tachón tomate). A la izquierda, un chat de WhatsApp desordenado (fondo crema de WhatsApp, nota de voz, «¿Me repite el pedido?» y un sello tomate «¿Y el total?»); a la derecha, sobre tinta, el único mensaje que genera Pedify (con el formato real de `buildOrderMessage`) y la comanda en el panel. Debajo, una franja con datos del producto en números gigantes: 0 % de comisión, 14 días gratis, 1 enlace y QR, 0 apps que descargar (son características, no estadísticas).
- «Del **antojo** al pedido confirmado»: la palabra gigante rellena con una foto (`.image-text`).
- Pasos en tarjetas con numerales en contorno (`.text-outline-ink`) que se vuelven mostaza al pasar el mouse; mosaico de tipos de negocio (`.food-card`); abanico de fotos con la insignia «Los más pedidos»; el tablero de pedidos ilustrativo en una ventana de navegador; planes (tiquetes) y cierre mostaza con «Abre tu tienda **hoy**» enorme.

## Tienda pública

Es la vitrina del comerciante, no de Pedify: manda la portada, el logo y el nombre del negocio. Con portada, la foto ocupa la parte de arriba (26–30 rem de alto) con un degradado tinta desde abajo y, encima, el logo, el nombre en grande, la descripción, el estado y el botón de WhatsApp; el detalle (domicilio, horario, pagos) va debajo en una franja (tres columnas en escritorio). Sin portada, letrero mostaza con puntos y el nombre en grande, con el detalle a la derecha en escritorio.

- **Los más pedidos**: carrusel horizontal con fotos 4:3 grandes, número mostaza (1–3) y el botón de agregar sobre la foto. Si aún no hay ventas, «Para abrir el apetito» con los productos que tienen foto.
- **Productos**: en el celular, filas con la foto a la derecha (patrón de las apps de domicilios); en escritorio, tarjetas en tres columnas con la foto arriba (o `.food-placeholder`). Toda la tarjeta abre la **ficha del producto**; el control de cantidad queda encima.
- **Hacer pedido**: el botón del carrito es mostaza, «Hacer pedido · $total» (ya no lleva a WhatsApp).
- **Seguimiento del pedido** (misma hoja del carrito): tarjeta tinta con el estado en grande y su ícono (campana que late mientras espera, gorro de cocina, moto…), pasos con hora (Recibido → Aceptado y en preparación → Listo → En camino → Entregado; los domicilios incluyen «En camino») y el resumen como tiquete. Cancelado: tarjeta tomate con el motivo. Debajo, «Llamar» y «Escribir por WhatsApp» al negocio. Con la hoja cerrada, la barra inferior tinta dice «Pedido #N · estado» con «Ver estado». Se actualiza sola.
- **Ficha del producto** (`<dialog class="sheet">`): foto grande, nombre, precio y descripción completa; abajo, «Agregar a mi pedido · $precio» (mostaza) y, con el producto ya en el pedido, el contador y «Ver mi pedido».
- Agotado: foto en gris, precio tachado e insignia tomate. El estado (Abierto / Cerrado · abre… / Pedidos en pausa) va en una pastilla de color bajo el nombre. En escritorio el detalle (domicilio, horario, pagos) pasa a una columna a la derecha.

## Panel

- **Inicio**: saludo sobre la portada del negocio (o una foto de comida si aún no tiene) con degradado tinta de izquierda a derecha; el interruptor de pedidos va encima.
- **Mapa del domicilio** (`.delivery-map`, Leaflet + `public/js/map.js`): la moto del domiciliario en un círculo mostaza con borde tinta que late; la casa del cliente como gota tinta con la casa mostaza; una línea punteada entre los dos (solo la dirección, no la ruta). Se encuadra solo para mostrar a ambos. Debajo, la distancia en una línea («Tu domiciliario está a 950 m»).
- **Página del domiciliario** (`/domicilio`): tarjeta de estado (mostaza «¿Listo para salir?» → tinta «Compartiendo tu ubicación» con un punto verde que late → verde «¡Pedido entregado!»), el mapa, «Entregar a» con Llamar, Google Maps y Waze, «Cobrar» en tinta con el valor en mostaza grande (verde si ya está pagado) y el botón mostaza «Marcar como entregado» con confirmación.
- **Enlace del domiciliario** (panel): hoja con el código QR, «Enviar por WhatsApp», «Copiar enlace» y «Abrir aquí»; se abre sola al tocar «Enviar con domiciliario».
- **Inicio de sesión con rol**: dos tarjetas de opción (`.role-option`) «Soy el dueño» (ícono de tienda) y «Soy empleado» (gorro de cocina); la elegida en mostaza claro con borde tinta y un punto mostaza. El texto bajo el título cambia según el rol y se recuerda la última opción en el dispositivo.
- **Permisos en Equipo**: debajo de cada empleado, fichas con casilla (`.choice`) «Marcar agotados», «Ver ventas del día», «Ver clientes», «Ver analíticas»; se guardan al tocarlas. Lo que un empleado no puede ver no aparece en su menú; si entra por enlace, un aviso con candado le dice que lo pida al propietario.
- **Avisos push**: en Inicio, tarjeta tinta con campana mostaza que late, «Que ningún pedido se te pase» y «Activar avisos» (se oculta cuando ya están activos o si se descarta); en el menú lateral y en el cajón del celular, botón «Activar avisos aquí» / «Avisos activados aquí» (un toque envía una prueba); en Configuración → Pedidos, estado del dispositivo con probar y desactivar. En iPhone sin instalar, explica cómo agregar Pedify a la pantalla de inicio. La notificación usa el ícono tinta con la comanda mostaza y una insignia blanca para Android.
- **Mi menú**: aviso tinta con fotos circulares cuando hay productos sin foto («Agregar foto» abre el primero). Cada categoría termina con «Agregar producto» y **«Elegir productos»**: hoja con toda la carta agrupada por categoría, casillas (`.pick`, `.pick-check`), búsqueda, «Seleccionar todo» / «Quitar selección», insignias «Entra» (tinta) y «Sale» (tomate), y el resumen de cambios antes de guardar.
- **Ingreso y registro**: columna mostaza con puntos, foto grande inclinada detrás de la comanda (o mosaico de tres fotos en el registro); en el celular, una tira de tres fotos sobre el formulario.

## Movimiento

- El gesto propio es el **tiquete que se imprime** (`.print-in`, revelado de arriba hacia abajo con `clip-path`, 0.9–1 s, curva exponencial).
- En la portada: la demostración del teléfono (una vez), las fotos que flotan y siguen al mouse, y las secciones que aparecen al bajar (`[data-reveal]`, solo con JavaScript: sin él, todo se ve). Nada se mueve en bucle salvo el flotar suave de las fotos.
- Las fotos se acercan un 5–6 % al pasar el mouse (solo en dispositivos con puntero).
- Transiciones de interfaz de 150–250 ms. Todo se anula con `prefers-reduced-motion`.

## Reglas

- Mobile first; la barra inferior respeta `env(safe-area-inset-bottom)`.
- Sin texto en gradiente, sin vidrio/desenfoque decorativo, sin rótulos pequeños sobre los títulos.
- Los datos de demostración se marcan como "Ejemplo ilustrativo".
- Textos en español de Colombia; los errores dicen qué pasó y cómo resolverlo.
