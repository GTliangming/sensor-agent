from langchain_core.tools import tool


@tool
def search_annotation_sop(query: str) -> str:
    """在本地示例知识库中检索语音标注 SOP。生产环境应替换为经过授权的检索服务。"""
    q = query.strip().lower()
    if "切分" in query or "boundary" in q or "segment" in q:
        return "示例 SOP：切分边界应贴合实际语音起止；避免吞字、截断音素和不必要的静音。"
    if "质检" in query or "quality" in q:
        return "示例 SOP：质检应检查标签准确性、时间边界、说话人一致性及格式完整性。"
    return "示例知识库暂未命中，请补充关键词或接入真实 SOP 检索服务。"


TOOLS = [search_annotation_sop]
