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

module.exports = { airportConfigSchema, manifestSchema };
