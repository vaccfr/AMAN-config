import { describe, expect, it } from 'vitest';
import { lintAirportConfig } from '../src/lint.js';
import { validateAirportFile } from '../src/bundle.js';
import { asFile, minimalAirport } from './helpers.js';

/** Rule ids raised for a config, so each test pins a rule rather than a message. */
function rules(config, filename) {
  return lintAirportConfig(asFile(config, filename)).map((issue) => issue.rule);
}

describe('cross-reference linter', () => {
  it('passes a consistent configuration', () => {
    expect(lintAirportConfig(asFile(minimalAirport()))).toEqual([]);
  });

  it('rejects a filename that disagrees with the icao field', () => {
    const config = minimalAirport();
    config.icao = 'LFPO';
    const issues = lintAirportConfig(asFile(config, 'lfpg.json'));
    expect(issues.map((i) => i.rule)).toEqual(['filename-icao-match']);
    expect(issues[0].message).toContain('LFPG');
    expect(issues[0].message).toContain('LFPO');
  });

  it('accepts a filename differing only in case', () => {
    expect(rules(minimalAirport(), 'LFXX.json')).toEqual([]);
  });

  it('rejects a preferred runway the transition may not use', () => {
    const config = minimalAirport();
    config.runways.push({ id: '09', qfu: 86, group: 'main', defaultThroughput: 90 });
    config.transitions[0].preferredRunway = '09';
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['preferred-runway-available']);
    expect(issues[0].message).toContain('ALPHA1W');
  });

  it('accepts a null preferred runway', () => {
    const config = minimalAirport();
    config.transitions[0].preferredRunway = null;
    expect(rules(config)).toEqual([]);
  });

  it('rejects an available runway that resolves to nothing', () => {
    const config = minimalAirport();
    config.transitions[0].availableRunways = ['26L'];
    config.transitions[0].preferredRunway = null;
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['available-runways-resolve']);
    expect(issues[0].message).toContain('26L');
  });

  it('accepts an available runway naming a runway group', () => {
    const config = minimalAirport();
    config.transitions[0].availableRunways = ['main'];
    config.transitions[0].preferredRunway = null;
    expect(rules(config)).toEqual([]);
  });

  it('rejects a configuration activating an undeclared runway', () => {
    const config = minimalAirport();
    config.configurations[0].activeRunways = ['26L'];
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['active-runways-resolve']);
    expect(issues[0].message).toContain('XX_W');
  });

  it('rejects a configuration activating an undeclared transition', () => {
    const config = minimalAirport();
    config.configurations[0].activeTransitions = ['BRAVO1W'];
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['active-transitions-resolve']);
    expect(issues[0].message).toContain('BRAVO1W');
  });

  it('rejects a duplicated runway id', () => {
    const config = minimalAirport();
    config.runways.push({ id: '27', qfu: 266, group: 'main', defaultThroughput: 90 });
    expect(rules(config)).toEqual(['duplicate-runway-id']);
  });

  it('rejects a duplicated transition name', () => {
    const config = minimalAirport();
    config.transitions.push({ ...config.transitions[0] });
    expect(rules(config)).toEqual(['duplicate-transition-name']);
  });

  // The schema also catches this, so `validateAirportFile` never reaches the
  // lint rule. It is duplicated because the runtime failure it guards is
  // silent — a flight simply never arms IAF-crossing detection.
  it('rejects IAF coordinates out of range', () => {
    const config = minimalAirport();
    config.transitions[0].iafCoords = { lat: 200, lon: 2.5 };
    expect(rules(config)).toEqual(['iaf-coords-valid']);
    expect(validateAirportFile(asFile(config))[0].rule).toBe('schema');
  });

  it('rejects an IAF implausibly far from the ARP', () => {
    const config = minimalAirport();
    config.transitions[0].iafCoords = { lat: 40.0, lon: 2.0 }; // ~480 NM south
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['iaf-near-arp']);
    expect(issues[0].message).toContain('ALPHA1W');
  });

  it('rejects an IAF sitting effectively on the ARP', () => {
    const config = minimalAirport();
    config.transitions[0].iafCoords = { lat: 48.01, lon: 2.01 };
    expect(rules(config)).toEqual(['iaf-near-arp']);
  });

  it('accepts an IAF inside the terminal-area band', () => {
    const config = minimalAirport();
    config.transitions[0].iafCoords = { lat: 48.5, lon: 2.5 };
    expect(rules(config)).toEqual([]);
  });

  it('rejects absent IAF coordinates', () => {
    const config = minimalAirport();
    delete config.transitions[0].iafCoords;
    expect(lintAirportConfig(asFile(config)).map((i) => i.rule)).toEqual(['iaf-coords-valid']);
  });
});
