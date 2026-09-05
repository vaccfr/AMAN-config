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

const tma = (bundle, tid) => bundle.tmas.find((t) => t.content.id === tid);
const view = (bundle, tid, id) => tma(bundle, tid).views.find((v) => v.content.id === id);

describe('the Paris TMAs as committed', () => {
  it('validates, splitting the approach positions from the en-route ones', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = validateBundle(read.bundle);
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (!result.ok) return;

    // Each is its own URL: /lfpg and /lfpo are the interactive approach
    // positions, /par the en-route ones shared by both.
    expect([...result.bundle.tmas.keys()].sort()).toEqual(['lfpg', 'lfpo', 'par']);
    expect(result.bundle.tmas.get('lfpg').airports).toEqual(['LFPG']);
    expect(result.bundle.tmas.get('lfpo').airports).toEqual(['LFPO']);
    expect(result.bundle.tmas.get('par').airports).toEqual(['LFPG', 'LFPO']);
  });

  it('gives each approach position the interactive runway timeline', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const tid of ['lfpg', 'lfpo']) {
      const t = tma(read.bundle, tid);
      expect(t.content.views).toEqual(['RWY', '40Min']);
      for (const v of t.views) {
        expect(v.content.panels).toHaveLength(1);
        expect(v.content.panels[0].layout).toBe('runway-columns');
        expect(v.content.panels[0].interactive).toBe(true);
      }
    }
  });

  it('lists the en-route sectors on /par', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    expect(tma(read.bundle, 'par').content.views).toEqual([
      'RT',
      'TE',
      'TP',
      'AR',
      'OPKZ',
      'RPAW',
      'PG_PO_PB',
    ]);
  });

  it('gives each sector view its own IAF filter', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const filterOf = (id) => view(read.bundle, 'par', id).content.panels[0].filter.iafs;
    expect(filterOf('RT')).toEqual(['BANOX']);
    expect(filterOf('TE')).toEqual(['LORNI']);
    expect(filterOf('TP')).toEqual(['MOPAR']);
    expect(filterOf('AR')).toEqual(['OKIPA']);
    expect(filterOf('OPKZ')).toEqual(['BANOX', 'MOPAR']);
    expect(filterOf('RPAW')).toEqual(['BANOX', 'MOPAR', 'LORNI']);
  });

  // The sector ladder is an IAF timeline; the awareness ladder beside it is a
  // RUNWAY timeline — landing slots, no IAF letter, callsigns by fix colour.
  it('pairs an IAF sector ladder with a runway awareness ladder', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const id of ['RT', 'TE', 'TP', 'AR', 'OPKZ', 'RPAW']) {
      const [sector, awareness] = view(read.bundle, 'par', id).content.panels;
      expect(sector.timeReference).toBe('iaf');
      expect(awareness.timeReference).toBe('threshold');
      expect(awareness.fields).toEqual(['dc', 'callsign']);
      expect(awareness.fields).not.toContain('iaf');
      expect(awareness.colors.callsign.by).toBe('iaf');
      expect(awareness.filter).toEqual({});
    }
  });

  it('carries the IAF letter only where several IAFs can appear', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const sectorOf = (id) => view(read.bundle, 'par', id).content.panels[0];
    for (const id of ['RT', 'TE', 'TP', 'AR']) {
      expect(sectorOf(id).fields).toEqual(['dc', 'callsign', 'sta_iaf']);
    }
    for (const id of ['OPKZ', 'RPAW']) {
      expect(sectorOf(id).fields).toEqual(['dc', 'iaf', 'callsign', 'sta_iaf']);
      expect(sectorOf(id).colors.iaf.by).toBe('iaf');
    }
  });

  // The approach positions and the en-route page link to each other, so a
  // controller can move between them without editing the URL.
  it('cross-links the approach positions and the en-route page', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    expect(tma(read.bundle, 'lfpg').content.links).toEqual(['par']);
    expect(tma(read.bundle, 'lfpo').content.links).toEqual(['par']);
    expect(tma(read.bundle, 'par').content.links).toEqual(['lfpg', 'lfpo']);
  });

  it('gives the Paris group view one ladder per airport', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const panels = view(read.bundle, 'par', 'PG_PO_PB').content.panels;
    expect(panels.map((p) => p.id)).toEqual(['lfpg', 'lfpo']);
    expect(panels[0].sides.left.icao).toBe('LFPG');
    expect(panels[1].sides.left.icao).toBe('LFPO');
    // Orly groups its runways east/west, not north/south.
    expect(panels[1].sides.left.runwayGroup).toBe('ouest');
  });

  // Sides name a GROUP so a view survives the platform turning west to east.
  it('declares panel sides by runway group, never by runway id', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const v of tma(read.bundle, 'par').views) {
      for (const panel of v.content.panels) {
        expect(panel.sides.left.runwayGroup).toBeTruthy();
        expect(panel.interactive).toBe(false);
      }
    }
  });
});

describe('TMA and view cross-reference rules', () => {
  it('rejects a filter naming a fix no covered airport declares', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].filter.iafs = ['BANOKS'];
      }),
    ).toContain('view-filter-iaf-exists');
  });

  it('rejects a panel side naming an undeclared runway group', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].sides.left.runwayGroup = 'est';
      }),
    ).toContain('panel-side-group-exists');
  });

  it('rejects colouring by IAF without a declared colour for it', async () => {
    expect(
      await rulesAfter((b) => {
        delete tma(b, 'par').content.iafs.BANOX;
      }),
    ).toContain('view-iaf-colour-declared');
  });

  it('rejects a view file the TMA does not list', async () => {
    expect(
      await rulesAfter((b) => {
        const t = tma(b, 'par').content;
        t.views = t.views.filter((v) => v !== 'RT');
      }),
    ).toContain('view-listed-by-tma');
  });

  it('rejects a listed view with no file', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.views.push('GHOST');
      }),
    ).toContain('tma-view-exists');
  });

  it('rejects a configuration mapping an airport to a template it lacks', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.configurations[0].airports.LFPG = 'PG_NORTH';
      }),
    ).toContain('tma-configuration-template-exists');
  });

  it('rejects a TMA naming an airport the bundle lacks', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.airports.push('LFPB');
      }),
    ).toContain('tma-airport-exists');
  });

  it('rejects a configuration that skips a declared airport', async () => {
    expect(
      await rulesAfter((b) => {
        delete tma(b, 'par').content.configurations[0].airports.LFPG;
      }),
    ).toContain('tma-configuration-covers-airports');
  });

  it('rejects an entirely empty configuration mapping', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.configurations[0].airports = {};
      }),
    ).toContain('schema');
  });

  it('rejects a view id that disagrees with its filename', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.id = 'RTT';
      }),
    ).toContain('view-id-matches-filename');
  });

  // The desequenced tab is a fixed part of the interface, never a view.
  it('rejects a view claiming the reserved desequenced id', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.id = 'DESEQUENCED';
      }),
    ).toContain('view-id-reserved');
  });

  it('rejects a dual-sided panel with no sides', async () => {
    expect(
      await rulesAfter((b) => {
        delete view(b, 'par', 'RT').content.panels[0].sides;
      }),
    ).toContain('schema');
  });

  it('rejects a runway-columns panel that declares sides', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'lfpg', 'RWY').content.panels[0].sides = {
          left: { icao: 'LFPG', runwayGroup: 'sud' },
          right: { icao: 'LFPG', runwayGroup: 'nord' },
        };
      }),
    ).toContain('schema');
  });

  it('rejects an unknown field id', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].fields = ['dc', 'squawk'];
      }),
    ).toContain('schema');
  });

  it('rejects a link to a TMA the bundle does not contain', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.links.push('nice');
      }),
    ).toContain('tma-link-exists');
  });

  it('rejects a TMA linking to itself', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.links.push('par');
      }),
    ).toContain('tma-link-self');
  });

  it('rejects an unknown colour source', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].colors.callsign.by = 'squawk';
      }),
    ).toContain('schema');
  });
});
