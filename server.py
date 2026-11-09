import asyncio
import json
import uuid
import time
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import websockets

app = FastAPI(title="nokey-api OpenAI Proxy")

# ── 全局状态管理 ──────────────────────────────────────────
CONNECTED_WEBSOCKET = None
ACTIVE_JOBS: Dict[str, asyncio.Event] = {}
JOB_RESPONSES: Dict[str, List[Dict[str, Any]]] = {}
CURRENT_BINDING = None

# ── 安全免责声明 ──────────────────────────────────────────
DISCLAIMER = """
======================================================================
                     【nokey-api 开源免责声明】
1. 本项目属于 RPA（机器人流程自动化）及自动化测试技术研究成果，完全开源。
2. 本工具不接管、不收集用户的任何账号、密码、Cookie 或个人隐私数据。
3. 用户完全在自主登录的浏览器中使用本工具，其本质为模拟人类看屏与输入行为。
4. 严禁将本工具用于高频商业刷量、爬虫或恶意攻击行为。
5. 因违反各大模型平台《服务条款》（ToS）导致账号被限制或封禁，作者概不负责。
======================================================================
"""
print(DISCLAIMER)

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    stream: Optional[bool] = False
    temperature: Optional[float] = 0.7

# ── 协议深度翻译：对下网页端的 Super Prompt 变形引擎 ───────────────
def transform_to_web_prompt(request: ChatCompletionRequest) -> str:
    history_text = ""
    system_instruction = "你现在是一个标准的自动化后端大模型 API 节点。"
    
    # 扁平化多轮历史上下文，采用强标签物理隔离，防止网页版模型思维混乱
    for msg in request.messages:
        if msg.role == "system":
            system_instruction = msg.content
        else:
            history_text += f"\n<{msg.role.upper()}>\n{msg.content}\n</{msg.role.upper()}>\n"
            
    web_prompt = f"""[API MODE ACTIVE]
# INSTRUCTION
你当前作为一个无缝嵌入开发工作流的底层 API 节点运行。
你必须无条件遵从下方定义的所有系统指令与输出格式规范，不要包含任何多余的寒暄。

# SYSTEM DIRECTION
{system_instruction}

# CONVERSATION HISTORY (READ-ONLY)
以下是此会话的历史上下文，请结合上下文深入理解用户的最终任务：
{history_text}

# THE FINAL USER TASK
请立即处理并响应最后一条用户指令。如果指令要求你调用工具或返回特定格式（如JSON/代码），请严格执行，不要包裹任何多余的闲聊：
<{request.messages[-1].role.upper()}>
{request.messages[-1].content}
</{request.messages[-1].role.upper()}>
"""
    return web_prompt

# ── WebSocket 信道控制（新版单参数签名） ──────────────────────────
async def ws_handler(websocket):
    global CONNECTED_WEBSOCKET, CURRENT_BINDING
    CONNECTED_WEBSOCKET = websocket
    print(f"\n[nokey-api] 浏览器插件已成功建立通信管道。")
    
    try:
        async for raw_message in websocket:
            msg = json.loads(raw_message)
            msg_type = msg.get("type")
            job_id = msg.get("job_id")
            payload = msg.get("payload", {})

            if msg_type == "connection.hello":
                await websocket.send(json.dumps({
                    "version": 1, "event_id": str(uuid.uuid4()),
                    "type": "connection.ready", "payload": {"token": "rainbow_secure_token_xyz"}
                }))
                print("[nokey-api] 握手授权成功，信道就绪。")
            elif msg_type == "connection.ping":
                await websocket.send(json.dumps({"version": 1, "type": "connection.pong"}))
            elif msg_type == "session.bind":
                CURRENT_BINDING = payload
                print(f"[nokey-api] 成功锚定标签页 -> URL: {payload.get('url')}")
            elif msg_type in ["reply.started", "reply.updated", "reply.completed", "job.failed", "job.unknown"]:
                if job_id in ACTIVE_JOBS:
                    if job_id not in JOB_RESPONSES:
                        JOB_RESPONSES[job_id] = []
                    JOB_RESPONSES[job_id].append({
                        "type": msg_type, "text": payload.get("text", ""), "detail": payload.get("detail", "")
                    })
                    ACTIVE_JOBS[job_id].set()
    except Exception as e:
        print(f"[nokey-api] 通信过程发生异常: {e}")
    finally:
        if CONNECTED_WEBSOCKET == websocket:
            CONNECTED_WEBSOCKET = None
            CURRENT_BINDING = None
            print("[nokey-api] 浏览器插件通信管道已断开。")

# ── 协议深度翻译：对上 Agent 的 OpenAI 兼容度协议规范接口 ───────────
@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    global CONNECTED_WEBSOCKET, CURRENT_BINDING
    if not CONNECTED_WEBSOCKET or not CURRENT_BINDING:
        raise HTTPException(status_code=503, detail="nokey-api 核心控制端未绑定任何 AI 聊天标签页")

    # 调用变形器组装多轮洗脑提示词
    processed_prompt = transform_to_web_prompt(request)
    job_id = str(uuid.uuid4())
    
    ACTIVE_JOBS[job_id] = asyncio.Event()
    JOB_RESPONSES[job_id] = []

    submit_event = {
        "version": 1, "event_id": str(uuid.uuid4()), "type": "job.submit", "job_id": job_id,
        "payload": {
            "tab_id": CURRENT_BINDING["tab_id"], "document_id": CURRENT_BINDING["document_id"],
            "url": CURRENT_BINDING["url"], "text": processed_prompt
        }
    }
    await CONNECTED_WEBSOCKET.send(json.dumps(submit_event))

    if request.stream:
        async def sse_generator():
            last_sent_length = 0
            is_done = False
            while not is_done:
                await ACTIVE_JOBS[job_id].wait()
                ACTIVE_JOBS[job_id].clear()
                events = JOB_RESPONSES[job_id]
                while events:
                    ev = events.pop(0)
                    if ev["type"] in ["job.failed", "job.unknown"]:
                        # 核心清洗传递：如果中间层触发了平台风控噪音拦截，安全向上抛出异常告知 Agent
                        yield f"data: {json.dumps({'error': ev['detail']})}\n\n"
                        is_done = True
                        break
                    
                    chunk_text = ev["text"][last_sent_length:]
                    if chunk_text:
                        last_sent_length = len(ev["text"])
                        chunk_payload = {
                            "id": job_id, "object": "chat.completion.chunk", "created": int(time.time()),
                            "model": request.model,
                            "choices": [{"index": 0, "delta": {"content": chunk_text}, "finish_reason": None}]
                        }
                        yield f"data: {json.dumps(chunk_payload)}\n\n"

                    if ev["type"] == "reply.completed":
                        final_payload = {
                            "id": job_id, "object": "chat.completion.chunk", "created": int(time.time()),
                            "model": request.model,
                            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                        }
                        yield f"data: {json.dumps(final_payload)}\n\n"
                        yield "data: [DONE]\n\n"
                        is_done = True
                        break
                await asyncio.sleep(0.05)
            ACTIVE_JOBS.pop(job_id, None)
            JOB_RESPONSES.pop(job_id, None)
        return StreamingResponse(sse_generator(), media_type="text/event-stream")
    else:
        while True:
            await ACTIVE_JOBS[job_id].wait()
            ACTIVE_JOBS[job_id].clear()
            events = JOB_RESPONSES[job_id]
            for ev in events:
                if ev["type"] in ["job.failed", "job.unknown"]:
                    raise HTTPException(status_code=500, detail=ev["detail"])
                if ev["type"] == "reply.completed":
                    # 动态估算并伪造 Token 计数器，解决 Agent 强制元数据校验阻断
                    comp_tokens = int(len(ev["text"]) * 1.5)
                    prom_tokens = int(len(processed_prompt) * 1.5)
                    response_json = {
                        "id": job_id, "object": "chat.completion", "created": int(time.time()), "model": request.model,
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": ev["text"]}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": prom_tokens, "completion_tokens": comp_tokens, "total_tokens": prom_tokens + comp_tokens}
                    }
                    ACTIVE_JOBS.pop(job_id, None)
                    JOB_RESPONSES.pop(job_id, None)
                    return response_json
            await asyncio.sleep(0.1)

async def main():
    async with websockets.serve(ws_handler, "127.0.0.1", 8766):
        print("[nokey-api] 控制中心已在 ws://127.0.0.1:8766 挂载就绪...")
        import uvicorn
        config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="info")
        server = uvicorn.Server(config)
        await server.serve()

if __name__ == "__main__":
    asyncio.run(main())
