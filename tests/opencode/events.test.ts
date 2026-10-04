import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../src/opencode/types.js";

const { globalEventMock } = vi.hoisted(() => {
  return {
    globalEventMock: vi.fn(),
  };
});

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      event: globalEventMock,
    },
  },
}));

import {
  __setSseIdleTimeoutForTests,
  stopEventListening,
  subscribeToEvents,
} from "../../src/opencode/events.js";
import { logger } from "../../src/utils/logger.js";
import { defined } from "../helpers/defined.js";

function createStream<T>(events: T[]): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield (
        event && typeof event === "object" && "type" in event ? { payload: event } : event
      ) as T;
    }
  })();
}

function createOpenStream<T>(events: T[], signal: AbortSignal): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield (
        event && typeof event === "object" && "type" in event ? { payload: event } : event
      ) as T;
    }

    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createDeferredStream<T>(eventPromise: Promise<T>): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    yield await eventPromise;
  })();
}

function createAbortableStream(signal: AbortSignal): AsyncGenerator<Event, void, unknown> {
  return (async function* () {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createDelayedOpenStream<T>(
  event: T,
  signal: AbortSignal,
  delayMs: number,
): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield (event && typeof event === "object" && "type" in event ? { payload: event } : event) as T;

    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("opencode/events", () => {
  beforeEach(() => {
    globalEventMock.mockReset();
  });

  afterEach(() => {
    stopEventListening();
    __setSseIdleTimeoutForTests(30_000);
    vi.useRealTimers();
  });

  it("subscribes to stream and forwards events to callback", async () => {
    const eventA = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    const eventB = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(callback).toHaveBeenCalledTimes(2);
    expect(defined(callback.mock.calls[0]?.[0])).toEqual({ directory: "D:/repo", event: eventA });
    expect(defined(callback.mock.calls[1]?.[0])).toEqual({ directory: "D:/repo", event: eventB });
  });

  it("logs callback errors without failing event delivery", async () => {
    const eventA = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    const eventB = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });
    const callbackError = new Error("callback failed");
    const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const callback = vi
      .fn()
      .mockImplementationOnce(() => {
        throw callbackError;
      })
      .mockImplementationOnce(() => undefined);

    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith("[Events] Callback failed:", callbackError);

    stopEventListening();
    await subscription;
    loggerErrorSpy.mockRestore();
  });

  it("unwraps global event payloads before forwarding them", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockImplementationOnce(function (this: { event?: unknown }) {
      expect(this.event).toBe(globalEventMock);
      return Promise.resolve({
        stream: createStream([{ directory: "D:/repo", payload: event }]),
      });
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({ directory: "D:/repo", event });
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("ignores global events from other directories", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockImplementation(async (options: { signal: AbortSignal }) => {
      return {
        stream: createOpenStream([{ directory: "D:/other", payload: event }], options.signal),
      };
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(callback).not.toHaveBeenCalled();
  });

  it("matches global event directories across Windows slash and drive casing differences and keeps the frame spelling", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({
      stream: createStream([{ directory: "d:/repo/", payload: event }]),
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:\\repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({ directory: "d:/repo/", event });
    });
    await flushImmediate();

    stopEventListening();
    await subscription;
  });

  it("hands on a global frame without a directory with the subscribed directory", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({
      stream: createStream([{ payload: event }]),
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({ directory: "D:/repo", event });
    });
    await flushImmediate();

    stopEventListening();
    await subscription;
  });

  it("retries the supported stream when OpenCode is unavailable", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return {
          stream: createOpenStream([{ directory: "D:/repo", payload: event }], options.signal),
        };
      });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(
      () => {
        expect(callback).toHaveBeenCalledWith({ directory: "D:/repo", event });
      },
      { timeout: 3000 },
    );
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledTimes(2);
  });

  it("does not create duplicate subscription for same directory while active", async () => {
    globalEventMock.mockImplementation(async (options: { signal: AbortSignal }) => {
      return { stream: createAbortableStream(options.signal) };
    });

    const firstCallback = vi.fn();
    const firstSubscription = subscribeToEvents("D:/repo", firstCallback);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });

    await subscribeToEvents("D:/repo", vi.fn());
    expect(globalEventMock).toHaveBeenCalledTimes(1);

    stopEventListening();
    await firstSubscription;
  });

  it("aborts previous stream when directory changes", async () => {
    let firstSignal: { aborted: boolean } | null = null;

    globalEventMock
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        firstSignal = options.signal;
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
      });

    const firstSubscription = subscribeToEvents("D:/repo-a", vi.fn());

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });

    const secondSubscription = subscribeToEvents("D:/repo-b", vi.fn());

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(2);
    });

    expect(globalEventMock).toHaveBeenCalledTimes(2);
    expect(firstSignal).toEqual(expect.objectContaining({ aborted: true }));

    stopEventListening();
    await Promise.all([firstSubscription, secondSubscription]);
  });

  it("throws when subscribe result has no stream", async () => {
    globalEventMock.mockResolvedValueOnce({ stream: null });

    await expect(subscribeToEvents("D:/repo", vi.fn())).rejects.toThrow(
      "No stream returned from event subscription",
    );
  });

  it("reconnects when stream ends unexpectedly", async () => {
    globalEventMock
      .mockResolvedValueOnce({ stream: createStream([]) })
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
      });

    const subscription = subscribeToEvents("D:/repo", vi.fn());

    await vi.waitFor(
      () => {
        expect(globalEventMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    stopEventListening();
    await subscription;
  });

  it("runs the reconnect callback once the stream delivers again after it dropped", async () => {
    const event = { type: "server.connected", properties: {} };
    globalEventMock
      .mockResolvedValueOnce({ stream: createStream([event]) })
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createOpenStream([event], options.signal) };
      });
    const onReconnect = vi.fn();

    const subscription = subscribeToEvents("D:/repo", vi.fn(), onReconnect);

    await vi.waitFor(
      () => {
        expect(onReconnect).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );

    stopEventListening();
    await subscription;
  });

  it("runs the reconnect callback when the client reconnects inside one subscription", async () => {
    const connected = { type: "server.connected", properties: {} };
    globalEventMock.mockImplementationOnce(async (options: { signal: AbortSignal }) => {
      return { stream: createOpenStream([connected, connected], options.signal) };
    });
    const onReconnect = vi.fn();

    const subscription = subscribeToEvents("D:/repo", vi.fn(), onReconnect);

    await vi.waitFor(() => {
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });
    expect(globalEventMock).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledWith({ serverRestarted: null });

    stopEventListening();
    await subscription;
  });

  it("hands the connect event's restart mark to the reconnect callback", async () => {
    globalEventMock
      .mockResolvedValueOnce({
        stream: createStream([{ type: "server.connected", properties: {} }]),
      })
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return {
          stream: createOpenStream(
            [{ type: "server.connected", properties: { restarted: true } }],
            options.signal,
          ),
        };
      });
    const onReconnect = vi.fn();

    const subscription = subscribeToEvents("D:/repo", vi.fn(), onReconnect);

    await vi.waitFor(
      () => {
        expect(onReconnect).toHaveBeenCalledWith({ serverRestarted: true });
      },
      { timeout: 3000 },
    );

    stopEventListening();
    await subscription;
  });

  it("does not run the reconnect callback on the first connection", async () => {
    const callback = vi.fn();
    const onReconnect = vi.fn();
    globalEventMock.mockImplementationOnce(async (options: { signal: AbortSignal }) => {
      return {
        stream: createOpenStream([{ type: "server.connected", properties: {} }], options.signal),
      };
    });

    const subscription = subscribeToEvents("D:/repo", callback, onReconnect);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    });
    await flushImmediate();
    expect(onReconnect).not.toHaveBeenCalled();

    stopEventListening();
    await subscription;
  });

  it("reconnects after non-fatal stream error", async () => {
    globalEventMock
      .mockRejectedValueOnce(new Error("transient stream failure"))
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
      });

    const subscription = subscribeToEvents("D:/repo", vi.fn());

    await vi.waitFor(
      () => {
        expect(globalEventMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    stopEventListening();
    await subscription;
  });

  it("reconnects when an active stream stops delivering events", async () => {
    vi.useFakeTimers();
    __setSseIdleTimeoutForTests(10);

    globalEventMock
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
      });

    const subscription = subscribeToEvents("D:/repo", vi.fn());

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_010);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(2);
    });

    stopEventListening();
    await subscription;
  });

  it("resets the idle timeout after receiving an event", async () => {
    __setSseIdleTimeoutForTests(40);

    const event = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockImplementation(async (options: { signal: AbortSignal }) => {
      return { stream: createDelayedOpenStream(event, options.signal, 15) };
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(
      () => {
        expect(callback).toHaveBeenCalledWith({ directory: "D:/repo", event });
      },
      { timeout: 500 },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(globalEventMock).toHaveBeenCalledTimes(1);

    stopEventListening();
    await subscription;
  });

  it("does not deliver queued callback after listener is stopped", async () => {
    const event = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    let resolveEvent: (event: Event) => void = () => {};
    const eventPromise = new Promise<Event>((resolve) => {
      resolveEvent = resolve;
    });
    globalEventMock.mockResolvedValueOnce({ stream: createDeferredStream(eventPromise) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });

    stopEventListening();
    resolveEvent(event);
    await flushImmediate();
    await subscription;

    expect(callback).not.toHaveBeenCalled();
  });
});
