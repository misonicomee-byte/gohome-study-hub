export const LINE_STATE_COOKIE = "__Host-ghc_line_state";
export const LINE_SESSION_COOKIE = "__Host-ghc_houtei_session";

const encoder = new TextEncoder();

export interface LineAuthEnv {
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  LINE_SESSION_SECRET?: string;
}

export interface StatePayload {
  state: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

export interface SessionPayload {
  sub: string;
  name?: string;
  friend: true;
  exp: number;
}

export function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=") || "";
    }
  }
  return null;
}

export function buildCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
  } = {},
): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.secure ?? true) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function clearCookie(name: string): string {
  return buildCookie(name, "", { maxAge: 0 });
}

export function sanitizeReturnTo(value: string | null): string {
  if (!value) return "/houtei-kenshu/portal/";
  let parsed: URL;
  try {
    parsed = new URL(value, "https://study.gohome-clinic.com");
  } catch {
    return "/houtei-kenshu/portal/";
  }
  const path = `${parsed.pathname}${parsed.search}`;
  if (!path.startsWith("/houtei-kenshu/")) return "/houtei-kenshu/portal/";
  if (path === "/houtei-kenshu/" || path === "/houtei-kenshu") return "/houtei-kenshu/portal/";
  return path;
}

export function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return bytesToBase64Url(values);
}

export async function signPayload<T extends object>(
  secret: string,
  payload: T,
): Promise<string> {
  const data = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(secret, data);
  return `${data}.${signature}`;
}

export async function verifyPayload<T>(
  secret: string,
  token: string | null,
): Promise<T | null> {
  if (!token) return null;
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = await hmac(secret, data);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(data))) as T;
  } catch {
    return null;
  }
}

export async function getValidSession(
  request: Request,
  secret: string | undefined,
): Promise<SessionPayload | null> {
  if (!secret) return null;
  const cookie = getCookie(request.headers.get("Cookie"), LINE_SESSION_COOKIE);
  const payload = await verifyPayload<SessionPayload>(secret, cookie);
  if (!payload || payload.friend !== true) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
