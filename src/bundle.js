'use strict';

// ajv's 2020 entry sets `module.exports = Ajv2020` and also `.default`. Use
// `.default` so both the runtime and TypeScript see a constructable class.
const Ajv2020 = require('ajv/dist/2020.js').default;
const { airportConfigSchema, manifestSchema, tmaSchema, viewSchema } = require('./schema.js');
const { lintAirportConfig, lintTma } = require('./lint.js');
const { SCHEMA_VERSION } = require('./version.js');

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateManifest = ajv.compile(manifestSchema);
const validateAirport = ajv.compile(airportConfigSchema);
const validateTma = ajv.compile(tmaSchema);
const validateView = ajv.compile(viewSchema);

/** Render one ajv error as a message naming the offending path. */
function formatAjvError(error) {
  const at = error.instancePath === '' ? 'the document root' : error.instancePath;
  const extra =
    error.keyword === 'additionalProperties'
      ? ` ("${String(error.params.additionalProperty)}")`
      : '';
  return `${at} ${error.message ?? 'failed validation'}${extra}`;
}

function schemaIssues(path, validate, content) {
  if (validate(content)) return [];
  return (validate.errors ?? []).map((error) => ({
    file: path,
    rule: 'schema',
    message: formatAjvError(error),
  }));
}

/**
 * Validate one airport file: schema first, then cross-references.
 * @param {import('../types/index.js').RawConfigFile} file
 * @returns {import('../types/index.js').ConfigIssue[]}
 */
function validateAirportFile(file) {
  const issues = schemaIssues(file.path, validateAirport, file.content);
  // Linting reads fields directly and assumes the shape is correct, so it only
  // runs once the schema has confirmed it.
  if (issues.length > 0) return issues;
  return lintAirportConfig(file);
}

/**
 * Validate a whole bundle, all-or-nothing.
 *
 * Validation is deliberately not per-file: a per-file result would let the
 * caller adopt an airport whose cross-references point into a file that failed,
 * so any issue anywhere rejects the entire bundle. The caller keeps whatever it
 * had loaded before.
 *
 * @param {import('../types/index.js').RawBundle} raw
 * @returns {import('../types/index.js').ValidationResult}
 */
function validateBundle(raw) {
  const issues = schemaIssues('manifest.json', validateManifest, raw.manifest);
  if (issues.length > 0) return { ok: false, issues };

  const schemaVersion = /** @type {{ schemaVersion: number }} */ (raw.manifest).schemaVersion;
  if (schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          file: 'manifest.json',
          rule: 'schema-version',
          message: `bundle declares schemaVersion ${schemaVersion}, but this validator supports ${SCHEMA_VERSION}`,
        },
      ],
    };
  }

  if (raw.airports.length === 0) {
    return {
      ok: false,
      issues: [
        { file: 'airports/', rule: 'empty-bundle', message: 'the bundle declares no airports' },
      ],
    };
  }

  for (const file of raw.airports) issues.push(...validateAirportFile(file));
  if (issues.length > 0) return { ok: false, issues };

  const airports = new Map();
  for (const file of raw.airports) {
    const config = /** @type {any} */ (file.content);
    const icao = String(config.icao).toUpperCase();
    if (airports.has(icao)) {
      issues.push({
        file: file.path,
        rule: 'duplicate-icao',
        message: `ICAO "${icao}" is declared by more than one file in the bundle`,
      });
      continue;
    }
    // Normalise on the way in: uppercase key, and `accessCallsigns` defaulted
    // to [] when omitted, matching what the API relies on.
    airports.set(icao, { ...config, icao, accessCallsigns: config.accessCallsigns ?? [] });
  }
  if (issues.length > 0) return { ok: false, issues };

  // ── TMAs and views ───────────────────────────────────────────────────────
  // Additive: a bundle with no tmas/ directory is valid, so this landed and was
  // reviewed before anything rendered it.
  const tmas = new Map();
  for (const tma of raw.tmas ?? []) {
    const shape = [
      ...schemaIssues(tma.path, validateTma, tma.content),
      ...tma.views.flatMap((v) => schemaIssues(v.path, validateView, v.content)),
    ];
    if (shape.length > 0) {
      issues.push(...shape);
      continue;
    }
    issues.push(...lintTma(tma, airports));
    if (issues.length === 0) {
      // Shape is confirmed by the schema above; narrow for the checker.
      const content = /** @type {import('../types/index.js').TmaConfig} */ (tma.content);
      const id = content.id;
      if (tmas.has(id)) {
        issues.push({
          file: tma.path,
          rule: 'duplicate-tma-id',
          message: `TMA id "${id}" is declared more than once`,
        });
        continue;
      }
      tmas.set(id, {
        ...content,
        views: tma.views.map((v) => v.content),
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, bundle: { schemaVersion, airports, tmas } };
}

module.exports = { validateAirportFile, validateBundle };
