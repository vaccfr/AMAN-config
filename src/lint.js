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

/**
 * Cross-reference rules for a TMA and its views.
 *
 * These are the ones that matter most in practice: a view naming a fix that no
 * covered airport declares renders a silently empty ladder, which looks like
 * "no traffic" rather than like a mistake.
 *
 * @param {{path: string, content: any, views: {path: string, content: any}[]}} tma
 * @param {Map<string, any>} airportsByIcao  keyed by uppercase ICAO
 * @returns {import('../types/index.js').ConfigIssue[]}
 */
function lintTma(tma, airportsByIcao) {
  const config = tma.content;
  /** @type {import('../types/index.js').ConfigIssue[]} */
  const issues = [];
  const add = (file, rule, message) => issues.push({ file, rule, message });

  // The directory name is how the TMA is addressed; a mismatch means it loads
  // under a name nothing links to.
  const dirName = tma.path.split('/')[1];
  if (dirName !== config.id) {
    add(tma.path, 'tma-id-matches-directory', `directory is "${dirName}" but "id" is "${config.id}"`);
  }

  const covered = [];
  for (const icao of config.airports) {
    const airport = airportsByIcao.get(String(icao).toUpperCase());
    if (!airport) {
      add(tma.path, 'tma-airport-exists', `declares airport "${icao}", which the bundle does not contain`);
      continue;
    }
    covered.push(airport);
  }

  // Every configuration must map every declared airport to one of ITS templates.
  for (const configuration of config.configurations) {
    for (const icao of config.airports) {
      const templateId = configuration.airports[icao];
      if (templateId === undefined) {
        add(
          tma.path,
          'tma-configuration-covers-airports',
          `configuration "${configuration.id}" does not map airport "${icao}"`,
        );
        continue;
      }
      const airport = airportsByIcao.get(String(icao).toUpperCase());
      if (!airport) continue;
      if (!airport.configurations.some((c) => c.id === templateId)) {
        add(
          tma.path,
          'tma-configuration-template-exists',
          `configuration "${configuration.id}" maps "${icao}" to template "${templateId}", which that airport does not declare`,
        );
      }
    }
    for (const icao of Object.keys(configuration.airports)) {
      if (!config.airports.includes(icao)) {
        add(
          tma.path,
          'tma-configuration-covers-airports',
          `configuration "${configuration.id}" maps "${icao}", which the TMA does not declare`,
        );
      }
    }
  }

  // Fix names available anywhere in the TMA, and the runway groups per airport.
  const knownIafs = new Set();
  for (const airport of covered) for (const t of airport.transitions) knownIafs.add(t.iaf);
  const groupsByIcao = new Map(
    covered.map((a) => [a.icao.toUpperCase(), new Set(a.runways.map((r) => r.group))]),
  );

  // Colours are declared per fix; one that does not exist is dead config.
  for (const iaf of Object.keys(config.iafs ?? {})) {
    if (!knownIafs.has(iaf)) {
      add(tma.path, 'tma-iaf-exists', `declares a colour for "${iaf}", which no covered airport uses`);
    }
  }

  const viewsById = new Map(tma.views.map((v) => [v.content.id, v]));
  for (const id of config.views) {
    if (!viewsById.has(id)) {
      add(tma.path, 'tma-view-exists', `lists view "${id}", which has no file under views/`);
    }
  }
  for (const view of tma.views) {
    if (!config.views.includes(view.content.id)) {
      add(view.path, 'view-listed-by-tma', `view "${view.content.id}" is not listed in the TMA's views`);
    }
    // Reserved: the desequenced tab is a fixed part of the interface and is
    // never a configured view.
    if (view.content.id === 'DESEQUENCED') {
      add(view.path, 'view-id-reserved', 'view id "DESEQUENCED" is reserved for the desequenced tab');
    }
    const stem = (view.path.split('/').pop() ?? '').replace(/\.json$/i, '');
    if (stem !== view.content.id) {
      add(view.path, 'view-id-matches-filename', `filename implies "${stem}" but "id" is "${view.content.id}"`);
    }

    const panelIds = new Set();
    for (const panel of view.content.panels) {
      if (panelIds.has(panel.id)) {
        add(view.path, 'panel-id-unique', `panel id "${panel.id}" is used more than once`);
      }
      panelIds.add(panel.id);

      for (const iaf of panel.filter?.iafs ?? []) {
        if (!knownIafs.has(iaf)) {
          add(
            view.path,
            'view-filter-iaf-exists',
            `panel "${panel.id}" filters on IAF "${iaf}", which no airport in this TMA declares — the panel would render empty`,
          );
        }
      }

      for (const [side, spec] of Object.entries(panel.sides ?? {})) {
        const icao = String(spec.icao).toUpperCase();
        if (!config.airports.includes(spec.icao) && !config.airports.includes(icao)) {
          add(view.path, 'panel-side-airport-covered', `panel "${panel.id}" ${side} side names "${spec.icao}", which the TMA does not declare`);
          continue;
        }
        const groups = groupsByIcao.get(icao);
        if (groups && !groups.has(spec.runwayGroup)) {
          add(
            view.path,
            'panel-side-group-exists',
            `panel "${panel.id}" ${side} side names runway group "${spec.runwayGroup}", which ${icao} does not declare`,
          );
        }
      }

      // Colouring by IAF needs a colour for every fix that could appear.
      if (panel.colors && Object.values(panel.colors).some((c) => c.by === 'iaf')) {
        const declared = new Set(Object.keys(config.iafs ?? {}));
        const needed = panel.filter?.iafs ?? [...knownIafs];
        for (const iaf of needed) {
          if (!declared.has(iaf)) {
            add(
              view.path,
              'view-iaf-colour-declared',
              `panel "${panel.id}" colours by IAF but the TMA declares no colour for "${iaf}"`,
            );
          }
        }
      }
    }
  }

  return issues;
}

module.exports.lintTma = lintTma;
