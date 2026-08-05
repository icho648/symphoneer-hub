import {
  type LocalRuntimeCommandResult,
  LocalRuntimeCommandResultSchema,
  type LocalRuntimeEvent,
  LocalRuntimeEventSchema,
  type LocalRuntimeSnapshot,
  LocalRuntimeSnapshotSchema,
  type RuntimeCommand,
} from "@symphoneer-hub/contracts";

export class RuntimeClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "RuntimeClientError";
  }
}

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly request: typeof fetch;

  constructor(baseUrl: string, request: typeof fetch = fetch) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    ) {
      throw new RuntimeClientError(0, "unsafe_runtime_url", "Runtime URL must be loopback HTTP");
    }
    this.baseUrl = url.href.replace(/\/$/, "");
    this.request = request;
  }

  snapshot(): Promise<LocalRuntimeSnapshot> {
    return this.call("/v1/snapshot", LocalRuntimeSnapshotSchema);
  }

  events(afterSequence = 0): Promise<{ events: LocalRuntimeEvent[] }> {
    return this.call(`/v1/events?after=${afterSequence}`, {
      parse(value: unknown) {
        if (
          !value ||
          typeof value !== "object" ||
          !Array.isArray((value as { events?: unknown }).events)
        ) {
          throw new Error("invalid event list");
        }
        return {
          events: (value as { events: unknown[] }).events.map((event) =>
            LocalRuntimeEventSchema.parse(event),
          ),
        };
      },
    });
  }

  command(command: RuntimeCommand): Promise<LocalRuntimeCommandResult> {
    return this.call("/v1/commands", LocalRuntimeCommandResultSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
  }

  private async call<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}${path}`, {
        ...init,
        headers: { accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new RuntimeClientError(0, "runtime_unavailable", "local Runtime is unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RuntimeClientError(
        response.status,
        "invalid_runtime_response",
        "Runtime returned invalid JSON",
      );
    }
    if (!response.ok) {
      const error = body as {
        error?: { code?: unknown; message?: unknown };
        code?: unknown;
        message?: unknown;
      };
      const code =
        typeof error.error?.code === "string"
          ? error.error.code
          : typeof error.code === "string"
            ? error.code
            : "runtime_error";
      const message =
        typeof error.error?.message === "string"
          ? error.error.message
          : typeof error.message === "string"
            ? error.message
            : "Runtime command failed";
      throw new RuntimeClientError(response.status, code, message);
    }
    try {
      return schema.parse(body);
    } catch {
      throw new RuntimeClientError(
        response.status,
        "invalid_runtime_response",
        "Runtime response violated the contract",
      );
    }
  }
}
