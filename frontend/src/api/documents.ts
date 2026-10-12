// 文档管理 API 层。
//
// ⚠️ 当前后端还没写，这里用一个“可订阅的内存 mock”把前端完整跑起来：
//    - 上传后模拟 解析 → 分块 → 向量化 → 入库 的状态流转
//    - UI 通过 subscribe() 实时收到状态变化（将来换成 SSE 推送，接口形状不变）
//
// 将来对接真实后端时，只需把下面几个函数体换成 fetch：
//    listDocuments()        -> GET    /api/documents
//    uploadDocument(file)   -> POST   /api/documents          (multipart)
//    deleteDocument(id)     -> DELETE /api/documents/:id
//    订阅进度               -> SSE    /api/documents/:id/progress  或轮询 GET /api/documents
// 其余（类型、STAGES、工具函数）都能原样复用。

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

export const ACCEPT_EXTS = ["pdf", "doc", "docx", "xls", "xlsx", "txt", "md"];

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

// MOCK_STORE_MARKER

// ===== 以下是 mock 实现（将来替换为真实后端调用）=====

let docs: DocItem[] = [];
const listeners = new Set<() => void>();

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

function patch(id: string, data: Partial<DocItem>) {
  docs = docs.map((d) => (d.id === id ? { ...d, ...data } : d));
  emit();
}

// 模拟后台处理流水线：按阶段推进状态，带随机耗时
function runPipeline(id: string) {
  const order: DocStatus[] = ["parsing", "chunking", "embedding", "storing"];
  let i = 0;
  const tick = () => {
    if (!docs.some((d) => d.id === id)) return; // 已被删除
    if (i < order.length) {
      patch(id, { status: order[i] });
      i += 1;
      setTimeout(tick, 700 + Math.random() * 900);
    } else {
      patch(id, { status: "done", chunks: 8 + Math.floor(Math.random() * 40) });
    }
  };
  setTimeout(tick, 400);
}

export function uploadDocument(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const doc: DocItem = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now() + Math.random()),
    name: file.name,
    ext,
    size: file.size,
    status: "pending",
    createdAt: Date.now(),
  };
  docs = [doc, ...docs];
  emit();
  runPipeline(doc.id);
}

export function deleteDocument(id: string) {
  docs = docs.filter((d) => d.id !== id);
  emit();
}
