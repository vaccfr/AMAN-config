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
```

Adding an airport means adding a file to `airports/`. Nothing else needs to
change — the API discovers airports from the directory.

## Changing a configuration

1. Open a pull request against `main`.
2. CI validates the whole bundle. A failure names the file and the rule.
3. Once merged, the running API fetches, validates and adopts the new bundle.
   Existing sessions keep the configuration they started with until their feed
   goes idle; new sessions use the new one immediately.

A bundle that fails validation is **never** adopted — the API keeps serving the
last configuration that passed, so a mistake here degrades to "the change did
not take effect", never to an outage.

## CI setup

CI builds the validator from the AMAN-SIM repository so there is exactly one
implementation of every rule. AMAN-SIM is private, so the workflow needs a read
token:

1. Create a fine-grained personal access token with **Contents: read-only** on
   `vaccfr/aman-sim`.
2. Add it to this repository as the secret `AMAN_SIM_READ_TOKEN`
   (Settings → Secrets and variables → Actions).

Without it, the "Check out the validator" step fails and nothing is validated.

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

With the application repository checked out alongside this one:

```bash
cd ../aman-sim
pnpm install
pnpm --filter @aman-sim/config-schema build
node packages/config-schema/dist/cli.js ../aman-config
```

To run the API against a local checkout instead of GitHub:

```bash
AMAN_CONFIG_SOURCE=file:../aman-config pnpm dev
```
