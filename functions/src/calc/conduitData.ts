// Representative dimensions for the conduit fill calculation. Sources are listed next to each table.
// (Filled in from manufacturers' public catalogs based on JIS; see README.)

export interface WireSpec {
  label: string;
  d?: number; // finished outer diameter, mm (round wires)
  long?: number; // flat cables (VVF): major x minor, mm
  short?: number;
}
export interface ConduitSpec {
  label: string;
  short: string;
  sizes: Record<string, number>; // nominal size -> inner diameter, mm
}

export const WIRES: Record<string, WireSpec> = {};
export const CONDUITS: Record<string, ConduitSpec> = {};
