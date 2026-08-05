import { type JobsOptions, type Processor, Queue, Worker } from "bullmq";
import Redis from "ioredis";

const COMMAND_QUEUE = "symphoneer-hub:commands";
const PRESENCE_TTL_SECONDS = 30;

export function createRedis(redisUrl: string, options: { worker?: boolean } = {}) {
  return new Redis(redisUrl, {
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: options.worker ? null : 3,
  });
}

export class PresenceStore {
  constructor(private readonly redis: Redis) {}

  async online(installationId: string, connectionId: string): Promise<void> {
    await this.redis.set(
      `hub:presence:${installationId}`,
      connectionId,
      "EX",
      PRESENCE_TTL_SECONDS,
    );
  }

  async offline(installationId: string, connectionId: string): Promise<void> {
    const key = `hub:presence:${installationId}`;
    const current = await this.redis.get(key);
    if (current === connectionId) await this.redis.del(key);
  }

  async getConnectionId(installationId: string): Promise<string | null> {
    return this.redis.get(`hub:presence:${installationId}`);
  }

  async isOnline(installationId: string): Promise<boolean> {
    return (await this.getConnectionId(installationId)) !== null;
  }
}

export type CommandJob = { commandId: string };

export class CommandQueue {
  private readonly queue: Queue<CommandJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<CommandJob>(COMMAND_QUEUE, { connection });
  }

  async enqueue(commandId: string, options: JobsOptions = {}): Promise<void> {
    await this.queue.add(
      "deliver",
      { commandId },
      {
        jobId: commandId,
        attempts: 8,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86_400, count: 5000 },
        ...options,
      },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createCommandWorker(connection: Redis, processor: Processor<CommandJob>) {
  return new Worker<CommandJob>(COMMAND_QUEUE, processor, {
    connection,
    concurrency: 10,
    lockDuration: 30_000,
  });
}

export class CommandPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(installationId: string, payload: string): Promise<number> {
    return this.redis.publish(`hub:command:${installationId}`, payload);
  }
}

export class CommandSubscriber {
  constructor(private readonly redis: Redis) {}

  async subscribe(handler: (installationId: string, payload: string) => void): Promise<void> {
    await this.redis.psubscribe("hub:command:*");
    this.redis.on("pmessage", (_pattern, channel, payload) => {
      const installationId = channel.slice("hub:command:".length);
      handler(installationId, payload);
    });
  }

  async close(): Promise<void> {
    await this.redis.punsubscribe("hub:command:*");
  }
}

export class FixedWindowRateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const result = await this.redis.eval(
      `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
      `,
      1,
      `hub:rate:${key}`,
      String(windowSeconds),
    );
    return Number(result) <= limit;
  }
}
