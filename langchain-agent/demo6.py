import os
import time

from langchain.tools import ToolRuntime,tool
from langchain.messages import HumanMessage, AIMessageChunk
from langchain.agents import create_agent
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from dataclasses import dataclass
from langgraph.config import get_stream_writer

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)

@tool
def search_database(query : str) -> str:
    """ 根据关键词从数据库查询数据"""

    writer = get_stream_writer()
    writer(f"正在根据关键词：{query}从数据库查询数据")
    time.sleep(1)

    writer("根据关键词，已经找到50条相关记录")
    time.sleep(1)

    writer("查询完成，正在整理最佳结果")
    time.sleep(1)

    return f"关于{query}查询的结果是：。。。。。。"


agent = create_agent(
    model= llm,
    tools= [search_database],
    system_prompt= "你是一个智能助手，根据用户的提问去作答！"
)

for stream_mode, chunk in agent.stream(
        {"messages" : [HumanMessage("搜索 LangChain 的教程")]},
    stream_mode= ["messages", "custom"],
):
    # 自定义进度
    if stream_mode == "custom":
        print(f"\n 【当前进度】: {chunk}")
    elif stream_mode == "messages":
        token,metadata = chunk
        if isinstance(token, AIMessageChunk) and token.content:
            print(token.content, end="", flush=True)