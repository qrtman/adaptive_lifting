import requests
import time
import subprocess
import os
import sys

BASE_URL = "http://localhost:8000"

def run_tests():
    print("Registering Coach...")
    coach_data = {"email": "coach@test.com", "password": "password123", "role": "COACH"}
    res = requests.post(f"{BASE_URL}/api/auth/register", json=coach_data)
    if res.status_code != 200:
        print(f"Failed to register coach: {res.text}")
        sys.exit(1)
    coach_token = res.json()["access_token"]
    print("Coach registered successfully.")

    print("Registering Athlete 1...")
    athlete1_data = {"email": "athlete1@test.com", "password": "password123", "role": "ATHLETE"}
    res = requests.post(f"{BASE_URL}/api/auth/register", json=athlete1_data)
    if res.status_code != 200:
        print(f"Failed to register athlete 1: {res.text}")
        sys.exit(1)
    athlete1_token = res.json()["access_token"]
    print("Athlete 1 registered successfully.")

    print("Registering Athlete 2...")
    athlete2_data = {"email": "athlete2@test.com", "password": "password123", "role": "ATHLETE"}
    res = requests.post(f"{BASE_URL}/api/auth/register", json=athlete2_data)
    if res.status_code != 200:
        print(f"Failed to register athlete 2: {res.text}")
        sys.exit(1)
    athlete2_token = res.json()["access_token"]
    print("Athlete 2 registered successfully.")

    print("Linking Athlete 1 to Coach...")
    headers = {"Authorization": f"Bearer {athlete1_token}"}
    res = requests.post(f"{BASE_URL}/api/auth/link-athlete", json={"code": "coach@test.com"}, headers=headers)
    if res.status_code != 200:
        print(f"Failed to link athlete 1: {res.text}")
        sys.exit(1)
    print("Athlete 1 linked successfully.")

    # Generate data for Athlete 1 by fetching microcycles (which triggers seed_db)
    print("Fetching microcycles for Athlete 1 to seed data...")
    res = requests.get(f"{BASE_URL}/api/microcycles", headers=headers)
    if res.status_code != 200:
        print(f"Failed to fetch microcycles: {res.text}")
        sys.exit(1)
    athlete1_mcs = res.json()
    print(f"Athlete 1 has {len(athlete1_mcs)} microcycles.")

    # Generate data for Athlete 2
    print("Fetching microcycles for Athlete 2 to seed data...")
    headers2 = {"Authorization": f"Bearer {athlete2_token}"}
    res = requests.get(f"{BASE_URL}/api/microcycles", headers=headers2)
    athlete2_mcs = res.json()
    print(f"Athlete 2 has {len(athlete2_mcs)} microcycles.")

    print("Testing Coach Roster...")
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    res = requests.get(f"{BASE_URL}/api/coach/roster", headers=coach_headers)
    roster = res.json()
    print("Coach roster:", roster)
    if len(roster) != 1 or roster[0]["email"] != "athlete1@test.com":
        print("Bug found: Coach roster is incorrect.")
        sys.exit(1)

    print("Testing Data Isolation: Coach viewing microcycles...")
    res = requests.get(f"{BASE_URL}/api/microcycles", headers=coach_headers)
    coach_mcs = res.json()
    print(f"Coach can see {len(coach_mcs)} microcycles.")
    if len(coach_mcs) != len(athlete1_mcs):
        print("Bug found: Coach sees incorrect number of microcycles. Data isolation failure.")
        sys.exit(1)

    print("Testing Push Programming Endpoint...")
    push_res = requests.post(
        f"{BASE_URL}/api/coach/push-program", 
        json={"athleteId": roster[0]["id"], "template": "Hypertrophy Block"}, 
        headers=coach_headers
    )
    if push_res.status_code != 200:
        print(f"Bug found: Failed to push programming. {push_res.text}")
        sys.exit(1)
        
    print("Testing Data Isolation: Coach viewing microcycles after push...")
    res = requests.get(f"{BASE_URL}/api/microcycles", headers=coach_headers)
    coach_mcs_after = res.json()
    print(f"Coach can see {len(coach_mcs_after)} microcycles after pushing new program.")
    if len(coach_mcs_after) <= len(coach_mcs):
        print("Bug found: Push programming did not add new microcycles.")
        sys.exit(1)

    print("All tests passed! Authentication and Data Isolation works perfectly.")

if __name__ == "__main__":
    run_tests()
