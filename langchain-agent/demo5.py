import os
from langchain.tools import ToolRuntime,tool
from langchain.messages import HumanMessage, AIMessageChunk
from langchain.agents import create_agent
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from dataclasses import dataclass

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)

@tool
def get_weather(city : str) -> str:
    """ 获取指定城市天气信息"""
    return f"{city}今天阳光明媚，温度25度，湿度70%"


agent = create_agent(
    model= llm,
    tools= [get_weather],
    system_prompt= "你是一个智能助手，根据用户的提问去作答！"
)


for stream_mode, data in agent.stream(
    {"messages": [HumanMessage("西安今天的天气如何？")]},
    stream_mode= ["messages", "updates"],
):
    # 处理updates 步骤级更新
    if stream_mode == "updates":
        for node_name, update in data.items():
            # 模型发起工具调用
            if node_name == "model" and update["messages"][-1].tool_calls:
                tool_name = update["messages"][-1].tool_calls[0]["name"]
                print(f"\n 【准备调用工具】：{tool_name}")
            # 工具执行返回结果
            elif node_name == "tools":
                print(f"\n 【工具返回】：{update['messages'][-1].content}")

    elif stream_mode == "messages":
        token, metadata = data
        # 过滤工具消息，只打印模型最终回复
        if isinstance(token, AIMessageChunk) and token.content:
            print(token.content, end="", flush=True)
