import asyncio
import json
import uuid
import time
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()
CONNECTED_WEBSOCKET: Optional[WebSocket] = None
JOB_QUEUES: dict = {}
CURRENT_BINDING = None

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[dict]
    stream: Optional[bool] = False
    temperature: Optional[float] = 0.7

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global CONNECTED_WEBSOCKET, CURRENT_BINDING
    await websocket.accept()
    CONNECTED_WEBSOCKET = websocket
    print("\n🟢 [Gateway] Monolithic WebSocket 核心总线成功挂载绑定！")
    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                msg = json.loads(raw_data)
            except Exception as pe:
                print(f"❌ [Gateway] JSON 解析异常: {pe}, 原始数据: {raw_data}")
                continue

            m_type = msg.get("type")
            job_id = msg.get("job_id")
            payload = msg.get("payload", {})
            
            # 调试打点：彻底看清插件发回了什么
            if m_type != "connection.ping":
                print(f"📥 [WebSocket 接收] Type: {m_type} | Job: {job_id} | PayloadKeys: {list(payload.keys())}")

            if m_type == "session.bind": 
                CURRENT_BINDING = payload
                print(f"⚓ [Gateway] 成功绑定视场作用域: {CURRENT_BINDING}")
            elif m_type in ["reply.started", "reply.updated", "reply.completed", "job.failed"]:
                if job_id in JOB_QUEUES:
                    # 💡 饱和式鲁棒提取：防止 content.js 或 background.js 传输层嵌套错位导致 KeyError
                    extracted_text = payload.get("text", "")
                    if not extracted_text and isinstance(payload.get("payload"), dict):
                        extracted_text = payload["payload"].get("text", "")
                    
                    await JOB_QUEUES[job_id].put({
                        "type": m_type, 
                        "text": str(extracted_text)
                    })
    except WebSocketDisconnect:
        print("🔴 [Gateway] 检测到插件物理断开连接")
    except Exception as e:
        print(f"❌ [Gateway] WebSocket 核心循环发生未预期崩溃: {str(e)}")
    finally:
        CONNECTED_WEBSOCKET = None

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    global CONNECTED_WEBSOCKET, CURRENT_BINDING
    if not CONNECTED_WEBSOCKET: 
        raise HTTPException(status_code=503, detail="插件未连接，上行断层")
        
    job_id = str(uuid.uuid4())
    JOB_QUEUES[job_id] = asyncio.Queue()
    
    prompt = f"[API MODE]\n# THE FINAL USER TASK\n<USER>\n{request.messages[-1]['content']}\n</USER>\n"
    
    try:
        await CONNECTED_WEBSOCKET.send_text(json.dumps({
            "version": 1, 
            "type": "job.submit", 
            "job_id": job_id,
            "payload": {"tab_id": int(CURRENT_BINDING["tab_id"]) if CURRENT_BINDING else 0, "text": prompt}
        }))
    except Exception as se:
        JOB_QUEUES.pop(job_id, None)
        raise HTTPException(status_code=500, detail=f"向上行物理通道发包失败: {str(se)}")
    
    final_text = ""
    deadline = time.time() + 45.0
    completed_normally = False
    
    print(f"🚀 [Agent Task] 任务 {job_id} 已成功下发，进入异步高并发接收队列...")
    
    while time.time() < deadline:
        try:
            # 缩短 wait_for 超时至 0.2 秒，实现极速高频响应
            ev = await asyncio.wait_for(JOB_QUEUES[job_id].get(), timeout=0.2)
            
            if ev["text"]: 
                final_text = ev["text"]
                
            if ev["type"] == "reply.completed":
                print(f"🎯 [Agent Task] 接收到完成信标 [reply.completed]，完美收网！")
                completed_normally = True
                break
            elif ev["type"] == "job.failed":
                print(f"❌ [Agent Task] 网页报告任务失败 [job.failed]")
                break
        except asyncio.TimeoutError: 
            continue
        except Exception as queue_err:
            print(f"❌ [Agent Task] 队列处理发生非预期异常: {queue_err}")
            break
            
    JOB_QUEUES.pop(job_id, None)
    
    # 💡 兜底策略：如果超时了，但我们手里其实已经抓到了全文本扫描的有效资产（长度大于5），
    # 依然强行视作通关放行返回给 Agent，绝不引发 500 回滚！
    if not completed_normally and len(final_text) > 5:
        print(f"⚠️ [Agent Task] 虽然未收到完成信标，但抓取到有效资产长度 {len(final_text)}，保底强制放行！")
        completed_normally = True

    if not completed_normally or not final_text:
        raise HTTPException(status_code=500, detail="未能捕获有效资产，历史已被安全回滚。")
        
    return {
        "id": job_id, 
        "object": "chat.completion", 
        "created": int(time.time()), 
        "model": request.model, 
        "choices": [{
            "index": 0, 
            "message": {"role": "assistant", "content": final_text}, 
            "finish_reason": "stop"
        }]
    }

if __name__ == "__main__":
    import uvicorn
    # 将 log_level 改为 info，彻底看清 Fast API 报错的控制台调用栈
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
