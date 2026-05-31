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
        "name": "list_projects",
        "arguments": {}
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
        # Depending on the schema, result might contain a text message, or structured data
        # Let's inspect the keys
        if "content" in result:
            text = result["content"][0].get("text", "")
            try:
                # The text might be JSON formatted
                data = json.loads(text)
                projects = data if isinstance(data, list) else data.get("projects", [])
                print(f"Found {len(projects)} projects:")
                for p in projects:
                    print(f"- Title: {p.get('title')} ({p.get('name')})")
            except Exception:
                print("Text content:")
                print(text[:1000])
        else:
            print("Raw Result Keys:", result.keys())
            print(json.dumps(result, indent=2)[:1000])
except Exception as e:
    print(f"Error: {e}")
