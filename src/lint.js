'use strict';

/** Earth radius in nautical miles. Mirrors `distanceNmi` in the API's geo.util. */
const R_NMI = 3440.065;

/**
 * Great-circle distance in NM. Haversine, the same formula the engine uses.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number}
 */
function distanceNmi(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_NMI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** An IAF sits in the terminal area. Outside this band the coordinate is wrong. */
const IAF_MIN_NMI = 5;
const IAF_MAX_NMI = 120;

/**
 * Cross-reference rules that JSON Schema cannot express.
 *
 * Schema validation checks shape; these check that the file is internally
 * consistent. Every rule here guards a failure that is either silent at runtime
 * or only surfaces once live traffic reaches the affected transition.
 *
 * Callers MUST run these only on files that have already passed schema
 * validation — the rules assume the shape is correct and read fields directly.
 *
 * @param {import('../types/index.js').RawConfigFile} file
 * @returns {import('../types/index.js').ConfigIssue[]}
 */
function lintAirportConfig(file) {
  const config = /** @type {any} */ (file.content);
  /** @type {import('../types/index.js').ConfigIssue[]} */
  const issues = [];
  const add = (rule, message) => issues.push({ file: file.path, rule, message });

  // ── filename ↔ icao ────────────────────────────────────────────────────────
  // The API keys its config map by ICAO but discovers files by name; a mismatch
  // means an airport silently loads under the wrong key.
  const stem = (file.path.split('/').pop() ?? file.path).replace(/\.json$/i, '');
  if (stem.toUpperCase() !== String(config.icao).toUpperCase()) {
    add(
      'filename-icao-match',
      `filename implies "${stem.toUpperCase()}" but the "icao" field is "${config.icao}"`,
    );
  }

  // ── uniqueness ─────────────────────────────────────────────────────────────
  // Every rule below resolves a name to a declaration, which is meaningless
  // when two declarations share a name.
  const runwayIds = new Set();
  for (const runway of config.runways) {
    if (runwayIds.has(runway.id)) {
      add('duplicate-runway-id', `runway "${runway.id}" is declared more than once`);
    }
    runwayIds.add(runway.id);
  }

  const transitionNames = new Set();
  for (const transition of config.transitions) {
    if (transitionNames.has(transition.name)) {
      add('duplicate-transition-name', `transition "${transition.name}" is declared more than once`);
    }
    transitionNames.add(transition.name);
  }

  const runwayGroups = new Set(config.runways.map((r) => r.group));

  for (const transition of config.transitions) {
    // ── iafCoords ────────────────────────────────────────────────────────────
    // Duplicated from the schema on purpose: a wrong or absent IAF coordinate
    // fails silently. The flight never arms closest-point-of-approach
    // detection, so the crossing reads as "never flew the transition" with no
    // error anywhere. This must be caught statically.
    const coords = transition.iafCoords;
    const lat = coords ? coords.lat : undefined;
    const lon = coords ? coords.lon : undefined;
    if (
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      typeof lon !== 'number' ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      add(
        'iaf-coords-valid',
        `transition "${transition.name}" must declare "iafCoords" with a latitude in [-90, 90] and a longitude in [-180, 180]`,
      );
    } else {
      // ── IAF plausibility ───────────────────────────────────────────────────
      // Range checks alone pass a transcribed digit or a flipped hemisphere
      // straight through: the coordinate stays a valid latitude, it just points
      // at another continent. Distance to the ARP is what catches that.
      const distance = distanceNmi(config.arp.lat, config.arp.lon, lat, lon);
      if (distance < IAF_MIN_NMI || distance > IAF_MAX_NMI) {
        add(
          'iaf-near-arp',
          `transition "${transition.name}" has its IAF ${distance.toFixed(1)} NM from the ARP, outside the plausible ${IAF_MIN_NMI}–${IAF_MAX_NMI} NM band — check for a transcribed digit or a flipped sign`,
        );
      }
    }

    // ── availableRunways resolve ─────────────────────────────────────────────
    // An entry may name a concrete runway id or a runway group.
    for (const entry of transition.availableRunways) {
      if (!runwayIds.has(entry) && !runwayGroups.has(entry)) {
        add(
          'available-runways-resolve',
          `transition "${transition.name}" lists "${entry}" in availableRunways, which is neither a declared runway id nor a declared runway group`,
        );
      }
    }

    // ── preferredRunway ∈ availableRunways ───────────────────────────────────
    // The anti-crossing strategy assigns this runway to the transition. One the
    // transition may not use produces an assignment the engine then has to
    // override, silently defeating the strategy.
    const preferred = transition.preferredRunway;
    if (preferred !== null && !transition.availableRunways.includes(preferred)) {
      add(
        'preferred-runway-available',
        `transition "${transition.name}" sets preferredRunway "${preferred}", which is not in its own availableRunways`,
      );
    }
  }

  // ── configuration templates resolve ────────────────────────────────────────
  for (const template of config.configurations) {
    for (const runwayId of template.activeRunways) {
      if (!runwayIds.has(runwayId)) {
        add(
          'active-runways-resolve',
          `configuration "${template.id}" activates runway "${runwayId}", which the airport does not declare`,
        );
      }
    }
    for (const name of template.activeTransitions) {
      if (!transitionNames.has(name)) {
        add(
          'active-transitions-resolve',
          `configuration "${template.id}" activates transition "${name}", which the airport does not declare`,
        );
      }
    }
  }

  return issues;
}

module.exports = { lintAirportConfig };
