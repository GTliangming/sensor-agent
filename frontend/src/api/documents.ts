// 文档管理 API 层（对接真实后端）。
//
// 对外保持一个“可订阅的本地缓存”：UI 调 listDocuments() 读缓存、subscribe() 收变化。
// 内部通过 REST + SSE 和后端同步：
//    listDocuments()        <- GET    /api/documents（refresh 时拉取，写入缓存）
//    uploadDocument(file)   -> POST   /api/documents（multipart）+ SSE 跟踪进度
//    deleteDocument(id)     -> DELETE /api/documents/:id
//    进度                    <- SSE    /api/documents/:id/progress
// 后端地址默认走相对路径（dev 由 Vite 代理转发到 Flask）。

export type DocStage = "parsing" | "chunking" | "embedding" | "storing";
export type DocStatus = "pending" | DocStage | "done" | "failed";

export const STAGES: { key: DocStage; label: string }[] = [
  { key: "parsing", label: "解析" },
  { key: "chunking", label: "分块" },
  { key: "embedding", label: "向量化" },
  { key: "storing", label: "入库" },
];

export interface DocItem {
  id: string;
  name: string;
  ext: string;
  size: number;
  status: DocStatus;
  chunks?: number; // 入库后的分块数
  error?: string;
  createdAt: number;
}

// 后端实际支持的格式（.doc/.xls 老格式不支持）
export const ACCEPT_EXTS = ["pdf", "docx", "xlsx", "txt", "md"];

/** -1 排队中 · 0..3 对应四个阶段 · 4 已完成 · -2 失败 */
export function stageIndex(status: DocStatus): number {
  if (status === "pending") return -1;
  if (status === "done") return 4;
  if (status === "failed") return -2;
  return STAGES.findIndex((s) => s.key === status);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 原始文件地址（预览 / 下载用）：对接后端 GET /api/documents/:id/file
export function fileUrl(id: string): string {
  return `${API_BASE}/api/documents/${id}/file`;
}

// 浏览器能内嵌预览的格式；其余（docx/xlsx）只能下载或新窗口打开
export const INLINE_PREVIEW_EXTS = ["pdf", "txt", "md"];

// MOCK_STORE_MARKER

// ===== 真实后端实现 =====

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

let docs: DocItem[] = [];
const listeners = new Set<() => void>();
const watching = new Set<string>(); // 正在 SSE 跟踪进度的文档 id

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function listDocuments(): DocItem[] {
  return docs;
}

function isTerminal(s: DocStatus) {
  return s === "done" || s === "failed";
}

function patchLocal(id: string, data: Partial<DocItem>) {
  docs = docs.map((d) => (d.id === id ? { ...d, ...data } : d));
  emit();
}

export async function refresh() {
  try {
    const resp = await fetch(`${API_BASE}/api/documents`);
    if (!resp.ok) return;
    docs = (await resp.json()) as DocItem[];
    emit();
    // 刷新后，对仍在处理中的文档重新挂上进度监听（比如刷新了页面）
    docs.forEach((d) => {
      if (!isTerminal(d.status)) watchProgress(d.id);
    });
  } catch {
    /* 后端没起时静默，UI 显示空列表 */
  }
}

// 用 SSE 跟踪单个文档的状态流转，直到 done/failed
function watchProgress(id: string) {
  if (watching.has(id)) return;
  watching.add(id);
  const es = new EventSource(`${API_BASE}/api/documents/${id}/progress`);
  es.onmessage = (e) => {
    let data: Partial<DocItem> & { status: DocStatus };
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if ((data.status as string) === "deleted") {
      es.close();
      watching.delete(id);
      return;
    }
    patchLocal(id, {
      status: data.status,
      chunks: data.chunks,
      error: data.error,
    });
    if (isTerminal(data.status)) {
      es.close();
      watching.delete(id);
    }
  };
  es.onerror = () => {
    es.close();
    watching.delete(id);
  };
}

export async function uploadDocument(file: File) {
  const form = new FormData();
  form.append("file", file);
  try {
    const resp = await fetch(`${API_BASE}/api/documents`, {
      method: "POST",
      body: form,
    });
    if (!resp.ok) {
      let msg = `上传失败（${resp.status}）`;
      try {
        msg = (await resp.json()).error ?? msg;
      } catch {
        /* ignore */
      }
      const tmp: DocItem = {
        id: "tmp-" + Date.now() + "-" + Math.random(),
        name: file.name,
        ext: file.name.split(".").pop()?.toLowerCase() ?? "",
        size: file.size,
        status: "failed",
        error: msg,
        createdAt: Date.now(),
      };
      docs = [tmp, ...docs];
      emit();
      return;
    }
    const doc = (await resp.json()) as DocItem;
    docs = [doc, ...docs.filter((d) => d.id !== doc.id)];
    emit();
    watchProgress(doc.id);
  } catch {
    /* 网络错误：静默，可按需加提示 */
  }
}

export async function deleteDocument(id: string) {
  if (id.startsWith("tmp-")) {
    // 上传就失败的占位项，前端直接移除即可
    docs = docs.filter((d) => d.id !== id);
    emit();
    return;
  }
  try {
    const resp = await fetch(`${API_BASE}/api/documents/${id}`, {
      method: "DELETE",
    });
    if (resp.ok || resp.status === 404) {
      docs = docs.filter((d) => d.id !== id);
      emit();
    }
  } catch {
    /* ignore */
  }
}

// 模块加载即拉一次列表
refresh();
