import os
import base64
import uuid
import hmac
import hashlib
import urllib.parse
import json
import requests
import time
import secrets
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Header, Response
from sqlalchemy.orm import Session
try:
    from cryptography.fernet import Fernet
except Exception as exc:
    raise RuntimeError(
        "cryptography is required for integration credential encryption"
    ) from exc

from .database import (
    get_db, User, IntegrationConnection, IntegrationCredential, 
    IntegrationOutbox, WebhookEvent, SheetPublication, Workout, 
    Microcycle, Exercise, ExerciseSet, CoachingRelationship, OAuthState
)
from .main import get_current_user, start_session
from .math_utils import calculate_e1rm_linear_decay, calculate_inol, calculate_dots

router = APIRouter()

# --- Config & Keys ---
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "mock_webhook_secret")
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "mock_client_id")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "mock_client_secret")
INTEGRATION_ENCRYPTION_KEY = os.environ.get("INTEGRATION_ENCRYPTION_KEY", "dev-only-change-me")
APP_URL = os.environ.get("APP_URL", "http://localhost:5173")

# In-memory dictionary for short-lived link tokens: token -> {"user_id": user_id, "expires_at": datetime}
PENDING_LINK_TOKENS = {}

# --- Security Encryption / Decryption Helpers ---
def _fernet_for_key(key: str) -> Fernet:
    try:
        f_key = base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest())
        return Fernet(f_key)
    except Exception as exc:
        raise RuntimeError("Integration credential encryption could not initialize") from exc


def encrypt_data(data: str, key: str) -> str:
    return _fernet_for_key(key).encrypt(data.encode()).decode()

def decrypt_data(token: str, key: str) -> str:
    return _fernet_for_key(key).decrypt(token.encode()).decode()

# --- Telegram Helper Functions ---
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 5 * 60
TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS = 30


def verify_telegram_init_data(init_data: str, bot_token: str) -> dict:
    """Verify Telegram WebApp initData and return its authenticated user object.

    We accept data up to five minutes old and tolerate clocks up to 30 seconds
    ahead. The freshness limit narrows the replay window but is not one-time
    replay prevention.
    """
    if (
        not isinstance(init_data, str) or not init_data
        or not isinstance(bot_token, str) or not bot_token.strip()
        or bot_token == "mock_bot_token"
    ):
        raise ValueError("Invalid Telegram authentication")
    try:
        pairs = urllib.parse.parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        if not pairs:
            raise ValueError
        # Duplicate keys make the signed representation ambiguous across parsers.
        if len({key for key, _ in pairs}) != len(pairs):
            raise ValueError
        parsed = dict(pairs)
        received_hash = parsed.pop("hash", None)
        if not received_hash or len(received_hash) != 64:
            raise ValueError
        try:
            bytes.fromhex(received_hash)
        except ValueError:
            raise ValueError
        data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(parsed.items()))
        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated_hash, received_hash.lower()):
            raise ValueError

        auth_date_raw = parsed.get("auth_date")
        if not auth_date_raw or not auth_date_raw.isascii() or not auth_date_raw.isdecimal():
            raise ValueError
        auth_date = int(auth_date_raw)
        now = int(time.time())
        age = now - auth_date
        if age < -TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS or age > TELEGRAM_INIT_DATA_MAX_AGE_SECONDS:
            raise ValueError

        user_raw = parsed.get("user")
        if not user_raw:
            raise ValueError
        user = json.loads(user_raw)
        if not isinstance(user, dict) or isinstance(user.get("id"), bool) or not isinstance(user.get("id"), int) or user["id"] <= 0:
            raise ValueError
        return user
    except (TypeError, ValueError, UnicodeError, json.JSONDecodeError):
        # Never include initData or the bot token in errors or logs.
        raise ValueError("Invalid Telegram authentication") from None

def send_telegram_message(chat_id: int, text: str, reply_markup: dict = None) -> bool:
    if TELEGRAM_BOT_TOKEN == "mock_bot_token":
        print(f"[MOCK TELEGRAM BOT] Chat {chat_id}: {text}")
        return True
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML"
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        res = requests.post(url, json=payload, timeout=6)
        return res.status_code == 200
    except Exception as e:
        print(f"Failed to post to Telegram: {str(e)}")
        return False

# --- Telegram Webhook / Linking Endpoints ---

@router.post("/api/integrations/telegram/link-token")
def generate_telegram_link_token(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Generate 8-character numeric link token
    import random
    token = "".join(random.choices("0123456789", k=8))
    PENDING_LINK_TOKENS[token] = {
        "user_id": current_user.id,
        "expires_at": datetime.utcnow() + timedelta(minutes=10)
    }
    return {"token": token, "bot_username": "AdaptiveLiftingBot"}

@router.post("/api/integrations/telegram/miniapp/session")
def telegram_miniapp_session(req: dict, response: Response, db: Session = Depends(get_db)):
    initData = req.get("initData")
    linkToken = req.get("linkToken")
    
    if not initData:
        raise HTTPException(status_code=400, detail="Missing initData")
        
    try:
        tg_user = verify_telegram_init_data(initData, TELEGRAM_BOT_TOKEN)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
        
    tg_user_id = tg_user.get("id")
    if not tg_user_id:
        raise HTTPException(status_code=400, detail="No user id in initData")
        
    # Check if this user is trying to link an account
    user = None
    if linkToken:
        token_info = PENDING_LINK_TOKENS.get(linkToken)
        if not token_info or token_info["expires_at"] < datetime.utcnow():
            raise HTTPException(status_code=400, detail="Link token expired or invalid")
            
        user_id = token_info["user_id"]
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Associated user not found")
            
        # Create connection
        conn = db.query(IntegrationConnection).filter(
            IntegrationConnection.user_id == user.id,
            IntegrationConnection.provider == "telegram"
        ).first()
        
        if not conn:
            conn = IntegrationConnection(
                id=str(uuid.uuid4()),
                user_id=user.id,
                provider="telegram",
                external_account_id=str(tg_user_id),
                status="active",
                scopes="miniapp,bot"
            )
            db.add(conn)
        else:
            conn.external_account_id = str(tg_user_id)
            conn.status = "active"
            conn.revoked_at = None
            
        db.commit()
        # Clean token
        PENDING_LINK_TOKENS.pop(linkToken, None)
    else:
        # Find existing connection
        conn = db.query(IntegrationConnection).filter(
            IntegrationConnection.provider == "telegram",
            IntegrationConnection.external_account_id == str(tg_user_id),
            IntegrationConnection.status == "active"
        ).first()
        if not conn:
            raise HTTPException(status_code=403, detail="Telegram account not linked. Connect from settings first.")
        user = db.query(User).filter(User.id == conn.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User account missing")
            
    # Use the same revocable server-side session and cookie as other login paths.
    auth_payload = start_session(response, user)

    return {
        "status": "success",
        "access_token": auth_payload["access_token"],
        "user": {"id": user.id, "email": user.email, "role": user.role, "tg_username": tg_user.get("username")}
    }

@router.delete("/api/integrations/telegram")
def disconnect_telegram(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.user_id == current_user.id,
        IntegrationConnection.provider == "telegram"
    ).first()
    if conn:
        conn.status = "revoked"
        conn.revoked_at = datetime.utcnow()
        db.commit()
    return {"status": "disconnected"}

@router.get("/api/integrations/telegram/status")
def get_telegram_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.user_id == current_user.id,
        IntegrationConnection.provider == "telegram",
        IntegrationConnection.status == "active"
    ).first()
    if conn:
        return {"status": "connected", "external_account_id": conn.external_account_id}
    return {"status": "disconnected"}

# --- Webhook Endpoint ---
@router.post("/api/integrations/telegram/webhook")
def telegram_webhook(payload: dict, db: Session = Depends(get_db), x_telegram_bot_api_secret_token: Optional[str] = Header(None)):
    # Verify webhook secret token if configured
    env_name = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "").strip().lower()
    production_like = env_name in {"production", "staging", "prod"} or os.environ.get("COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes"}
    if TELEGRAM_WEBHOOK_SECRET == "mock_webhook_secret" and production_like:
        raise HTTPException(status_code=503, detail="Telegram webhook secret is not configured")
    if TELEGRAM_WEBHOOK_SECRET != "mock_webhook_secret":
        if x_telegram_bot_api_secret_token != TELEGRAM_WEBHOOK_SECRET:
            raise HTTPException(status_code=403, detail="Invalid webhook secret token")

    update_id = payload.get("update_id")
    if not update_id:
        return {"status": "ignored"}
        
    # Deduplicate webhook requests
    existing_event = db.query(WebhookEvent).filter(
        WebhookEvent.provider == "telegram",
        WebhookEvent.external_event_id == str(update_id)
    ).first()
    if existing_event:
        return {"status": "duplicate_ok"}
        
    # Log event
    evt = WebhookEvent(
        id=str(uuid.uuid4()),
        provider="telegram",
        external_event_id=str(update_id),
        status="processed"
    )
    db.add(evt)
    db.commit()
    
    # Process text commands
    message = payload.get("message")
    if not message or "text" not in message:
        return {"status": "processed"}
        
    text = message["text"].strip()
    from_user = message["from"]
    tg_user_id = from_user["id"]
    chat_id = message["chat"]["id"]
    
    # Try to extract deep link start parameters
    if text.startswith("/start"):
        parts = text.split()
        if len(parts) > 1:
            token = parts[1]
            token_info = PENDING_LINK_TOKENS.get(token)
            if token_info and token_info["expires_at"] > datetime.utcnow():
                # Link account
                user_id = token_info["user_id"]
                conn = db.query(IntegrationConnection).filter(
                    IntegrationConnection.user_id == user_id,
                    IntegrationConnection.provider == "telegram"
                ).first()
                if not conn:
                    conn = IntegrationConnection(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        provider="telegram",
                        external_account_id=str(tg_user_id),
                        status="active",
                        scopes="miniapp,bot"
                    )
                    db.add(conn)
                else:
                    conn.external_account_id = str(tg_user_id)
                    conn.status = "active"
                    conn.revoked_at = None
                db.commit()
                PENDING_LINK_TOKENS.pop(token, None)
                send_telegram_message(chat_id, "<b>Account linked successfully!</b> You can now use /today to fetch your workouts or launch the Mini App.")
                return {"status": "processed"}
            else:
                send_telegram_message(chat_id, "Invalid or expired linking token.")
                return {"status": "processed"}
                
    # Query connection
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.provider == "telegram",
        IntegrationConnection.external_account_id == str(tg_user_id),
        IntegrationConnection.status == "active"
    ).first()
    
    if not conn:
        send_telegram_message(
            chat_id, 
            "This Telegram account is not linked. To sync your training, please link it in the settings panel."
        )
        return {"status": "processed"}
        
    linked_user = db.query(User).filter(User.id == conn.user_id).first()
    if not linked_user:
        send_telegram_message(chat_id, "Linked user profile not found.")
        return {"status": "processed"}
        
    # Command processing
    if text == "/today":
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        # Find athlete scheduled workouts
        workouts = db.query(Workout).join(Microcycle).filter(
            Microcycle.owner_id == linked_user.id,
            Workout.date == today_str
        ).all()
        
        if not workouts:
            send_telegram_message(chat_id, f"<b>Rest day!</b> No workouts scheduled for today ({today_str}).")
            return {"status": "processed"}
            
        workout = workouts[0]
        msg = f"<b>Today's Workout: {workout.title} ({workout.date})</b>\n\n"
        
        if not workout.exercises:
            msg += "No exercises programmed."
        else:
            for idx, ex in enumerate(workout.exercises, 1):
                msg += f"{idx}. {ex.title} ({ex.variation}) - {ex.tier}\n"
                for s in ex.sets:
                    msg += f"  • Set {s.label}: "
                    if s.plannedWeight:
                        msg += f"{s.plannedWeight}kg x {s.plannedReps} @ RPE {s.plannedRpe}"
                    else:
                        msg += f"Prescription placeholder"
                    if s.actual:
                        msg += f" <i>(Logged: {s.actual}kg x {s.reps} @ {s.executedRpe})</i>"
                    msg += "\n"
                    
        reply_markup = {
            "inline_keyboard": [[
                {
                    "text": "Open Web App console",
                    "web_app": {"url": f"{APP_URL}/?tg_auth=true"}
                }
            ]]
        }
        send_telegram_message(chat_id, msg, reply_markup)
        
    elif text == "/log":
        reply_markup = {
            "inline_keyboard": [[
                {
                    "text": "Launch Logger Console",
                    "web_app": {"url": f"{APP_URL}/?tg_auth=true"}
                }
            ]]
        }
        send_telegram_message(chat_id, "Open the Mini App logger to log active training sets:", reply_markup)
        
    elif text == "/done":
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        workout = db.query(Workout).join(Microcycle).filter(
            Microcycle.owner_id == linked_user.id,
            Workout.date == today_str
        ).first()
        
        if not workout:
            send_telegram_message(chat_id, "No workout scheduled today to mark as done.")
            return {"status": "processed"}
            
        workout.status = "COMPLETED"
        workout.updated_at = datetime.utcnow()
        db.commit()
        send_telegram_message(chat_id, f"<b>Workout Completed!</b> Your workout <i>'{workout.title}'</i> is flagged as completed.")
        
    elif text == "/status":
        if linked_user.role != "COACH":
            send_telegram_message(chat_id, "Unauthorized. Only coaches can request /status reports.")
            return {"status": "processed"}
            
        # Coach completions summary
        relationships = db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == linked_user.id,
            CoachingRelationship.ended_at.is_(None)
        ).all()
        
        if not relationships:
            send_telegram_message(chat_id, "No active athletes associated with your coaching account.")
            return {"status": "processed"}
            
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        summary_msg = f"<b>Athlete Status Summary ({today_str}):</b>\n\n"
        
        for r in relationships:
            athlete = db.query(User).filter(User.id == r.athlete_id).first()
            if not athlete:
                continue
            w = db.query(Workout).join(Microcycle).filter(
                Microcycle.owner_id == athlete.id,
                Workout.date == today_str
            ).first()
            
            if w:
                summary_msg += f"• <b>{athlete.email}</b>: {w.title} - <code>{w.status}</code> (Tonnage: {w.tonnage}kg)\n"
            else:
                summary_msg += f"• <b>{athlete.email}</b>: Rest day\n"
                
        send_telegram_message(chat_id, summary_msg)
        
    else:
        # Ambiguous freeform message
        send_telegram_message(chat_id, "Sorry, I didn't recognize that command. Use /today, /log, /done, or /status.")
        
    return {"status": "processed"}

# --- Google Sheets OAuth & Outbox Implementation ---

@router.get("/api/integrations/google-sheets/auth-url")
def get_sheets_auth_url(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Google Sheets is available to coaches")
    # Keep only a hash in storage; the bearer value is opaque, random, and short-lived.
    now = datetime.utcnow()
    db.query(OAuthState).filter(OAuthState.expires_at <= now).delete(synchronize_session=False)
    state = secrets.token_urlsafe(32)
    db.add(OAuthState(
        state_hash=hashlib.sha256(state.encode("utf-8")).hexdigest(),
        user_id=current_user.id,
        provider="google-sheets",
        created_at=now,
        expires_at=now + timedelta(minutes=10),
    ))
    db.commit()
    redirect_uri = f"{APP_URL}/api/integrations/google-sheets/callback"
    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/spreadsheets",
        "access_type": "offline",
        "prompt": "consent",
        "state": state
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return {"auth_url": url}

@router.get("/api/integrations/google-sheets/callback")
def sheets_callback(code: str, state: Optional[str] = None, db: Session = Depends(get_db)):
    # Exchange authorization code for tokens
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing authorization parameters")

    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    state_record = db.query(OAuthState).filter(OAuthState.state_hash == state_hash).one_or_none()
    if state_record is None:
        raise HTTPException(status_code=400, detail="Invalid or already used OAuth state")
    now = datetime.utcnow()
    if state_record.expires_at <= now:
        db.delete(state_record)
        db.commit()
        raise HTTPException(status_code=400, detail="Expired OAuth state")
    if state_record.provider != "google-sheets":
        db.delete(state_record)
        db.commit()
        raise HTTPException(status_code=400, detail="OAuth state provider mismatch")
    user_id = state_record.user_id
    if not db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).one_or_none():
        db.delete(state_record)
        db.commit()
        raise HTTPException(status_code=400, detail="OAuth state user is unavailable")
    # A conditional DELETE makes consumption atomic across concurrent callbacks.
    consumed = db.query(OAuthState).filter(
        OAuthState.state_hash == state_hash,
        OAuthState.provider == "google-sheets",
        OAuthState.expires_at > now,
    ).delete(synchronize_session=False)
    db.commit()
    if consumed != 1:
        raise HTTPException(status_code=400, detail="Invalid or already used OAuth state")
        
    redirect_uri = f"{APP_URL}/api/integrations/google-sheets/callback"
    token_url = "https://oauth2.googleapis.com/token"
    
    payload = {
        "code": code,
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }
    
    # In mock mode, fake token exchange
    if GOOGLE_OAUTH_CLIENT_ID == "mock_client_id":
        access_token = "mock_google_access_token"
        refresh_token = "mock_google_refresh_token"
        expires_in = 3600
    else:
        try:
            res = requests.post(token_url, data=payload, timeout=6)
            if res.status_code != 200:
                raise HTTPException(status_code=400, detail=f"OAuth code exchange failed: {res.text}")
            token_data = res.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")
            expires_in = token_data.get("expires_in", 3600)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Token request error: {str(e)}")
            
    # Connect
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.user_id == user_id,
        IntegrationConnection.provider == "google-sheets"
    ).first()
    
    if not conn:
        conn = IntegrationConnection(
            id=str(uuid.uuid4()),
            user_id=user_id,
            provider="google-sheets",
            status="active",
            scopes="spreadsheets"
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)
        
    # Store credentials encrypted
    cred_access = db.query(IntegrationCredential).filter(
        IntegrationCredential.connection_id == conn.id,
        IntegrationCredential.credential_type == "access_token"
    ).first()
    
    if not cred_access:
        cred_access = IntegrationCredential(
            connection_id=conn.id,
            credential_type="access_token",
            encrypted_payload=encrypt_data(access_token, INTEGRATION_ENCRYPTION_KEY),
            expires_at=datetime.utcnow() + timedelta(seconds=expires_in)
        )
        db.add(cred_access)
    else:
        cred_access.encrypted_payload = encrypt_data(access_token, INTEGRATION_ENCRYPTION_KEY)
        cred_access.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        
    if refresh_token:
        cred_refresh = db.query(IntegrationCredential).filter(
            IntegrationCredential.connection_id == conn.id,
            IntegrationCredential.credential_type == "refresh_token"
        ).first()
        if not cred_refresh:
            cred_refresh = IntegrationCredential(
                connection_id=conn.id,
                credential_type="refresh_token",
                encrypted_payload=encrypt_data(refresh_token, INTEGRATION_ENCRYPTION_KEY)
            )
            db.add(cred_refresh)
        else:
            cred_refresh.encrypted_payload = encrypt_data(refresh_token, INTEGRATION_ENCRYPTION_KEY)
            
    db.commit()
    # Simple HTML redirect payload so that browser window closes/redirects cleanly
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""
    <html>
        <body style="background: #0A0A0A; color: #FFF; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
            <div style="text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 12px; background: #131313;">
                <h2 style="color: #34C759; margin-bottom: 10px;">Google Sheets Connected Successfully!</h2>
                <p style="color: #8E8E93;">You can close this tab and return to the dashboard settings.</p>
                <script>setTimeout(function() { window.close(); }, 2500);</script>
            </div>
        </body>
    </html>
    """)

@router.get("/api/integrations/google-sheets/status")
def get_sheets_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.user_id == current_user.id,
        IntegrationConnection.provider == "google-sheets",
        IntegrationConnection.status == "active"
    ).first()
    
    if not conn:
        return {"status": "disconnected"}
        
    # Get recent outbox jobs
    jobs = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.connection_id == conn.id
    ).order_by(IntegrationOutbox.id.desc()).limit(5).all()
    
    formatted_jobs = []
    for j in jobs:
        try:
            p = json.loads(j.payload_json)
            sheet_name = p.get("sheet_name", "Untitled Publish")
        except Exception:
            sheet_name = "Analytics Export"
            
        formatted_jobs.append({
            "id": j.id,
            "sheet_name": sheet_name,
            "status": j.status,
            "attempts": j.attempt_count,
            "error": j.result if j.status == "failed" else None
        })
        
    return {
        "status": "connected",
        "connection_id": conn.id,
        "jobs": formatted_jobs
    }

@router.delete("/api/integrations/google-sheets")
def disconnect_sheets(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.user_id == current_user.id,
        IntegrationConnection.provider == "google-sheets"
    ).first()
    if conn:
        conn.status = "revoked"
        conn.revoked_at = datetime.utcnow()
        # Delete credentials
        creds = db.query(IntegrationCredential).filter(IntegrationCredential.connection_id == conn.id).all()
        for cr in creds:
            db.delete(cr)
        db.commit()
    return {"status": "disconnected"}

@router.post("/api/integrations/google-sheets/publish")
def publish_to_sheets(req: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Only coaches can publish mesocycle spreadsheets")
        
    athlete_id = req.get("athlete_id")
    mesocycle_id = req.get("mesocycle_id")
    sheet_name = req.get("sheetName", "Mesocycle Export")
    tabs = req.get("tabs", ["Sets", "Workouts", "INOL", "ACWR", "e1RM"])
    
    if not athlete_id or not mesocycle_id:
        raise HTTPException(status_code=400, detail="Missing athlete_id or mesocycle_id")
        
    # Verify coach relationship or mesocycle ownership
    rel = db.query(CoachingRelationship).filter(
        CoachingRelationship.coach_id == current_user.id,
        CoachingRelationship.athlete_id == athlete_id,
        CoachingRelationship.ended_at.is_(None)
    ).first()
    
    if not rel:
        raise HTTPException(status_code=403, detail="Unauthorized: No active relationship with this athlete")
        
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.user_id == current_user.id,
        IntegrationConnection.provider == "google-sheets",
        IntegrationConnection.status == "active"
    ).first()
    
    if not conn:
        raise HTTPException(status_code=400, detail="Google Sheets integration not connected")
        
    outbox = IntegrationOutbox(
        id=str(uuid.uuid4()),
        provider="google-sheets",
        connection_id=conn.id,
        payload_json=json.dumps({
            "athlete_id": athlete_id,
            "mesocycle_id": mesocycle_id,
            "sheet_name": sheet_name,
            "tabs": tabs
        }),
        status="queued",
        attempt_count=0
    )
    
    db.add(outbox)
    db.commit()
    db.refresh(outbox)
    return {"status": "queued", "job_id": outbox.id}

# --- Google Sheets Outbox Processor (Background Thread Worker) ---

def refresh_google_access_token(conn_id: str, db: Session) -> Optional[str]:
    # Fetch refresh token
    cred_refresh = db.query(IntegrationCredential).filter(
        IntegrationCredential.connection_id == conn_id,
        IntegrationCredential.credential_type == "refresh_token"
    ).first()
    
    if not cred_refresh:
        return None
        
    refresh_token = decrypt_data(cred_refresh.encrypted_payload, INTEGRATION_ENCRYPTION_KEY)
    token_url = "https://oauth2.googleapis.com/token"
    payload = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token"
    }
    
    try:
        res = requests.post(token_url, data=payload, timeout=6)
        if res.status_code != 200:
            return None
        data = res.json()
        access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        
        # Save fresh access token
        cred_access = db.query(IntegrationCredential).filter(
            IntegrationCredential.connection_id == conn_id,
            IntegrationCredential.credential_type == "access_token"
        ).first()
        
        if not cred_access:
            cred_access = IntegrationCredential(
                connection_id=conn_id,
                credential_type="access_token",
                encrypted_payload=encrypt_data(access_token, INTEGRATION_ENCRYPTION_KEY),
                expires_at=datetime.utcnow() + timedelta(seconds=expires_in)
            )
            db.add(cred_access)
        else:
            cred_access.encrypted_payload = encrypt_data(access_token, INTEGRATION_ENCRYPTION_KEY)
            cred_access.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
            
        db.commit()
        return access_token
    except Exception:
        return None

def get_valid_google_access_token(conn_id: str, db: Session) -> Optional[str]:
    cred_access = db.query(IntegrationCredential).filter(
        IntegrationCredential.connection_id == conn_id,
        IntegrationCredential.credential_type == "access_token"
    ).first()
    
    if cred_access and cred_access.expires_at > datetime.utcnow() + timedelta(minutes=2):
        return decrypt_data(cred_access.encrypted_payload, INTEGRATION_ENCRYPTION_KEY)
        
    return refresh_google_access_token(conn_id, db)

def process_sheets_publish_job(job: IntegrationOutbox, db: Session) -> bool:
    try:
        payload = json.loads(job.payload_json)
    except Exception as e:
        job.status = "failed"
        job.result = f"Malformed payload JSON: {str(e)}"
        return False
        
    athlete_id = payload.get("athlete_id")
    mesocycle_id = payload.get("mesocycle_id")
    sheet_name = payload.get("sheet_name", "Mesocycle Export")
    tabs = payload.get("tabs", ["Sets", "Workouts", "INOL", "ACWR", "e1RM"])
    
    # 1. Fetch training data
    workouts = db.query(Workout).join(Microcycle).filter(
        Microcycle.mesocycle_id == mesocycle_id,
        Microcycle.owner_id == athlete_id
    ).order_by(Workout.date).all()
    
    if not workouts:
        job.status = "failed"
        job.result = "No training workouts found for chosen athlete/mesocycle"
        return False
        
    # 2. Get Access Token
    if GOOGLE_OAUTH_CLIENT_ID == "mock_client_id":
        # Mock Google Sheets API execution
        time.sleep(2)
        job.status = "success"
        job.result = "mock-spreadsheet-url-id-12345"
        return True
        
    access_token = get_valid_google_access_token(job.connection_id, db)
    if not access_token:
        job.status = "failed"
        job.result = "Failed to fetch valid Google OAuth credentials"
        return False
        
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    # Persist the created resource ID separately from the user-visible result.
    # If a later request fails or the worker exits, retries resume this sheet.
    spreadsheet_id = payload.get("_spreadsheet_id")
    if not spreadsheet_id:
        if payload.get("_spreadsheet_create_started"):
            job.status = "failed"
            job.attempt_count = 3
            job.result = "Spreadsheet creation outcome is uncertain; automatic retry stopped"
            return False
        # Persist intent before the external side effect. If the provider succeeds
        # but the worker or database fails before the ID is checkpointed, recovery
        # will stop instead of issuing a second create request.
        payload["_spreadsheet_create_started"] = True
        job.payload_json = json.dumps(payload)
        db.commit()
        try:
            res_create = requests.post(
                "https://sheets.googleapis.com/v4/spreadsheets",
                headers=headers,
                json={"properties": {"title": sheet_name}},
                timeout=8
            )
            if res_create.status_code != 200:
                job.status = "failed"
                job.attempt_count = 3
                job.result = f"Google Spreadsheet creation failed; automatic retry stopped: {res_create.text}"
                return False

            spreadsheet_id = res_create.json()["spreadsheetId"]
            payload["_spreadsheet_id"] = spreadsheet_id
            job.payload_json = json.dumps(payload)
        except Exception as ex:
            job.status = "failed"
            # The provider may have created the sheet before the response was
            # lost. Without an ID there is no safe automatic retry.
            job.attempt_count = 3
            job.result = f"Spreadsheet creation outcome is uncertain; automatic retry stopped: {str(ex)}"
            return False
        db.commit()
        
    # Create worksheets/tabs
    try:
        current = requests.get(
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}",
            headers=headers,
            params={"fields": "sheets.properties(sheetId,title)"},
            timeout=8,
        )
        if current.status_code != 200:
            job.status = "failed"
            job.result = f"Could not inspect spreadsheet tabs: {current.text}"
            return False
        existing_sheets = current.json().get("sheets", [])
        existing_titles = {sheet.get("properties", {}).get("title") for sheet in existing_sheets}
        sheets_requests = [
            {"addSheet": {"properties": {"title": tab}}}
            for tab in tabs if tab not in existing_titles
        ]
        default_sheet = next((sheet.get("properties", {}) for sheet in existing_sheets
                              if sheet.get("properties", {}).get("sheetId") == 0), None)
        if default_sheet and default_sheet.get("title") not in tabs:
            sheets_requests.append({"deleteSheet": {"sheetId": 0}})
        if sheets_requests:
            res_tabs = requests.post(
                f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
                headers=headers,
                json={"requests": sheets_requests},
                timeout=8
            )
            if res_tabs.status_code != 200:
                job.status = "failed"
                job.result = f"Sheet structure creation failed: {res_tabs.text}"
                return False
    except Exception as ex:
        job.status = "failed"
        job.result = f"Sheet structure creation failed: {str(ex)}"
        return False
        
    # Gather datasets
    data_batches = []
    
    # Tab 1: Sets
    if "Sets" in tabs:
        sets_headers = ["Date", "Category", "Tier", "Exercise", "Planned Weight", "Actual Weight", "Reps", "RPE", "e1RM", "INOL", "Tonnage"]
        sets_rows = [sets_headers]
        
        for w in workouts:
            for ex in w.exercises:
                for s in ex.sets:
                    wt = float(s.actual or 0)
                    rp = int(s.reps or 0)
                    rpe = float(s.executedRpe or 0)
                    e1rm = calculate_e1rm_linear_decay(wt, rp, rpe) if (wt > 0 and rp > 0) else 0.0
                    intensity = (wt / e1rm) * 100.0 if e1rm > 0 else 0.0
                    inol = calculate_inol(rp, intensity) if intensity > 0 else 0.0
                    tonnage = wt * rp
                    
                    sets_rows.append([
                        w.date, ex.lift_category, ex.tier, ex.title,
                        s.plannedWeight or "—", s.actual or "—", 
                        s.reps or "—", s.executedRpe or "—",
                        e1rm or "—", inol or "—", tonnage or "—"
                    ])
                    
        data_batches.append({"range": "Sets!A1", "values": sets_rows})
        
    # Tab 2: Workouts
    if "Workouts" in tabs:
        workouts_headers = ["Date", "Day", "Title", "Tonnage", "Bodyweight", "Status"]
        workouts_rows = [workouts_headers]
        for w in workouts:
            workouts_rows.append([
                w.date, w.dayLabel, w.title, w.tonnage, w.athlete_bw or "—", w.status
            ])
        data_batches.append({"range": "Workouts!A1", "values": workouts_rows})
        
    # Tab 3: INOL
    if "INOL" in tabs:
        inol_headers = ["Lift Category", "Microcycle ID", "Weekly Accumulated INOL"]
        inol_rows = [inol_headers]
        
        # Group workouts by microcycle
        mc_groups = {}
        for w in workouts:
            if w.microcycle_id not in mc_groups:
                mc_groups[w.microcycle_id] = []
            mc_groups[w.microcycle_id].append(w)
            
        for mc_id, w_list in mc_groups.items():
            cats = {"Squat": 0.0, "Bench": 0.0, "Deadlift": 0.0}
            for w in w_list:
                for ex in w.exercises:
                    if ex.lift_category in cats:
                        for s in ex.sets:
                            wt = float(s.actual or 0)
                            rp = int(s.reps or 0)
                            rpe = float(s.executedRpe or 0)
                            e1rm = calculate_e1rm_linear_decay(wt, rp, rpe) if (wt > 0 and rp > 0) else 0.0
                            intensity = (wt / e1rm) * 100.0 if e1rm > 0 else 0.0
                            inol = calculate_inol(rp, intensity) if intensity > 0 else 0.0
                            cats[ex.lift_category] += inol
                            
            for cat, val in cats.items():
                inol_rows.append([cat, mc_id, round(val, 2)])
                
        data_batches.append({"range": "INOL!A1", "values": inol_rows})
        
    # Tab 4: ACWR
    if "ACWR" in tabs:
        acwr_headers = ["Date", "Workout Title", "Acute Load (reps)", "Chronic Load (reps)", "ACWR", "Status"]
        acwr_rows = [acwr_headers]
        
        # Calculate reps based load per workout
        rep_loads = []
        for w in workouts:
            total_reps = sum(int(s.reps or 0) for ex in w.exercises for s in ex.sets)
            rep_loads.append((w.date, w.title, total_reps))
            
        for idx, (dt, title, l_reps) in enumerate(rep_loads):
            acute = sum(r[2] for r in rep_loads[max(0, idx-6):idx+1]) # 7 days
            chronic = sum(r[2] for r in rep_loads[max(0, idx-27):idx+1]) / 4.0 # 28 days
            chronic = max(chronic, 1.0)
            acwr = round(acute / chronic, 2)
            status = "Optimal" if 0.8 <= acwr <= 1.3 else ("Danger (High)" if acwr > 1.5 else "Under-training")
            acwr_rows.append([dt, title, acute, round(chronic, 2), acwr, status])
            
        data_batches.append({"range": "ACWR!A1", "values": acwr_rows})
        
    # Tab 5: e1RM
    if "e1RM" in tabs:
        e1rm_headers = ["Date", "Exercise", "Top Set Logged", "Calculated e1RM"]
        e1rm_rows = [e1rm_headers]
        for w in workouts:
            for ex in w.exercises:
                for s in ex.sets:
                    if s.isTop:
                        wt = float(s.actual or 0)
                        rp = int(s.reps or 0)
                        rpe = float(s.executedRpe or 0)
                        e1rm = calculate_e1rm_linear_decay(wt, rp, rpe) if (wt > 0 and rp > 0) else 0.0
                        if e1rm > 0:
                            e1rm_rows.append([w.date, ex.title, f"{wt}kg x {rp} @ {rpe}", e1rm])
        data_batches.append({"range": "e1RM!A1", "values": e1rm_rows})
        
    # Batch write data
    try:
        res_write = requests.post(
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchUpdate",
            headers=headers,
            json={
                "valueInputOption": "USER_ENTERED",
                "data": data_batches
            },
            timeout=12
        )
        if res_write.status_code == 200:
            job.status = "success"
            job.result = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
            return True
        else:
            job.status = "failed"
            job.result = f"Writing values failed: {res_write.text}"
            return False
    except Exception as e:
        job.status = "failed"
        job.result = f"Network error writing cells: {str(e)}"
        return False

OUTBOX_POLL_SECONDS = 10
OUTBOX_CLAIM_LEASE = timedelta(minutes=15)


def claim_next_outbox_job(session_factory=None) -> Optional[str]:
    """Atomically reserve one due job so concurrent worker processes cannot both run it."""
    from sqlalchemy import or_, and_
    from .database import SessionLocal

    factory = session_factory or SessionLocal
    now = datetime.utcnow()
    db = factory()
    try:
        db.query(OAuthState).filter(OAuthState.expires_at <= now).delete(synchronize_session=False)
        db.query(IntegrationOutbox).filter(
            IntegrationOutbox.provider == "google-sheets",
            IntegrationOutbox.status == "processing",
            IntegrationOutbox.attempt_count >= 3,
            IntegrationOutbox.retry_after <= now,
        ).update({
            IntegrationOutbox.status: "failed",
            IntegrationOutbox.retry_after: None,
            IntegrationOutbox.result: "Worker lease expired after the maximum attempts",
        }, synchronize_session=False)
        # Selecting candidates is only advisory: the conditional UPDATE is the claim.
        # retry_after doubles as a lease while status is processing, allowing recovery
        # after a worker dies without introducing another migration.
        candidates = db.query(IntegrationOutbox.id).filter(IntegrationOutbox.provider == "google-sheets").filter(or_(
            IntegrationOutbox.status == "queued",
            and_(IntegrationOutbox.status == "failed", IntegrationOutbox.attempt_count < 3,
                 or_(IntegrationOutbox.retry_after.is_(None), IntegrationOutbox.retry_after <= now)),
            and_(IntegrationOutbox.status == "processing", IntegrationOutbox.attempt_count < 3,
                 IntegrationOutbox.retry_after <= now),
        )).order_by(IntegrationOutbox.id).limit(20).all()
        for (job_id,) in candidates:
            changed = db.query(IntegrationOutbox).filter(
                IntegrationOutbox.id == job_id,
                IntegrationOutbox.provider == "google-sheets",
                or_(
                    IntegrationOutbox.status == "queued",
                    and_(IntegrationOutbox.status == "failed", IntegrationOutbox.attempt_count < 3,
                         or_(IntegrationOutbox.retry_after.is_(None), IntegrationOutbox.retry_after <= now)),
                    and_(IntegrationOutbox.status == "processing", IntegrationOutbox.attempt_count < 3,
                         IntegrationOutbox.retry_after <= now),
                ),
            ).update({
                IntegrationOutbox.status: "processing",
                IntegrationOutbox.retry_after: now + OUTBOX_CLAIM_LEASE,
                IntegrationOutbox.attempt_count: IntegrationOutbox.attempt_count + 1,
            }, synchronize_session=False)
            if changed:
                db.commit()
                return job_id
        db.commit()
        return None
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def process_next_outbox_job(session_factory=None) -> bool:
    """Claim and process at most one job. Returns whether a job was claimed."""
    from .database import SessionLocal

    factory = session_factory or SessionLocal
    job_id = claim_next_outbox_job(factory)
    if job_id is None:
        return False

    db = factory()
    try:
        job = db.query(IntegrationOutbox).filter_by(id=job_id, status="processing").one_or_none()
        if job is None:
            return True
        print(f"[WORKER] Processing export outbox job {job.id}...")
        try:
            success = process_sheets_publish_job(job, db)
        except Exception as exc:
            db.rollback()
            job = db.query(IntegrationOutbox).filter_by(id=job_id, status="processing").one_or_none()
            if job is None:
                return True
            job.status = "failed"
            job.result = f"Worker error: {exc}"
            success = False
        if not success:
            if job.attempt_count < 3:
                job.retry_after = datetime.utcnow() + timedelta(minutes=5 * job.attempt_count)
            else:
                job.retry_after = None
        else:
            job.retry_after = None
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
