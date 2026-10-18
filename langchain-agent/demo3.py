import os
from langchain.tools import ToolRuntime,tool
from langchain.messages import HumanMessage,AIMessage
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

@dataclass
class UserContext:
    user_id : str
    user_level : int =2 # 2:普通用户 1:Vip


@tool
def get_user_info(runtime : ToolRuntime[UserContext]) -> str:
    """ 获取当前用户信息，并根据等级返回不同的权限说明"""
    ctx = runtime.context
    if ctx.user_level == 1:
        return f"用户 {ctx.user_id}(VIP会员)特权: 无限制访问，可查询历史订单，专属折扣"
    else:
        return f"用户 {ctx.user_id}(普通用户)限制：仅可查询本月订单，且每日最多查询3次"



@tool
def get_user_question_count(runtime : ToolRuntime[UserContext]) -> str:
    """ 统计当前会话中用户提出的问题总数，当用户询问自己问了多少个问题的时候调用"""
    # 从State 中获取全部的对话消息
    all_message = runtime.state["messages"]
    # 统计用户消息数量
    user_count = len(
        [msg for msg in all_message if isinstance(msg, HumanMessage)]
    )
    return f"当前会话中，您一共提出了{user_count}个问题。"

# 创建Agent

agent = create_agent(
    model=llm,
    tools = [get_user_question_count,get_user_info],
    context_schema =  UserContext,
    system_prompt = "你是一个智能客服助手，回答用户的提问，了解用户身份，并且帮用户解决问题或者根据用户身份提供相应服务。",
)


# 调用测试
responses = agent.invoke(
    {
        "messages": [
            HumanMessage("我想买 IPhone 18 Duo"),
            AIMessage("好的，您想买多少部"),
            HumanMessage("现在还有多少库存呢？"),
            AIMessage("当前有100部库存"),
            HumanMessage("联系方式是多少"),
            AIMessage("联系方式是:客服400-xxxx-xxxx"),
            HumanMessage("请问我的账户有什么权限？"),
            HumanMessage("好的，我一共问了几个问题？"),
        ],
    },
    context=UserContext(user_id="123456", user_level=1),
)

print(responses["messages"][-1].content)
