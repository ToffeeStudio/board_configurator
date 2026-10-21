import {beforeEach, expect, mock, test} from 'bun:test';
import {readFileSync} from 'node:fs';
// Storage adapter simulation; the browser fixture also exercises real IndexedDB.
const records = new Map<string, any>();
let discardWrites = false;
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (id: string) => structuredClone(records.get(id)),
  values: async () => structuredClone([...records.values()]),
  update: async (id: string, change: (value: any) => any) => {
    const next = change(structuredClone(records.get(id)));
    if (!discardWrites) records.set(id, structuredClone(next));
  },
}));
const {saveRecovery, readRecoveries, recoveryHash} = await import('../src/utils/toffee_studio/firmware-recovery');
import type {FirmwareRecovery} from '../src/utils/toffee_studio/firmware-recovery';
const choice = JSON.parse(readFileSync('firmware-downloads/manifest.json', 'utf8'))[0];
const targetImage = new Uint8Array(readFileSync('firmware-downloads/normal.uf2'));
const fresh = (): FirmwareRecovery => ({version: 2, id: 'test', createdAt: '2026-10-21T00:00:00Z', choice,
  settings: {layers: 1, keymap: '07'.repeat(144), macros: '05'.repeat(56), layout: '01020304'},
  targetImage, originalSectors: null, originalSha256: null, flashBase: 0x10000000,
  status: 'prepared', serial: null, verifiedBytes: null});
beforeEach(() => {records.clear(); discardWrites = false;});
test('exact image, original and settings survive each durable stage and reload', async () => {
  let record = fresh(); await saveRecovery(record);
  expect((await readRecoveries())[0].targetImage).toEqual(targetImage);
  const original = new Uint8Array(Math.ceil(targetImage.length / 2 / 4096) * 4096).fill(0x5a);
  record = {...record, status: 'writing', serial: 'TEST', originalSectors: original, originalSha256: await recoveryHash(original)};
  await saveRecovery(record);
  for (const status of ['verified', 'complete'] as const) {
    record = {...record, status, verifiedBytes: original.length}; await saveRecovery(record);
    expect((await readRecoveries())[0]).toEqual(record);
  }
});
test('original sectors, target release, identity and private settings cannot be replaced', async () => {
  const original = new Uint8Array(Math.ceil(targetImage.length / 2 / 4096) * 4096).fill(0x5a);
  const record = {...fresh(), status: 'writing' as const, serial: 'TEST', originalSectors: original, originalSha256: await recoveryHash(original)};
  await saveRecovery(record);
  const partial = original.slice(); partial[0] ^= 1;
  for (const changed of [
    {...record, originalSectors: partial, originalSha256: await recoveryHash(partial)},
    {...record, serial: 'WRONG'}, {...record, settings: null},
    {...record, choice: {...choice, name: 'Different release'}},
  ]) await expect(saveRecovery(changed)).rejects.toThrow('immutable');
  expect((await readRecoveries())[0]).toEqual(record);
});
test('legacy backup is retained with missing image explicit; exact target can be added once', async () => {
  const {version, targetImage: image, originalSha256, flashBase, ...legacy} = fresh();
  records.set(legacy.id, legacy);
  const migrated = (await readRecoveries())[0];
  expect(migrated.targetImage).toBe(null); expect(migrated.version).toBe(2);
  expect(records.get(legacy.id).version).toBeUndefined();
  await saveRecovery({...migrated, targetImage: image});
  expect((await readRecoveries())[0].targetImage).toEqual(image);
});
test('corrupt image/original, invalid verification and failed persistence stop explicitly', async () => {
  const bad = targetImage.slice(); bad[100] ^= 1;
  await expect(saveRecovery({...fresh(), targetImage: bad})).rejects.toThrow('SHA-256');
  const original = new Uint8Array(Math.ceil(targetImage.length / 2 / 4096) * 4096);
  await expect(saveRecovery({...fresh(), serial: 'TEST', originalSectors: original, originalSha256: '0'.repeat(64)})).rejects.toThrow('damaged');
  await expect(saveRecovery({...fresh(), status: 'verified'})).rejects.toThrow('missing');
  discardWrites = true;
  await expect(saveRecovery(fresh())).rejects.toThrow('readback failed');
});
