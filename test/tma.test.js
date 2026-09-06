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
const airport = (bundle, id) => bundle.airports.find((a) => a.path.endsWith(`/${id}.json`));
const view = (bundle, tid, id) => tma(bundle, tid).views.find((v) => v.content.id === id);

describe('the two kinds of page', () => {
  it('validates, with approach views on the facility and en-route views on the TMA', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = validateBundle(read.bundle);
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (!result.ok) return;

    // A facility owns its own approach views.
    for (const id of ['lfpg', 'lfpo', 'lfbo', 'lfmn']) {
      const airport = result.bundle.airportsById.get(id);
      expect(airport).toBeDefined();
      expect(airport.views.map((v) => v.id)).toEqual(['RWY', '40Min']);
    }

    // The en-route page watches facilities by CONFIG ID, not by aerodrome.
    const par = result.bundle.tmas.get('par');
    expect(par.airports).toEqual(['lfpg', 'lfpo']);
  });

  // Interactivity is a property of the kind, not something a panel declares.
  it('has no interactive flag anywhere', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const result = validateBundle(read.bundle);
    if (!result.ok) return;
    const panels = [
      ...[...result.bundle.airportsById.values()].flatMap((a) => a.views.flatMap((v) => v.panels)),
      ...[...result.bundle.tmas.values()].flatMap((t) => t.views.flatMap((v) => v.panels)),
    ];
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) expect(panel).not.toHaveProperty('interactive');
  });

  // A fix has one colour wherever it appears, so it is declared once.
  it('declares the IAF palette once, in the manifest', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const result = validateBundle(read.bundle);
    if (!result.ok) return;
    expect(result.bundle.iafs.BANOX.color).toBe('#5FD98A');
    expect(result.bundle.iafs.LORNI.color).toBe('#F0A050');
    for (const airport of result.bundle.airportsById.values()) {
      expect(airport).not.toHaveProperty('iafs');
    }
    expect(result.bundle.tmas.get('par')).not.toHaveProperty('iafs');
  });

  it('keeps the approach views on the runway-columns layout', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const result = validateBundle(read.bundle);
    if (!result.ok) return;
    for (const view of result.bundle.airportsById.get('lfpg').views) {
      expect(view.panels).toHaveLength(1);
      expect(view.panels[0].layout).toBe('runway-columns');
      expect(view.panels[0].timeReference).toBeUndefined();
    }
  });

  it('gives each position the sectors it works', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    // Each sector ladder, as "<facility> <fixes>", in panel order.
    const sectorsOf = (id) =>
      view(read.bundle, 'par', id)
        .content.panels.filter((p) => p.timeReference === 'iaf')
        .map((p) => `${p.sides.left.icao} ${p.filter.iafs.join('/')}`);

    expect(sectorsOf('OT')).toEqual(['LFPO ODILO']);
    expect(sectorsOf('RT')).toEqual(['LFPG BANOX']);
    expect(sectorsOf('TE')).toEqual(['LFPG LORNI', 'LFPO VEBEK']);
    expect(sectorsOf('TP')).toEqual(['LFPG MOPAR']);
    expect(sectorsOf('AR')).toEqual(['LFPG OKIPA']);
    expect(sectorsOf('AO')).toEqual(['LFPO MOLBA']);
    expect(sectorsOf('ORGY')).toEqual(['LFPG BANOX', 'LFPO ODILO']);
    expect(sectorsOf('OPKZ')).toEqual(['LFPG BANOX/MOPAR', 'LFPO ODILO']);
    expect(sectorsOf('AOML')).toEqual(['LFPG OKIPA', 'LFPO MOLBA']);
    expect(sectorsOf('RPAW')).toEqual(['LFPG BANOX/MOPAR/LORNI', 'LFPO ODILO/VEBEK']);
    // The group view is two overviews and no sector ladder at all.
    expect(sectorsOf('PG_PO_PB')).toEqual([]);
  });

  // The sector ladder is an IAF timeline; the overview beside it is a RUNWAY
  // timeline — landing slots, no IAF letter, callsigns by fix colour — and it
  // sits at the far side so the sector ladders stay together.
  it('closes every position with an overview at the far side', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const vid of tma(read.bundle, 'par').content.views) {
      const panels = view(read.bundle, 'par', vid).content.panels;
      const last = panels[panels.length - 1];
      expect(last.timeReference).toBe('threshold');
      expect(last.filter).toEqual({});
      expect(last.fields).toEqual(['dc', 'callsign']);
      expect(last.colors.callsign.by).toBe('iaf');
      expect(last.align).toBe('end');
      for (const panel of panels.slice(0, -1)) expect(panel.align).toBeUndefined();
    }
  });

  it('watches the overview of the facility whose sectors it works', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const overviewOf = (id) => {
      const panels = view(read.bundle, 'par', id).content.panels;
      return panels[panels.length - 1].sides.left.icao;
    };
    for (const id of ['RT', 'TE', 'TP', 'AR', 'ORGY', 'OPKZ', 'AOML', 'RPAW']) {
      expect(overviewOf(id)).toBe('LFPG');
    }
    // The two Orly-only positions watch Orly instead.
    for (const id of ['OT', 'AO']) expect(overviewOf(id)).toBe('LFPO');
  });

  it('carries the IAF letter only where several fixes share a ladder', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    for (const vid of tma(read.bundle, 'par').content.views) {
      for (const panel of view(read.bundle, 'par', vid).content.panels) {
        if (panel.timeReference !== 'iaf') continue;
        const several = panel.filter.iafs.length > 1;
        expect(panel.fields).toEqual(
          several ? ['dc', 'iaf', 'callsign', 'sta_iaf'] : ['dc', 'callsign', 'sta_iaf'],
        );
        expect(panel.colors.iaf?.by).toBe(several ? 'iaf' : undefined);
      }
    }
  });

  it('gives the group view an overview of each facility, Orly at the far side', async () => {
    const read = await readBundleDir(BUNDLE_ROOT);
    if (!read.ok) return;
    const panels = view(read.bundle, 'par', 'PG_PO_PB').content.panels;
    expect(panels.map((p) => p.sides.left.icao)).toEqual(['LFPG', 'LFPO']);
    expect(panels.every((p) => p.timeReference === 'threshold')).toBe(true);
    expect(panels[1].sides.left.runwayGroup).toBe('ouest');
  });
});

describe('cross-reference rules', () => {
  it('rejects a filter naming a fix no watched facility declares', async () => {
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

  it('rejects a panel side naming an aerodrome the page does not cover', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].sides.left.icao = 'EGLL';
      }),
    ).toContain('panel-side-airport-covered');
  });

  it('rejects colouring by IAF without a colour in the manifest', async () => {
    expect(
      await rulesAfter((b) => {
        delete b.manifest.iafs.BANOX;
      }),
    ).toContain('view-iaf-colour-declared');
  });

  it('rejects a TMA watching an airport config the bundle lacks', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.airports.push('lfpb');
      }),
    ).toContain('tma-airport-exists');
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

  it('rejects an approach view whose filter names an unknown fix', async () => {
    expect(
      await rulesAfter((b) => {
        airport(b, 'lfpg').content.views[0].panels[0].filter = { iafs: ['NOPE'] };
      }),
    ).toContain('view-filter-iaf-exists');
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
        airport(b, 'lfpg').content.views[0].panels[0].sides = {
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

  // The interface draws one current-time line across every ladder in a view
  // and derives one scroll range for them, so a view is a single time axis.
  it('rejects panels of one view declaring different windows', async () => {
    expect(
      await rulesAfter((b) => {
        const panels = view(b, 'par', 'RT').content.panels;
        panels[0].window = { totalMin: 40, pastMin: 5 };
        panels[1].window = { totalMin: 120, pastMin: 5 };
      }),
    ).toContain('view-window-consistent');
  });

  it('rejects a TMA watching the same facility twice', async () => {
    expect(
      await rulesAfter((b) => {
        tma(b, 'par').content.airports = ['lfpg', 'lfpg'];
      }),
    ).toContain('schema');
  });

  it('rejects a TMA listing the same view twice', async () => {
    expect(
      await rulesAfter((b) => {
        const t = tma(b, 'par').content;
        t.views = [t.views[0], t.views[0]];
      }),
    ).toContain('schema');
  });

  // A runway-columns panel draws "this page's" runways, which is unambiguous
  // only where the page has one facility. An en-route page watches several.
  it('rejects a runway-columns panel in an en-route view', async () => {
    expect(
      await rulesAfter((b) => {
        const panel = view(b, 'par', 'RT').content.panels[0];
        panel.layout = 'runway-columns';
        delete panel.sides;
      }),
    ).toContain('view-panel-names-airport');
  });

  it('accepts the destination field', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].fields = ['destination', 'callsign'];
      }),
    ).toEqual([]);
  });

  it('rejects an unknown colour source', async () => {
    expect(
      await rulesAfter((b) => {
        view(b, 'par', 'RT').content.panels[0].colors.callsign.by = 'squawk';
      }),
    ).toContain('schema');
  });
});
