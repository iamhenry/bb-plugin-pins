import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server.ts";

type Create = (request: unknown) => Promise<unknown>;
type SpawnRequest = Record<string, unknown>;

function fakeHost(spawn: (request: SpawnRequest) => Promise<{ id: string }>) {
  let create: Create | undefined;
  const calls: string[] = [];
  const bb = {
    rpc: {
      register(_contract: unknown, handlers: { create: Create }) {
        create = handlers.create;
      },
    },
    sdk: {
      threads: {
        async spawn(request: SpawnRequest) {
          calls.push("spawn");
          return spawn(request);
        },
        async pin() {
          calls.push("pin");
        },
        async list() {
          calls.push("list");
          return [];
        },
        async reorderPinned() {
          calls.push("reorderPinned");
        },
      },
    },
    log: { warn() {} },
  } as unknown as BbPluginApi;

  plugin(bb);
  assert.ok(create);
  return { calls, create };
}

test("create fills only missing provider provenance", async () => {
  let spawned: SpawnRequest | undefined;
  const host = fakeHost(async (request) => {
    spawned = request;
    return { id: "thread-1" };
  });
  const request = {
    projectId: "project-1",
    providerId: "opencode",
    model: "openai/gpt-5.6-sol",
    executionInputSources: { model: "explicit", reasoningLevel: "client-preference" },
    input: [{ text: "hello" }],
  };

  await host.create(request);

  assert.deepEqual(spawned, {
    ...request,
    executionInputSources: {
      ...request.executionInputSources,
      providerId: "explicit",
    },
    origin: "plugin",
  });
  assert.deepEqual(request.executionInputSources, {
    model: "explicit",
    reasoningLevel: "client-preference",
  });
  assert.equal(host.calls.filter((call) => call === "spawn").length, 1);
});

test("create preserves existing or absent provenance", async () => {
  for (const request of [
    {
      providerId: "opencode",
      executionInputSources: { providerId: "client-preference" },
    },
    { providerId: "opencode" },
    { executionInputSources: { model: "explicit" } },
  ]) {
    let spawned: SpawnRequest | undefined;
    const host = fakeHost(async (value) => {
      spawned = value;
      return { id: "thread-1" };
    });

    await host.create(request);

    assert.deepEqual(spawned, { ...request, origin: "plugin" });
  }
});

test("create propagates spawn failure before pinning", async () => {
  const failure = new Error("spawn failed");
  const host = fakeHost(async () => {
    throw failure;
  });

  await assert.rejects(
    host.create({ providerId: "opencode", executionInputSources: {} }),
    failure,
  );
  assert.deepEqual(host.calls, ["spawn"]);
});
