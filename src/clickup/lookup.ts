/**
 * Read-only ClickUp lookups used to populate the dashboard dropdowns:
 * workspaces, Chat channels, and Lists (traversing spaces + folders).
 */

const V2 = "https://api.clickup.com/api/v2";
const V3 = "https://api.clickup.com/api/v3";

export interface Option {
  id: string;
  name: string;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) {
    throw new Error(`ClickUp GET ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listWorkspaces(token: string): Promise<Option[]> {
  const data = await getJson<{ teams: { id: string; name: string }[] }>(`${V2}/team`, token);
  return data.teams.map((t) => ({ id: t.id, name: t.name }));
}

export async function listChannels(token: string, workspaceId: string): Promise<Option[]> {
  // v3 Chat is experimental; tolerate failure so the dashboard still loads.
  try {
    const data = await getJson<{ data: { id: string; name?: string }[] }>(
      `${V3}/workspaces/${workspaceId}/chat/channels`,
      token,
    );
    return (data.data ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id }));
  } catch {
    return [];
  }
}

/** Flatten a workspace's Lists across folderless lists and folder lists. */
export async function listLists(token: string, workspaceId: string): Promise<Option[]> {
  const spaces = await getJson<{ spaces: { id: string; name: string }[] }>(
    `${V2}/team/${workspaceId}/space`,
    token,
  );
  const out: Option[] = [];
  for (const space of spaces.spaces ?? []) {
    // Folderless lists
    try {
      const fl = await getJson<{ lists: { id: string; name: string }[] }>(
        `${V2}/space/${space.id}/list`,
        token,
      );
      for (const l of fl.lists ?? []) out.push({ id: l.id, name: `${space.name} / ${l.name}` });
    } catch {
      /* ignore a space we can't read */
    }
    // Lists inside folders
    try {
      const folders = await getJson<{ folders: { id: string; name: string; lists?: { id: string; name: string }[] }[] }>(
        `${V2}/space/${space.id}/folder`,
        token,
      );
      for (const f of folders.folders ?? []) {
        for (const l of f.lists ?? []) {
          out.push({ id: l.id, name: `${space.name} / ${f.name} / ${l.name}` });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}
