// Decide antes de pintar la portada si se muestra la intro (public/js/intro.js): una vez por visita,
// nunca con «reducir movimiento» ni al entrar directo a una sección (#planes). Va como script normal en
// <head> para que la portada no alcance a verse antes de la cortina. Sin JavaScript no hay intro.
try {
  const skip =
    sessionStorage.getItem("pedify:intro") === "vista" || matchMedia("(prefers-reduced-motion: reduce)").matches || location.hash.length > 1;
  document.documentElement.classList.add(skip ? "intro-off" : "intro-on");
} catch {
  document.documentElement.classList.add("intro-off");
}
