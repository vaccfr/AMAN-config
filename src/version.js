'use strict';

/**
 * Version of the configuration format this validator understands.
 *
 * Every configuration bundle declares the version it was written against. A
 * bundle declaring anything else is rejected in full rather than parsed on a
 * best-effort basis: a deployed API will eventually lag this repository, and
 * half-loading a format from the future is worse than refusing it outright.
 *
 * Bump this whenever the shape changes in a way an older reader cannot handle.
 */
const SCHEMA_VERSION = 1;

module.exports = { SCHEMA_VERSION };
