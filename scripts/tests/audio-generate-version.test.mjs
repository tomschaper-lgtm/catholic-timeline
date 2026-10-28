// scripts/tests/audio-generate-version.test.mjs
// MODULE DATE: 2026-10-27T19:45:00-05:00 (Tuesday) · tests freeVersion never goes backward
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freeVersion, highestExistingVersion, nextVersion, AUDIO_ROOT } from '../services/audio-generate.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agv-'));
process.chdir(tmp);                                   // AUDIO_ROOT is relative to the working folder
const dir = path.join(AUDIO_ROOT, 'Saints');
await fs.mkdir(dir, { recursive: true });
const touch = n => fs.writeFile(path.join(dir, n), 'x');

// 1) the real case: link says v3, v6 sits in the folder, v4/v5 were deleted earlier
await touch('st-anthony-of-padua-1231-v6.mp3'); await touch('st-anthony-of-padua-1231-v6.json');
const anthony = { id: 'st-anthony-of-padua-1231', audio: 'audio/Saints/st-anthony-of-padua-1231-v3.mp3' };
assert.equal(nextVersion(anthony), 4);                // the old rule, unchanged
assert.equal(await highestExistingVersion(anthony.id), 6);
assert.equal(await freeVersion(anthony, dir), 7);     // was 4 before the fix

// 2) link ahead of the files: the link still wins
const ahead = { id: 'st-other-100', audio: 'audio/Saints/st-other-100-v9.mp3' };
assert.equal(await freeVersion(ahead, dir), 10);

// 3) no audio yet, nothing on disk: v1
assert.equal(await freeVersion({ id: 'st-new-1' }, dir), 1);

// 4) a different article's files, and a longer id with the same start, don't count
await touch('st-anthony-of-padua-1231-extra-v20.mp3');
assert.equal(await highestExistingVersion('st-anthony-of-padua-1231'), 6);

// 5) another type folder counts too
await fs.mkdir(path.join(AUDIO_ROOT, 'Other'), { recursive: true });
await fs.writeFile(path.join(AUDIO_ROOT, 'Other', 'st-anthony-of-padua-1231-v8.mp3'), 'x');
assert.equal(await freeVersion(anthony, dir), 9);

// 6) no audio folder at all
process.chdir(os.tmpdir());
assert.equal(await highestExistingVersion('whatever'), 0);

console.log('audio-generate-version: all checks passed');
