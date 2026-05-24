export interface ProjectMutationSinkOptions<TState> {
  applyTransaction: (mutator: (current: TState) => TState) => Promise<TState>;
  broadcast?: (state: TState) => void;
}

export class ProjectMutationSink<TState> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ProjectMutationSinkOptions<TState>) {}

  apply(mutator: (current: TState) => TState): Promise<TState> {
    const next = this.chain.then(async () => {
      const state = await this.options.applyTransaction(mutator);
      this.options.broadcast?.(state);
      return state;
    });

    this.chain = next.catch(() => undefined);
    return next;
  }
}

export class ProjectMutationSinkRegistry<TState> {
  private readonly sinks = new Map<string, ProjectMutationSink<TState>>();
  private readonly optionsByKey = new Map<string, ProjectMutationSinkOptions<TState>>();

  getOrCreate(key: string, options: ProjectMutationSinkOptions<TState>): ProjectMutationSink<TState> {
    const existing = this.sinks.get(key);
    if (existing) {
      if (process.env.NODE_ENV === "development" && this.optionsByKey.get(key) !== options) {
        throw new Error(`ProjectMutationSinkRegistry options changed for key: ${key}`);
      }

      return existing;
    }

    const sink = new ProjectMutationSink(options);
    this.sinks.set(key, sink);
    this.optionsByKey.set(key, options);
    return sink;
  }

  clear(): void {
    this.sinks.clear();
    this.optionsByKey.clear();
  }

  delete(key: string): void {
    this.sinks.delete(key);
    this.optionsByKey.delete(key);
  }
}
