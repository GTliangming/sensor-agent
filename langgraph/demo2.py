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