import { getValidSession, type LineAuthEnv } from "../../../_shared/lineAuth";
import { getModuleBySlug } from "../../../../src/data/houteiKenshu.mjs";

interface TrainingVideoEnv extends LineAuthEnv {
  TRAINING_VIDEOS?: R2Bucket;
}

export async function onRequestGet(context: {
  request: Request;
  env: TrainingVideoEnv;
  params: { slug?: string };
}): Promise<Response> {
  const session = await getValidSession(context.request, context.env.LINE_SESSION_SECRET);
  if (!session) {
    return new Response("LINE authentication is required.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const slug = normalizeSlug(context.params.slug);
  const module = getModuleBySlug(slug);
  if (!module) return new Response("Not found", { status: 404 });

  const bucket = context.env.TRAINING_VIDEOS;
  if (!bucket) {
    return new Response("Training video storage is not configured.", { status: 503 });
  }

  const key = `${module.slug}.mp4`;
  const rangeHeader = context.request.headers.get("Range");
  if (rangeHeader) {
    return serveRange(bucket, key, rangeHeader);
  }

  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    status: 200,
    headers: videoHeaders(object.size),
  });
}

function normalizeSlug(value: string | undefined): string {
  return (value ?? "").replace(/\.mp4$/i, "");
}

async function serveRange(bucket: R2Bucket, key: string, rangeHeader: string): Promise<Response> {
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return rangeNotSatisfiable();

  const head = await bucket.head(key);
  if (!head) return new Response("Not found", { status: 404 });

  const start = Number(match[1]);
  const explicitEnd = match[2] ? Number(match[2]) : undefined;
  if (!Number.isSafeInteger(start) || start < 0) return rangeNotSatisfiable();
  if (explicitEnd !== undefined && (!Number.isSafeInteger(explicitEnd) || explicitEnd < start)) {
    return rangeNotSatisfiable();
  }
  if (start >= head.size) return rangeNotSatisfiable(head.size);

  const object = await bucket.get(key, {
    range: explicitEnd === undefined
      ? { offset: start }
      : { offset: start, length: explicitEnd - start + 1 },
  });
  if (!object) return new Response("Not found", { status: 404 });

  const end = Math.min(explicitEnd ?? head.size - 1, head.size - 1);
  const length = end - start + 1;
  const headers = videoHeaders(head.size);
  headers.set("Content-Length", String(length));
  headers.set("Content-Range", `bytes ${start}-${end}/${head.size}`);

  return new Response(object.body, {
    status: 206,
    headers,
  });
}

function videoHeaders(size: number): Headers {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Length": String(size),
    "Content-Type": "video/mp4",
  });
}

function rangeNotSatisfiable(size = "*"): Response {
  return new Response("Range Not Satisfiable", {
    status: 416,
    headers: {
      "Cache-Control": "no-store",
      "Content-Range": `bytes */${size}`,
    },
  });
}
