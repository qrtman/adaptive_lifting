"""Browser origin enforcement and bounded authentication throttling."""
from starlette.concurrency import run_in_threadpool
from .auth_limits import allow_auth_attempt
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

from .runtime_config import is_production_like


def install_request_security(app, allowed_origins):
    auth_paths = {
        "/api/auth/login", "/api/auth/register", "/api/auth/google",
        "/api/auth/verify-email", "/api/auth/resend-verification",
        "/api/integrations/telegram/miniapp/session",
        "/api/billing/stripe/checkout-session", "/api/billing/stripe/portal-session",
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
        path = request.url.path.rstrip("/")
        if request.method == "POST" and path in auth_paths:
            address = request.client.host if request.client else "unknown"
            category = "registration" if path.endswith("/register") else "verification" if path.endswith("/verify-email") else "resend" if path.endswith("/resend-verification") else "auth"
            limit, seconds = (10, 3600) if category == "registration" else (20, 60)
            if not await run_in_threadpool(allow_auth_attempt, address, category, limit, seconds):
                return JSONResponse({"detail": "Too many authentication attempts"}, status_code=429, headers={"Retry-After": str(seconds)})
        response = await call_next(request)
        if path.startswith("/api/auth/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response
