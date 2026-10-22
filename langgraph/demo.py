import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.checkpoint.memory import InMemorySaver

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)

# 请求模型
def call_model(state:MessagesState):
    response = llm.invoke(state["messages"])
    return {"messages": response}

builder = StateGraph(MessagesState)
builder.add_node(call_model)
builder.add_edge(START, "call_model")

checkpointer = InMemorySaver()
config = {
    "configurable":{
        "thread_id": "111"
    }
}
graph =  builder.compile(checkpointer=checkpointer)

result = graph.stream(
    {"messages":[{"role":"user", "content":"陕西省的省会是哪里?"}]},
    stream_mode = "values",
    config = config
)
for chunk in result:
    chunk["messages"][-1].pretty_print()

result2 = graph.stream(
    {"messages":[{"role":"user", "content":"甘肃呢？"}]},
    stream_mode = "values",
    config = config
)
for chunk in result2:
    chunk["messages"][-1].pretty_print()


