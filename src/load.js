'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** Bundle-relative directory holding one JSON file per airport. */
const AIRPORTS_DIR = 'airports';
/** Bundle-relative directory holding one subdirectory per TMA. */
const TMAS_DIR = 'tmas';
/** Bundle-relative manifest filename. */
const MANIFEST_FILE = 'manifest.json';

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Reading a file can fail two ways; a bare value cannot carry that. */
async function readJson(absolute, relative, issues) {
  let text;
  try {
    text = await fs.readFile(absolute, 'utf-8');
  } catch (err) {
    issues.push({ file: relative, rule: 'unreadable', message: messageOf(err) });
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    issues.push({ file: relative, rule: 'invalid-json', message: messageOf(err) });
    return { ok: false };
  }
}

/**
 * Read and JSON-parse a bundle directory. Reading and parsing are separated
 * from validation so the same `validateBundle` runs over a git working copy, a
 * local development directory, and a CI checkout without three code paths.
 *
 * @param {string} root
 * @returns {Promise<import('../types/index.js').ReadBundleResult>}
 */
async function readBundleDir(root) {
  /** @type {import('../types/index.js').ConfigIssue[]} */
  const issues = [];

  const manifest = await readJson(path.join(root, MANIFEST_FILE), MANIFEST_FILE, issues);
  if (!manifest.ok) return { ok: false, issues };

  const airportsRoot = path.join(root, AIRPORTS_DIR);
  let entries;
  try {
    entries = await fs.readdir(airportsRoot);
  } catch (err) {
    issues.push({
      file: `${AIRPORTS_DIR}/`,
      rule: 'unreadable',
      message: `cannot read the airports directory: ${messageOf(err)}`,
    });
    return { ok: false, issues };
  }

  const airports = [];
  for (const entry of entries.filter((e) => e.toLowerCase().endsWith('.json')).sort()) {
    const relative = `${AIRPORTS_DIR}/${entry}`;
    const read = await readJson(path.join(airportsRoot, entry), relative, issues);
    if (read.ok) airports.push({ path: relative, content: read.value });
  }

  const tmas = await readTmas(root, issues);

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, bundle: { manifest: manifest.value, airports, tmas } };
}

/**
 * Read `tmas/<id>/tma.json` plus every `tmas/<id>/views/*.json`.
 *
 * Absent entirely is not an error: the directory is additive to schema
 * version 1, so a bundle without it stays valid for readers that predate it.
 */
async function readTmas(root, issues) {
  const tmasRoot = path.join(root, TMAS_DIR);
  let entries;
  try {
    entries = await fs.readdir(tmasRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const tmas = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = `${TMAS_DIR}/${entry.name}`;
    const tmaPath = `${dir}/tma.json`;
    const tma = await readJson(path.join(root, tmaPath), tmaPath, issues);
    if (!tma.ok) continue;

    const viewsRoot = path.join(root, dir, 'views');
    let viewFiles = [];
    try {
      viewFiles = (await fs.readdir(viewsRoot)).filter((f) => f.toLowerCase().endsWith('.json')).sort();
    } catch (err) {
      issues.push({
        file: `${dir}/views/`,
        rule: 'unreadable',
        message: `cannot read the views directory: ${messageOf(err)}`,
      });
      continue;
    }

    const views = [];
    for (const file of viewFiles) {
      const relative = `${dir}/views/${file}`;
      const view = await readJson(path.join(viewsRoot, file), relative, issues);
      if (view.ok) views.push({ path: relative, content: view.value });
    }
    tmas.push({ path: tmaPath, content: tma.value, views });
  }
  return tmas;
}

module.exports = { AIRPORTS_DIR, MANIFEST_FILE, TMAS_DIR, readBundleDir };
