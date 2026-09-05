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
  /** Absent in a bundle written before TMAs existed; treated as empty. */
  tmas?: RawTma[];
}

/** One TMA directory as read from disk: its own file plus its view files. */
export interface RawTma {
  path: string;
  content: unknown;
  views: RawConfigFile[];
}

// ── TMA and views ─────────────────────────────────────────────────────────────

/** Fields a panel may render, in declaration order. */
export type PanelFieldId =
  | 'callsign'
  | 'sta_threshold'
  | 'sta_iaf'
  | 'dc'
  | 'dt'
  | 'iaf'
  | 'aircraftType'
  | 'confidence'
  | 'parking';

/** What a colour may be keyed on. Categorical only. */
export type ColorSource = 'state' | 'delayLevel' | 'iaf' | 'runway' | 'none';

/** Which part of a row a colour applies to. */
export type ColorTarget = 'callsign' | 'iaf' | 'row';

export type PanelLayout = 'runway-columns' | 'dual-sided';

/**
 * One side of a dual-sided panel, named by runway GROUP rather than runway id
 * so the view survives the platform turning: an airport's west and east
 * configurations activate different runways but the same groups.
 */
export interface PanelSide {
  icao: string;
  runwayGroup: string;
}

export interface PanelConfig {
  id: string;
  layout: PanelLayout;
  /** Present exactly when `layout` is `dual-sided`. */
  sides?: { left: PanelSide; right: PanelSide };
  window: { totalMin: number; pastMin: number };
  /**
   * Which scheduled time positions a flight on the axis: the runway threshold,
   * or the IAF passage time that the en-route sectors work to. Defaults to
   * `threshold`.
   */
  timeReference?: 'threshold' | 'iaf';
  /** Optional allow-lists, ANDed. An absent key constrains nothing. */
  filter?: { iafs?: string[] };
  fields: PanelFieldId[];
  colors?: Partial<Record<ColorTarget, { by: ColorSource }>>;
  /** When false, no flight-mutating interaction is offered, lock or not. */
  interactive: boolean;
}

export interface ViewConfig {
  id: string;
  label: string;
  panels: PanelConfig[];
}

/** Maps every airport of the TMA to one of that airport's own templates. */
export interface TmaConfiguration {
  id: string;
  label: string;
  airports: Record<string, string>;
}

interface TmaCommon {
  id: string;
  label: string;
  airports: string[];
  accessCallsigns?: string[];
  configurations: TmaConfiguration[];
  /** Colour per published fix name, declared once for the whole TMA. */
  iafs?: Record<string, { color: string }>;
}

/**
 * `tma.json` as authored: `views` is a list of ids, in tab order, each with a
 * file under `views/`.
 */
export interface TmaFile extends TmaCommon {
  views: string[];
}

/**
 * A TMA as resolved into a validated bundle: the view ids have been replaced by
 * the loaded view definitions, in the order the file declared them.
 */
export interface TmaConfig extends TmaCommon {
  views: ViewConfig[];
}

/** A bundle that has passed schema validation and cross-reference linting. */
export interface ConfigBundle {
  schemaVersion: number;
  /** Keyed by uppercase ICAO. */
  airports: ReadonlyMap<string, AirportConfig>;
  /** Keyed by TMA id. Empty for a bundle with no `tmas/` directory. */
  tmas: ReadonlyMap<string, TmaConfig>;
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
export declare function lintTma(
  tma: RawTma,
  airportsByIcao: ReadonlyMap<string, AirportConfig>,
): ConfigIssue[];
export declare function validateAirportFile(file: RawConfigFile): ConfigIssue[];
export declare function validateBundle(raw: RawBundle): ValidationResult;
export declare function readBundleDir(root: string): Promise<ReadBundleResult>;
