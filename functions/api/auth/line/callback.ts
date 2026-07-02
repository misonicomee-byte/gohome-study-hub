import {
  LINE_SESSION_COOKIE,
  LINE_STATE_COOKIE,
  buildCookie,
  clearCookie,
  getCookie,
  signPayload,
  verifyPayload,
  type LineAuthEnv,
  type SessionPayload,
  type StatePayload,
} from "../../../_shared/lineAuth";

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface IdTokenVerifyResponse {
  sub?: string;
  name?: string;
}

interface FriendshipResponse {
  friendFlag?: boolean;
}

export async function onRequestGet(context: {
  request: Request;
  env: LineAuthEnv;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirectToEntry(url, "cancelled");
  if (!code || !state || !env.LINE_LOGIN_CHANNEL_ID || !env.LINE_LOGIN_CHANNEL_SECRET || !env.LINE_SESSION_SECRET) {
    return redirectToEntry(url, "failed");
  }

  const stateCookie = getCookie(request.headers.get("Cookie"), LINE_STATE_COOKIE);
  const statePayload = await verifyPayload<StatePayload>(env.LINE_SESSION_SECRET, stateCookie);
  if (!statePayload || statePayload.state !== state || statePayload.exp < Math.floor(Date.now() / 1000)) {
    return redirectToEntry(url, "expired");
  }

  const redirectUri = new URL("/api/auth/line/callback", request.url).toString();
  const tokenResponse = await exchangeCodeForToken({
    code,
    redirectUri,
    channelId: env.LINE_LOGIN_CHANNEL_ID,
    channelSecret: env.LINE_LOGIN_CHANNEL_SECRET,
  });
  if (!tokenResponse.access_token || tokenResponse.error) {
    return redirectToEntry(url, "failed");
  }

  const friendship = await getFriendshipStatus(tokenResponse.access_token);
  if (!friendship.friendFlag) {
    return redirectToEntry(url, "friend_required");
  }

  const user = tokenResponse.id_token
    ? await verifyIdToken(tokenResponse.id_token, env.LINE_LOGIN_CHANNEL_ID)
    : {};
  const session = await signPayload<SessionPayload>(env.LINE_SESSION_SECRET, {
    sub: user.sub ?? "line-user",
    name: user.name,
    friend: true,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  });

  const target = new URL(statePayload.returnTo, url);
  return new Response(null, {
    status: 302,
    headers: [
      ["Location", target.toString()],
      ["Set-Cookie", clearCookie(LINE_STATE_COOKIE)],
      [
        "Set-Cookie",
        buildCookie(LINE_SESSION_COOKIE, session, {
          maxAge: 30 * 24 * 60 * 60,
          sameSite: "Lax",
        }),
      ],
      ["Cache-Control", "no-store"],
    ],
  });
}

async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
  channelId: string;
  channelSecret: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("client_id", params.channelId);
  body.set("client_secret", params.channelSecret);

  const response = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return { error: String(response.status) };
  return response.json();
}

async function verifyIdToken(idToken: string, channelId: string): Promise<IdTokenVerifyResponse> {
  const body = new URLSearchParams();
  body.set("id_token", idToken);
  body.set("client_id", channelId);

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return {};
  return response.json();
}

async function getFriendshipStatus(accessToken: string): Promise<FriendshipResponse> {
  const response = await fetch("https://api.line.me/friendship/v1/status", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { friendFlag: false };
  return response.json();
}

function redirectToEntry(url: URL, status: string): Response {
  const target = new URL("/houtei-kenshu/", url);
  target.searchParams.set("auth", status);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": clearCookie(LINE_STATE_COOKIE),
      "Cache-Control": "no-store",
    },
  });
}
