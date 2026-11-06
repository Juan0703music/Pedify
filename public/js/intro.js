// Intro de la portada: fondo tinta con logos, «PEDIFY» gigante y transparente, una hamburguesa dibujada que
// cae con rebote, suelta vapor y se abre (el cheddar se estira); baja una cortina de cheddar mostaza que
// chorrea, aparece el logo y la cortina sube mostrando la portada. Dura unos 4,5 s y se puede saltar.
// Sin librerías: Web Animations API y un cuadro por cuadro para la tapa y el queso.
const EASE = {
  out: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  back: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  in: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
};

/** Números «al azar» que siempre salen iguales: la cortina tiene la misma forma en cada visita. */
function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** El borde de abajo de la cortina con gotas: tubos que cuelgan con la punta redonda. */
function curtainPath(width = 1000, edge = 1000, drops = 15) {
  const random = seeded(7);
  const step = width / drops;
  let d = `M0 0H${width}V${edge}`;
  for (let i = drops - 1; i >= 0; i -= 1) {
    const w = step * (0.32 + random() * 0.32);
    const x = i * step + random() * (step - w);
    const length = 50 + random() * 230;
    const r = w / 2;
    d += `L${x + w} ${edge}Q${x + w - r * 0.25} ${edge} ${x + w - r * 0.25} ${edge + r}V${edge + length}`;
    d += `A${r * 0.75} ${r * 0.75} 0 0 1 ${x + r * 0.25} ${edge + length}V${edge + r}Q${x + r * 0.25} ${edge} ${x} ${edge}`;
  }
  return `${d}L0 ${edge}Z`;
}

/** Abre la tapa (bisagra a la izquierda) y estira los hilos de cheddar entre la tapa y la tajada. */
function openBurger(svg, duration) {
  const lid = svg.querySelector("[data-lid]");
  const strands = svg.querySelector("[data-strands]");
  const base = 148;
  const cheese = 152;
  const hinge = 40;
  // [x en la tapa, x en la tajada, largo máximo antes de romperse]
  const pairs = [72, 101, 129, 160, 191, 221, 250].map((x, i) => [x, x + (i % 2 ? 3 : -3), 70 + ((i * 37) % 60)]);
  strands.innerHTML = pairs.map(() => `<path fill="none" stroke="#ffc72c" stroke-linecap="round" />`).join("");
  const paths = [...strands.children];
  const draw = (p) => {
    const angle = -16 * p;
    const lift = -34 * p;
    const rad = (angle * Math.PI) / 180;
    lid.setAttribute("transform", `translate(0 ${lift}) rotate(${angle} ${hinge} ${base})`);
    pairs.forEach(([top, bottom, max], i) => {
      // Dónde quedó el punto de la tapa después de girar y subir.
      const x = hinge + (top - hinge) * Math.cos(rad);
      const y = base + (top - hinge) * Math.sin(rad) + lift;
      const length = Math.hypot(x - bottom, y - cheese);
      const path = paths[i];
      if (length < 2 || length > max) return path.setAttribute("opacity", "0");
      const midX = (x + bottom) / 2 + (i % 2 ? 1 : -1) * length * 0.12;
      const midY = (y + cheese) / 2 + Math.abs(x - bottom) * 0.3 + length * 0.06; // el queso cuelga
      path.setAttribute("d", `M${x} ${y}Q${midX} ${midY} ${bottom} ${cheese}`);
      path.setAttribute("stroke-width", String(Math.max(1.5, 9 * (1 - length / max))));
      path.setAttribute("opacity", "1");
    });
  };
  draw(0);
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      draw(1 - (1 - t) ** 2);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Reproduce la intro si intro-gate.js la dejó activa. Devuelve una promesa que se cumple cuando la
 * portada queda a la vista (también al tocar «Saltar intro»).
 */
export function playIntro() {
  const root = document.querySelector("[data-intro]");
  const html = document.documentElement;
  if (!root || !html.classList.contains("intro-on")) return Promise.resolve();

  const $ = (selector) => root.querySelector(selector);
  const animations = [];
  const timers = [];
  const animate = (element, keyframes, options) => {
    const animation = element.animate(keyframes, { fill: "both", ...options });
    animations.push(animation);
    return animation;
  };
  const at = (ms, step) => timers.push(setTimeout(step, ms));

  $("[data-intro-drip]").setAttribute("d", curtainPath());
  html.classList.add("intro-playing");

  return new Promise((resolve) => {
    let finished = false;
    const finish = (quick = false) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      const done = () => {
        animations.forEach((animation) => animation.cancel());
        root.remove();
        html.classList.remove("intro-on", "intro-playing");
        html.classList.add("intro-off", "intro-reveal");
        resolve();
      };
      if (!quick) return done();
      html.classList.add("intro-reveal");
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: EASE.out, fill: "both" }).finished.then(done, done);
    };

    $("[data-intro-skip]").addEventListener("click", () => finish(true));

    // 1. El nombre fantasma, la hamburguesa con rebote y el vapor.
    animate($(".intro-ghost"), [{ opacity: 0, transform: "translateY(-50%) scale(1.15)" }, { opacity: 1, transform: "translateY(-50%) scale(1)" }], { duration: 600, easing: EASE.out });
    animate($(".intro-product"), [{ transform: "scale(0) rotate(-12deg)" }, { transform: "scale(1) rotate(0)" }], { duration: 650, delay: 250, easing: EASE.back });
    const steam = [...root.querySelectorAll(".intro-steam path")];
    steam.forEach((path, i) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      animate(path, [{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: 550, delay: 800 + i * 120, easing: EASE.out });
      at(1350, () => animate(path, [{ strokeDashoffset: 0 }, { strokeDashoffset: -length }], { duration: 400, delay: i * 80, easing: EASE.in }));
    });

    // 2. Se abre la tapa y el cheddar se estira.
    at(1350, () => void openBurger($(".intro-burger"), 850));

    // 3. Baja la cortina de cheddar, aparece el logo y la cortina sube mostrando la portada.
    at(2350, () => animate($(".intro-curtain"), [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], { duration: 650, easing: EASE.in }));
    at(3000, () => {
      for (const selector of [".intro-product", ".intro-ghost", ".intro-pattern"]) $(selector).style.visibility = "hidden";
      root.style.background = "transparent";
      animate($(".intro-brand"), [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: 450, easing: EASE.back });
    });
    at(3700, () => {
      html.classList.add("intro-reveal");
      animate($(".intro-curtain"), [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], { duration: 850, easing: EASE.inOut });
      animate($(".intro-brand"), [{ opacity: 1, transform: "translateY(0)" }, { opacity: 1, transform: "translateY(-100vh)" }], { duration: 850, easing: EASE.inOut });
    });
    at(4600, () => finish());
  });
}
