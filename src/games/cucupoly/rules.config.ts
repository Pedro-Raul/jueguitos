/**
 * Valores que el xlsx original no define. Cada uno lleva el comentario SUPUESTO
 * para poder cambiarlos sin tocar la lógica.
 */
export const RULES = {
  /** SUPUESTO: dinero inicial de cada jugador. */
  startingMoney: 1500,
  /** SUPUESTO: sueldo al pasar o caer en GO. */
  goSalary: 200,
  /** SUPUESTO: fianza para salir de la cárcel. */
  jailFine: 50,
  /** SUPUESTO: turnos que hay que esperar en la cárcel si no se paga la fianza. */
  jailTurns: 3,
  /** SUPUESTO: renta de propiedad = 10% del precio, redondeada. */
  propertyRentRate: 0.1,
  /** SUPUESTO: renta de busetas según cuántas tenga el dueño (1..4). */
  busRents: [25, 50, 100, 200],
  /** SUPUESTO: multiplicador de renta de servicios según cuántos tenga el dueño (1..3). */
  serviceMultipliers: [4, 10, 15],
  /** SUPUESTO: la subasta arranca en el 75% del precio. */
  auctionStartRate: 0.75,
  /** SUPUESTO: dinero que reparte Impulso Económico a cada jugador activo. */
  initialEventBoost: 250,
  /** SUPUESTO: tics del contador de la subasta relámpago. */
  openAuctionCountdown: 5,
  /** SUPUESTO: milisegundos entre tics del contador. */
  openAuctionTickMs: 1000,
  /** SUPUESTO: apuesta máxima por jugador en la mesa de 31. */
  table31BetLimit: 100,
  /** SUPUESTO: objetivo de la mesa de 31. */
  table31Target: 31,
  /** SUPUESTO: las cartas de la mesa de 31 valen entre 1 y 11. */
  table31CardMax: 11,
  /** SUPUESTO: Abastecimiento sube un 15% las rentas del dueño. */
  waterRentBonus: 0.15,
  /** SUPUESTO: duración de una habilidad, en rondas. */
  abilityRounds: 1,
  /** SUPUESTO: rondas de espera tras usar una habilidad. */
  abilityCooldownRounds: 6,
  /**
   * PLACEHOLDER: mazo de ejemplo de Tesorería. El xlsx no define las cartas.
   * amount positivo = cobras; negativo = pagas.
   */
  treasuryDeck: [
    { text: 'Cobras 100', amount: 100 },
    { text: 'Pagas 50', amount: -50 },
    { text: 'Cobras 200', amount: 200 },
    { text: 'Pagas 100', amount: -100 },
    { text: 'Cobras 50', amount: 50 },
    { text: 'Pagas 150', amount: -150 },
  ],
} as const
