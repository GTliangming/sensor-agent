"""外部依赖层：SiliconFlow 的 rerank 客户端（cross-encoder 精排）。

OpenAI SDK 没有 rerank 方法，这里用 httpx 直接调 SiliconFlow 的 /v1/rerank。
用于两阶段检索的第二步：对向量粗筛出的候选逐一打分、重新排序。
"""

import httpx

from config import config


class RerankError(Exception):
    """rerank 服务调用失败（上层据此回退到纯向量排序）。"""


def rerank(query: str, docs: list[str], top_n: int) -> list[tuple[int, float]]:
    """对 docs 逐条打分并排序。

    返回 [(原始下标, 相关性分数), ...]，按分数从高到低，最多 top_n 条。
    下标对应传入 docs 的位置，便于调用方映射回原始 chunk。
    """
    if not docs:
        return []

    config.validate_embedding()  # 复用 SiliconFlow key 的校验
    url = f"{config.SILICONFLOW_BASE_URL.rstrip('/')}/rerank"
    payload = {
        "model": config.RERANK_MODEL,
        "query": query,
        "documents": docs,
        "top_n": min(top_n, len(docs)),
        "return_documents": False,
    }
    headers = {"Authorization": f"Bearer {config.SILICONFLOW_API_KEY}"}

    try:
        resp = httpx.post(
            url, json=payload, headers=headers, timeout=config.RERANK_TIMEOUT
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except Exception as exc:  # noqa: BLE001 —— 统一转领域异常，由上层回退
        raise RerankError(str(exc)) from exc

    ranked = [
        (int(r["index"]), float(r["relevance_score"]))
        for r in results
        if r.get("index") is not None
    ]
    ranked.sort(key=lambda x: x[1], reverse=True)
    return ranked[:top_n]
