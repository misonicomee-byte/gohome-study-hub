import { getValidSession, type LineAuthEnv } from "../_shared/lineAuth";

export async function onRequest(context: {
  request: Request;
  env: LineAuthEnv;
  next: () => Promise<Response>;
}): Promise<Response> {
  const url = new URL(context.request.url);

  if (url.pathname === "/houtei-kenshu" || url.pathname === "/houtei-kenshu/") {
    return context.next();
  }

  const session = await getValidSession(context.request, context.env.LINE_SESSION_SECRET);
  if (session) {
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const target = new URL("/houtei-kenshu/", url);
  target.searchParams.set("auth", context.env.LINE_SESSION_SECRET ? "required" : "config");
  target.searchParams.set("next", `${url.pathname}${url.search}`);
  return Response.redirect(target.toString(), 302);
}
