import asyncio
import json
import uuid
import httpx
import websockets

# ── 统一网络配置对齐 ──────────────────────────────────────────
# 💡 核心对齐点：将原有的 8766 虚拟端口，彻底收拢至 server.py 的 8000/ws 统一样式总线端
WS_URL = "ws://127.0.0.1:8000/ws"
API_URL = "http://127.0.0"

MOCK_TAB_ID = 8888
MOCK_DOCUMENT_ID = str(uuid.uuid4())
MOCK_URL = "https://google.com"

# ── 阶段一：纯后端模拟高仿真浏览器插件行为 ────────────────────────
async def mock_browser_plugin():
    await asyncio.sleep(1)  # 等待 HTTP 线程或服务就绪
    print("[测试-模拟插件] 正在尝试建立与中央网关的 WebSocket 连接...")
    
    try:
        async with websockets.connect(WS_URL) as ws:
            print("[测试-模拟插件] 🟢 WebSocket 通信信道连接成功。")
            
            # 1. 客户端 Hello 握手
            hello_msg = {
                "version": 1,
                "event_id": str(uuid.uuid4()),
                "type": "connection.hello",
                "payload": {"extension_id": "mock_test_extension_id"}
            }
            await ws.send(json.dumps(hello_msg))
            
            # 2. 模拟用户点击 Popup 绑定网页标签页
            bind_msg = {
                "version": 1,
                "event_id": str(uuid.uuid4()),
                "type": "session.bind",
                "payload": {
                    "tab_id": MOCK_TAB_ID,
                    "document_id": MOCK_DOCUMENT_ID,
                    "url": MOCK_URL
                }
            }
            await ws.send(json.dumps(bind_msg))
            print("[测试-模拟插件] ⚓ 模拟绑定成功！已锁定测试仿真网页作用视场。")
            
            # 3. 核心：监听并捕获来自 server.py 已经过处理的 Super Prompt
            async for raw_task in ws:
                task = json.loads(raw_task)
                
                if task.get("type") == "connection.ping":
                    await ws.send(json.dumps({"version": 1, "type": "connection.pong"}))
                    continue
                if task.get("type") == "event.ack":
                    continue
                    
                if task.get("type") == "job.submit":
                    job_id = task.get("job_id")
                    super_prompt = task["payload"]["text"]
                    
                    print("\n" + "="*50)
                    print("[测试-模拟插件] 📥 核心拦截：捕获到经过 Server 转换后的 Super Prompt 投喂文本：")
                    print("-" * 50)
                    print(super_prompt)
                    print("-" * 50)
                    print("[测试-模拟插件] ⏳ 正在模拟多模型网页端动态增量输出...")
                    
                    # 模拟大模型网页开始吐字 (reply.started)
                    await ws.send(json.dumps({
                        "version": 1, "type": "reply.started", "job_id": job_id,
                        "payload": {"text": "已成功承接上行指令。根据对话历史，", "seq": 1}
                    }))
                    await asyncio.sleep(0.3)
                    
                    # 模拟打字机增量吐字 (reply.updated)
                    chunks = ["多轮历史上下文 ", "差值清洗逻辑 ", "与元数据估算伪造 ", "已在全链路中 ", "验证通过。"]
                    current_text = "已成功承接上行指令。根据对话历史，"
                    
                    for i, chunk in enumerate(chunks, start=2):
                        current_text += chunk
                        await ws.send(json.dumps({
                            "version": 1, "type": "reply.updated", "job_id": job_id,
                            "payload": {"text": current_text, "seq": i}
                        }))
                        await asyncio.sleep(0.2)  # 模拟打字延迟
                    
                    # 模拟网页生成结束 (reply.completed)
                    await ws.send(json.dumps({
                        "version": 1, "type": "reply.completed", "job_id": job_id,
                        "payload": {"text": current_text, "seq": len(chunks) + 2}
                    }))
                    print("[测试-模拟插件] 🏁 仿真网页端生成流结束，回传数据大闭环。")
                    break
                    
    except Exception as e:
        print(f"[测试-模拟插件] ❌ 仿真链路发生异常: {e}")

# ── 阶段二：模拟高级 Agent 发起包含【多轮历史】的流式请求 ────────────
async def mock_agent_client():
    await asyncio.sleep(2)  # 等待虚拟插件完成绑定
    print("\n[测试-模拟Agent] 🤖 模拟 Agent 启动，发起多轮历史上下文 OpenAI 格式请求...")
    
    # 模拟真实的 复杂上下文结构
    request_payload = {
        "model": "nokey-google-ai",
        "messages": [
            {"role": "system", "content": "你是一个极度严谨的代码专家，回答问题请保持简洁。"},
            {"role": "user", "content": "你好，请问你是谁？"},
            {"role": "assistant", "content": "你好！我是你的智能代码助手。"},
            {"role": "user", "content": "请结合对话历史，测试多轮链路是否通畅。"}
        ],
        "stream": True  # 开启流式测试
    }
    
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", API_URL, json=request_payload, timeout=30.0) as response:
                if response.status_code != 200:
                    print(f"[测试-模拟Agent] ❌ 接口响应错误，状态码: {response.status_code}")
                    return
                
                print("[测试-模拟Agent] 🟢 成功连接 nokey-api Gateway，接收同步流数据：")
                print("-" * 50)
                
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_content = line[6:].strip()
                        if data_content == "[DONE]":
                            print("\n" + "-" * 50)
                            print("[测试-模拟Agent] 🎉 成功捕获 [DONE] 终止符，协议格式对齐兼容。")
                            break
                        
                        try:
                            chunk_json = json.loads(data_content)
                            delta = chunk_json["choices"]["delta"]
                            if "content" in delta:
                                # 实时打印打字机流式字符
                                print(delta["content"], end="", flush=True)
                        except:
                            pass
    except Exception as e:
        print(f"[测试-模拟Agent] ❌ HTTP 请求发生异常: {e}")

# ── 核心异步执行引擎 ────────────────────────────────────────────
async def runner():
    print("=" * 60)
    print("        nokey-api (V0.2.0 Alpha Edition) 核心总线联调测试")
    print("============================================================")
    
    await asyncio.gather(
        mock_browser_plugin(),
        mock_agent_client()
    )

if __name__ == "__main__":
    try:
        asyncio.run(runner())
    except KeyboardInterrupt:
        print("\n[测试] 用户手动终止。")
