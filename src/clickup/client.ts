/**
 * Minimal ClickUp API client.
 *
 * Auth: ClickUp uses the personal token directly in the `Authorization`
 * header (no "Bearer" prefix), e.g. `Authorization: pk_12345_ABCDEF`.
 *
 * - Tasks  (v2, well supported): POST /api/v2/list/{listId}/task,
 *                                PUT  /api/v2/task/{taskId}
 * - Chat   (v3, experimental):   POST /api/v3/workspaces/{ws}/chat/channels/{ch}/messages
 *
 * The v3 Chat API is flagged experimental by ClickUp and may require an OAuth
 * app token rather than a personal token. Channel posting is therefore
 * toggleable; tasks work independently.
 */

const V2 = "https://api.clickup.com/api/v2";
const V3 = "https://api.clickup.com/api/v3";

export interface CreateTaskInput {
  listId: string;
  name: string;
  description?: string;
  status?: string;
  priority?: 1 | 2 | 3 | 4; // 1 urgent .. 4 low
  tags?: string[];
  dueDate?: number; // epoch ms
}

export interface ClickUpTask {
  id: string;
  url?: string;
}

export class ClickUpClient {
  constructor(
    private readonly token: string,
    private readonly opts: { dryRun?: boolean } = {},
  ) {}

  async createTask(input: CreateTaskInput): Promise<ClickUpTask> {
    const body = {
      name: input.name,
      markdown_content: input.description,
      status: input.status,
      priority: input.priority,
      tags: input.tags,
      due_date: input.dueDate,
    };
    if (this.opts.dryRun) {
      console.log("[DRY_RUN] createTask", JSON.stringify(body));
      return { id: `dry_${Date.now()}` };
    }
    const res = await this.post(`${V2}/list/${input.listId}/task`, body);
    const json = (await res.json()) as { id: string; url?: string };
    return { id: json.id, url: json.url };
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    if (this.opts.dryRun) {
      console.log("[DRY_RUN] updateTaskStatus", taskId, status);
      return;
    }
    await this.put(`${V2}/task/${taskId}`, { status });
  }

  async sendChannelMessage(
    workspaceId: string,
    channelId: string,
    content: string,
  ): Promise<void> {
    const body = { type: "message", content, content_format: "text/md" };
    if (this.opts.dryRun) {
      console.log("[DRY_RUN] sendChannelMessage", channelId, content);
      return;
    }
    await this.post(
      `${V3}/workspaces/${workspaceId}/chat/channels/${channelId}/messages`,
      body,
    );
  }

  private post(url: string, body: unknown): Promise<Response> {
    return this.request("POST", url, body);
  }

  private put(url: string, body: unknown): Promise<Response> {
    return this.request("PUT", url, body);
  }

  private async request(method: string, url: string, body: unknown): Promise<Response> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stripUndefined(body)),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`ClickUp ${method} ${url} -> ${res.status}: ${text}`);
    }
    return res;
  }
}

function stripUndefined(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
