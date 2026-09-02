import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const pin = z.object({
  threadId: z.string(),
  title: z.string(),
  pinSortKey: z.string().nullable(),
  pinnedAt: z.number(),
});

export const pinsRpc = defineRpcContract({
  pinned: { input: z.null(), output: z.array(pin) },
  reorder: {
    input: z.object({
      threadId: z.string().min(1),
      previousThreadId: z.string().min(1).nullable(),
      nextThreadId: z.string().min(1).nullable(),
    }),
    output: z.array(pin),
  },
  create: {
    // Full NewThreadRequest from experimental_NewThreadComposer's onSubmit.
    input: z.unknown(),
    output: z.array(pin),
  },
  unpin: { input: z.string().min(1), output: z.array(pin) },
  gitStats: {
    input: z.object({ environmentIds: z.array(z.string()).max(100) }),
    output: z.object({
      rows: z.array(
        z.object({
          environmentId: z.string(),
          insertions: z.number().int().nonnegative(),
          deletions: z.number().int().nonnegative(),
          ahead: z.number().int().nonnegative(),
          behind: z.number().int().nonnegative(),
          dirty: z.boolean(),
        }),
      ),
    }),
  },
});
