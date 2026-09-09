from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str, headers: dict | None = None) -> HTTPException:
    kwargs = {
        "status_code": status_code,
        "detail": {"error": {"code": code, "message": message}},
    }
    if headers:
        kwargs["headers"] = headers
    return HTTPException(**kwargs)
