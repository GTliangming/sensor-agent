import os
from dotenv import load_dotenv
from langchain_core.messages import AIMessage,HumanMessage,SystemMessage
from langchain_openai import ChatOpenAI
from langchain.agents import create_agent

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)

# 手动构建对话历史
messages = [
    SystemMessage(content="你好一位翻译专家，将中文翻译成英文。"),
    HumanMessage(content="我的朋友，你好吗？"),
    AIMessage(content="Hello friend, how are you?"),
    HumanMessage(content="我正在写代码"),
]


# 调用模型
# response = llm.invoke(messages)
# print(response.content)

# 创建agent
agent = create_agent(model=llm)
#
response = agent.invoke({"messages": messages})
print(response["messages"][-1])


