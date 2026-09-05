import { describe, expect, it } from 'vitest';
import { readBundleDir } from '../src/load.js';
import { validateBundle } from '../src/bundle.js';
import { BUNDLE_ROOT } from './helpers.js';

/** Read the real bundle, apply a mutation, and return the rule ids raised. */
async function rulesAfter(mutate) {
  const read = await readBundleDir(BUNDLE_ROOT);
  expect(read.ok).toBe(true);
  if (!read.ok) return [];
  mutate(read.bundle);
  const result = validateBundle(read.bundle);
  return result.ok ? [] : [...new Set(result.issues.map((i) => i.rule))];
}

const paris = (bundle) => bundle.tmas.find((t) => t.content.id === 'paris');
const view = (bundle, id) => paris(bundle).views.find((v) => v.content.id === id);

describe('the Paris TMA as committed', () => {
  it('validates, with every view the TMA lists', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = validateBundle(read.bundle);
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (!result.ok) return;

    const tma = result.bundle.tmas.get('paris');
    expect(tma).toBeDefined();
    expect(tma.airports).toEqual(['LFPG']);
    // Tab order on screen: what the TMA declares, never the directory listing.
    expect(tma.views.map((v) => v.id)).toEqual([
      'RWY',
      '40Min',
      'PAR',
      'RPAW',
      'RPAE',
      'APTE',
      'ORGY',
      'HPKZ',
    ]);
  });

  it('keeps the two approach views on the runway-columns layout', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const id of ['RWY', '40Min']) {
      const v = view(read.bundle, id);
      expect(v.content.panels).toHaveLength(1);
      expect(v.content.panels[0].layout).toBe('runway-columns');
      expect(v.content.panels[0].interactive).toBe(true);
      // Runway timelines stay referenced to the threshold.
      expect(v.content.panels[0].timeReference).toBeUndefined();
    }
  });

  // Sides are declared by runway GROUP so a view survives the platform turning
  // west to east — PG_W and PG_E activate different ids but the same groups.
  it('declares en-route panel sides by runway group, never by runway id', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const id of ['PAR', 'RPAW', 'RPAE', 'APTE', 'ORGY', 'HPKZ']) {
      for (const panel of view(read.bundle, id).content.panels) {
        expect(panel.layout).toBe('dual-sided');
        expect(panel.sides.left).toEqual({ icao: 'LFPG', runwayGroup: 'sud' });
        expect(panel.sides.right).toEqual({ icao: 'LFPG', runwayGroup: 'nord' });
        expect(panel.interactive).toBe(false);
      }
    }
  });

  it('gives each sector view its own IAF filter', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const filterOf = (id) => view(read.bundle, id).content.panels[0].filter.iafs;
    expect(filterOf('RPAW')).toEqual(['MOPAR', 'BANOX', 'LORNI']);
    expect(filterOf('RPAE')).toEqual(['OKIPA']);
    expect(filterOf('APTE')).toEqual(['LORNI']);
    expect(filterOf('ORGY')).toEqual(['BANOX']);
    expect(filterOf('HPKZ')).toEqual(['MOPAR']);
    // PAR shows everything, so it has no filter and no second awareness ladder.
    expect(view(read.bundle, 'PAR').content.panels[0].filter).toEqual({});
    expect(view(read.bundle, 'PAR').content.panels).toHaveLength(1);
  });

  it('pairs every filtered sector view with an IAF-coloured awareness ladder', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const id of ['RPAW', 'RPAE', 'APTE', 'ORGY', 'HPKZ']) {
      const panels = view(read.bundle, id).content.panels;
      expect(panels.map((p) => p.id)).toEqual(['sector', 'awareness']);
      // An IAF timeline: flights sit at their IAF passage time, and that is
      // the time the sector ladder shows.
      expect(panels[0].timeReference).toBe('iaf');
      expect(panels[1].timeReference).toBe('iaf');
      expect(panels[0].fields).toEqual(['dc', 'callsign', 'sta_iaf']);
      // The awareness ladder carries the en-route delay too, next to the
      // callsign — controllers read it on both.
      expect(panels[1].fields).toEqual(['dc', 'callsign']);
      expect(panels[1].colors.callsign.by).toBe('iaf');
      expect(panels[1].filter).toEqual({});
    }
  });
});

describe('TMA and view cross-reference rules', () => {
  it('rejects a filter naming a fix no covered airport declares', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'ORGY').content.panels[0].filter.iafs = ['BANOKS'];
      }),
    ).toContain('view-filter-iaf-exists');
  });

  it('rejects a panel side naming an undeclared runway group', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'ORGY').content.panels[0].sides.left.runwayGroup = 'est';
      }),
    ).toContain('panel-side-group-exists');
  });

  it('rejects colouring by IAF without a declared colour for it', async () => {
    expect(
      await rulesAfter((b) => {
        delete paris(b).content.iafs.BANOX;
      }),
    ).toContain('view-iaf-colour-declared');
  });

  it('rejects a view file the TMA does not list', async () => {
    expect(
      await rulesAfter((b) => {
        paris(b).content.views = paris(b).content.views.filter((v) => v !== 'ORGY');
      }),
    ).toContain('view-listed-by-tma');
  });

  it('rejects a listed view with no file', async () => {
    expect(
      await rulesAfter((b) => {
        paris(b).content.views.push('GHOST');
      }),
    ).toContain('tma-view-exists');
  });

  it('rejects a configuration mapping an airport to a template it lacks', async () => {
    expect(
      await rulesAfter((b) => {
        paris(b).content.configurations[0].airports.LFPG = 'PG_NORTH';
      }),
    ).toContain('tma-configuration-template-exists');
  });

  it('rejects a TMA naming an airport the bundle lacks', async () => {
    expect(
      await rulesAfter((b) => {
        paris(b).content.airports.push('LFPB');
      }),
    ).toContain('tma-airport-exists');
  });

  it('rejects a configuration that skips a declared airport', async () => {
    expect(
      await rulesAfter((b) => {
        // Needs a second airport: removing the only mapping leaves an empty
        // object, which the schema's minProperties rejects before linting.
        const tma = paris(b).content;
        tma.airports.push('LFPO');
        for (const c of tma.configurations) c.airports.LFPO = 'PO_W';
        delete tma.configurations[0].airports.LFPG;
      }),
    ).toContain('tma-configuration-covers-airports');
  });

  it('rejects an entirely empty configuration mapping', async () => {
    expect(
      await rulesAfter((b) => {
        delete paris(b).content.configurations[0].airports.LFPG;
      }),
    ).toContain('schema');
  });

  it('rejects a view id that disagrees with its filename', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'ORGY').content.id = 'ORGYY';
      }),
    ).toContain('view-id-matches-filename');
  });

  // The desequenced tab is a fixed part of the interface, never a view.
  it('rejects a view claiming the reserved desequenced id', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'ORGY').content.id = 'DESEQUENCED';
      }),
    ).toContain('view-id-reserved');
  });

  it('rejects a dual-sided panel with no sides', async () => {
    expect(
      await rulesAfter((b) => {
        delete view(b, 'ORGY').content.panels[0].sides;
      }),
    ).toContain('schema');
  });

  it('rejects a runway-columns panel that declares sides', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'RWY').content.panels[0].sides = {
          left: { icao: 'LFPG', runwayGroup: 'sud' },
          right: { icao: 'LFPG', runwayGroup: 'nord' },
        };
      }),
    ).toContain('schema');
  });

  it('rejects an unknown field id', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'ORGY').content.panels[0].fields = ['dc', 'squawk'];
      }),
    ).toContain('schema');
  });

  it('rejects an unknown colour source', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'ORGY').content.panels[0].colors.callsign.by = 'squawk';
      }),
    ).toContain('schema');
  });
});
