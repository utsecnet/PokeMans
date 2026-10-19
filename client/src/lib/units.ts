/**
 * How a height and a weight are said, in the reader's choice of units.
 *
 * PokéAPI publishes height in decimetres and weight in hectograms, which is why every
 * reading in the app divides by 10. Those tenths are what the database stores, what the
 * filters compare and what the sort chain orders by, and none of that changes here: this
 * file only decides how a stored number is read out. A preference that altered the stored
 * value would make a saved filter mean something different on a different screen.
 *
 * Plain functions in a .ts file rather than part of the provider, so the conversions can be
 * tested without a JSX-capable runtime -- the same reason advancedSearchLogic.ts exists.
 */

export type UnitSystem = 'metric' | 'imperial';

const METRES_PER_INCH = 0.0254;
const KG_PER_POUND = 0.45359237;

/** Height with no unit, for a column that names the unit in its heading. */
export function heightValue(raw: number, system: UnitSystem): string {
  if (system === 'metric') return (raw / 10).toFixed(1);
  // Feet and inches, not decimal feet: a height is read aloud as 4 foot 11, not as 4.9
  // feet. Rounding to the inch before splitting is what stops 11.6 inches printing as 12.
  const inches = Math.round(raw / 10 / METRES_PER_INCH);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Weight with no unit. */
export function weightValue(raw: number, system: UnitSystem): string {
  const kg = raw / 10;
  return (system === 'metric' ? kg : kg / KG_PER_POUND).toFixed(1);
}

/** A reading that carries its own unit, for prose. */
export function heightReading(raw: number, system: UnitSystem): string {
  return system === 'metric' ? `${heightValue(raw, system)} m` : heightValue(raw, system);
}

export function weightReading(raw: number, system: UnitSystem): string {
  return `${weightValue(raw, system)} ${system === 'metric' ? 'kg' : 'lb'}`;
}

/**
 * Column headings. An imperial height heading names no unit, because its values carry their
 * own marks and naming feet above a column of feet and inches would name half of one.
 */
export function heightColumnLabel(system: UnitSystem): string {
  return system === 'metric' ? 'Height (m)' : 'Height';
}

export function weightColumnLabel(system: UnitSystem): string {
  return system === 'metric' ? 'Weight (kg)' : 'Weight (lb)';
}
