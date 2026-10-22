"""Agent 工作流：无 API Key 时保留确定性演示；配置 DeepSeek 后使用真实模型和工具。

本模块是整个 Agent 服务的编排核心，提供两条可切换的执行路径：
1. 真实模型路径：用 LangChain 的 create_agent 把 ChatOpenAI（以 OpenAI 兼容协议
   接入 DeepSeek）与工具组合成一个可自主调用工具的 Agent。
2. 确定性演示路径：不依赖任何外部模型，用固定规则产出可复现的输出，便于无密钥
   时启动项目、跑测试与学习流程。
同时用 LangGraph 的 StateGraph 把"分类 -> 回答"编排成一个演示用的有向图。
"""

from typing import Any

# create_agent：LangChain 高阶封装，输入模型、工具与系统提示，返回一个会在内部
# 自动完成"思考 -> 决定是否调用工具 -> 整合结果"循环的 Agent 执行器。
from langchain.agents import create_agent
# ChatOpenAI：OpenAI 兼容的聊天模型客户端；通过自定义 base_url 即可指向 DeepSeek。
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.graph.state import AgentState
# TOOLS：注册好的工具列表，交给 Agent 后模型即可按需调用。
from app.tools.registry import TOOLS


SYSTEM_PROMPT = """你是一个面向语音数据标注团队的中文业务助手。
请用清晰、务实的中文回答。涉及语音标注 SOP、切分、质检、规范等问题时，优先调用提供的检索工具，基于工具返回的内容作答。
必须区分工具检索到的资料与一般性建议；如果工具结果只是示例数据，要明确说明，不能声称查询了真实业务数据库。
不要声称自己执行了未实际调用的工具或访问了未接入的业务系统。"""


def run_deepseek_agent(input_text: str) -> dict[str, Any]:
    """调用 DeepSeek，并返回模型消息，供服务层生成真实执行轨迹。

    返回的 messages 是 LangChain 的消息列表（包含 AIMessage、ToolMessage 等），
    服务层会据此还原"模型思考、工具调用、工具返回"的完整执行轨迹。
    """
    # 缺少密钥时直接报错：真实模型路径强依赖 DEEPSEEK_API_KEY。
    if not settings.deepseek_api_key:
        raise RuntimeError(
            "已启用模型调用，但没有配置 DEEPSEEK_API_KEY。请在项目根目录 .env 中填写密钥。"
        )

    # 构造聊天模型：base_url 指向 DeepSeek，借助 OpenAI 兼容协议复用 ChatOpenAI。
    model = ChatOpenAI(
        model=settings.deepseek_model,
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url.rstrip("/"),
        temperature=settings.deepseek_temperature,
        timeout=settings.deepseek_timeout_seconds,
        max_retries=2,
    )
    # 把模型 + 工具 + 系统提示组合成 Agent，并一次性执行用户输入。
    # invoke 的入参是消息列表；Agent 内部自动完成多轮工具调用循环。
    agent = create_agent(model=model, tools=TOOLS, system_prompt=SYSTEM_PROMPT)
    result = agent.invoke({"messages": [{"role": "user", "content": input_text}]})
    messages = result.get("messages", [])
    answer = ""
    # 从后往前找最后一条有内容的 AI 消息，作为最终回答。
    for message in reversed(messages):
        if getattr(message, "type", "") == "ai" and getattr(message, "content", None):
            content = message.content
            # 模型返回可能是纯字符串，也可能是分段的结构化内容（list of dict）。
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
    """不消耗 API 额度的确定性示例，用于无密钥时启动和测试项目。

    用关键词匹配模拟"是否需要检索知识库"的分类逻辑，命中时直接调用示例工具，
    输出完全可复现，不依赖任何在线模型。
    """
    text = input_text
    # 命中业务关键词时，走"检索示例知识库"分支。
    if any(word in text for word in ("SOP", "标准", "切分", "质检", "规范")):
        # 直接调用注册表中的第一个工具（@tool 装饰后用 invoke 调用，入参为字典）。
        tool_result = TOOLS[0].invoke({"query": text})
        answer = (
            f"根据当前示例知识库：\n\n{tool_result}\n\n"
            "说明：这是演示数据，尚未连接真实业务数据库。"
        )
        tool_summary = "命中业务知识检索意图"
    else:
        # 未命中时给出提示，引导用户配置真实模型。
        answer = (
            "我已收到你的任务。当前运行在演示模式，尚未调用在线大模型。\n\n"
            "配置 DEEPSEEK_API_KEY 并设置 MODEL_ENABLED=true 后，即可启用 DeepSeek。"
        )
        tool_summary = "当前为确定性示例工作流"
    return {"answer": answer, "tool_summary": tool_summary, "messages": []}


# 保留旧名称，便于已有代码或学习示例引用。
def build_graph():
    """用 LangGraph 构建"分类 -> 回答"的演示工作流，返回可执行的编译后图。

    StateGraph 以 AgentState 作为在节点间流转的共享状态；每个节点接收当前状态、
    返回状态的增量更新，LangGraph 负责把增量合并回整体状态。
    """
    # 延迟导入：仅在构图时才引入 LangGraph，避免模块加载期的强依赖。
    from langgraph.graph import END, START, StateGraph

    def classify_node(state: AgentState) -> AgentState:
        # 分类节点：根据输入是否含业务关键词，判定任务意图并写入 tool_summary。
        text = state.get("input", "")
        if any(word in text for word in ("SOP", "标准", "切分", "质检", "规范")):
            return {"tool_summary": "命中业务知识检索意图"}
        return {"tool_summary": "当前为基础示例工作流；真实业务查询需接入 Go 授权 API"}

    def respond_node(state: AgentState) -> AgentState:
        # 回答节点：复用确定性演示逻辑生成最终答复，写回 answer。
        result = run_demo_agent(state.get("input", ""))
        return {"answer": result["answer"]}

    # 声明图、注册节点，并用边把执行顺序串成 START -> classify -> respond -> END。
    graph = StateGraph(AgentState)
    graph.add_node("classify", classify_node)
    graph.add_node("respond", respond_node)
    graph.add_edge(START, "classify")
    graph.add_edge("classify", "respond")
    graph.add_edge("respond", END)
    # compile 把图固化为可调用对象，之后即可通过 invoke 驱动整条流程。
    return graph.compile()


# 模块加载时即编译出图实例，供外部直接复用。
agent_graph = build_graph()
