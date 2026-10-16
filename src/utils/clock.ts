/**
 * Reloj de la aplicación. El horario de atención depende de la hora actual;
 * las pruebas reemplazan `clock.now` para fijarla (por ejemplo, un martes a las 7:00 p. m.).
 */
export const clock = {
  now: (): Date => new Date(),
};
