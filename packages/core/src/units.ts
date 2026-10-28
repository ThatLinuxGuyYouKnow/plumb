/** Units and formatting. Millimetres in, display strings out. Pure functions. */

export type DisplayUnit = 'm' | 'ft';

/** Format a length: `4.04 m`, or feet/inches `13′3″` (nearest inch, 12″ carries). */
export function fmt(mm: number, unit: DisplayUnit = 'm', dec = 2): string {
  if (unit === 'm') {
    const d = Math.min(2, Math.max(0, Math.round(dec)));
    return `${(mm / 1000).toFixed(d)} m`;
  }
  const totalInches = Math.round(mm / 25.4);
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches - ft * 12;
  return `${ft}′${inch}″`;
}

/** Format an area: `14.7 m²`, or whole `158 ft²`. */
export function fmtArea(mm2: number, unit: DisplayUnit = 'm'): string {
  if (unit === 'm') return `${(mm2 / 1e6).toFixed(1)} m²`;
  return `${(mm2 / 1e6 * 10.7639).toFixed(0)} ft²`;
}

/** Numeric field value in the display unit, 2 decimals. */
export function toUnit(mm: number, unit: DisplayUnit = 'm'): string {
  return unit === 'm' ? (mm / 1000).toFixed(2) : (mm / 304.8).toFixed(2);
}

/** Parse a numeric field value back to millimetres. */
export function fromUnit(value: number, unit: DisplayUnit = 'm'): number {
  return unit === 'm' ? value * 1000 : value * 304.8;
}

/** Format a length without a unit suffix (inline labels). */
export function fmtNum(mm: number, unit: DisplayUnit = 'm', dec = 2): string {
  if (unit === 'm') {
    const d = Math.min(2, Math.max(0, Math.round(dec)));
    return (mm / 1000).toFixed(d);
  }
  const totalInches = Math.round(mm / 25.4);
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches - ft * 12;
  return inch === 0 ? `${ft}′` : `${ft}′${inch}″`;
}
