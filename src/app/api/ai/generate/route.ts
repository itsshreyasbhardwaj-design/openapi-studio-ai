import { z } from "zod";
import { generateSpec } from "@/lib/core/ai";
import { readJson, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  request: z.string().min(8).max(4000),
  title: z.string().max(120).optional(),
  baseUrl: z.string().url().max(300).optional(),
  style: z.enum(["minimal", "standard", "comprehensive"]).optional(),
});

/**
 * Stream a generated specification as newline-delimited JSON events.
 *
 * NDJSON rather than SSE: the client consumes it with a plain `fetch` reader,
 * there is no reconnect semantics to emulate, and every frame is a complete
 * JSON object which keeps the parser trivial.
 */
export const POST = route(
  async ({ request, log }) => {
    const body = await readJson(request, schema);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown): void => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          for await (const event of generateSpec(
            {
              request: body.request,
              ...(body.title === undefined ? {} : { title: body.title }),
              ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }),
              ...(body.style === undefined ? {} : { style: body.style }),
            },
            request.signal,
          )) {
            send(event);
            if (event.type === "done") {
              log.info("ai.generated", {
                engine: event.result.engine,
                repaired: event.result.repaired,
              });
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error("ai.stream_failed", { error: message });
          send({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  },
  { scope: "ai:generate", limit: 20 },
);
