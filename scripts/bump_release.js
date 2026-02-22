#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON_FILE = path.join(ROOT_DIR, 'package.json');
const RELEASE_NOTES_FILE = path.join(ROOT_DIR, 'release-notes.json');
const DEFAULT_HIGHLIGHT = 'General quality, reliability, and capability updates.';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isValidSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

function usage() {
  process.stderr.write('Usage: node ./scripts/bump_release.js <version> [highlight1] [highlight2] ...\n');
}

function main() {
  const [, , versionArg, ...highlights] = process.argv;
  if (!versionArg || !isValidSemver(versionArg)) {
    usage();
    process.exit(1);
  }

  const packageJson = readJson(PACKAGE_JSON_FILE);
  packageJson.version = versionArg;
  writeJson(PACKAGE_JSON_FILE, packageJson);

  let releaseNotes = {};
  if (fs.existsSync(RELEASE_NOTES_FILE)) {
    releaseNotes = readJson(RELEASE_NOTES_FILE);
  }

  releaseNotes.version = versionArg;
  releaseNotes.highlights = highlights.length > 0
    ? highlights.map(item => String(item).trim()).filter(Boolean)
    : Array.isArray(releaseNotes.highlights) && releaseNotes.highlights.length > 0
      ? releaseNotes.highlights
      : [DEFAULT_HIGHLIGHT];

  writeJson(RELEASE_NOTES_FILE, releaseNotes);
  process.stdout.write(`Updated release files to version ${versionArg}\n`);
}

main();
