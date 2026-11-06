// Decide antes de pintar la portada si se muestra la intro (public/js/intro.js): cada vez que se abre o
// se recarga la portada, salvo con «reducir movimiento» o al entrar con un enlace a una sección (#…).
// Va como script normal en <head> para que la portada no alcance a verse antes de la cortina. Sin
// JavaScript no hay intro.
try {
  const skip = matchMedia("(prefers-reduced-motion: reduce)").matches || location.hash.length > 1;
  document.documentElement.classList.add(skip ? "intro-off" : "intro-on");
} catch {
  document.documentElement.classList.add("intro-off");
}
