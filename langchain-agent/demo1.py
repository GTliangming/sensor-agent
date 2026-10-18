import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate , MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain.messages import  AIMessage,HumanMessage

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)

# # 定义提示词模板
# prompt_template = ChatPromptTemplate.from_template(
#     "你是{role}专家,请用{style}风格回答问题,问题：{question}"
# )

# # 单轮+format_messages
# # 格式化生成消息列表
# message = prompt_template.format_messages(
#     role = "文学",
#     style = "幽默",
#     question = "讲个故事"
# )


# response = llm.invoke(message)
# print(response.content)

# 链式调用
# chain = prompt_template | llm | StrOutputParser()
#
# content = chain.invoke({
#     "role": "文学",
#     "style": "幽默",
#     "question": "讲个故事"
# })
#
# print(content)


# 构建带占位符的模板
prompt_template = ChatPromptTemplate.from_messages([
    ("system","你是一个友好的客服助手！"),
    MessagesPlaceholder(variable_name="chat_history"),
    ("user","{question}"),
])

# 构建历史对话
history_message = [
    AIMessage(content="你好！请问有什么可以帮您？"),
    HumanMessage(content="我想查一下订单状态"),
]
chain = prompt_template | llm | StrOutputParser()

content = chain.invoke({
    "chat_history":history_message,
    "question":"我的订单号是6666"
})
print(content)