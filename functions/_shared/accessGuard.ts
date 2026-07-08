export interface AccessGuardResult {
  ok: boolean;
  email: string | null;
}

export function requireCloudflareAccess(request: Request): AccessGuardResult {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return { ok: true, email: null };
  }

  const email = request.headers.get("CF-Access-Authenticated-User-Email");
  const assertion = request.headers.get("CF-Access-Jwt-Assertion");
  if (!email || !assertion) {
    return { ok: false, email: null };
  }

  return { ok: true, email };
}

export function accessRequiredResponse(): Response {
  return new Response("Cloudflare Access authentication is required.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
