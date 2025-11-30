// src/lib/RedisCache.ts
import { createClient } from "redis";
const getRedisConfig = () => {
  return process.env.REDIS_CONFIG_URL || "redis://localhost:6379/1";
};
export class RedisCache {
  // Create a Redis client instance.
  private static client = createClient({ url: getRedisConfig() });
  private static DEFAULT_EXPIRATION_SECONDS = 900; // 15 minutes

  /**
   * Initializes the Redis client. Call this once on server startup.
   */
  public static async init(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    try {
      await this.client.connect();
      console.log("Connected to Redis");
    } catch (err) {
      console.error("Error connecting to Redis:", err);
    }
  }

  /**
   * Caches an object under a specified key.
   * @param key The cache key.
   * @param value The object to cache.
   * @param expirationSeconds Optional expiration time in seconds (defaults to 15 minutes).
   */
  public static async set(
    key: string,
    value: any,
    expirationSeconds?: number,
  ): Promise<void> {
    const exp = expirationSeconds || this.DEFAULT_EXPIRATION_SECONDS;
    const stringValue = JSON.stringify(value);
    await this.client.set(key, stringValue, { EX: exp });
  }

  /**
   * Retrieves a cached object by its key.
   * @param key The cache key.
   * @returns The cached object, or null if not found.
   */
  public static async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (data) {
      try {
        return JSON.parse(
          typeof data === "string" ? data : JSON.stringify(data),
        );
      } catch (err) {
        console.error("Error parsing cached data:", err);
        return data as unknown as T | null;
      }
    }
    return null;
  }

  /**
   * Deletes a cache entry.
   * @param key The cache key.
   */
  public static async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
