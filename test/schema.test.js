import { describe, expect, it } from 'vitest';
import { readBundleDir } from '../src/load.js';
import { validateAirportFile } from '../src/bundle.js';
import { BUNDLE_ROOT, asFile, minimalAirport } from './helpers.js';

describe('airport schema — the live bundle', () => {
  // The configuration in this repository IS the regression corpus: whatever
  // else the schema tightens, everything currently in service must keep
  // validating.
  it('accepts every airport configuration in this repository', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.bundle.airports.length).toBeGreaterThan(0);
    for (const file of read.bundle.airports) {
      expect({ file: file.path, issues: validateAirportFile(file) }).toEqual({
        file: file.path,
        issues: [],
      });
    }
  });
});

describe('airport schema — shape', () => {
  it('accepts the minimal configuration', () => {
    expect(validateAirportFile(asFile(minimalAirport()))).toEqual([]);
  });

  it('rejects a missing required field', () => {
    const config = minimalAirport();
    delete config.arp;
    const issues = validateAirportFile(asFile(config));
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('schema');
    expect(issues[0].message).toContain('arp');
  });

  it('rejects a field of the wrong type', () => {
    const config = minimalAirport();
    config.arp.lat = '48.0';
    const issues = validateAirportFile(asFile(config));
    expect(issues[0].rule).toBe('schema');
    expect(issues[0].message).toContain('/arp/lat');
  });

  it('rejects a latitude outside its range', () => {
    const config = minimalAirport();
    config.arp.lat = 91;
    const issues = validateAirportFile(asFile(config));
    expect(issues[0].rule).toBe('schema');
    expect(issues[0].message).toContain('/arp/lat');
  });

  it('rejects an unknown property, which is how a typo surfaces', () => {
    const config = minimalAirport();
    config.transitions[0].preferedRunway = '27';
    const issues = validateAirportFile(asFile(config));
    expect(issues[0].rule).toBe('schema');
    expect(issues[0].message).toContain('preferedRunway');
  });

  it('rejects an unknown strategy', () => {
    const config = minimalAirport();
    config.strategies[0] = 'NEAREST';
    const issues = validateAirportFile(asFile(config));
    expect(issues[0].rule).toBe('schema');
    expect(issues[0].message).toContain('/strategies/0');
  });

  it('does not require accessCallsigns, which is documented as optional', () => {
    const config = minimalAirport();
    delete config.accessCallsigns;
    expect(validateAirportFile(asFile(config))).toEqual([]);
  });
});
