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

  getOrCreate(key: string, options: ProjectMutationSinkOptions<TState>): ProjectMutationSink<TState> {
    const existing = this.sinks.get(key);
    if (existing) {
      return existing;
    }

    const sink = new ProjectMutationSink(options);
    this.sinks.set(key, sink);
    return sink;
  }

  clear(): void {
    this.sinks.clear();
  }

  delete(key: string): void {
    this.sinks.delete(key);
  }
}
