import {createStore, get, update, values, UseStore} from 'idb-keyval';
import {DEBUG_ENABLED} from '../../config/debug';
import {FirmwareChoice, ViaSettings, validateFirmware, validateSettings} from './firmware-update';
import {FLASH_BASE, SECTOR} from './picoboot';

export type FirmwareRecovery = {
  version: 2; id: string; createdAt: string; choice: FirmwareChoice; settings: ViaSettings | null;
  status: 'prepared' | 'writing' | 'verified' | 'complete'; serial: string | null;
  targetImage: Uint8Array | null; originalSectors: Uint8Array | null; originalSha256: string | null;
  flashBase: number; verifiedBytes: number | null;
};
type LegacyRecovery = Omit<FirmwareRecovery, 'version' | 'targetImage' | 'originalSha256' | 'flashBase'> & {version?: undefined};
let store: UseStore;
function recoveryStore() {
  if (!DEBUG_ENABLED) throw new Error('Firmware recovery tools are disabled.');
  // Separate from VIA preferences and manual measurements. Never uploaded.
  return store ||= createStore('toffee-firmware-recovery-v1', 'backups');
}
export async function recoveryHash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function sameBytes(a: Uint8Array | null, b: Uint8Array | null) {
  return a === null || b === null ? a === b : a.length === b.length && a.every((byte, i) => byte === b[i]);
}
async function readRecord(raw: FirmwareRecovery | LegacyRecovery): Promise<FirmwareRecovery> {
  // Existing records stay in place. Missing legacy images require an exact-hash download.
  const record: FirmwareRecovery = raw.version === undefined ? {...raw, version: 2, targetImage: null,
    flashBase: FLASH_BASE, originalSha256: raw.originalSectors ? await recoveryHash(raw.originalSectors) : null} : raw;
  if (record.version !== 2 || !record.id || !record.createdAt || record.flashBase !== FLASH_BASE ||
      !['prepared', 'writing', 'verified', 'complete'].includes(record.status) ||
      !['normal', 'manual', 'current-unlimited'].includes(record.choice.id) ||
      record.choice.file !== record.choice.id + '.uf2' || !/^[0-9a-f]{64}$/.test(record.choice.sha256))
    throw new Error('Invalid local firmware recovery record. Keep the backup and contact support.');
  if (record.settings) validateSettings(record.settings);
  if (record.targetImage) await validateFirmware(record.targetImage, record.choice.sha256);
  if (record.originalSectors) {
    const size = record.originalSectors.length;
    if (!record.serial || !size || size % SECTOR || size > 1024 * 1024 ||
        record.targetImage && size !== Math.ceil(record.targetImage.length / 2 / SECTOR) * SECTOR ||
        await recoveryHash(record.originalSectors) !== record.originalSha256)
      throw new Error('Original firmware backup is incomplete or damaged. No firmware written.');
  } else if (record.status !== 'prepared' || record.originalSha256 !== null)
    throw new Error('Original firmware backup is missing. No firmware written.');
  if (['verified', 'complete'].includes(record.status) && record.verifiedBytes !== record.originalSectors!.length)
    throw new Error('Invalid firmware verification record. No settings restored.');
  return record;
}
export async function saveRecovery(record: FirmwareRecovery) {
  const db = recoveryStore();
  await readRecord(record);
  await update<FirmwareRecovery | LegacyRecovery>(record.id, previous => {
    if (previous && (JSON.stringify(previous.choice) !== JSON.stringify(record.choice) ||
        JSON.stringify(previous.settings) !== JSON.stringify(record.settings) || previous.createdAt !== record.createdAt ||
        previous.serial !== null && previous.serial !== record.serial ||
        previous.originalSectors !== null && !sameBytes(previous.originalSectors, record.originalSectors) ||
        previous.version === 2 && previous.targetImage !== null && !sameBytes(previous.targetImage, record.targetImage)))
      throw new Error('Recovery originals are immutable. The saved backup was not replaced.');
    return record;
  }, db);
  const saved = await get<FirmwareRecovery>(record.id, db);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(record))
    throw new Error('Local recovery backup readback failed. No new flash operation will start.');
  console.info('Firmware recovery saved locally:', record.id, record.status);
}
export async function readRecoveries() {
  const records = await values<FirmwareRecovery | LegacyRecovery>(recoveryStore());
  return (await Promise.all(records.map(readRecord))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
