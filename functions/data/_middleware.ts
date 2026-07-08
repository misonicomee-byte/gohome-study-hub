import { accessRequiredResponse, requireCloudflareAccess } from "../_shared/accessGuard";

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const access = requireCloudflareAccess(context.request);
  if (!access.ok) return accessRequiredResponse();

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
