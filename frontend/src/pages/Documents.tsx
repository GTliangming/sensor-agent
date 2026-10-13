import { useEffect, useRef, useState } from "react";
import {
  ACCEPT_EXTS,
  DocItem,
  INLINE_PREVIEW_EXTS,
  STAGES,
  deleteDocument,
  fileUrl,
  formatSize,
  listDocuments,
  stageIndex,
  subscribe,
  uploadDocument,
} from "../api/documents";

function statusLabel(doc: DocItem): string {
  if (doc.status === "pending") return "排队中…";
  if (doc.status === "failed") return "处理失败";
  if (doc.status === "done") return `已入库 · ${doc.chunks} 块`;
  const stage = STAGES.find((s) => s.key === doc.status);
  return `${stage?.label}中…`;
}

function Stepper({ doc }: { doc: DocItem }) {
  const idx = stageIndex(doc.status);
  return (
    <div className="stepper">
      {STAGES.map((s, i) => {
        const state = idx > i ? "done" : idx === i ? "active" : "todo";
        return (
          <span key={s.key} className={`step step-${state}`}>
            <span className="step-dot" />
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

function PreviewModal({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  const url = fileUrl(doc.id);
  const inline = INLINE_PREVIEW_EXTS.includes(doc.ext);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-box" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <span className="preview-title" title={doc.name}>
            {doc.name}
          </span>
          <div className="preview-ops">
            <a href={url} target="_blank" rel="noopener noreferrer">
              新窗口打开
            </a>
            <button onClick={onClose} aria-label="关闭">
              关闭
            </button>
          </div>
        </div>
        <div className="preview-body">
          {inline ? (
            <iframe src={url} title={doc.name} />
          ) : (
            <div className="preview-fallback">
              <p>
                {doc.ext.toUpperCase()} 文件无法在浏览器内直接预览，可下载后用本地软件查看。
              </p>
              <a
                className="preview-download"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                下载 / 打开原文件
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Documents() {
  const [docs, setDocs] = useState<DocItem[]>(listDocuments());
  const [dragging, setDragging] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribe(() => setDocs([...listDocuments()])), []);

  function onFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (ACCEPT_EXTS.includes(ext)) uploadDocument(f);
    });
  }

  return (
    <div className="doc-page">
      <h2>文档管理</h2>
      <p className="doc-sub">
        支持 {ACCEPT_EXTS.map((e) => e.toUpperCase()).join(" / ")} · 上传后自动
        解析 → 分块 → 向量化 → 入库
      </p>

      <div
        className={`upload-zone${dragging ? " dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <div className="upload-title">拖拽文件到此处，或点击选择</div>
        <div className="upload-hint">可一次选择多个文件</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT_EXTS.map((e) => "." + e).join(",")}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {docs.length === 0 ? (
        <div className="doc-empty">暂无文档，先上传几篇传感器 / 示波器资料</div>
      ) : (
        <div className="doc-list">
          <div className="doc-row doc-head">
            <span className="col-name">文件名</span>
            <span className="col-size">大小</span>
            <span className="col-status">处理状态</span>
            <span className="col-op" />
          </div>
          {docs.map((d) => (
            <div className="doc-row" key={d.id}>
              <span className="col-name">
                <span className="ext-badge">{d.ext || "?"}</span>
                <span className="doc-name" title={d.name}>
                  {d.name}
                </span>
              </span>
              <span className="col-size">{formatSize(d.size)}</span>
              <span className="col-status">
                {d.status === "failed" ? (
                  <span className="pill pill-fail">{statusLabel(d)}</span>
                ) : (
                  <>
                    <Stepper doc={d} />
                    <span
                      className={`status-text${
                        d.status === "done" ? " ok" : ""
                      }`}
                    >
                      {statusLabel(d)}
                    </span>
                  </>
                )}
              </span>
              <span className="col-op">
                {confirmId === d.id ? (
                  <span className="confirm-group">
                    <button
                      className="del-btn confirm"
                      onClick={() => {
                        deleteDocument(d.id);
                        setConfirmId(null);
                      }}
                    >
                      确认
                    </button>
                    <button
                      className="del-btn"
                      onClick={() => setConfirmId(null)}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="op-group">
                    {!d.id.startsWith("tmp-") && (
                      <button
                        className="del-btn"
                        onClick={() => setPreviewDoc(d)}
                        title="预览原文件"
                      >
                        预览
                      </button>
                    )}
                    <button
                      className="del-btn"
                      onClick={() => setConfirmId(d.id)}
                      title="删除"
                    >
                      删除
                    </button>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {previewDoc && (
        <PreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}
