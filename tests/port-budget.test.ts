import {expect, test} from 'bun:test';
import {PortBudget, SAFE_MA, type BudgetReply, type Connection} from '../src/features/usb-power/port-budget';

function rig() {
  const profiles = new Map<string, number>();
  const writes: [string, number][] = [];
  const command = (port: string, board: string) => {
    const reply: BudgetReply = {board, maximum: 940, milliamps: SAFE_MA};
    const device = {};
    const connection: Connection = {
      device, port,
      read: async () => ({...reply}),
      set: async (target, ma) => {
        if (target !== board) throw new Error('Wrong board');
        writes.push([port, ma]);
        reply.milliamps = ma;
        return {...reply};
      },
    };
    return connection;
  };
  const fixture: {connection: Connection | null} = {connection: command('port-a', 'board-a')};
  const budget = new PortBudget({
    async connection() { return fixture.connection; },
    saved: key => profiles.get(key) ?? null,
    save: (key, ma) => { profiles.set(key, ma); },
    clear: key => { profiles.delete(key); },
  });
  return {budget, profiles, fixture, command, writes};
}

test('only this board on this port restores an elevated limit after restart', async () => {
  const {budget, profiles, fixture, command, writes} = rig();
  await budget.reconcile();
  expect(budget.snapshot().milliamps).toBe(450);
  await budget.set(800, budget.snapshot().key!);
  expect(profiles.get('port-a:board-a')).toBe(800);

  for (const [port, board] of [['other-port', 'board-a'], ['port-a', 'other-board'], ['port-a', 'board-a']]) {
    budget.invalidate();
    fixture.connection = command(port, board);
    await budget.reconcile();
  }
  expect(writes).toEqual([['port-a', 800], ['port-a', 800]]);
  await budget.set(450, budget.snapshot().key!);
  expect(profiles.size).toBe(0);
  expect(budget.snapshot().milliamps).toBe(450);
});

test('a confirmation from an old port cannot write to its replacement', async () => {
  const {budget, fixture, command, writes} = rig();
  await budget.reconcile();
  const old = budget.snapshot().key!;
  fixture.connection = command('new-port', 'board-a');
  await budget.set(800, old);
  expect(writes).toEqual([]);
  expect(budget.snapshot().message).toContain('connection changed');
});

test('disconnect during a late acknowledgement cannot save or label a profile as active', async () => {
  const {budget, fixture, profiles} = rig();
  await budget.reconcile();
  const old = fixture.connection!;
  const pending = Promise.withResolvers<BudgetReply>();
  const entered = Promise.withResolvers<void>();
  old.set = () => { entered.resolve(); return pending.promise; };
  const write = budget.set(800, budget.snapshot().key!);
  await entered.promise;
  fixture.connection = null;
  budget.invalidate();
  pending.resolve({board: 'board-a', maximum: 940, milliamps: 800});
  await write;
  expect(profiles.size).toBe(0);
  expect(budget.snapshot().milliamps).toBeNull();
});

test('a false acknowledgement never saves, and a failed reduction deletes the elevated profile', async () => {
  const {budget, fixture, profiles} = rig();
  await budget.reconcile();
  const oldKey = budget.snapshot().key!;
  fixture.connection!.set = async () => ({board: 'board-a', maximum: 940, milliamps: 800});
  await budget.set(800, oldKey);
  expect(profiles.size).toBe(0);
  expect(budget.snapshot().message).toContain('did not confirm');

  profiles.set(oldKey, 800);
  fixture.connection!.read = async () => ({board: 'board-a', maximum: 940, milliamps: 800});
  fixture.connection!.set = async () => { throw new Error('Device busy'); };
  await budget.set(450, oldKey);
  expect(profiles.size).toBe(0);
  expect(budget.snapshot().message).toBe('Device busy');
});

test('invalid saved limits never send a command', async () => {
  const {budget, profiles, writes} = rig();
  profiles.set('port-a:board-a', 941);
  await budget.reconcile();
  expect(writes).toEqual([]);
  expect(budget.snapshot().message).toContain('outside');
});
