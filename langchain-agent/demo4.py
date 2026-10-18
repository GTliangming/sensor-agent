from langchain.chat_models import init_chat_model
from dotenv import load_dotenv
import os
import asyncio


load_dotenv()

llm = init_chat_model(
    model = os.getenv("DEEPSEEK_MODEL"),
    model_provider = "openai",
    base_url = os.getenv("DEEPSEEK_BASE_URL"),
    api_key = os.getenv("DEEPSEEK_API_KEY"),
)


# for chunk in llm.stream("给我讲一个笑话"):
#     print(chunk.content, end="", flush=True)

async def stream_response():
    for chunk in llm.stream("给我讲一个笑话"):
        print(chunk.content, end="", flush=True)

asyncio.run(stream_response())