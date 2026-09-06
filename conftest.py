import os

os.environ.setdefault("JWT_SECRET_CURRENT", "test-jwt-secret-current")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://testserver")
os.environ.setdefault("COOKIE_SECURE", "false")
