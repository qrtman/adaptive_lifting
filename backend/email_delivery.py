"""Transactional email adapters. Never include provider response bodies in errors."""
import html
import os
from dataclasses import dataclass

import requests


class EmailDeliveryError(Exception):
    def __init__(self, *, temporary=True):
        super().__init__("Email provider temporarily unavailable" if temporary else "Email provider rejected delivery")
        self.temporary = temporary


@dataclass(frozen=True)
class VerificationMessage:
    recipient: str
    url: str

    def content(self):
        text = ("Verify your Adaptive Lifting email\n\n"
                f"Confirm your email: {self.url}\n\n"
                "This single-use link expires 24 hours after your request. Confirm on the page, then sign in. "
                "If you did not register, you can ignore this email.")
        body = ("<h1>Verify your Adaptive Lifting email</h1>"
                f'<p><a style="display:inline-block;padding:14px 20px;background:#202020;color:#ffffff;border-radius:6px;text-decoration:none" href="{html.escape(self.url, quote=True)}">Verify email address</a></p>'
                "<p>This single-use link expires 24 hours after your request. Confirm on the page, then sign in.</p>"
                "<p>If you did not register, you can ignore this email.</p>")
        return text, body


class ResendEmailProvider:
    def send(self, message, job_id):
        plain, body = message.content()
        try:
            response = requests.post("https://api.resend.com/emails", timeout=15,
                headers={"Authorization": f"Bearer {os.environ['EMAIL_PROVIDER_API_KEY']}",
                         "Idempotency-Key": job_id},
                json={"from": os.environ["EMAIL_FROM"], "to": [message.recipient],
                      "subject": "Verify your Adaptive Lifting email", "html": body, "text": plain})
        except requests.RequestException:
            raise EmailDeliveryError() from None
        if not 200 <= response.status_code < 300:
            raise EmailDeliveryError(temporary=response.status_code in {408, 429} or response.status_code >= 500)


class FakeEmailProvider:
    """Explicit test/development adapter; messages stay in memory, never in logs."""
    def __init__(self):
        self.messages = []
        self.failures_remaining = 0
        self.delivered_ids = set()

    def send(self, message, job_id):
        if self.failures_remaining:
            self.failures_remaining -= 1
            raise EmailDeliveryError()
        if job_id not in self.delivered_ids:
            self.messages.append(message)
            self.delivered_ids.add(job_id)


fake_provider = FakeEmailProvider()


def email_provider():
    from .runtime_config import is_production_like
    name = os.environ.get("EMAIL_PROVIDER", "").strip()
    if name == "resend":
        return ResendEmailProvider()
    if name == "fake" and not is_production_like():
        return fake_provider
    raise RuntimeError("A transactional EMAIL_PROVIDER is required")
