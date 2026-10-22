import asyncio
import os
from operator import add
from dotenv import load_dotenv
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph,START,END
from langgraph.config import get_stream_writer
from langchain_core.messages import AnyMessage, HumanMessage,AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langchain_openai import ChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)

nodes = ["supervisor", "travel", "joke", "couplet", "other"]

class State(TypedDict):
    messages: Annotated[list[AnyMessage], add]
    type: str

def supervisor_node(state: State):
    print(">>>> supervisor_node")
    writer = get_stream_writer()
    writer({"node":">>>> supervisor_node"})
    # 如果已经有type,表示问题已经经过其他节点处理过了
    if "type" in state:
        writer({"supervisor_step": f"已获得{state['type']} 智能体处理结果"})
        return { "type": END }
    else:
        # 根据用户的问题类型，对问题进行分类，结果保存在type当中
        prompt = """
                你是一个智能助手，请根据用户的问题类型，对问题进行分类，并将任务分给其他Agent执行。
                问题类型包括：
                - 旅行和路线规划相关问题,返回：travel
                - 笑话相关问题,返回：joke
                - 对联相关问题,返回：couplet
                - 其他问题,返回：other
                除了这几个类型外，不要返回其他任何的内容
            """
        prompts = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": state["messages"][0].content},
        ]
        response = llm.invoke(prompts)
        writer({"supervisor_step":f"问题分类结果：{response.content}"})
        if response.content in nodes:
            return { "type": response.content }
        else:
            raise ValueError("type is not in (travel, joke, couplet, other)")

async def travel_node(state: State):
    print(">>>> travel_node")
    writer = get_stream_writer()
    writer({"node":">>>> travel_node"})

    client = MultiServerMCPClient(
        {
            "amap-maps":{
                "command": "npx",
                "args": ["-y", "@amap/amap-maps-mcp-server"],
                "env": {
                    "AMAP_MAPS_API_KEY": os.getenv("AMAP_MAPS_API_KEY"),
                },
                "transport": "stdio"
            }
        }
    )
    prompt = "你是一个专业旅行规划助手，你要根据用户的问题，生成一个旅游路线规划，并且用中文输出且长度不超过100个字。"

    prompts = [ 
        {"role": "system", "content": prompt},
        {"role": "user", "content": state["messages"][0].content},
    ]
    tools = await client.get_tools()
    agent = create_react_agent(
        model=llm,
        tools=tools
    )
    response = await agent.ainvoke({"messages": prompts})
    result = response["messages"][-1].content
    writer({"travel_result": result})
    return {"messages": [HumanMessage(content=result)], "type": "travel"}

def joke_node(state: State):
    print(">>>> joke_node")
    writer = get_stream_writer()
    writer({"node":">>>> joke_node"})

    prompt = "你是一个专业讲笑话的，你要根据用户的问题，写一个不超过100个字的笑话。"

    prompts = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": state["messages"][0].content},
    ]
    response = llm.invoke(prompts)
    return {"messages": [HumanMessage(content=response.content)], "type": "joke"}

def couplet_node(state: State):
    print(">>>> couplet_node")
    writer = get_stream_writer()
    writer({"node":">>>> couplet_node"})
    return {"messages": [HumanMessage(content="couplet_node")], "type": "couplet"}


def other_node(state: State):
    print(">>>> other_node")
    writer = get_stream_writer()
    writer({"node": ">>>> other_node"})
    return {"messages" : [HumanMessage(content="我暂时无法回答这个问题，抱歉！")],"type":"other"}

# 条件路由
def routing_func(state: State):
    if state["type"] == "travel":
        return "travel_node"
    elif state["type"] == "joke":
        return "joke_node"
    elif state["type"] == "couplet":
        return "couplet_node"
    elif state["type"] == END:
        return END
    else:
        return "other_node"


# 构建图
builder = StateGraph(State)
# 添加节点
builder.add_node("supervisor_node",supervisor_node)
builder.add_node("travel_node",travel_node)
builder.add_node("joke_node",joke_node)
builder.add_node("couplet_node",couplet_node)
builder.add_node("other_node",other_node)
# 构建边
builder.add_edge(START,"supervisor_node")
builder.add_conditional_edges(
    "supervisor_node",
    routing_func,
    ["travel_node","joke_node","couplet_node","other_node",END]
)
builder.add_edge("travel_node","supervisor_node")
builder.add_edge("joke_node","supervisor_node")
builder.add_edge("couplet_node","supervisor_node")
builder.add_edge("other_node","supervisor_node")

checkpointer = InMemorySaver()
# Graph完成构建
graph = builder.compile(checkpointer=checkpointer)


# 执行测试代码
if __name__ == "__main__":
    config = {
        "configurable": {
            "thread_id": "1"
        },
    }

    async def main():
        async for chunk in graph.astream(
            {
                "messages": [HumanMessage(content="帮我规划一个西安钟楼到大雁塔的驾车路线。")]
            },
            config,
            stream_mode="custom"
        ):
            print(chunk)

    asyncio.run(main())

    # res = graph.invoke(
    #     {
    #         "messages": [HumanMessage(content="给我将一个冷笑话。")]
    #     },
    #     config,
    #     stream_mode="custom"
    # )
    # print(res["messages"][-1].content)