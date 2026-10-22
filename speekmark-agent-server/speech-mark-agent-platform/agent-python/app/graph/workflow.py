"""Agent 工作流：无 API Key 时保留确定性演示；配置 DeepSeek 后使用真实模型和工具。"""

from typing import Any

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.graph.state import AgentState
from app.tools.registry import TOOLS


SYSTEM_PROMPT = """你是一个面向语音数据标注团队的中文业务助手。
请用清晰、务实的中文回答。涉及语音标注 SOP、切分、质检、规范等问题时，优先调用提供的检索工具，基于工具返回的内容作答。
必须区分工具检索到的资料与一般性建议；如果工具结果只是示例数据，要明确说明，不能声称查询了真实业务数据库。
不要声称自己执行了未实际调用的工具或访问了未接入的业务系统。"""


def run_deepseek_agent(input_text: str) -> dict[str, Any]:
    """调用 DeepSeek，并返回模型消息，供服务层生成真实执行轨迹。"""
    if not settings.deepseek_api_key:
        raise RuntimeError(
            "已启用模型调用，但没有配置 DEEPSEEK_API_KEY。请在项目根目录 .env 中填写密钥。"
        )

    model = ChatOpenAI(
        model=settings.deepseek_model,
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url.rstrip("/"),
        temperature=settings.deepseek_temperature,
        timeout=settings.deepseek_timeout_seconds,
        max_retries=2,
    )
    agent = create_agent(model=model, tools=TOOLS, system_prompt=SYSTEM_PROMPT)
    result = agent.invoke({"messages": [{"role": "user", "content": input_text}]})
    messages = result.get("messages", [])
    answer = ""
    for message in reversed(messages):
        if getattr(message, "type", "") == "ai" and getattr(message, "content", None):
            content = message.content
            if isinstance(content, str):
                answer = content
            elif isinstance(content, list):
                answer = "\n".join(
                    str(part.get("text", "")) for part in content if isinstance(part, dict)
                ).strip()
            if answer:
                break
    if not answer:
        raise RuntimeError("DeepSeek 已返回结果，但未找到可展示的文本回答。")
    return {"answer": answer, "messages": messages}


def run_demo_agent(input_text: str) -> dict[str, Any]:
    """不消耗 API 额度的确定性示例，用于无密钥时启动和测试项目。"""
    text = input_text
    if any(word in text for word in ("SOP", "标准", "切分", "质检", "规范")):
        tool_result = TOOLS[0].invoke({"query": text})
        answer = (
            f"根据当前示例知识库：\n\n{tool_result}\n\n"
            "说明：这是演示数据，尚未连接真实业务数据库。"
        )
        tool_summary = "命中业务知识检索意图"
    else:
        answer = (
            "我已收到你的任务。当前运行在演示模式，尚未调用在线大模型。\n\n"
            "配置 DEEPSEEK_API_KEY 并设置 MODEL_ENABLED=true 后，即可启用 DeepSeek。"
        )
        tool_summary = "当前为确定性示例工作流"
    return {"answer": answer, "tool_summary": tool_summary, "messages": []}


# 保留旧名称，便于已有代码或学习示例引用。
def build_graph():
    from langgraph.graph import END, START, StateGraph

    def classify_node(state: AgentState) -> AgentState:
        text = state.get("input", "")
        if any(word in text for word in ("SOP", "标准", "切分", "质检", "规范")):
            return {"tool_summary": "命中业务知识检索意图"}
        return {"tool_summary": "当前为基础示例工作流；真实业务查询需接入 Go 授权 API"}

    def respond_node(state: AgentState) -> AgentState:
        result = run_demo_agent(state.get("input", ""))
        return {"answer": result["answer"]}

    graph = StateGraph(AgentState)
    graph.add_node("classify", classify_node)
    graph.add_node("respond", respond_node)
    graph.add_edge(START, "classify")
    graph.add_edge("classify", "respond")
    graph.add_edge("respond", END)
    return graph.compile()


agent_graph = build_graph()
