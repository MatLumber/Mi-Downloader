#!/usr/bin/env node
/**
 * Bump the patch version in frontend/package.json AND frontend/package-lock.json.
 *
 * Both files matter: CI installs with `npm ci`, which hard-fails when the
 * lockfile's version disagrees with package.json. Bumping only package.json —
 * what this repo did before — left the lockfile one release behind and would
 * have broken every build after the first.
 *
 * Prints `version=<new>` on stdout for $GITHUB_OUTPUT.
 */

const fs = require('fs');

const PKG = 'frontend/package.json';
const LOCK = 'frontend/package-lock.json';

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

if ([major, minor, patch].some(Number.isNaN)) {
  console.error(`Unparseable version in ${PKG}: ${pkg.version}`);
  process.exit(1);
}

const next = `${major}.${minor}.${patch + 1}`;
pkg.version = next;
// Trailing newline matches what npm itself writes, so a later `npm install`
// does not show a spurious diff.
fs.writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);

if (fs.existsSync(LOCK)) {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  lock.version = next;
  // lockfileVersion 2/3 repeats the version on the root package entry.
  if (lock.packages && lock.packages['']) lock.packages[''].version = next;
  fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
}

process.stdout.write(`version=${next}\n`);
