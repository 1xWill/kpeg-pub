import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import {
  getRuntimeContext,
  getRuntimeSyncStatus,
  repairRuntimeGlobalKitties,
  repairRuntimeKittyById,
  repairRuntimeMarketListings,
  repairRuntimeOwnerKitties,
  repairRuntimeOwnerStats,
  repairRuntimeStats,
  runServerlessSync
} from "./runtime.js";
import { buildServer } from "./server.js";

type HttpMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "OPTIONS";
export type ServerlessApiRequest = {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders | Headers | Record<string, string | string[] | undefined>;
  payload?: string | Buffer | Uint8Array;
};
export type ServerlessApiResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
};

let appPromise: Promise<FastifyInstance> | null = null;

async function getServerlessApp(): Promise<FastifyInstance> {
  appPromise ??= getRuntimeContext().then(async (context) => {
    const requestRepairOptions = {
      repairGlobalKitties: repairRuntimeGlobalKitties,
      repairKittyById: repairRuntimeKittyById,
      repairOwnerKitties: repairRuntimeOwnerKitties,
      repairOwnerStats: repairRuntimeOwnerStats,
      repairMarketListings: repairRuntimeMarketListings
    };
    const app = buildServer(context.repo, context.runtimeConfig, {
      runSync: runServerlessSync,
      syncSecret: context.syncSecret,
      getStatus: getRuntimeSyncStatus,
      repairStats: repairRuntimeStats,
      ...requestRepairOptions
    });
    await app.ready();
    return app;
  });
  try {
    return await appPromise;
  } catch (error) {
    appPromise = null;
    throw error;
  }
}

function toPlainHeaders(
  headers: ServerlessApiRequest["headers"]
): Record<string, string | string[] | undefined> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

export async function handleApiRequest(input: ServerlessApiRequest): Promise<ServerlessApiResponse> {
  try {
    const app = await getServerlessApp();
    const response = await app.inject({
      method: (input.method ?? "GET") as HttpMethod,
      url: input.url ?? "/",
      headers: toPlainHeaders(input.headers),
      ...(input.payload === undefined ? {} : { payload: input.payload })
    });

    return {
      statusCode: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(response.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      ),
      body: response.body
    };
  } catch (error) {
    return serverlessFailureResponse(error);
  }
}

function serverlessFailureResponse(error: unknown): ServerlessApiResponse {
  return {
    statusCode: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify({
      ok: false,
      error: "api unavailable",
      detail: error instanceof Error ? error.message : "serverless api failed"
    })
  };
}

export async function handleFetchRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const payload =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : Buffer.from(await request.arrayBuffer());
  const response = await handleApiRequest({
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: request.headers,
    ...(payload === undefined ? {} : { payload })
  });
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.statusCode,
    headers
  });
}

export async function handleServerlessRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = await requestPayload(req);
  const response = await handleApiRequest({
    ...(req.method ? { method: req.method } : {}),
    ...(req.url ? { url: req.url } : {}),
    headers: req.headers,
    ...(payload === undefined ? {} : { payload })
  });

  res.statusCode = response.statusCode;
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value);
  }
  res.end(response.body);
}

async function requestPayload(req: IncomingMessage): Promise<Buffer | undefined> {
  const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
  if (parsedBody !== undefined) {
    return typeof parsedBody === "string" || Buffer.isBuffer(parsedBody)
      ? Buffer.from(parsedBody)
      : Buffer.from(JSON.stringify(parsedBody));
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}
