// Portada: demostración interactiva del teléfono (pedido → seguimiento del cliente → comanda en el panel), fotos que siguen al mouse y aparición de las
// secciones al bajar. Sin JavaScript la página se ve completa (con la
// demostración ya terminada); con "reducir movimiento" no hay animaciones automáticas.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

// ───────────────────────────── Aparición al bajar ─────────────────────────────

if (!reduceMotion && "IntersectionObserver" in window) {
  document.documentElement.classList.add("js-reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
}

// ───────────────────────────── Fotos que siguen al mouse ─────────────────────────────

const hero = document.querySelector("[data-hero]");
if (hero && finePointer && !reduceMotion) {
  const layers = [...hero.querySelectorAll("[data-depth]")];
  let frame = 0;
  hero.addEventListener("pointermove", (event) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const box = hero.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      for (const layer of layers) {
        const depth = Number(layer.dataset.depth);
        layer.style.transform = `translate3d(${(-x * depth).toFixed(1)}px, ${(-y * depth).toFixed(1)}px, 0)`;
      }
    });
  });
  hero.addEventListener("pointerleave", () => layers.forEach((layer) => (layer.style.transform = "")));
}

// ───────────────────────────── Demostración del teléfono ─────────────────────────────

const demo = document.querySelector("[data-demo]");
if (demo) {
  const PRODUCTS = {
    burger: { name: "Hamburguesa especial", price: 18000 },
    salchi: { name: "Salchipapa especial", price: 22000 },
    jugo: { name: "Jugo natural", price: 6000 },
    perro: { name: "Perro especial", price: 14000 },
  };
  const money = (value) => `$${new Intl.NumberFormat("es-CO").format(value)}`;
  const root = demo.parentElement;
  const bubble = root.querySelector("[data-demo-bubble]");
  const ticket = root.querySelector("[data-demo-ticket]");
  const send = demo.querySelector("[data-demo-send]");
  const hint = demo.querySelector("[data-demo-hint]");
  const resetButton = demo.querySelector("[data-demo-reset]");

  /** id → cantidad, en el orden en que se agregaron. */
  const cart = new Map();
  let sent = false;
  let timers = [];

  const count = () => [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  const total = () => [...cart].reduce((sum, [id, quantity]) => sum + PRODUCTS[id].price * quantity, 0);

  function draw() {
    for (const id of Object.keys(PRODUCTS)) {
      const badge = demo.querySelector(`[data-demo-qty="${id}"]`);
      badge.textContent = String(cart.get(id) ?? 0);
      badge.hidden = !cart.get(id);
    }
    const items = count();
    send.disabled = items === 0 || sent;
    send.classList.toggle("is-sent", sent);
    demo.querySelector("[data-demo-count]").textContent = String(items);
    demo.querySelector("[data-demo-total]").textContent = money(total());
    demo.querySelector("[data-demo-label]").textContent = sent ? "Pedido enviado" : items === 0 ? "Agrega productos" : "Hacer pedido";
    hint.hidden = sent;
    resetButton.hidden = !sent;
  }

  function bump(element, className) {
    element.classList.remove(className);
    void element.offsetWidth; // reinicia la animación
    element.classList.add(className);
  }

  function add(id) {
    if (sent) reset();
    cart.set(id, (cart.get(id) ?? 0) + 1);
    bump(demo.querySelector(`[data-demo-add="${id}"]`), "is-tapped");
    bump(send, "is-bump");
    draw();
  }

  function deliver() {
    if (count() === 0) return;
    sent = true;
    const lines = [...cart].map(([id, quantity], index) => `${index + 1}. ${PRODUCTS[id].name} x${quantity} - ${money(PRODUCTS[id].price * quantity)}`);
    root.querySelector("[data-demo-lines]").innerHTML = lines.join("<br />");
    root.querySelector("[data-demo-bubble-total]").textContent = `TOTAL: ${money(total())}`;
    root.querySelector("[data-demo-ticket-total]").textContent = money(total());
    bubble.classList.add("is-shown");
    // La comanda llega al panel un momento después del mensaje.
    timers.push(setTimeout(() => ticket.classList.add("is-shown"), reduceMotion ? 0 : 700));
    draw();
  }

  function reset() {
    timers.forEach(clearTimeout);
    timers = [];
    cart.clear();
    sent = false;
    bubble.classList.remove("is-shown");
    ticket.classList.remove("is-shown");
    draw();
  }

  /** Se arma un pedido solo, una vez, cuando el teléfono aparece en pantalla. */
  function autoplay() {
    reset();
    const steps = [
      [900, () => add("burger")],
      [1700, () => add("salchi")],
      [2500, () => add("jugo")],
      [3100, () => add("jugo")],
      [4300, () => deliver()],
    ];
    timers = steps.map(([delay, step]) => setTimeout(step, delay));
  }

  demo.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-demo-add]");
    if (addButton) {
      // Si la persona toca, la demostración automática se detiene y manda ella.
      if (!sent) timers.forEach(clearTimeout);
      add(addButton.dataset.demoAdd);
    }
    if (event.target.closest("[data-demo-send]")) deliver();
    if (event.target.closest("[data-demo-reset]")) reset();
  });

  if (reduceMotion || !("IntersectionObserver" in window)) {
    // Sin animaciones automáticas: queda el pedido de ejemplo ya enviado (el del HTML), y se puede repetir a mano.
    cart.set("burger", 1).set("salchi", 1).set("jugo", 2);
    sent = true;
    draw();
  } else {
    reset();
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        autoplay();
      },
      { threshold: 0.45 },
    );
    watcher.observe(demo);
  }
}
