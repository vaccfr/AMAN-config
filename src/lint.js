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
 * @param {Set<string>} iafColors  fix names the manifest gives a colour
 * @returns {import('../types/index.js').ConfigIssue[]}
 */
function lintAirportConfig(file, iafColors = new Set()) {
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


  // ── the facility's own approach views ──────────────────────────────────────
  // Linted with the same rules as an en-route view: the two kinds differ in
  // interactivity and header, not in how a view is checked.
  const viewIafs = new Set(config.transitions.map((t) => t.iaf));
  const groups = new Set(config.runways.map((r) => r.group));
  const covered = new Set(
    (config.coveredIcaos ?? [config.icao]).map((i) => String(i).toUpperCase()),
  );
  issues.push(
    ...lintViews(
      (config.views ?? []).map((view) => ({ file: file.path, content: view })),
      {
        knownIafs: viewIafs,
        groupsByIcao: new Map([...covered].map((icao) => [icao, groups])),
        coveredIcaos: covered,
        iafColors,
      },
    ),
  );

  return issues;
}

module.exports = { lintAirportConfig };

/**
 * Rules for a set of views, shared by both kinds of page.
 *
 * A view naming a fix that no covered airport declares renders a silently
 * empty ladder — it looks like "no traffic" rather than like a mistake — so
 * this is the rule that earns its keep most often.
 *
 * @param {{file: string, content: any}[]} views
 * @param {{knownIafs: Set<string>, groupsByIcao: Map<string, Set<string>>,
 *          coveredIcaos: Set<string>, iafColors: Set<string>}} ctx
 * @returns {import('../types/index.js').ConfigIssue[]}
 */
function lintViews(views, ctx) {
  /** @type {import('../types/index.js').ConfigIssue[]} */
  const issues = [];
  const add = (file, rule, message) => issues.push({ file, rule, message });

  const seen = new Set();
  for (const { file, content: view } of views) {
    if (seen.has(view.id)) add(file, 'view-id-unique', `view id "${view.id}" is declared twice`);
    seen.add(view.id);

    // Reserved: the desequenced tab is a fixed part of the interface.
    if (view.id === 'DESEQUENCED') {
      add(file, 'view-id-reserved', 'view id "DESEQUENCED" is reserved for the desequenced tab');
    }

    // One view is one time axis. The interface draws a single current-time
    // line across every ladder in a view and derives one scroll range for
    // them, so panels disagreeing about the window would put that line minutes
    // away from where some of the ladders actually place "now".
    const windows = new Set(view.panels.map((p) => `${p.window.totalMin}/${p.window.pastMin}`));
    if (windows.size > 1) {
      add(
        file,
        'view-window-consistent',
        `panels of "${view.id}" declare different time windows (${[...windows].sort().join(', ')}); a view is drawn on one shared axis`,
      );
    }

    const panelIds = new Set();
    for (const panel of view.panels) {
      if (panelIds.has(panel.id)) {
        add(file, 'panel-id-unique', `panel id "${panel.id}" is used more than once in "${view.id}"`);
      }
      panelIds.add(panel.id);

      for (const iaf of panel.filter?.iafs ?? []) {
        if (!ctx.knownIafs.has(iaf)) {
          add(
            file,
            'view-filter-iaf-exists',
            `panel "${panel.id}" of "${view.id}" filters on IAF "${iaf}", which no covered airport declares — the panel would render empty`,
          );
        }
      }

      for (const [which, spec] of Object.entries(panel.sides ?? {})) {
        const icao = String(spec.icao).toUpperCase();
        if (!ctx.coveredIcaos.has(icao)) {
          add(
            file,
            'panel-side-airport-covered',
            `panel "${panel.id}" of "${view.id}" ${which} side names "${spec.icao}", which this page does not cover`,
          );
          continue;
        }
        const groups = ctx.groupsByIcao.get(icao);
        if (groups && !groups.has(spec.runwayGroup)) {
          add(
            file,
            'panel-side-group-exists',
            `panel "${panel.id}" of "${view.id}" ${which} side names runway group "${spec.runwayGroup}", which ${icao} does not declare`,
          );
        }
      }

      if (panel.colors && Object.values(panel.colors).some((c) => c.by === 'iaf')) {
        const needed = panel.filter?.iafs ?? [...ctx.knownIafs];
        for (const iaf of needed) {
          if (!ctx.iafColors.has(iaf)) {
            add(
              file,
              'view-iaf-colour-declared',
              `panel "${panel.id}" of "${view.id}" colours by IAF but the manifest declares no colour for "${iaf}"`,
            );
          }
        }
      }
    }
  }
  return issues;
}

/**
 * Cross-reference rules for a TMA and its views.
 *
 * A TMA names airport CONFIG ids and owns no configurations, callsigns or
 * sequencer — it is a read-only window onto facilities that own all of that.
 *
 * @param {{path: string, content: any, views: {path: string, content: any}[]}} tma
 * @param {Map<string, any>} airportsById  keyed by config id (lowercase)
 * @param {Set<string>} iafColors  fix names the manifest gives a colour
 * @returns {import('../types/index.js').ConfigIssue[]}
 */
function lintTma(tma, airportsById, iafColors) {
  const config = tma.content;
  /** @type {import('../types/index.js').ConfigIssue[]} */
  const issues = [];
  const add = (rule, message) => issues.push({ file: tma.path, rule, message });

  const dirName = tma.path.split('/')[1];
  if (dirName !== config.id) {
    add('tma-id-matches-directory', `directory is "${dirName}" but "id" is "${config.id}"`);
  }

  const covered = [];
  for (const id of config.airports) {
    const airport = airportsById.get(String(id).toLowerCase());
    if (!airport) {
      add('tma-airport-exists', `watches airport config "${id}", which the bundle does not contain`);
      continue;
    }
    covered.push(airport);
  }

  const knownIafs = new Set();
  const coveredIcaos = new Set();
  const groupsByIcao = new Map();
  for (const airport of covered) {
    for (const t of airport.transitions) knownIafs.add(t.iaf);
    const groups = new Set(airport.runways.map((r) => r.group));
    for (const icao of airport.coveredIcaos ?? [airport.icao]) {
      coveredIcaos.add(String(icao).toUpperCase());
      groupsByIcao.set(String(icao).toUpperCase(), groups);
    }
  }

  const viewsById = new Map(tma.views.map((v) => [v.content.id, v]));
  for (const id of config.views) {
    if (!viewsById.has(id)) add('tma-view-exists', `lists view "${id}", which has no file under views/`);
  }
  for (const view of tma.views) {
    if (!config.views.includes(view.content.id)) {
      issues.push({
        file: view.path,
        rule: 'view-listed-by-tma',
        message: `view "${view.content.id}" is not listed in the TMA's views`,
      });
    }
    const stem = (view.path.split('/').pop() ?? '').replace(/\.json$/i, '');
    if (stem !== view.content.id) {
      issues.push({
        file: view.path,
        rule: 'view-id-matches-filename',
        message: `filename implies "${stem}" but "id" is "${view.content.id}"`,
      });
    }
  }

  issues.push(
    ...lintViews(
      tma.views.map((v) => ({ file: v.path, content: v.content })),
      { knownIafs, groupsByIcao, coveredIcaos, iafColors },
    ),
  );
  return issues;
}

module.exports.lintTma = lintTma;
module.exports.lintViews = lintViews;
