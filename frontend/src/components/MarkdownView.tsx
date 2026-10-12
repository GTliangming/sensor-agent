import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

// DeepSeek/ChatGPT 输出公式用 \(...\) 和 \[...\]，remark-math 只认 $...$ / $$...$$，先转换
function normalizeMath(src: string): string {
  return src
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `\n$$\n${body}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`);
}

// 从 katex 节点里取出原始 LaTeX（藏在 <annotation encoding="application/x-tex">）
function extractTex(node: any): string {
  if (!node) return "";
  if (
    node.tagName === "annotation" &&
    node.properties?.encoding === "application/x-tex"
  ) {
    return (node.children ?? []).map((c: any) => c.value ?? "").join("");
  }
  for (const child of node.children ?? []) {
    const t = extractTex(child);
    if (t) return t;
  }
  return "";
}

const hasClass = (node: any, cls: string) =>
  Array.isArray(node.properties?.className) &&
  node.properties.className.includes(cls);

// rehype 插件：把块级公式包进 .formula-wrap 并挂一个带 data-tex 的复制按钮
function rehypeMathCopy() {
  const walk = (node: any) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child: any) => {
      walk(child);
      if (child.type === "element" && hasClass(child, "katex-display")) {
        const tex = extractTex(child);
        const btn = {
          type: "element",
          tagName: "button",
          properties: {
            type: "button",
            className: ["copy-btn", "formula-copy"],
            "data-tex": tex,
          },
          children: [{ type: "text", value: "复制" }],
        };
        return [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["formula-wrap"] },
            children: [child, btn],
          },
        ];
      }
      return [child];
    });
  };
  return (tree: any) => walk(tree);
}

// 代码块：带复制按钮（React 托管，读取渲染后的纯文本）
function CodeBlock({ node, ...props }: any) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略剪贴板不可用的情况 */
    }
  };
  return (
    <div className="code-wrap">
      <button className="copy-btn" type="button" onClick={copy}>
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={ref} {...props} />
    </div>
  );
}

// 公式复制按钮由 rehype 插件以静态节点注入，这里用事件委托处理点击
function onContainerClick(e: React.MouseEvent<HTMLDivElement>) {
  const btn = (e.target as HTMLElement).closest(
    ".formula-copy"
  ) as HTMLElement | null;
  if (!btn) return;
  const tex = btn.getAttribute("data-tex") ?? "";
  if (!tex) return;
  navigator.clipboard.writeText(tex).then(() => {
    btn.textContent = "已复制";
    setTimeout(() => (btn.textContent = "复制"), 1500);
  });
}

// 渲染助手回答：Markdown（表格/列表/代码）、LaTeX 公式、图片，均支持一键复制
export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown" onClick={onContainerClick}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false }],
          rehypeMathCopy,
          rehypeHighlight,
        ]}
        components={{
          pre: CodeBlock,
          img: ({ node, ...props }: any) => <img loading="lazy" {...props} />,
          a: ({ node, ...props }: any) => (
            <a target="_blank" rel="noreferrer noopener" {...props} />
          ),
        }}
      >
        {normalizeMath(content)}
      </Markdown>
    </div>
  );
}
