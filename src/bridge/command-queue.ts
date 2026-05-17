import { randomUUID } from "node:crypto";
import type { BridgeCommand } from "../types/bridge.js";
import { RbxError } from "./errors.js";

export interface CommandQueueOptions {
  maxPending?: number;
  timeoutMs?: number;
}

export interface QueuedCommand<T = unknown> {
  id: string;
  command: BridgeCommand;
  params: unknown;
  resolve: (result: T) => void;
  reject: (err: Error) => void;
  createdAt: number;
  timeout: NodeJS.Timeout;
}

export class CommandQueue {
  private readonly maxPending: number;
  private readonly timeoutMs: number;
  private queue: QueuedCommand[] = [];
  private byId = new Map<string, QueuedCommand>();
  private onEnqueueCallback: (() => void) | undefined;

  constructor(opts: CommandQueueOptions = {}) {
    this.maxPending = opts.maxPending ?? Number.parseInt(process.env["RBX_QUEUE_MAX"] ?? "100", 10);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  onEnqueue(cb: () => void): void {
    this.onEnqueueCallback = cb;
  }

  size(): number {
    return this.queue.length;
  }

  allIds(): string[] {
    return [...this.byId.keys()];
  }

  enqueue<T>(command: BridgeCommand, params: unknown): Promise<T> {
    if (this.queue.length >= this.maxPending) {
      return Promise.reject(
        new RbxError(
          "RBX.BRIDGE.QUEUE_FULL",
          `Command queue full (${this.queue.length}/${this.maxPending})`,
          true,
          { current: this.queue.length, max: this.maxPending },
          "Wait for in-flight commands to drain, then retry.",
          503,
          1000,
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const entry: QueuedCommand = {
        id,
        command,
        params,
        resolve: (result) => resolve(result as T),
        reject,
        createdAt: Date.now(),
        timeout: setTimeout(() => {
          this.cleanup(id);
          reject(
            new RbxError(
              "RBX.BRIDGE.COMMAND_TIMEOUT",
              `Bridge command timed out after ${this.timeoutMs}ms: ${command}`,
              true,
              { command, timeoutMs: this.timeoutMs },
              "Retry the operation",
              504,
            ),
          );
        }, this.timeoutMs),
      };
      this.queue.push(entry);
      this.byId.set(id, entry);
      this.onEnqueueCallback?.();
    });
  }

  shift(): QueuedCommand | undefined {
    const entry = this.queue.shift();
    if (entry) this.byId.delete(entry.id);
    return entry;
  }

  get(id: string): QueuedCommand | undefined {
    return this.byId.get(id);
  }

  cleanup(id: string): QueuedCommand | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timeout);
    this.byId.delete(id);
    const idx = this.queue.findIndex((e) => e.id === id);
    if (idx !== -1) this.queue.splice(idx, 1);
    return entry;
  }

  rejectAll(err: Error): void {
    for (const cmd of [...this.byId.values()]) {
      this.cleanup(cmd.id);
      cmd.reject(err);
    }
  }
}
