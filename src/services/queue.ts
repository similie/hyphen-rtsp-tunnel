import {
  Queue,
  Worker,
  QueueEvents,
  type ConnectionOptions,
  type QueueOptions,
  type WorkerOptions,
  type Job,
  type QueueEventsOptions,
  type JobsOptions,
} from "bullmq";
const getRedisConfig = () => {
  return process.env.REDIS_CONFIG_URL || "redis://localhost:6379/1";
};

export type JobValue = Job;
export type qOptions = QueueOptions;
export type wOptions = WorkerOptions;
export type qEOptions = QueueEventsOptions;
export type JOpt = JobsOptions;
export type jQueue = Queue;
export type jWorker = Worker;
export class QueueManager {
  private readonly _connection: ConnectionOptions;
  private static _instance: QueueManager | undefined;
  private readonly _qMap: Map<string, Queue>;
  private readonly _wMap: Map<string, Worker>;
  private constructor() {
    this._connection = { url: getRedisConfig() };
    this._qMap = new Map<string, Queue>();
    this._wMap = new Map<string, Worker>();
  }

  public get connection() {
    return this._connection;
  }

  public get queueOpt() {
    return { connection: this.connection };
  }

  public concurrentOpt(value: number = 5) {
    return { connection: this.connection, concurrency: value };
  }

  public delayMsOpt(ttlMs: number) {
    const opt: qOptions = {
      connection: this.connection,
      defaultJobOptions: {
        delay: ttlMs, // e.g. 7 days = 7 * 24 * 60 * 60 * 1000
        removeOnComplete: true,
        removeOnFail: true,
      },
    };
    return opt;
  }

  public delaySecondsOpt(seconds: number) {
    const ttlMs = seconds * 1000;
    const opt: qOptions = {
      connection: this.connection,
      defaultJobOptions: {
        delay: ttlMs, // e.g. 7 days = 7 * 24 * 60 * 60 * 1000
        removeOnComplete: true,
        removeOnFail: true,
      },
    };
    return opt;
  }

  public delayMinutesOpt(minutes: number) {
    const ttlMs = minutes * 60 * 1000;
    const opt: qOptions = {
      connection: this.connection,
      defaultJobOptions: {
        delay: ttlMs, // e.g. 7 days = 7 * 24 * 60 * 60 * 1000
        removeOnComplete: true,
        removeOnFail: true,
      },
    };
    return opt;
  }

  public delayDaysOpt(days: number) {
    const ttlMs = days * 24 * 60 * 60 * 1000;
    const opt: qOptions = {
      connection: this.connection,
      defaultJobOptions: {
        delay: ttlMs, // e.g. 7 days = 7 * 24 * 60 * 60 * 1000
        removeOnComplete: true,
        removeOnFail: true,
      },
    };
    return opt;
  }

  public get workerOption() {
    const opt: wOptions = {
      connection: this._connection,
      removeOnFail: { count: 500, age: 3600 },
      removeOnComplete: { count: 500, age: 3600 },
    };
    return opt;
  }

  static get get(): QueueManager {
    if (!this._instance) {
      this._instance = new QueueManager();
    }
    return this._instance;
  }

  public add(name: string, JOpt = {}): Promise<JobValue> {
    if (!this._qMap.has(name)) {
      throw new Error("This queue hasn't been initialize");
    }
    return this._qMap.get(name)!.add(name, JOpt);
  }

  public queue(
    name: string,
    opt: qOptions = { connection: this._connection },
  ): Queue {
    if (!opt.connection) {
      opt.connection = this._connection;
    }
    const q = new Queue(name, opt);
    this._qMap.set(name, q);
    return q;
  }

  public qEvents(
    name: string,
    opt: qEOptions = { connection: this._connection },
  ) {
    if (!opt.connection) {
      opt.connection = this._connection;
    }
    if (!this._qMap.has(name)) {
      this.queue(name);
    }
    return new QueueEvents(name, opt);
  }

  public worker(
    name: string,
    cb: (job: JobValue) => Promise<any>,
    opt: wOptions = this.workerOption,
  ): Worker {
    if (!opt.connection) {
      opt.connection = this._connection;
    }

    if (!this._qMap.has(name)) {
      this.queue(name);
    }

    const w = new Worker(name, cb, opt);
    this._wMap.set(name, w);
    return w;
  }
}
