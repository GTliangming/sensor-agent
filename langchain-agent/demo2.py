import os
from dotenv import load_dotenv
from langchain.tools import tool
from langchain.agents import create_agent
from langchain.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI

load_dotenv()

llm = ChatOpenAI(
    model= os.getenv("DEEPSEEK_MODEL"),
    api_key= os.getenv("DEEPSEEK_API_KEY"),
    base_url= os.getenv("DEEPSEEK_BASE_URL"),
)
# 定义工具
@tool
def check_stock(product_id: str) -> str:
    """检查库存"""

    # 模拟数据库查询
    stock_data = {
        "A1001":15,
        "A1002":0,
        "A1003":2,
    }
    stock = stock_data.get(product_id,0)
    if stock > 0:
        return f"商品 {product_id} 库存充足，剩余 {stock} 件"
    else:
        return f"商品 {product_id} 库存不足"

# 创建Agent 并注册工具
agent = create_agent(
    tools=[check_stock],
    model=llm,
)

# 调用工具
response = agent.invoke({
    "messages": [
        HumanMessage("商品 A1001 到底还有没有货？"),
    ]
})
print(response["messages"][-1].content)