import urllib.request
import json
import ssl

import os

url = "https://stitch.googleapis.com/mcp"
api_key = os.environ.get("STITCH_API_KEY", "")

headers = {
    "X-Goog-Api-Key": api_key,
    "Content-Type": "application/json"
}

body = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1
}

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request(
    url, 
    data=json.dumps(body).encode('utf-8'), 
    headers=headers,
    method="POST"
)

try:
    with urllib.request.urlopen(req, context=ctx) as response:
        content = response.read().decode('utf-8')
        parsed = json.loads(content)
        
        tools = parsed.get("result", {}).get("tools", [])
        for t in tools:
            if t.get("name") in ["list_screens", "get_screen"]:
                print(f"Tool: {t.get('name')}")
                print(json.dumps(t.get("inputSchema", {}), indent=2))
                print("="*40)
except Exception as e:
    print(f"Error: {e}")
