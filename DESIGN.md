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
- **Horas** (Configuración → Horario): listas con las horas cada media hora en hora normal («6:00 a. m.», «11:30 p. m.»; nunca hora militar). Si el horario guardado no cae en media hora exacta, esa hora también aparece en la lista. Toda hora que se muestra usa `time12()` de `public/js/ui.js`.
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
- **Sonido de pedidos**: es una preferencia del dispositivo y se mantiene en todas las secciones. Si el navegador aún no deja sonar la página nueva, el botón sigue diciendo «Sonido de pedidos activado» y aparece debajo, en mostaza, «Toca cualquier parte de la página para que suene aquí»; el primer toque lo reactiva (nunca lo apaga).
- **Alerta de pedido nuevo**: tiquete que se imprime arriba de la pantalla con campana mostaza, número y total; se va solo a los 9 s. Sonido "ding-dong" generado con Web Audio, activado por el usuario desde la barra lateral (o la campana del encabezado en celular), junto al indicador "En vivo".
- **Gráficas** (`.chart-bar`, `.chart-tooltip`): columnas de máx. 24 px con 4 px redondeados arriba y base recta, cuadrícula de 1 px en `line`, valor solo en el punto más alto, tooltip tinta con el valor primero, y "Ver como tabla".
- **Aviso de suscripción** (franja bajo el encabezado del panel): mostaza claro si la prueba termina en ≤ 5 días, mostaza si venció y está en gracia, tomate si la tienda ya no recibe pedidos; botón tinta "Ver planes"/"Renovar plan" solo para el propietario.
- **Domicilio según la distancia** (Configuración → Entrega): dos tarjetas de elección (`.role-option`) «Tarifa fija» / «Según la distancia». La segunda muestra el mapa con el pin tinta de la tienda (o, sin ubicación, un recuadro con «Usar mi ubicación actual» y «Marcarla en el mapa») y filas «Hasta [2] km · [$ 4.000] · papelera» con «Agregar rango»; un recuadro con el interruptor «Más lejos, cobrar por kilómetro» y «Cada km adicional [$ 1.000]»; tarjetas «Toda la ciudad» / «Hasta una distancia»; y, sobre fondo `ground`, «Así le cobras a tus clientes» con fichas «1 km · $4.000 … 20 km · $20.500» (tachadas «no llega» si quedan fuera). En el carrito, «Compartir mi ubicación» pasa a botón tinta obligatorio; marcada, la línea verde dice «Ubicación marcada · a 3,2 km · domicilio $5.000», y fuera de la zona, en tomate, a cuánto está y hasta dónde llega el negocio. Mientras falte el valor, el resumen dice «$36.000 + domicilio» y el botón solo «Hacer pedido».
- **Verificación del comprobante**: en la tarjeta del pedido, junto al método de pago, «Comprobante verificado» (verde), «Revisar comprobante» (mostaza), «Comprobante no coincide» (tomate) o «Revisando comprobante…» (gris). En el detalle, el recuadro de pago toma ese color y, bajo la miniatura, un bloque blanco con el titular («Todo coincide con el pedido» / «Algo no coincide: revísalo antes de aceptar») y una fila por revisión con su ícono (✓ verde, ✗ tomate, ! gris), más la nota «solo tu cuenta confirma que el dinero llegó». En el carrito, el botón dice «Revisando tu comprobante…» mientras se lee; luego «Leímos $40.000: coincide con tu pedido» o un aviso mostaza si parece de otro valor.
- **Pedidos desde la mesa**: en la tienda, bajo la portada, una franja mostaza con el ícono de cubiertos en un círculo tinta: «**Estás en la mesa 4.** Pide desde tu celular y te lo llevamos a la mesa». En el carrito, «Comer aquí · Mesa 4» y «Para llevar»; con mesa, un aviso mostaza claro «Te lo llevamos a la mesa 4». En el panel, «Mesa 4» con los cubiertos en lugar de «Domicilio/Recoger», y el botón final «Servido en la mesa». Hoja de QR para imprimir (`.table-sheet`, `.table-card`): tarjetas blancas con borde punteado para recortar, nombre del negocio, «MESA» y el número en `.display` grande, el QR, «Escanea con la cámara y pide desde tu celular» y «Pedidos con Pedify»; en Mi tienda, una muestra de la tarjeta de la mesa 1.
- **Crear otro negocio** (selector de negocio): «Crear otro negocio» con cuántos llevas de los que permite el plan («1 de 3») a la derecha; al llegar al límite, en su lugar, un candado con el motivo («Tu plan Emprendedor permite 1 negocio…») y el botón tinta «Ver planes» para el propietario.
- **Mi plan**: tarjeta tinta con el nombre del plan en `.display` y el precio en mostaza; medidores de uso (pista `mustard-soft`, relleno `chart`, tomate al 90 %); planes en tarjetas con el actual resaltado.
- **Panel central** (`/admin`): la misma estructura del panel del negocio: barra lateral tinta (logo, insignia "Administración", secciones con el contador tomate de pagos por revisar, «Ir a mi negocio», «Sistema en línea» y el bloque de la persona con cerrar sesión); en el celular, encabezado tinta con las secciones en pastillas deslizables (la activa en mostaza). Resumen: «Hola, [nombre]», indicadores con su variación («+12 % vs. septiembre»), la gráfica 3D de ingresos y «Para atender» (pagos por revisar en mostaza claro, los que vencen en 7 días con sus iniciales y fichas «en gracia»/«vencidos» que abren Negocios filtrado; «Todo al día» en verde). Negocios: fichas de filtro con su cantidad, tabla con iniciales, estado, último pedido («hace 3 h») y registro. Si falta configuración del servidor, recuadro mostaza claro "Pendiente de configurar en el servidor" con la lista.
- **Gráficas 3D** (`public/js/chart3d.js`, `.night-card`, `.c3d`): tarjeta tinta «de noche» (como la portada) con columnas de CSS 3D sobre un piso `#1f1e26` y las líneas de valores en la pared del fondo. Las caras se sombrean según la luz (arriba a la izquierda) al girar. Se gira arrastrando (en el celular, solo de lado, para no estorbar el desplazamiento) o con las vistas en pastilla «3D» / «De frente» / «Desde arriba» (la activa en mostaza; la transición mide el final y anima desde donde está). La gráfica se achica y se centra sola para caber; los textos siempre miran a la cámara y conservan su tamaño. Valor solo en la columna más alta; tooltip blanco con el valor primero (mouse, toque o flechas del teclado); «Ver como tabla» con los mismos datos. Colores, validados contra el fondo tinta: dinero en mostaza `#ffc72c`, conteos en `#e9e7f0`, horas en la rampa mostaza `#6b5000 → #ffd34d` (más es más claro) y estados En prueba `#5a93f2` · Pagando `#2aa660` · En gracia `#c08000` · Vencidos `#e04f6b` · Suspendidos `#8d8b97`, con 2 px entre tramos y leyenda con cantidades. Las columnas crecen desde el piso una sola vez al entrar; sin columnas animadas con «reducir movimiento».
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

## Tienda pública — «Noche de neón»

Es la vitrina del comerciante, no de Pedify: mandan la portada, el logo y el nombre del negocio. La tienda es **de noche** (fondo `ink`, `.store-night` en `<body>`; también el fondo del rebote en el iPhone) y la comida va a toda luz; el mostaza hace de neón. El carrito y el seguimiento siguen siendo una hoja clara: la comanda de papel sobre la noche.

- **Portada de cine** (`.night-hero`): con portada, la foto a pantalla completa (84 % del alto) que se asienta al cargar y se desliza un poco al bajar (`animation-timeline: scroll()`, solo donde se soporta), con degradado tinta. Encima: logo en círculo mostaza, la pastilla de estado (punto verde que late si está abierto, tomate si está cerrado), el **nombre como letrero gigante** (`.neon-name`: condensado, mayúsculas, la última palabra en contorno mostaza; el tamaño se ajusta para que la palabra más larga quepa, máx. 6rem), la descripción y «Ver el menú» (mostaza) + «WhatsApp». Sin portada: **letrero de neón** (`.night-sign`) con resplandor mostaza, puntos que se desvanecen, el nombre repetido enorme en contorno tenue al fondo y el contorno del nombre con brillo.
- **Datos del negocio** (`.fact`): fichas en una fila deslizable (en escritorio se acomodan en varias líneas): domicilio, recoger, mínimo, pagos, dirección (abre Google Maps) y «Horario · hoy…», que despliega la semana con el día de hoy en mostaza.
- **Los más pedidos** (`.reel`): carrusel de cine de borde a borde con tarjetas 4:5 (`.reel-card`), foto a sangre, número enorme en contorno mostaza (1–3), nombre y precio mostaza sobre el degradado y el «+» mostaza. Las tarjetas que entran se aclaran y crecen al deslizar (`view(inline)`).
- **Menú**: barra de categorías fija en tinta (la activa en mostaza), títulos de categoría en `.display` con la cantidad de productos, filas con la foto de 7.25rem a la derecha (se «revela» al entrar en pantalla) y el precio en mostaza; en escritorio, tarjetas `ink-2` en tres columnas con la foto arriba y filo mostaza al pasar el mouse. Agotado: foto en gris, precio tachado e insignia `tomato-glow`.
- **Controles**: el «+» y el contador son mostaza con tinta; la **barra del carrito es mostaza** («Ver mi pedido · $total», cantidad en un círculo tinta). La barra del seguimiento queda tinta con un filo.
- **El momento propio**: al agregar desde el menú, la foto del plato **vuela en arco** hasta el contador de la barra, que salta al recibirla. Al abrir un producto, su **foto crece desde la tarjeta** hasta la ficha (capa `popover` por encima de la hoja) mientras el texto sube. Con «reducir movimiento» o sin soporte, todo aparece en su sitio sin animación.
- **Ficha del producto** (`.sheet.sheet-night`): oscura, foto grande arriba, nombre en `.display`, precio mostaza, descripción y «Agregar a mi pedido · $precio» (mostaza); con el producto ya en el pedido, el contador y «Ver mi pedido» (blanco).
- **Seguimiento del pedido** (hoja clara del carrito): tarjeta tinta con el estado en grande y su ícono, pasos con hora y el resumen como tiquete; cancelado en tomate. Con la hoja cerrada, la barra inferior dice «Pedido #N · estado» con «Ver estado» o «Ver en el mapa».
- Tokens solo para la noche: `leaf-glow` (#4cd987) y `tomato-glow` (#ff8a7a), versiones claras de los estados que se leen sobre tinta.

## Panel

- **Inicio**: saludo sobre la portada del negocio (o una foto de comida si aún no tiene) con degradado tinta de izquierda a derecha; el interruptor de pedidos va encima.
- **Mapa del domicilio** (`.delivery-map`, Leaflet + `public/js/map.js`): la moto del domiciliario en un círculo mostaza con borde tinta que late; la casa del cliente como gota tinta con la casa mostaza; una línea punteada entre los dos (solo la dirección, no la ruta). Se encuadra solo para mostrar a ambos. Debajo, la distancia en una línea («Tu domiciliario está a 950 m»).
- **Página del domiciliario** (`/domicilio`): tarjeta de estado (mostaza «¿Listo para salir?» → tinta «Compartiendo tu ubicación» con un punto verde que late → verde «¡Pedido entregado!»), el mapa, «Entregar a» con Llamar, Google Maps y Waze, «Cobrar» en tinta con el valor en mostaza grande (verde si ya está pagado) y el botón mostaza «Marcar como entregado» con confirmación.
- **Pago por adelantado** (carrito de la tienda): bloque con borde tinta de 2 px «Paga ahora y envía tu pedido» con el ícono QR en un círculo mostaza, pestañas píldora si hay varias cuentas, el QR redibujado en un marco tinta, el valor a pagar grande, la llave en una píldora gris que se copia, «Guardar imagen del QR», tres pasos numerados sobre fondo gris y el botón tinta «Subir comprobante de pago»; ya subido, una franja verde con la miniatura y «Comprobante listo». En el seguimiento, una franja mostaza «Comprobante enviado…» que pasa a verde «Pago confirmado». En el panel, «Revisar comprobante» en mostaza en la tarjeta y, en el detalle, el bloque de pago resaltado con la miniatura del comprobante.
- **QR para cobrar** (página del domiciliario): pantalla blanca completa (`<dialog>`), «Escanea para pagar», pestañas tipo píldora (la activa en tinta) si hay varias cuentas, el QR redibujado en negro sobre blanco dentro de un marco tinta de 3 px con esquinas de 22 px, el valor a pagar muy grande y la llave en una píldora gris que se copia al tocarla. Mantiene la pantalla encendida mientras está abierta.
- **Cuentas de cobro** (Configuración → Pagos): una tarjeta por Nequi, Bre-B y Daviplata con el recuadro del QR (punteado para subir; el QR nítido cuando ya está), estado «QR listo» (verde), «Solo llave» (mostaza) o «Sin configurar», y los campos número/llave y titular.
- **Enlace del domiciliario** (panel): hoja con el código QR, «Enviar por WhatsApp», «Copiar enlace» y «Abrir aquí»; se abre sola al tocar «Enviar con domiciliario».
- **Inicio de sesión con rol**: dos tarjetas de opción (`.role-option`) «Soy el dueño» (ícono de tienda) y «Soy empleado» (gorro de cocina); la elegida en mostaza claro con borde tinta y un punto mostaza. El texto bajo el título cambia según el rol y se recuerda la última opción en el dispositivo.
- **Permisos en Equipo**: debajo de cada empleado, fichas con casilla (`.choice`) «Marcar agotados», «Ver ventas del día», «Ver clientes», «Ver analíticas»; se guardan al tocarlas. Lo que un empleado no puede ver no aparece en su menú; si entra por enlace, un aviso con candado le dice que lo pida al propietario.
- **La app** (instalable en celular y computador): en el menú lateral y el cajón, fila «Instalar la app» junto al plan (se oculta si ya la abriste como app). En Inicio, tarjeta blanca con ícono mostaza «Pedify como app, en tu celular y en tu computador», botón tinta «Instalar en este computador/celular» y, en el computador, el QR de `/app` («¿Y en tu celular?»). Si el navegador no ofrece el botón, una hoja (`.sheet`) con los pasos de cada equipo, cada uno con su ícono en un círculo mostaza claro. La página `/app` sigue a la portada: tinta con resplandor mostaza, titular `.display` con «computador» en contorno, un portátil y un celular ilustrativos con el mismo pedido y un punto «En vivo» que late a la vez (`.device-laptop`, `.device-phone`, `.live-pulse`), y tarjetas de pasos con «Tu equipo» resaltado en mostaza.
- **Cambios desde otro dispositivo**: donde redibujar podría borrar lo que se escribe (Configuración), una barra tinta abajo «Se guardaron cambios desde otro dispositivo» con el botón mostaza «Actualizar». En las demás secciones el cambio aparece solo.
- **Sin conexión** (`public/offline.html`): tinta, logo y un tiquete blanco inclinado «SIN CONEXIÓN · Se fue el internet» con «Reintentar» tinta y «Esperando la conexión…» con un punto mostaza que late; se recarga sola. Sin archivos externos salvo la letra, que guarda el service worker.
- **Avisos push**: en Inicio, tarjeta tinta con campana mostaza que late, «Que ningún pedido se te pase» y «Activar avisos» (se oculta cuando ya están activos o si se descarta); en el menú lateral y en el cajón del celular, bloque «En vivo» (estado de la conexión) con dos filas alineadas con el menú, «Sonido de pedidos» y «Avisos de pedidos», y su estado a la derecha: «Activar» (mostaza), «Activo» (verde; en avisos, un toque envía una prueba), «Bloqueados» o «Ver cómo» (gris, el toque explica qué hacer); en Configuración → Pedidos, estado del dispositivo con probar y desactivar. En iPhone sin instalar, explica cómo agregar Pedify a la pantalla de inicio. La notificación usa el ícono tinta con la comanda mostaza y una insignia blanca para Android.
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

## Hojas (`.sheet`) en Safari

Las hojas (carrito, seguimiento, ficha de producto y ventanas del panel) toman el alto de su contenido hasta `max-height`. Sus contenedores internos usan `flex-auto` (`flex: 1 1 auto`), nunca `flex-1`: Safari en iPhone calculaba en 0 px una hoja cuyos hijos parten de `flex-basis: 0%` y la hoja se abría invisible. `.sheet[open]` tiene además `min-height` de respaldo.
