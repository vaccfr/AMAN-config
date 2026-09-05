/**
 * Public types for @vaccfr/aman-config-schema.
 *
 * `AirportConfig` mirrors the application's `PlatformConfig`. The two are
 * structurally identical on purpose: the API can pass a validated bundle
 * straight into its own types with no conversion. Change one and you must
 * change the other, and the schema in src/schema.js with it.
 */

export declare const SCHEMA_VERSION: number;

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface RunwayConfig {
  id: string;
  qfu: number;
  group: string;
  /** Seconds between arrivals. */
  defaultThroughput: number;
}

export interface TransitionConfig {
  name: string;
  iaf: string;
  iafCoords: Coordinates;
  symbol: string;
  sector: string;
  availableRunways: string[];
  approachTimes: { HEAVY: number; MEDIUM: number; LIGHT: number };
  sequence: { heading: number; distanceNmi: number }[];
  p_base_sec: number;
  dcMax_sec: number;
  dpMax_base_sec: number;
  preferredRunway: string | null;
}

export interface ConfigurationTemplate {
  id: string;
  name: string;
  activeRunways: string[];
  activeTransitions: string[];
}

export interface AirportConfig {
  icao: string;
  coveredIcaos: string[];
  arp: Coordinates;
  runways: RunwayConfig[];
  transitions: TransitionConfig[];
  strategies: ('ANTI_CROSSING' | 'PREFERRED' | 'EARLIEST')[];
  configurations: ConfigurationTemplate[];
  /** Defaulted to `[]` by the validator when the file omits it. */
  accessCallsigns: string[];
}

/** A single validation failure, always naming the file and the rule it broke. */
export interface ConfigIssue {
  /** Bundle-relative path, e.g. `airports/lfpg.json`. `manifest.json` for the manifest. */
  file: string;
  /** Stable rule identifier, e.g. `schema` or `preferred-runway-available`. */
  rule: string;
  /** Human-readable explanation naming the offending value. */
  message: string;
}

/** One parsed file of a bundle, as handed to the validator. */
export interface RawConfigFile {
  path: string;
  content: unknown;
}

/** A bundle as read from disk, before any validation. */
export interface RawBundle {
  manifest: unknown;
  airports: RawConfigFile[];
}

/** A bundle that has passed schema validation and cross-reference linting. */
export interface ConfigBundle {
  schemaVersion: number;
  /** Keyed by uppercase ICAO. */
  airports: ReadonlyMap<string, AirportConfig>;
}

export type ValidationResult =
  | { ok: true; bundle: ConfigBundle }
  | { ok: false; issues: ConfigIssue[] };

export type ReadBundleResult =
  | { ok: true; bundle: RawBundle }
  | { ok: false; issues: ConfigIssue[] };

export declare const airportConfigSchema: object;
export declare const manifestSchema: object;
export declare const AIRPORTS_DIR: string;
export declare const MANIFEST_FILE: string;

export declare function lintAirportConfig(file: RawConfigFile): ConfigIssue[];
export declare function validateAirportFile(file: RawConfigFile): ConfigIssue[];
export declare function validateBundle(raw: RawBundle): ValidationResult;
export declare function readBundleDir(root: string): Promise<ReadBundleResult>;
