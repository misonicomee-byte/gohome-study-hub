import { LINE_SESSION_COOKIE, clearCookie } from "../../../_shared/lineAuth";

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const target = new URL("/houtei-kenshu/", context.request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": clearCookie(LINE_SESSION_COOKIE),
      "Cache-Control": "no-store",
    },
  });
}
