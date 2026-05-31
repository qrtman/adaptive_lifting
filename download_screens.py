import urllib.request
import ssl
import json

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

screens = {
    "command_center.html": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1MjkwYmFjMzUyYmIwNjM5NDVhZTY3MjQ3NzI1EgsSBxCAvbi9-xsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTk5MDg1NTI2NDg4NTEwNjM1Mg&filename=&opi=89354086",
    "execution_feed.html": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1MjkwYmFmNzZhNzcwOTEwNzVmMGZkMDBlMThkEgsSBxCAvbi9-xsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTk5MDg1NTI2NDg4NTEwNjM1Mg&filename=&opi=89354086",
    "analysis_terminal.html": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1MjkwYmFlOWYzZTYwMmQzYzY0MTgxMDYxYjQ2EgsSBxCAvbi9-xsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTk5MDg1NTI2NDg4NTEwNjM1Mg&filename=&opi=89354086"
}

for name, url in screens.items():
    print(f"Downloading {name} from Stitch...")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            content = response.read().decode('utf-8')
            with open(name, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully saved {name} ({len(content)} bytes)")
    except Exception as e:
        print(f"Error downloading {name}: {e}")
