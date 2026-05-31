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
        print(f"Stitch MCP Server returned {len(tools)} tools:")
        for t in tools:
            print(f"- {t.get('name')}: {t.get('description')}")
            # print("  Input parameters:")
            # print(json.dumps(t.get('inputSchema', {}).get('properties', {}), indent=2))
except Exception as e:
    print(f"Error: {e}")
