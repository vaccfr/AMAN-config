'use strict';

/**
 * JSON Schema (draft 2020-12) for the configuration bundle.
 *
 * This is the single definition, used by this repository's CI and by the
 * AMAN-SIM API at load time, so a rule cannot be enforced in one place and not
 * the other. Field names mirror `PlatformConfig` in the application's shared
 * types; the two must not drift.
 *
 * Every object sets `additionalProperties: false`. A misspelled optional field
 * (`preferedRunway`) would otherwise be accepted and silently take its default,
 * which is exactly the class of mistake this schema exists to catch.
 */

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** `{ lat, lon }` in decimal degrees. Shared by the ARP and every IAF. */
const coordinates = {
  type: 'object',
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lon: { type: 'number', minimum: -180, maximum: 180 },
  },
  required: ['lat', 'lon'],
  additionalProperties: false,
};

const manifestSchema = {
  $schema: DIALECT,
  $id: 'https://github.com/vaccfr/AMAN-config/schema/manifest.json',
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', minimum: 1 },
  },
  required: ['schemaVersion'],
  additionalProperties: false,
};

const airportConfigSchema = {
  $schema: DIALECT,
  $id: 'https://github.com/vaccfr/AMAN-config/schema/airport.json',
  type: 'object',
  properties: {
    icao: { type: 'string', pattern: '^[A-Za-z]{4}$' },
    coveredIcaos: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Za-z]{4}$' },
      minItems: 1,
    },
    arp: coordinates,
    runways: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          qfu: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
          group: { type: 'string', minLength: 1 },
          defaultThroughput: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['id', 'qfu', 'group', 'defaultThroughput'],
        additionalProperties: false,
      },
    },
    transitions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          iaf: { type: 'string', minLength: 1 },
          iafCoords: coordinates,
          symbol: { type: 'string', minLength: 1 },
          sector: { type: 'string' },
          availableRunways: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
          approachTimes: {
            type: 'object',
            properties: {
              HEAVY: { type: 'number', exclusiveMinimum: 0 },
              MEDIUM: { type: 'number', exclusiveMinimum: 0 },
              LIGHT: { type: 'number', exclusiveMinimum: 0 },
            },
            required: ['HEAVY', 'MEDIUM', 'LIGHT'],
            additionalProperties: false,
          },
          sequence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                heading: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
                distanceNmi: { type: 'number', exclusiveMinimum: 0 },
              },
              required: ['heading', 'distanceNmi'],
              additionalProperties: false,
            },
          },
          p_base_sec: { type: 'number', minimum: 0 },
          dcMax_sec: { type: 'number', minimum: 0 },
          dpMax_base_sec: { type: 'number', minimum: 0 },
          preferredRunway: { type: ['string', 'null'], minLength: 1 },
        },
        required: [
          'name',
          'iaf',
          'iafCoords',
          'symbol',
          'sector',
          'availableRunways',
          'approachTimes',
          'sequence',
          'p_base_sec',
          'dcMax_sec',
          'dpMax_base_sec',
          'preferredRunway',
        ],
        additionalProperties: false,
      },
    },
    strategies: {
      type: 'array',
      minItems: 1,
      items: { enum: ['ANTI_CROSSING', 'PREFERRED', 'EARLIEST'] },
    },
    configurations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          activeRunways: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          activeTransitions: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
        required: ['id', 'name', 'activeRunways', 'activeTransitions'],
        additionalProperties: false,
      },
    },
    // Optional in the JSON and defaulted to [] on load, matching the contract
    // documented on the application's `PlatformConfig.accessCallsigns`.
    accessCallsigns: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
  required: [
    'icao',
    'coveredIcaos',
    'arp',
    'runways',
    'transitions',
    'strategies',
    'configurations',
  ],
  additionalProperties: false,
};

// ── TMA and views ─────────────────────────────────────────────────────────────
// Additive to schema version 1: an older validator (and an older API) simply
// does not read tmas/, so these can land and be reviewed before anything
// renders them. Only a change to the *airport* shape needs a version bump.

/** Fields a panel may render, in declaration order. */
const FIELD_IDS = [
  'callsign',
  'sta_threshold',
  'sta_iaf',
  'dc',
  'dt',
  'iaf',
  'aircraftType',
  'confidence',
  'parking',
];

/** What a colour may be keyed on. Categorical only — no thresholds yet. */
const COLOR_SOURCES = ['state', 'delayLevel', 'iaf', 'runway', 'none'];

/** Which part of a row a colour applies to. */
const COLOR_TARGETS = ['callsign', 'iaf', 'row'];

const HEX_COLOR = '^#[0-9a-fA-F]{6}$';

/**
 * One side of a dual-sided panel.
 *
 * Declared by runway GROUP rather than by runway id on purpose: LFPG's west and
 * east configurations activate different runways (27R/26L vs 09L/08R) but the
 * same groups (sud/nord), so a group-based side keeps working when the platform
 * turns. Naming ids would mean rewriting every view on every configuration
 * change.
 */
const panelSide = {
  type: 'object',
  properties: {
    icao: { type: 'string', pattern: '^[A-Za-z]{4}$' },
    runwayGroup: { type: 'string', minLength: 1 },
  },
  required: ['icao', 'runwayGroup'],
  additionalProperties: false,
};

const panelSides = {
  type: 'object',
  properties: { left: panelSide, right: panelSide },
  required: ['left', 'right'],
  additionalProperties: false,
};

const panelSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    layout: { enum: ['runway-columns', 'dual-sided'] },
    sides: panelSides,
    window: {
      type: 'object',
      properties: {
        totalMin: { type: 'integer', minimum: 5, maximum: 240 },
        pastMin: { type: 'integer', minimum: 0, maximum: 60 },
      },
      required: ['totalMin', 'pastMin'],
      additionalProperties: false,
    },
    /**
     * Which scheduled time positions a flight on the axis. A runway timeline
     * is referenced to the threshold; an IAF timeline — what the en-route
     * sectors work — is referenced to the IAF passage time. Defaults to
     * `threshold`, which is what the approach views have always used.
     */
    timeReference: { enum: ['threshold', 'iaf'] },
    // An object of optional allow-lists, ANDed. An absent key constrains
    // nothing. Deliberately not a predicate language: every key is an enum, so
    // CI catches a typo that would otherwise render a silently empty ladder.
    filter: {
      type: 'object',
      properties: {
        iafs: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
      },
      additionalProperties: false,
    },
    fields: {
      type: 'array',
      minItems: 1,
      items: { enum: FIELD_IDS },
    },
    colors: {
      type: 'object',
      propertyNames: { enum: COLOR_TARGETS },
      additionalProperties: {
        type: 'object',
        properties: { by: { enum: COLOR_SOURCES } },
        required: ['by'],
        additionalProperties: false,
      },
    },
    /** Whether flight-mutating interactions are offered at all on this panel. */
    interactive: { type: 'boolean' },
  },
  required: ['id', 'layout', 'window', 'fields', 'interactive'],
  additionalProperties: false,
  // A dual-sided panel needs its two sides; runway-columns derives its columns
  // from the session's active runways and must not declare them.
  allOf: [
    {
      if: { properties: { layout: { const: 'dual-sided' } }, required: ['layout'] },
      // `properties` repeated so ajv's strict mode can see the required key.
      then: { properties: { sides: panelSides }, required: ['sides'] },
      else: { not: { required: ['sides'] } },
    },
  ],
};

const viewSchema = {
  $schema: DIALECT,
  $id: 'https://github.com/vaccfr/AMAN-config/schema/view.json',
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
    panels: { type: 'array', minItems: 1, items: panelSchema },
  },
  required: ['id', 'label', 'panels'],
  additionalProperties: false,
};

const tmaSchema = {
  $schema: DIALECT,
  $id: 'https://github.com/vaccfr/AMAN-config/schema/tma.json',
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    label: { type: 'string', minLength: 1 },
    airports: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: '^[A-Za-z]{4}$' },
    },
    /**
     * Controller callsign patterns granting the sequencer lock for the whole
     * TMA. One lock covers every airport in the group.
     */
    accessCallsigns: { type: 'array', items: { type: 'string', minLength: 1 } },
    /**
     * Named configurations mapping every airport to one of ITS OWN templates.
     * A mapping, never a redeclaration — the runway and transition data stays
     * in the airport files and is not duplicated here.
     */
    configurations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          airports: {
            type: 'object',
            propertyNames: { pattern: '^[A-Za-z]{4}$' },
            additionalProperties: { type: 'string', minLength: 1 },
            minProperties: 1,
          },
        },
        required: ['id', 'label', 'airports'],
        additionalProperties: false,
      },
    },
    /**
     * Colour per IAF, keyed by published fix name. Declared once here rather
     * than per transition: several transitions share one IAF (LORNI1W and
     * LORNI1E are both LORNI), so a per-transition colour could be declared
     * inconsistently for the same fix.
     */
    iafs: {
      type: 'object',
      propertyNames: { minLength: 1 },
      additionalProperties: {
        type: 'object',
        properties: { color: { type: 'string', pattern: HEX_COLOR } },
        required: ['color'],
        additionalProperties: false,
      },
    },
    /** View ids, in tab order. Each must have a file under views/. */
    views: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    /**
     * Other TMAs reachable from this one's tab strip. The approach positions
     * link to the shared en-route page and back, so a controller can move
     * between them without editing the URL.
     */
    links: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9-]+$' } },
  },
  required: ['id', 'label', 'airports', 'configurations', 'views'],
  additionalProperties: false,
};

module.exports = { airportConfigSchema, manifestSchema, tmaSchema, viewSchema, FIELD_IDS, COLOR_SOURCES };

