import { type MqttClient } from "mqtt";
import { JobValue, QueueManager, jQueue } from "./queue";

export class ServiceRunner {
  private readonly QUEUE_CONNECTION_MESSAGE = "mqtt-message";

  private _connected = false;
  private readonly _queue: jQueue;
  private _queue_local: jQueue;
  private _queue_compose: jQueue;

  public constructor(private readonly _client: MqttClient) {}

  public get connected() {
    return this._connected;
  }

  public set connected(connected: boolean) {
    this._connected = connected;
  }

  public get client() {
    return this._client;
  }

  /**
   * Build all repositories listed in SourceRepository
   */
}
