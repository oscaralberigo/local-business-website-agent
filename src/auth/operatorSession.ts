import { createHmac, timingSafeEqual } from "node:crypto";

import type { RuntimeConfiguration } from "../config/runtimeConfiguration.js";

const cookieName = "operator_session";
const sessionDurationSeconds = 60 * 60 * 8;

type OperatorSession = {
  username: string;
  expiresAt: number;
};

export function verifyOperatorCredentials(
  configuration: RuntimeConfiguration,
  username: string,
  password: string
): boolean {
  return safeEqual(username, configuration.operatorUsername) && safeEqual(password, configuration.operatorPassword);
}

export function buildOperatorSessionCookie(configuration: RuntimeConfiguration): string {
  const session: OperatorSession = {
    username: configuration.operatorUsername,
    expiresAt: Math.floor(Date.now() / 1000) + sessionDurationSeconds
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload, configuration.operatorSessionSecret);
  const secure = configuration.appBaseUrl.startsWith("https://") ? "; Secure" : "";

  return `${cookieName}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDurationSeconds}${secure}`;
}

export function readOperatorSession(cookieHeader: string | undefined, configuration: RuntimeConfiguration): OperatorSession | null {
  const cookies = parseCookieHeader(cookieHeader);
  const rawSession = cookies.get(cookieName);

  if (!rawSession) {
    return null;
  }

  const [payload, signature] = rawSession.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, configuration.operatorSessionSecret))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OperatorSession;
    if (session.username !== configuration.operatorUsername || session.expiresAt < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const pair of cookieHeader?.split(";") ?? []) {
    const [name, ...valueParts] = pair.trim().split("=");
    if (name && valueParts.length > 0) {
      cookies.set(name, valueParts.join("="));
    }
  }

  return cookies;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
