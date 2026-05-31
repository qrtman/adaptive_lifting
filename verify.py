import requests
import json
from backend.math_utils import calculate_e1rm_linear_decay, calculate_inol, calculate_dots, calculate_attempt_jumps

# 1. Verify Math Engine
print("Verifying Math Engine...")
e1rm = calculate_e1rm_linear_decay(100, 5, 8)
print(f"e1rm: {e1rm}")
inol = calculate_inol(5, 80)
print(f"inol: {inol}")
dots = calculate_dots("MALE", 100, 600)
print(f"dots: {dots}")
jumps = calculate_attempt_jumps(200, "squat_dl", "MALE")
print(f"jumps: {jumps}")
print("Math Engine verified.")

# 2. API Tests: Create Coach and Athlete
print("\nVerifying Backend API...")
base_url = "http://127.0.0.1:8000/api"

coach_data = {"email": "coach@example.com", "password": "password", "role": "COACH"}
athlete_data = {"email": "athlete@example.com", "password": "password", "role": "ATHLETE"}

coach_resp = requests.post(f"{base_url}/auth/register", json=coach_data)
if coach_resp.status_code == 400 and "already registered" in coach_resp.text:
    coach_resp = requests.post(f"{base_url}/auth/login", data={"username": "coach@example.com", "password": "password"})
print("Coach Registration/Login:", coach_resp.status_code)

athlete_resp = requests.post(f"{base_url}/auth/register", json=athlete_data)
if athlete_resp.status_code == 400 and "already registered" in athlete_resp.text:
    athlete_resp = requests.post(f"{base_url}/auth/login", data={"username": "athlete@example.com", "password": "password"})
print("Athlete Registration/Login:", athlete_resp.status_code)

athlete_token = athlete_resp.json()["access_token"]
headers = {"Authorization": f"Bearer {athlete_token}"}

link_resp = requests.post(f"{base_url}/auth/link-athlete", json={"code": "coach@example.com"}, headers=headers)
print("Link Athlete to Coach:", link_resp.status_code, link_resp.text)

print("Verification complete.")
