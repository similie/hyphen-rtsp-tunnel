import { EventEmitter } from "events";
import { Redis } from "ioredis";
import Redlock, { Lock } from "redlock";
import { randomUUID } from "crypto";

export type LeaderEvents = {
  elected: () => void;
  revoked: () => void;
  error: (err: Error) => void;
};

export class LeaderElector extends EventEmitter {
  private static instance: LeaderElector;
  private redlock!: Redlock;
  private redis!: Redis;
  private renewTimer?: NodeJS.Timeout;
  private acquireTimer?: NodeJS.Timeout;
  private lock?: Lock;

  private readonly lockKey = "mqtt:leader:lock";
  private readonly ttlMs = 10000; // lock TTL
  private readonly renewEveryMs = 5000; // extend interval (< TTL)
  private readonly retryDelayMs = 1500; // backoff when not leader
  private readonly instanceId = randomUUID(); // for logging/diagnostics

  private constructor() {
    super();
  }

  static get(): LeaderElector {
    if (!this.instance) this.instance = new LeaderElector();
    return this.instance;
  }

  init(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.redlock = new Redlock([this.redis], {
      // Redlock will keep retrying for us when we explicitly request it,
      // but we’ll manage our own retry loop here.
      driftFactor: 0.01,
      retryCount: 0,
      retryDelay: 0,
    });
    this.startAcquireLoop();
  }

  /** Pure check: true only if we *currently* hold a live lock. */
  amLeader(): boolean {
    return !!this.lock;
  }

  /** Stop loops and release if we are leader. */
  async shutdown() {
    clearTimeout(this.acquireTimer as any);
    clearInterval(this.renewTimer as any);
    await this.safeRelease();
    await this.redis?.quit();
  }

  // -------- internal --------

  private startAcquireLoop() {
    const tryAcquire = async () => {
      if (this.lock) return; // already leader

      try {
        // Acquire without retries; we run our own loop.
        const lock = await this.redlock.acquire([this.lockKey], this.ttlMs);
        this.lock = lock;
        this.emit("elected");
        this.startRenewLoop();
      } catch {
        // Not acquired (someone else is leader). Back off a bit (with jitter).
      } finally {
        const jitter = Math.floor(Math.random() * 500);
        this.acquireTimer = setTimeout(tryAcquire, this.retryDelayMs + jitter);
      }
    };

    tryAcquire().catch((err) => this.emit("error", err as Error));
  }

  private startRenewLoop() {
    clearInterval(this.renewTimer as any);
    this.renewTimer = setInterval(async () => {
      if (!this.lock) return;
      try {
        this.lock = await this.lock.extend(this.ttlMs);
      } catch (err) {
        // Couldn’t extend: we lost leadership (expired or Redis issue)
        await this.safeRevoke();
        // acquisition loop is already running, it’ll try to reacquire
      }
    }, this.renewEveryMs);
  }

  private async safeRevoke() {
    clearInterval(this.renewTimer as any);
    this.lock = undefined;
    this.emit("revoked");
  }

  private async safeRelease() {
    if (!this.lock) return;
    try {
      await this.lock.release();
    } catch {
      // If already expired or released, ignore.
    } finally {
      await this.safeRevoke();
    }
  }
}
