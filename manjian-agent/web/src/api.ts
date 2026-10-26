// 后端 API 客户端。开发期经 vite proxy 打到 :8099，与生产同源。
export interface CreateTaskBody {
  request_id: string;
  topic: string;
  style?: string;
  target_seconds?: number;
  max_scenes?: number;
  max_generated_images?: number;
}

export interface TaskView {
  task_id: string;
  request_id: string;
  status: string;
  stage: string | null;
  result: Record<string, any> | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  agent_name: string;
  model_name: string | null;
  status: string;
  latency_ms: number | null;
  usage: Record<string, any> | null;
  estimated_cost: number | null;
}

const BASE = "/internal/v1/tasks";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function createTask(body: CreateTaskBody) {
  return j<{ task_id: string; status: string; created: boolean }>(
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function getTask(id: string) {
  return j<TaskView>(await fetch(`${BASE}/${id}`));
}

export async function cancelTask(id: string) {
  return j<{ task_id: string; cancel_accepted: boolean }>(
    await fetch(`${BASE}/${id}/cancel`, { method: "POST" }),
  );
}

export async function listRuns(id: string) {
  return j<{ task_id: string; runs: AgentRun[] }>(await fetch(`${BASE}/${id}/runs`));
}

export function videoUrl(id: string) {
  return `${BASE}/${id}/video`;
}

export async function ready() {
  try {
    return await j<Record<string, any>>(await fetch("/readyz"));
  } catch {
    return null;
  }
}

export const TERMINAL = new Set(["succeeded", "failed", "cancelled", "storyboard_ready"]);
