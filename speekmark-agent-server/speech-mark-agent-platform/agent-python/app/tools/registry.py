"""工具注册表：用 LangChain @tool 把普通函数登记为 Agent 可调用的工具。"""

from langchain_core.tools import tool


# @tool 装饰器会读取函数签名与 docstring，自动生成工具的 schema（名称、参数、描述），
# 使 Agent 中的模型能理解并按需调用；这里演示的是一个本地示例知识库检索工具。
@tool
def search_annotation_sop(query: str) -> str:
    """在本地示例知识库中检索语音标注 SOP。生产环境应替换为经过授权的检索服务。"""
    # 简化版关键词匹配：仅为演示，命中则返回对应的示例 SOP 文案。
    q = query.strip().lower()
    if "切分" in query or "boundary" in q or "segment" in q:
        return "示例 SOP：切分边界应贴合实际语音起止；避免吞字、截断音素和不必要的静音。"
    if "质检" in query or "quality" in q:
        return "示例 SOP：质检应检查标签准确性、时间边界、说话人一致性及格式完整性。"
    return "示例知识库暂未命中，请补充关键词或接入真实 SOP 检索服务。"


# TOOLS：对外暴露的工具集合，由工作流传给 create_agent 或直接 invoke 调用。
TOOLS = [search_annotation_sop]
