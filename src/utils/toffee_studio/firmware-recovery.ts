import {createStore, get, set, values, UseStore} from 'idb-keyval';
import {DEBUG_ENABLED} from '../../config/debug';
import {FirmwareChoice, ViaSettings} from './firmware-update';

export type FirmwareRecovery = {
  id: string; createdAt: string; choice: FirmwareChoice; settings: ViaSettings;
  status: 'prepared' | 'writing' | 'verified'; serial: string | null;
  originalSectors: Uint8Array | null; verifiedBytes: number | null;
};
let store: UseStore;
function recoveryStore() {
  if (!DEBUG_ENABLED) throw new Error('Firmware recovery tools are disabled.');
  // Separate from VIA preferences and manual measurements. Never uploaded.
  return store ||= createStore('toffee-firmware-recovery-v1', 'backups');
}
export async function saveRecovery(record: FirmwareRecovery) {
  const db = recoveryStore();
  await set(record.id, record, db);
  const saved = await get<FirmwareRecovery>(record.id, db);
  if (!saved || saved.status !== record.status || saved.choice.sha256 !== record.choice.sha256 ||
      JSON.stringify(saved.settings) !== JSON.stringify(record.settings) ||
      saved.originalSectors?.length !== record.originalSectors?.length ||
      record.originalSectors?.some((byte, index) => byte !== saved.originalSectors![index]))
    throw new Error('Local recovery backup readback failed. No new flash operation will start.');
  console.info('Firmware recovery saved locally:', record.id, record.status);
}
export async function readRecoveries() {
  return (await values<FirmwareRecovery>(recoveryStore())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
