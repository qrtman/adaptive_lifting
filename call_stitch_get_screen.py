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
    "method": "tools/call",
    "params": {
        "name": "get_screen",
        "arguments": {
            "name": "projects/10013589761028402611/screens/10577317681933374740",
            "projectId": "10013589761028402611",
            "screenId": "10577317681933374740"
        }
    },
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
        
        result = parsed.get("result", {})
        if "content" in result:
            text = result["content"][0].get("text", "")
            print("Screen Details Text:")
            print(text[:3000])
        else:
            print("Raw Result Keys:", result.keys())
            print(json.dumps(result, indent=2)[:3000])
except Exception as e:
    print(f"Error: {e}")
