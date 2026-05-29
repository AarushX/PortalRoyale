/**
 * ClickUp OAuth2 (authorization-code grant) + identity lookup.
 *
 *  authorize: https://app.clickup.com/api?client_id=…&redirect_uri=…&state=…
 *  token:     POST https://api.clickup.com/api/v2/oauth/token
 *  identity:  GET  https://api.clickup.com/api/v2/user
 *
 * The returned access token is used in the `Authorization` header exactly like
 * a personal token, so `ClickUpClient` works unchanged.
 */

const AUTHORIZE_URL = "https://app.clickup.com/api";
const TOKEN_URL = "https://api.clickup.com/api/v2/oauth/token";
const USER_URL = "https://api.clickup.com/api/v2/user";

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });
  const res = await fetch(`${TOKEN_URL}?${params.toString()}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ClickUp token exchange ${res.status}: ${await safeText(res)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("ClickUp token exchange: no access_token");
  return json.access_token;
}

export interface ClickUpUser {
  id: number;
  username: string;
}

export async function getUser(token: string): Promise<ClickUpUser> {
  const res = await fetch(USER_URL, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`ClickUp /user ${res.status}: ${await safeText(res)}`);
  const json = (await res.json()) as { user: { id: number; username: string } };
  return { id: json.user.id, username: json.user.username };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}
