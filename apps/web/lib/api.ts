export type AuthContext = { accessToken?: string; devUserId?: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function hubRequest<T>(
  path: string,
  auth: AuthContext,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(auth.accessToken ? { authorization: `Bearer ${auth.accessToken}` } : {}),
      ...(auth.devUserId ? { "x-dev-user-id": auth.devUserId } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = (await response.json()) as T & { error?: { code: string; message: string } };
  if (!response.ok)
    throw new Error(body.error?.message ?? `Hub API failed with ${response.status}`);
  return body;
}
