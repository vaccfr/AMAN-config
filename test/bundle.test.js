import { describe, expect, it } from 'vitest';
import { validateBundle } from '../src/bundle.js';
import { readBundleDir } from '../src/load.js';
import { SCHEMA_VERSION } from '../src/version.js';
import { BUNDLE_ROOT, asFile, minimalAirport } from './helpers.js';

function bundleOf(...airports) {
  return { manifest: { schemaVersion: SCHEMA_VERSION }, airports: airports.map((a) => asFile(a)) };
}

describe('validateBundle', () => {
  it('adopts this repository read from disk', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = validateBundle(read.bundle);
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (!result.ok) return;
    expect(result.bundle.airports.size).toBeGreaterThan(0);
    expect(result.bundle.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keys airports by uppercase ICAO and defaults accessCallsigns', () => {
    const config = minimalAirport();
    delete config.accessCallsigns;
    const result = validateBundle(bundleOf(config));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.airports.get('LFXX').accessCallsigns).toEqual([]);
  });

  // The core guarantee: validation is all-or-nothing, so a caller can never
  // adopt an airport whose cross-references point into a file that failed.
  it('rejects the whole bundle when a single file is invalid', () => {
    const good = minimalAirport();
    const bad = minimalAirport();
    bad.icao = 'LFYY';
    bad.coveredIcaos = ['LFYY'];
    bad.configurations[0].activeRunways = ['26L'];

    const result = validateBundle(bundleOf(good, bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.rule)).toEqual(['active-runways-resolve']);
    expect(result.issues[0].file).toBe('airports/lfyy.json');
  });

  it('rejects a bundle declaring an unsupported schema version', () => {
    const raw = bundleOf(minimalAirport());
    raw.manifest = { schemaVersion: SCHEMA_VERSION + 1 };
    const result = validateBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.rule)).toEqual(['schema-version']);
  });

  it('rejects a malformed manifest before looking at any airport', () => {
    const raw = bundleOf(minimalAirport());
    raw.manifest = {};
    const result = validateBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.file)).toEqual(['manifest.json']);
  });

  it('rejects a bundle declaring no airports', () => {
    const result = validateBundle({ manifest: { schemaVersion: SCHEMA_VERSION }, airports: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.rule)).toEqual(['empty-bundle']);
  });

  it('rejects two files declaring the same ICAO', () => {
    const raw = bundleOf(minimalAirport());
    raw.airports.push({ path: 'airports/copy.json', content: minimalAirport() });
    const result = validateBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.rule)).toContain('filename-icao-match');
  });
});

describe('readBundleDir', () => {
  it('reports a missing manifest without throwing', async () => {
    const read = await readBundleDir('/nonexistent/aman-config');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.issues.map((i) => ({ file: i.file, rule: i.rule }))).toEqual([
      { file: 'manifest.json', rule: 'unreadable' },
    ]);
  });
});
