# Python 语法速查表（基于本项目代码）

> 面向「有编程基础、但对现代 Python 写法不熟」的速查。每条都配本项目里的真实代码片段 + 一句话解释。
> 看不懂某处代码时，回这里按符号查即可。

---

## 一、类型标注（Type Hints）

类型标注给人和类型检查器（mypy）看，**运行时不强制**，不影响程序逻辑。

| 写法 | 含义 | 项目例子（文件） |
|---|---|---|
| `x: str` | x 是字符串 | `app_name: str` (config.py) |
| `x: int = 10` | x 是整数，默认 10 | `annotation_api_timeout_seconds: int = 10` |
| `str \| None` | 要么字符串要么 None（旧写法 `Optional[str]`） | `api_key: str \| None = None` (client.py) |
| `list[str]` | 字符串列表 | `cors_origins: list[str]` (config.py) |
| `dict[str, Any]` | 键是 str、值任意 | `payload: dict[str, Any]` (client.py) |
| `Sequence[LLMMessage]` | 「可遍历的序列」，比 list 更宽松 | `messages: Sequence[LLMMessage]` (client.py) |
| `Literal["ok", "degraded"]` | 只能是这几个固定值之一 | `status: Literal["ok", "degraded"]` (health.py) |
| `-> LLMResult` | 函数返回值类型 | `async def chat(...) -> LLMResult` |

> `str | None = None` 读法：类型是「str 或 None」，不传时默认 None。

---

## 二、函数参数

```python
def __init__(self, *, api_key=None, base_url=None, ...):   # client.py
```

- **`*,`（单独一个星号）**：分隔符，**它后面的参数调用时必须写参数名**。
  - `Client(api_key="x")` ✅ ；`Client("x")` ❌
  - 目的：参数多时防止位置传错、代码自解释。
- **`默认值`**：`def f(x=10)`，不传就用默认值。
- **`**kwargs`**：收集多余的关键字参数成字典（本项目暂未大量用到）。

---

## 三、条件表达式与推导式

**三元表达式（一行 if/else）**
```python
self._api_key = settings.deepseek_api_key if api_key is None else api_key   # client.py
```
读法：「如果 `api_key is None` 取前者，否则取后者」。等价于四行 if/else。

**列表推导式**
```python
[{"role": m.role, "content": m.content} for m in messages]   # client.py
```
读法：「对 messages 里每个 m，造一个字典，收集成列表」。等价于 for 循环 + append。

**`A or B` 兜底默认**
```python
content = (parsed.choices[0].message.content or "").strip()   # client.py
display_name=args.display_name or args.username               # create_user.py
```
`A or B`：A 为「真」就用 A，否则用 B。常用来给可能为 None/空的值兜个默认。

---

## 四、集合类型

| 类型 | 特点 | 项目例子 |
|---|---|---|
| `set{...}` | 不重复元素，查「在不在」极快（O(1)） | — |
| `frozenset({...})` | **只读版 set**，创建后不能改，适合当常量 | `_RETRYABLE_STATUS = frozenset({429, 500, ...})` (client.py) |
| `tuple(...)` | 不可变的「列表」，常量序列 | `ROLES = ("admin", "annotator", ...)` (create_user.py) |

```python
if response.status_code in _RETRYABLE_STATUS:   # 查白名单，frozenset 查得快
```

---

## 五、类相关

**`@dataclass` / `frozen=True`** — 自动生成 `__init__`/`__repr__`/`__eq__` 的「数据类」
```python
@dataclass(frozen=True)        # types.py
class LLMMessage:
    role: str
    content: str
```
- 省掉手写构造函数，直接 `LLMMessage(role="user", content="hi")`。
- `frozen=True`：**不可变**，创建后改字段会报错，适合「数据快照」。

**`@property`** — 把方法当属性访问（不用加括号）
```python
@property
def go_user_id(self) -> str | None:   # deps.py
    ...
# 用：current.go_user_id   （不是 current.go_user_id()）
```

**`@staticmethod`** — 不需要 `self` 的工具方法
```python
@staticmethod
def _raise_for_status(response): ...   # client.py，只看参数不碰实例
```

**命名约定**
- `self._api_key`：前导下划线 = **约定的「私有，外部别直接用」**（不强制）。
- `__aenter__`、`__init__`：前后双下划线 = **dunder/魔术方法**，解释器在特定时机自动调用。

---

## 六、异步（async）

```python
async def chat(self, ...):                     # 异步函数（协程）
    response = await self._client.post(...)     # 等 I/O，期间不阻塞
    await asyncio.sleep(delay)                  # 异步睡眠，不卡线程
```
- `async def`：定义协程，遇到 I/O 能「让出」给事件循环去干别的。
- `await`：等待一个异步操作完成；只能用在 `async def` 里。
- 对比：`time.sleep()` 卡死整个线程，`await asyncio.sleep()` 不卡。

**异步上下文管理器**（配合 `async with`）
```python
async def __aenter__(self): return self        # 进入 with 时
async def __aexit__(self, *a): await self.aclose()   # 退出 with 时（自动关资源）
# 用法：
async with DeepSeekClient() as c:
    await c.chat(...)
# 出了这个块，无论是否异常，都会自动 aclose()
```

---

## 七、异常处理

```python
try:
    body = response.json()
except ValueError as exc:                 # as exc：拿到异常对象
    raise AppError(...) from exc           # from exc：异常链，保留根因
```
- `except X as e`：捕获异常并命名为 e。
- `raise New from old`：转抛新异常，把原始异常挂后面，排查时堆栈能看到「根因」。
- **捕获顺序**：子类异常要写在父类前面。如 client.py 里 `httpx.TimeoutException`（子类）必须在 `httpx.HTTPError`（父类）之前捕获，否则超时会被当普通错误。

---

## 八、字符串与日志

**f-string**（格式化字符串）
```python
headers["Authorization"] = f"Bearer {self._api_key}"   # client.py
print(f"created user id={user.id}")                    # create_user.py
```
`f"...{表达式}..."`：花括号里的内容会被求值并插入。

**`%`-风格的惰性日志**
```python
logger.warning("llm retry reason=%s attempt=%s", reason, attempt)   # client.py
```
`%s` 是占位符，真正的值当参数传。好处：**只有真要输出该级别日志时才拼字符串**，省性能。别写成 `logger.warning(f"...{reason}")`。

---

## 九、其他常见符号

| 写法 | 含义 | 项目例子 |
|---|---|---|
| `2 ** attempt` | 幂运算，`2**3==8` | 指数退避 (client.py) |
| `from __future__ import annotations` | 让类型标注「延迟求值」，可写还没定义的类型 | client.py 顶部 |
| `@lru_cache` | 缓存函数结果，同参数只算一次 | `get_settings()` (config.py) |
| `*args` | 收集多余位置参数成元组 | — |
| `Path(__file__).resolve().parents[1]` | 当前文件往上第 2 层目录 | create_user.py |

---

## 用法建议

1. 读项目代码卡住时，先回这里按符号查。
2. 这些占了本项目「看不懂」的 ~90%，看熟后基本无障碍读自己的代码。
3. 新遇到的写法，随时让我补进这张表。

