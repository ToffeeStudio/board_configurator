export const SAFE_MA = 450;
export const MAX_MA = 940;

export type BudgetReply = {board: string; milliamps: number; maximum: number};
export type Connection = {device: object; port: string; read(): Promise<BudgetReply>; set(board: string, ma: number): Promise<BudgetReply>};
type Dependencies = {
  connection(): Promise<Connection | null>;
  saved(key: string): number | null;
  save(key: string, value: number): void;
  clear(key: string): void;
};
type State = {key: string | null; available: boolean; milliamps: number | null; message: string};

export class PortBudget {
  private state: State = {key: null, available: false, milliamps: null, message: 'Connect a keyboard to check this USB port.'};
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private generation = 0;

  constructor(private readonly deps: Dependencies) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.state;

  private report(state: State) {
    if (state.key === this.state.key && state.available === this.state.available && state.milliamps === this.state.milliamps && state.message === this.state.message) return;
    this.state = state;
    this.listeners.forEach(listener => listener());
  }

  invalidate() {
    this.generation++;
    this.report({key: null, available: false, milliamps: null, message: 'Checking this USB connection…'});
  }

  reconcile() {
    return this.enqueue(undefined, null);
  }

  set(ma: number, expectedKey: string) {
    if (!Number.isInteger(ma) || ma < SAFE_MA || ma > MAX_MA) throw new Error('Enter a whole number from 450 to 940 mA.');
    return this.enqueue(ma, expectedKey);
  }

  private enqueue(request: number | undefined, expectedKey: string | null) {
    const generation = this.generation;
    const run = this.queue.then(async () => {
      if (generation !== this.generation) return;
      try {
        await this.apply(request, expectedKey, generation);
      } catch (error) {
        if (generation !== this.generation) return;
        const message = (error as Error).message;
        if (this.state.message !== message) console.warn('USB current limit:', message);
        this.report({key: null, available: false, milliamps: null, message});
      }
    });
    this.queue = run;
    return run;
  }

  private async apply(request: number | undefined, expectedKey: string | null, generation: number) {
    const conn = await this.deps.connection();
    if (generation !== this.generation) return;
    if (!conn) {
      this.report({key: null, available: false, milliamps: null, message: 'Connect one Module on a recognised USB port.'});
      return;
    }
    const before = await conn.read();
    if (generation !== this.generation) return;
    const key = conn.port + ':' + before.board;
    if (expectedKey !== null && expectedKey !== key) {
      throw new Error('The USB connection changed. Confirm the limit for this port again.');
    }
    if (request === SAFE_MA) this.deps.clear(key);
    const target = request ?? this.deps.saved(key) ?? SAFE_MA;
    if (!Number.isInteger(target) || target < SAFE_MA || target > before.maximum) {
      throw new Error('The saved USB limit is outside this firmware’s supported range.');
    }

    if (request === undefined && target === SAFE_MA) {
      this.report({key, available: true, milliamps: before.milliamps, message: ''});
      return;
    }
    if (target !== SAFE_MA || before.milliamps !== SAFE_MA) {
      const current = await this.deps.connection();
      if (generation !== this.generation || current?.device !== conn.device || current.port !== conn.port) return;
      const acknowledgement = await conn.set(before.board, target);
      if (generation !== this.generation) return;
      const after = await conn.read();
      if (generation !== this.generation) return;
      if (acknowledgement.board !== before.board || after.board !== before.board ||
          acknowledgement.milliamps !== target || after.milliamps !== target) {
        throw new Error('The keyboard did not confirm the selected USB limit.');
      }
    }
    if (request !== undefined && request > SAFE_MA) {
      const current = await this.deps.connection();
      if (generation !== this.generation || current?.device !== conn.device || current.port !== conn.port) return;
      this.deps.save(key, target);
    }
    this.report({key, available: true, milliamps: target, message: ''});
  }
}
