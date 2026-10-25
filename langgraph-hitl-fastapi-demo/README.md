# Human-in-the-Loop LangGraph Demo (FastAPI + React)

This demo shows how a React client request is handled by FastAPI and processed by a LangGraph workflow. It is designed as a learning project: the frontend exposes the generated plan, each execution step, graph events, and both human review points.

## What This Demo Shows

- A plan-first workflow: the agent creates a structured plan before drafting an answer.
- Human review of the plan: edit, add, or remove steps, approve the plan, or request a new plan with feedback.
- Step-by-step execution: each plan step records its status and result; failures are recorded and surfaced in the final draft.
- A second human review point for the answer: request a revision or approve the final response.
- Streaming and blocking API variants for comparing request handling.
- SQLite-backed LangGraph checkpoints and pending request payloads for the main graph.

Plan steps are explicit work items for review. They are not hidden chain-of-thought.

## Workflow

```text
React
  -> FastAPI validates the request
  -> LangGraph generates a structured plan
  -> pause: human reviews or edits the plan
  -> execute approved steps one at a time
  -> draft an answer from the step results
  -> pause: human requests a revision or approves the answer
  -> finish
```

The graph is implemented with `assistant_plan`, `human_plan_review`, `assistant_execute_step`, `assistant_draft`, `human_feedback`, and `assistant_finalize` nodes. The execution node loops over the approved steps. The two interrupt points are `human_plan_review` and `human_feedback`.

If plan JSON is invalid, the planner retries once and then returns an error. A step failure is recorded as `failed` with an error message; the graph can continue and the final draft must disclose failed or incomplete work instead of claiming it succeeded.

## Frontend

The React app has three useful views:

- **Chat and plan review:** submit a request, inspect and edit each generated step, add or delete steps, approve execution, or request replanning with feedback.
- **LangGraph HITL debugger:** inspect the `thread_id`, request and response records, trace events, current graph node/branch, plan steps, execution results, and errors.
- **Flow guide:** follow how a browser request moves through FastAPI, SQLite, LangGraph, SSE, and human review.

The debugger displays events captured by the current browser session. It is a learning and troubleshooting view, not a durable audit log.

## Main Graph State and Persistence

The plan is stored as structured steps. Each step has an ID, description, status, result, and error. The graph state also tracks the current step index and plan review action/feedback, alongside the answer review state.

The main graph uses a local SQLite database at `backend/langgraph_state.sqlite3`:

- LangGraph's SQLite checkpointer stores graph checkpoints, including paused runs.
- The `pending_runs` table stores the request or resume payload that a later streaming GET consumes.

This supports resuming the main graph after a backend process restart. The database is local and currently has no encryption, retention policy, user isolation, or production-grade access control. It may contain user requests, plans, and model output; protect it accordingly. The database file is ignored by Git.

The separate MCP demo uses an in-memory checkpointer and does not have the same cross-process resume guarantee.

## Run Locally

### Requirements

- Python with `pip`
- Node.js and npm
- A DeepSeek API key for the main planning graph
- Docker and a GitHub personal access token only if you want to use the MCP routes

### Backend

Run backend commands from the `backend` directory:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Set the model credentials in an environment file discoverable from the backend (the app uses `find_dotenv()` to search for `.env`):

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
# Optional; defaults to https://api.deepseek.com
DEEPSEEK_BASE_URL=https://api.deepseek.com
# Optional; defaults to deepseek-chat
DEEPSEEK_MODEL=deepseek-chat
```

Start FastAPI:

```bash
uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`; interactive docs are at `http://127.0.0.1:8000/docs`.

### Frontend

In another terminal:

```bash
cd frontend
npm install
npm start
```

Open `http://localhost:3000`. The frontend calls the API at `http://localhost:8000`. Backend CORS allows `http://localhost:3000` and `http://localhost:3001`.

## Streaming API Walkthrough

The streaming endpoints are:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/graph/stream/create` | Create a run and queue its initial request |
| `GET` | `/graph/stream/{thread_id}` | Consume the pending operation and stream graph events |
| `POST` | `/graph/stream/plan-review` | Approve/edit the plan or request replanning |
| `POST` | `/graph/stream/resume` | Provide answer feedback or approve the answer |

Create a run:

```bash
curl -X POST http://localhost:8000/graph/stream/create \
  -H "Content-Type: application/json" \
  -d '{"human_request":"Explain what Human-in-the-Loop means"}'
```

Use the returned `thread_id` to stream until the plan review checkpoint:

```bash
curl --no-buffer http://localhost:8000/graph/stream/{thread_id}
```

Approve the reviewed plan. The submitted steps are the steps the graph will execute, so edits made in the frontend can be submitted here:

```bash
curl -X POST http://localhost:8000/graph/stream/plan-review \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id":"{thread_id}",
    "plan_action":"approved",
    "plan_steps":[
      {"description":"Define Human-in-the-Loop and explain why it is useful"},
      {"description":"Explain how a graph pauses and resumes"}
    ]
  }'
```

To request replanning, use `"plan_action":"replan"` and provide a non-empty `plan_feedback` instead of approving the plan:

```json
{
  "thread_id": "{thread_id}",
  "plan_action": "replan",
  "plan_feedback": "Make the plan shorter and include one concrete example."
}
```

Stream again to observe step execution and the answer draft:

```bash
curl --no-buffer http://localhost:8000/graph/stream/{thread_id}
```

When the graph pauses for answer review, request a revision:

```bash
curl -X POST http://localhost:8000/graph/stream/resume \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id":"{thread_id}",
    "review_action":"feedback",
    "human_comment":"Make the answer shorter and include an example."
  }'
```

Stream the revised draft, then approve it when it reaches answer review again:

```bash
curl --no-buffer http://localhost:8000/graph/stream/{thread_id}

curl -X POST http://localhost:8000/graph/stream/resume \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"{thread_id}","review_action":"approved"}'

curl --no-buffer http://localhost:8000/graph/stream/{thread_id}
```

Each review endpoint only accepts requests when the graph is paused at the matching review node. Invalid payloads return `422`; missing runs return `404`; attempting an action at the wrong graph stage returns `409`.

### SSE Events

The stream provides several event types:

- `start` and `resume`: identify a new or resumed graph run.
- `token`: text emitted while the graph generates a draft or final response.
- `status`: current user-facing state, such as `plan_review`, `user_feedback`, or `finished`.
- `trace`: backend lifecycle details such as `run_started`, `graph_input_prepared`, `plan_generated`, `plan_review_applied`, `execution_step_completed`, `checkpoint_saved`, `awaiting_plan_review`, `awaiting_human`, `run_finished`, and `backend_error`.
- `error`: a graph or server error.

The execution trace includes step index, total steps, step status, result/error, and the next step index. Text events depend on the LangGraph message stream; they should not be interpreted as a guarantee of provider-native token-by-token delivery.

## Blocking API

The blocking implementation follows the same plan-first and two-review workflow, but each request waits for the graph operation to reach its next pause or completion:

- `POST /graph/start`: start a run; it can return at plan review.
- `POST /graph/plan-review`: approve/edit the plan or request replanning.
- `POST /graph/resume`: provide answer feedback or approve the answer.

Use the streaming endpoints and blocking endpoints as alternative interfaces to the same main graph. Do not submit both styles concurrently for the same `thread_id`.

## MCP Tool-Calling Demo

The separate MCP routes demonstrate tool approval with a GitHub MCP server:

- Configuration: `backend/config/mcp_servers.json`
- Runtime prerequisites: Docker and `GITHUB_PERSONAL_ACCESS_TOKEN`
- The MCP agent has its own model configuration and in-memory checkpoint; it is separate from the DeepSeek-backed main graph and is not restored across backend restarts.

Example requests:

```bash
curl -X POST http://localhost:8000/mcp/start \
  -H "Content-Type: application/json" \
  -d '{"human_request":"Provide info about my GitHub account"}'

curl -X POST http://localhost:8000/mcp/approve \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"{thread_id}","approve_action":"approved"}'
```

Use `"approve_action":"rejected"` to reject a proposed tool call. Tool availability and required credentials depend on the MCP server configuration.

## Validation

From `frontend`:

```bash
npm run build
npm test
```

From `backend`:

```bash
python -m compileall -q app
python -m pip check
```

The most important manual integration path is: create a run, inspect/review the plan, approve or replan, observe each execution step, submit answer feedback, then approve the final answer. Also verify invalid review payloads and wrong-stage requests. Restart the backend while a main-graph run is paused and resume it with the same `thread_id` to check SQLite checkpoint recovery.

## Learning Goals

- Trace a frontend HTTP request through FastAPI validation and LangGraph state updates.
- Understand structured planning, conditional/looping graph execution, checkpointing, and human interrupts.
- Compare SSE streaming with blocking request/response APIs.
- Distinguish the main graph's SQLite persistence from the separate MCP demo's in-memory state.
