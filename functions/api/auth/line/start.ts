import {
  LINE_STATE_COOKIE,
  buildCookie,
  randomToken,
  sanitizeReturnTo,
  signPayload,
  type LineAuthEnv,
  type StatePayload,
} from "../../../_shared/lineAuth";

export async function onRequestGet(context: {
  request: Request;
  env: LineAuthEnv;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const configError = validateConfig(env);
  if (configError) return redirectWithAuthStatus(url, "config");

  const state = randomToken(24);
  const nonce = randomToken(24);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo") ?? url.searchParams.get("next"));
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const stateCookie = await signPayload<StatePayload>(env.LINE_SESSION_SECRET!, {
    state,
    nonce,
    returnTo,
    exp: expiresAt,
  });

  const redirectUri = new URL("/api/auth/line/callback", request.url).toString();
  const authorizationUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", env.LINE_LOGIN_CHANNEL_ID!);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("scope", "openid profile");
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("bot_prompt", "aggressive");

  if (!isMobileLineLoginRequest(request)) {
    authorizationUrl.searchParams.set("prompt", "login");
    authorizationUrl.searchParams.set("initial_amr_display", "lineqr");
    authorizationUrl.searchParams.set("switch_amr", "false");
    authorizationUrl.searchParams.set("disable_auto_login", "true");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      "Set-Cookie": buildCookie(LINE_STATE_COOKIE, stateCookie, {
        maxAge: 10 * 60,
        sameSite: "Lax",
      }),
      "Cache-Control": "no-store",
    },
  });
}

function validateConfig(env: LineAuthEnv): string | null {
  if (!env.LINE_LOGIN_CHANNEL_ID) return "LINE_LOGIN_CHANNEL_ID";
  if (!env.LINE_LOGIN_CHANNEL_SECRET) return "LINE_LOGIN_CHANNEL_SECRET";
  if (!env.LINE_SESSION_SECRET) return "LINE_SESSION_SECRET";
  return null;
}

function isMobileLineLoginRequest(request: Request): boolean {
  const userAgent = request.headers.get("User-Agent") || "";
  return /\b(Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini)\b/i.test(userAgent);
}

function redirectWithAuthStatus(url: URL, status: string): Response {
  const target = new URL("/houtei-kenshu/", url);
  target.searchParams.set("auth", status);
  return Response.redirect(target.toString(), 302);
}
