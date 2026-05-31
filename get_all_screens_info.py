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

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# List of screen IDs from list_screens
screen_ids = [
    "10577317681933374740",
    "a9c2f554b4b043d7b3374fd94ead7c3e",
    "45557c2247c748babefa2ed3994eca20",
    "aef103d21b8d4b979e4322cdd1069f28",
    "1fef58966fdc482290e4512c9b91c5b9",
    "c5ac61c9ad0940e293c4d101f110cc28",
    "a3c18d5cc8d54504bc51145eec762477",
    "30be19f1d76344f389216ab149ba9896",
    "b2048d72cc64472bbfda1d90fc40cb48",
    "0bef375a76e0427db999a0cb73a447b0",
    "f4bbc38549bc43fd83b436d8b1b11892",
    "10577317681933376630"
]

project_id = "10013589761028402611"

print(f"Fetching screen info for {len(screen_ids)} screens:")
for sid in screen_ids:
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "get_screen",
            "arguments": {
                "name": f"projects/{project_id}/screens/{sid}",
                "projectId": project_id,
                "screenId": sid
            }
        },
        "id": 1
    }
    
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
                try:
                    data = json.loads(text)
                    title = data.get("title", "No Title")
                    mime = data.get("htmlCode", {}).get("mimeType", "No Mime")
                    print(f"- ID: {sid} | Title: {title} | MimeType: {mime}")
                except Exception:
                    print(f"- ID: {sid} | RawText (first 100 char): {text[:100]}")
            else:
                print(f"- ID: {sid} | No content field")
    except Exception as e:
        print(f"- ID: {sid} | Error: {e}")
