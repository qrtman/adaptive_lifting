"""Browser origin enforcement and bounded authentication throttling."""
from collections import OrderedDict, deque
from time import monotonic
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

from .runtime_config import is_production_like


def install_request_security(app, allowed_origins):
    attempts = OrderedDict()
    auth_paths = {
        "/api/auth/login", "/api/auth/register", "/api/auth/google",
        "/api/integrations/telegram/miniapp/session",
    }

    @app.middleware("http")
    async def guard(request, call_next):
        if is_production_like() and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if not origin and request.headers.get("referer"):
                parsed = urlsplit(request.headers["referer"])
                origin = f"{parsed.scheme}://{parsed.netloc}"
            # CORS alone does not stop simple cross-origin form submissions.
            # Cookie-authenticated browser writes require an approved origin.
            if (origin and origin not in allowed_origins) or (not origin and request.cookies.get("session_id")):
                return JSONResponse({"detail": "Untrusted request origin"}, status_code=403)
            if request.url.path.rstrip("/") in auth_paths:
                address = request.client.host if request.client else "unknown"
                now = monotonic()
                window = attempts.setdefault(address, deque())
                attempts.move_to_end(address)
                while window and window[0] <= now - 60:
                    window.popleft()
                if len(window) >= 20:
                    return JSONResponse({"detail": "Too many authentication attempts"}, status_code=429, headers={"Retry-After": "60"})
                window.append(now)
                if len(attempts) > 10000:
                    attempts.popitem(last=False)
        return await call_next(request)
