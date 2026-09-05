# AMAN-config

Airport configuration for [AMAN-SIM](https://github.com/vaccfr/aman-sim).

This repository is the single source of airport truth. The running API loads it
directly from `main` and picks up merged changes without a deployment, so a
change here reaches controllers as soon as it is merged and validated.

## Layout

```
manifest.json          declares the schema version this bundle is written against
airports/
  lfpg.json            one file per airport, named after its ICAO (lowercase)
  lfpo.json
  lfbo.json
  lfmn.json

tmas/
  paris/
    tma.json           airports, access callsigns, configurations, IAF colours
    views/
      RWY.json         one file per view, named after its id
      ORGY.json

src/                   the schema and cross-reference linter
bin/validate.js        the validator CLI
types/                 TypeScript types for consumers
test/                  rule-by-rule tests, plus a check that every airport
                       config in this repository validates
```

Adding an airport means adding a file to `airports/`. Nothing else needs to
change — the API discovers airports from the directory.

The validator lives here rather than in the application so that CI is
self-contained: validating a pull request needs no secrets and no access to any
other repository. The AMAN-SIM API consumes this same package as a pinned
dependency, so there is exactly one implementation of every rule and a change
cannot be enforced in one place and not the other.

## TMAs and views

A TMA groups airports worked as one unit and lists the **views** — the tabs a
controller switches between. A view is an ordered list of **panels**; each panel
is one timeline with its own filter, field set, colouring and time window.

```jsonc
// tmas/paris/views/ORGY.json
{
  "id": "ORGY", "label": "ORGY",
  "panels": [
    { "id": "sector",                       // the working ladder
      "layout": "dual-sided",
      "sides": { "left":  { "icao": "LFPG", "runwayGroup": "sud" },
                 "right": { "icao": "LFPG", "runwayGroup": "nord" } },
      "window": { "totalMin": 45, "pastMin": 5 },
      "filter": { "iafs": ["BANOX"] },      // only this sector's traffic
      "fields": ["dc", "callsign", "sta_threshold"],
      "colors": { "callsign": { "by": "state" } },
      "interactive": false },

    { "id": "awareness",                    // all traffic, for context
      "layout": "dual-sided",
      "sides": { ... },
      "window": { "totalMin": 45, "pastMin": 5 },
      "filter": {},
      "fields": ["callsign"],
      "colors": { "callsign": { "by": "iaf" } },
      "interactive": false }
  ]
}
```

Things worth knowing before editing one:

- **Sides are named by runway *group*, never by runway id.** `PG_W` activates
  27R/26L and `PG_E` activates 09L/08R, but both have exactly one `sud` and one
  `nord` runway — so a group-based side keeps working when the platform turns.
  Naming ids would mean rewriting every view on every configuration change.
- **Filters are allow-lists, not expressions.** `{"iafs": [...]}` — keys are
  enumerated by the schema, so `BANOKS` fails CI instead of rendering a
  silently empty ladder that looks like "no traffic".
- **IAF colours live in `tma.json`**, keyed by published fix name. Several
  transitions share one IAF (`LORNI1W` and `LORNI1E` are both `LORNI`), so a
  colour on the transition could be declared inconsistently for the same fix.
- **A TMA configuration is a mapping, not a redeclaration.** `WL` maps each
  airport to one of *its own* templates; runway and transition data stays in the
  airport files and is never duplicated.
- **`fields` is both selection and order.** Anything omitted is not rendered.
- **`interactive: false`** means no flight-mutating interaction is offered on
  that panel, whether or not the viewer holds the sequencer lock.

## Changing a configuration

1. Open a pull request against `main`.
2. CI validates the whole bundle. A failure names the file and the rule.
3. Once merged, the running API fetches, validates and adopts the new bundle.
   Existing sessions keep the configuration they started with until their feed
   goes idle; new sessions use the new one immediately.

A bundle that fails validation is **never** adopted — the API keeps serving the
last configuration that passed, so a mistake here degrades to "the change did
not take effect", never to an outage.

## Reading a CI failure

Every failure names a file and a rule id:

```
  airports/lfpg.json
    [active-runways-resolve] configuration "PG_W" activates runway "99X", which the airport does not declare
```

| Rule | Meaning |
| --- | --- |
| `schema` | A field is missing, of the wrong type, out of range, or misspelled. Unknown fields are rejected, so `preferedRunway` fails here rather than being silently ignored. |
| `schema-version` | `manifest.json` declares a version the deployed API does not understand. |
| `filename-icao-match` | The filename and the `icao` field disagree. |
| `duplicate-runway-id` / `duplicate-transition-name` | Two declarations share a name, which makes every reference to it ambiguous. |
| `iaf-coords-valid` | A transition has missing or out-of-range `iafCoords`. This one fails **silently** at runtime — the flight never arms IAF-crossing detection — so it is checked twice. |
| `available-runways-resolve` | A transition lists a runway that is neither a declared runway id nor a declared runway group. |
| `preferred-runway-available` | A transition's `preferredRunway` is not in its own `availableRunways`, which would silently defeat the anti-crossing strategy. |
| `active-runways-resolve` / `active-transitions-resolve` | A configuration template references a runway or transition the airport does not declare. |
| `duplicate-icao` | Two files declare the same ICAO. |
| `invalid-json` / `unreadable` | The file could not be parsed or read. |

Validation is all-or-nothing: one bad file rejects the entire bundle, so a
configuration can never be adopted with dangling cross-references into a file
that failed.

## Validating locally

```bash
npm install
npm run validate        # validate the bundle in this repository
npm test                # exercise every rule
npm run type-check
```

`npm run validate` is exactly what CI runs and exactly what the API runs at
load time.

To point a local API at this checkout instead of GitHub, set in
`apps/api/.env`:

```
AMAN_CONFIG_SOURCE=file:../../../aman-config
```

The path resolves from the API's working directory (`apps/api`).

## Changing a validation rule

The rules are versioned with the bundle. When you change one:

1. Edit `src/schema.js` or `src/lint.js` and add a test.
2. If the change alters the *shape* a bundle must have, bump `SCHEMA_VERSION`
   in `src/version.js` and `schemaVersion` in `manifest.json`. An API that does
   not understand the declared version rejects the bundle in full rather than
   half-loading it.
3. Tag the release (`git tag v1.1.0 && git push --tags`) and bump the pinned
   dependency in AMAN-SIM so the API adopts the new rules deliberately.
