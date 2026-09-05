#!/usr/bin/env node
'use strict';

/**
 * Bundle validator.
 *
 * The same code the AMAN-SIM API runs at load time: a rule enforced in one
 * place and not the other would let a bundle pass review and then be rejected
 * in production, or the reverse.
 *
 * Usage: aman-config-validate [bundle-dir]   (default: the working directory)
 */
const { readBundleDir } = require('../src/load.js');
const { validateBundle } = require('../src/bundle.js');
const { SCHEMA_VERSION } = require('../src/version.js');

function report(issues) {
  const byFile = new Map();
  for (const issue of issues) {
    const existing = byFile.get(issue.file);
    if (existing) existing.push(issue);
    else byFile.set(issue.file, [issue]);
  }
  for (const [file, fileIssues] of byFile) {
    console.error(`\n  ${file}`);
    for (const issue of fileIssues) console.error(`    [${issue.rule}] ${issue.message}`);
  }
}

async function main() {
  const root = process.argv[2] ?? process.cwd();
  console.log(`Validating bundle at ${root} against schema version ${SCHEMA_VERSION}`);

  const read = await readBundleDir(root);
  if (!read.ok) {
    console.error(`\n✗ Bundle could not be read (${read.issues.length} problem(s)):`);
    report(read.issues);
    return 1;
  }

  const result = validateBundle(read.bundle);
  if (!result.ok) {
    console.error(`\n✗ Bundle rejected (${result.issues.length} problem(s)):`);
    report(result.issues);
    return 1;
  }

  const icaos = [...result.bundle.airports.keys()].sort();
  console.log(`\n✓ Bundle valid — ${icaos.length} airport(s): ${icaos.join(', ')}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
