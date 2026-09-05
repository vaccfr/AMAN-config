import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root — which is also the bundle under test. */
export const BUNDLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The smallest airport configuration that satisfies the schema. Tests clone and
 * break one thing at a time, so each assertion pins exactly one rule.
 */
export function minimalAirport() {
  return {
    icao: 'LFXX',
    coveredIcaos: ['LFXX'],
    arp: { lat: 48.0, lon: 2.0 },
    runways: [{ id: '27', qfu: 266, group: 'main', defaultThroughput: 90 }],
    transitions: [
      {
        name: 'ALPHA1W',
        iaf: 'ALPHA',
        iafCoords: { lat: 48.5, lon: 2.5 },
        symbol: 'A',
        sector: 'N',
        availableRunways: ['27'],
        approachTimes: { HEAVY: 600, MEDIUM: 600, LIGHT: 600 },
        sequence: [{ heading: 270, distanceNmi: 10 }],
        p_base_sec: 240,
        dcMax_sec: 300,
        dpMax_base_sec: 360,
        preferredRunway: '27',
      },
    ],
    strategies: ['ANTI_CROSSING'],
    configurations: [
      { id: 'XX_W', name: 'West', activeRunways: ['27'], activeTransitions: ['ALPHA1W'] },
    ],
    accessCallsigns: [],
    // Views are part of a facility now: an approach position owns its own.
    views: [
      {
        id: 'RWY',
        label: 'RWY',
        panels: [
          {
            id: 'runways',
            layout: 'runway-columns',
            window: { totalMin: 60, pastMin: 5 },
            filter: {},
            fields: ['sta_threshold', 'callsign'],
          },
        ],
      },
    ],
  };
}

/** A bundle-relative file wrapper around a config, named after its ICAO. */
export function asFile(config, filename) {
  return { path: `airports/${filename ?? `${config.icao.toLowerCase()}.json`}`, content: config };
}
