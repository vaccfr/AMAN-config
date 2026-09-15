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

  describe('alternate runways', () => {
    /** 27 lands, 26 departs beside it, 25 is a third runway to pair wrongly. */
    function paired() {
      const config = minimalAirport();
      config.runways.push(
        { id: '26', qfu: 266, group: 'main', defaultThroughput: 90 },
        { id: '25', qfu: 256, group: 'other', defaultThroughput: 90 },
      );
      config.configurations[0].alternateRunways = { 27: '26' };
      return config;
    }

    it('accepts an active runway paired with an inactive one', () => {
      expect(rules(paired())).toEqual([]);
    });

    it('rejects an alternate for a runway the configuration does not activate', () => {
      const config = paired();
      config.configurations[0].alternateRunways = { 25: '26' };
      const issues = lintAirportConfig(asFile(config));
      expect(issues.map((i) => i.rule)).toEqual(['alternate-runway-key-active']);
      expect(issues[0].message).toContain('XX_W');
      expect(issues[0].message).toContain('"25"');
    });

    it('rejects an alternate the airport does not declare', () => {
      const config = paired();
      config.configurations[0].alternateRunways = { 27: '26X' };
      const issues = lintAirportConfig(asFile(config));
      expect(issues.map((i) => i.rule)).toEqual(['alternate-runway-resolves']);
      expect(issues[0].message).toContain('26X');
    });

    it('rejects an alternate the configuration also activates', () => {
      const config = paired();
      config.configurations[0].activeRunways = ['27', '25'];
      config.configurations[0].alternateRunways = { 27: '25' };
      const issues = lintAirportConfig(asFile(config));
      expect(issues.map((i) => i.rule)).toEqual(['alternate-runway-inactive']);
      expect(issues[0].message).toContain('"25"');
    });

    it('rejects two runways sharing one alternate', () => {
      const config = paired();
      config.configurations[0].activeRunways = ['27', '25'];
      config.configurations[0].alternateRunways = { 27: '26', 25: '26' };
      const issues = lintAirportConfig(asFile(config));
      expect(issues.map((i) => i.rule)).toEqual(['alternate-runway-unique']);
      expect(issues[0].message).toContain('"25"');
      expect(issues[0].message).toContain('"27"');
    });

    it('accepts the same alternate in two configurations', () => {
      const config = paired();
      config.configurations.push({
        id: 'XX_S',
        name: 'South',
        activeRunways: ['25'],
        activeTransitions: ['ALPHA1W'],
        alternateRunways: { 25: '26' },
      });
      expect(rules(config)).toEqual([]);
    });
  });

  it('rejects a configuration activating two runways of one group', () => {
    const config = minimalAirport();
    config.runways.push({ id: '26', qfu: 266, group: 'main', defaultThroughput: 90 });
    config.configurations[0].activeRunways = ['27', '26'];
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['active-runways-distinct-groups']);
    expect(issues[0].message).toContain('XX_W');
    expect(issues[0].message).toContain('"27"');
    expect(issues[0].message).toContain('"26"');
    expect(issues[0].message).toContain('"main"');
  });

  it('accepts runways of one group activated by different configurations', () => {
    const config = minimalAirport();
    config.runways.push({ id: '09', qfu: 86, group: 'main', defaultThroughput: 90 });
    config.transitions[0].availableRunways = ['27', '09'];
    config.configurations.push({
      id: 'XX_E',
      name: 'East',
      activeRunways: ['09'],
      activeTransitions: ['ALPHA1W'],
    });
    expect(rules(config)).toEqual([]);
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

describe('cross-reference linter — runwayApproachDeltaSec', () => {
  it('accepts a correction for a runway the transition serves', () => {
    const config = minimalAirport();
    config.transitions[0].runwayApproachDeltaSec = { 27: 60 };
    expect(rules(config)).toEqual([]);
  });

  it('accepts a correction for a runway reached through a group entry', () => {
    const config = minimalAirport();
    config.transitions[0].availableRunways = ['main'];
    // preferred-runway-available matches availableRunways literally and does
    // not resolve groups, so this test keeps it out of the way.
    config.transitions[0].preferredRunway = null;
    config.transitions[0].runwayApproachDeltaSec = { 27: 60 };
    expect(rules(config)).toEqual([]);
  });

  it('rejects a correction for a runway the transition does not serve', () => {
    const config = minimalAirport();
    config.runways.push({ id: '09', qfu: 86, group: 'other', defaultThroughput: 90 });
    config.transitions[0].runwayApproachDeltaSec = { '09': 60 };
    const issues = lintAirportConfig(asFile(config));
    expect(issues.map((i) => i.rule)).toEqual(['approach-delta-runway-served']);
    expect(issues[0].message).toContain('ALPHA1W');
    expect(issues[0].message).toContain('09');
  });

  it('rejects a negative correction that cancels the approach time', () => {
    const config = minimalAirport();
    config.transitions[0].runwayApproachDeltaSec = { 27: -600 };
    const issues = lintAirportConfig(asFile(config));
    // One issue per wake category, since each is a separately wrong number.
    expect(issues.map((i) => i.rule)).toEqual([
      'approach-delta-keeps-time-positive',
      'approach-delta-keeps-time-positive',
      'approach-delta-keeps-time-positive',
    ]);
    expect(issues[0].message).toContain('HEAVY');
  });

  it('accepts a negative correction that leaves the approach time positive', () => {
    const config = minimalAirport();
    config.transitions[0].runwayApproachDeltaSec = { 27: -599 };
    expect(rules(config)).toEqual([]);
  });

  it('does not check the floor for a runway the transition does not serve', () => {
    const config = minimalAirport();
    config.runways.push({ id: '09', qfu: 86, group: 'other', defaultThroughput: 90 });
    config.transitions[0].runwayApproachDeltaSec = { '09': -9000 };
    expect(rules(config)).toEqual(['approach-delta-runway-served']);
  });
});
