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

project_id = "10013589761028402611"

target_screens = {
    "stitch_calendar_antigravity.html": "a3c18d5cc8d54504bc51145eec762477",
    "stitch_calendar_macos_dark.html": "0bef375a76e0427db999a0cb73a447b0",
    "stitch_weekly_enhanced.html": "f4bbc38549bc43fd83b436d8b1b11892"
}

for local_name, sid in target_screens.items():
    print(f"Fetching metadata for screen ID: {sid} ({local_name})...")
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
                data = json.loads(text)
                html_code = data.get("htmlCode", {})
                download_url = html_code.get("downloadUrl")
                if download_url:
                    print(f"Downloading code from {download_url[:100]}...")
                    dl_req = urllib.request.Request(
                        download_url,
                        headers={"User-Agent": "Mozilla/5.0"}
                    )
                    with urllib.request.urlopen(dl_req, context=ctx) as dl_res:
                        code_content = dl_res.read().decode('utf-8')
                        with open(local_name, "w", encoding="utf-8") as f:
                            f.write(code_content)
                        print(f"Saved {local_name} ({len(code_content)} bytes)")
                else:
                    print(f"No download URL found for {sid}")
            else:
                print(f"No content field for {sid}")
    except Exception as e:
        print(f"Error for {sid}: {e}")
    print("-" * 50)
