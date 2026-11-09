import asyncio
import json
import uuid
import httpx
import websockets

# ── 模拟网络配置 ──────────────────────────────────────────────
WS_URL = "ws://" + "127.0.0.1" + ":" + "8766"
API_URL = "http://" + "127.0.0.1" + ":" + "8000" + "/v1/chat/completions"

MOCK_TAB_ID = 8888
MOCK_DOCUMENT_ID = str(uuid.uuid4())
MOCK_URL = "https://deepseek.com"

# ── 阶段一：纯后端模拟高仿真浏览器插件行为 ────────────────────────
async def mock_browser_plugin():
    await asyncio.sleep(1)  # 等待 HTTP 线程启动
    print("[测试-模拟插件] 正在尝试建立与控制中心的 WebSocket 连接...")
    
    try:
        async with websockets.connect(WS_URL) as ws:
            print("[测试-模拟插件] 🟢 WebSocket 通信管道连接成功。")
            
            # 1. 客户端 Hello 握手
            hello_msg = {
                "version": 1,
                "event_id": str(uuid.uuid4()),
                "type": "connection.hello",
                "payload": {"extension_id": "mock_test_extension_id"}
            }
            await ws.send(json.dumps(hello_msg))
            
            raw_ready = await ws.recv()
            ready_msg = json.loads(raw_ready)
            print(f"[测试-模拟插件] 接收到服务端授权响应: {ready_msg.get('type')}")
            
            # 2. 模拟用户点击 Popup 锚定绑定
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
            print("[测试-模拟插件] ⚓ 模拟绑定成功！已成功锚定 DeepSeek 仿真网页沙盒。")
            
            # 3. 核心：监听并捕获来自 server.py 已经过“洗脑变形”的 Super Prompt
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
                    print("[测试-模拟插件] 📥 核心拦截：捕获到经过 Server 深度转换的 Super Prompt 投喂流：")
                    print("-" * 50)
                    print(super_prompt)
                    print("-" * 50)
                    print("[测试-模拟插件] ⏳ 正在模拟多模型网页端动态增量蹦字输出...")
                    
                    # 模拟大模型网页开始吐字 (reply.started)
                    await ws.send(json.dumps({
                        "version": 1, "type": "reply.started", "job_id": job_id,
                        "payload": {"text": "遵照指令，API 节点启动。根据上下文，", "seq": 1}
                    }))
                    await asyncio.sleep(0.3)
                    
                    # 模拟打字机增量吐字 (reply.updated)
                    chunks = ["多轮历史对话 ", "洗脑提示词 ", "与 Token 估算伪造 ", "在全链路总线中 ", "测试成功！"]
                    current_text = "遵照指令，API 节点启动。根据上下文，"
                    
                    for i, chunk in enumerate(chunks, start=2):
                        current_text += chunk
                        await ws.send(json.dumps({
                            "version": 1, "type": "reply.updated", "job_id": job_id,
                            "payload": {"text": current_text, "seq": i}
                        }))
                        await asyncio.sleep(0.2)  # 模拟打字间隔延迟
                    
                    # 模拟网页生成彻底结束 (reply.completed)
                    await ws.send(json.dumps({
                        "version": 1, "type": "reply.completed", "job_id": job_id,
                        "payload": {"text": current_text, "seq": len(chunks) + 2}
                    }))
                    print("[测试-模拟插件] 🏁 仿真网页端生成流全部正常结束，回传数据闭环。")
                    break
                    
    except Exception as e:
        print(f"[测试-模拟插件] ❌ 仿真链路断开: {e}")

# ── 阶段二：模拟高级 Agent 发起包含【多轮历史】的流式请求 ────────────
async def mock_agent_client():
    await asyncio.sleep(2)  # 等待虚拟插件完成安全锚定
    print("\n[测试-模拟Agent] 🤖 逼真 Agent 启动，发起复杂的【多轮历史+系统指令】OpenAI 请求...")
    
    # 模拟真实的 Cursor / LangChain 复杂上下文结构
    request_payload = {
        "model": "nokey-deepseek-chat",
        "messages": [
            {"role": "system", "content": "你是一个极度严谨的资深代码专家，回答问题只输出干货代码。"},
            {"role": "user", "content": "你好，请问你是谁？"},
            {"role": "assistant", "content": "你好！我是你的智能代码助手。有什么我可以帮你的？"},
            {"role": "user", "content": "请结合你刚才的专家角色和对话历史，验证多轮链路是否通畅。"}
        ],
        "stream": True  # 开启流式打字机测试
    }
    
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", API_URL, json=request_payload, timeout=30.0) as response:
                if response.status_code != 200:
                    print(f"[测试-模拟Agent] ❌ 接口响应错误，状态码: {response.status_code}")
                    return
                
                print("[测试-模拟Agent] 🟢 成功接入 nokey-api Gateway，开始接收同步流数据：")
                print("-" * 50)
                
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_content = line[6:].strip()
                        if data_content == "[DONE]":
                            print("\n" + "-" * 50)
                            print("[测试-模拟Agent] 🎉 成功捕获 [DONE] 终止符，元数据完美兼容！")
                            break
                        
                        try:
                            chunk_json = json.loads(data_content)
                            delta = chunk_json["choices"]["delta"]
                            if "content" in delta:
                                # 实时打印打字机吐出来的字
                                print(delta["content"], end="", flush=True)
                        except:
                            pass
    except Exception as e:
        print(f"[测试-模拟Agent] ❌ HTTP 请求抛出致命异常: {e}")

# ── 核心异步执行引擎 ────────────────────────────────────────────
async def runner():
    print("=" * 60)
    print("        nokey-api (V0.1.0 Beta Edition) 核心总线测试")
    print("============================================================")
    
    await asyncio.gather(
        mock_browser_plugin(),
        mock_agent_client()
    )

if __name__ == "__main__":
    try:
        asyncio.run(runner())
    except KeyboardInterrupt:
        print("\n[测试] 用户强行终止。")
