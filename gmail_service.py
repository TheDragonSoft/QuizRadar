import os
import sys
import json
import base64
import urllib.parse
from datetime import datetime
from bs4 import BeautifulSoup

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from quiz_parser import parse_quiz_email

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
CACHE_FILE = os.path.join(os.path.dirname(__file__), 'quiz_emails_cache.json')
PROCESSED_FILE = os.path.join(os.path.dirname(__file__), 'processed_quizzes.json')

def get_credentials():
    creds = None
    token_path = os.path.join(os.path.dirname(__file__), 'token.json')
    cred_path = os.path.join(os.path.dirname(__file__), 'credentials.json')

    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception as e:
            print(f"Error loading token: {e}")

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                with open(token_path, 'w') as f:
                    f.write(creds.to_json())
            except Exception as e:
                print(f"Token refresh failed: {e}")
                creds = None

        if not creds and os.path.exists(cred_path):
            flow = InstalledAppFlow.from_client_secrets_file(cred_path, SCOPES)
            creds = flow.run_local_server(port=0)
            with open(token_path, 'w') as f:
                f.write(creds.to_json())

    return creds

def get_user_profile():
    try:
        creds = get_credentials()
        if not creds:
            return {"authenticated": False, "email": None}
        service = build('gmail', 'v1', credentials=creds)
        profile = service.users().getProfile(userId='me').execute()
        return {"authenticated": True, "email": profile.get('emailAddress')}
    except Exception as e:
        return {"authenticated": False, "error": str(e)}

def _extract_body(payload):
    body_text = ""
    if 'parts' in payload:
        for part in payload['parts']:
            mime_type = part.get('mimeType', '')
            part_body = part.get('body', {})
            data = part_body.get('data', '')
            if data:
                decoded = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
                if mime_type == 'text/plain':
                    body_text += decoded + "\n"
                elif mime_type == 'text/html' and not body_text:
                    soup = BeautifulSoup(decoded, 'html.parser')
                    body_text += soup.get_text(separator=' ', strip=True) + "\n"
            if 'parts' in part:
                body_text += _extract_body(part)
    else:
        data = payload.get('body', {}).get('data', '')
        if data:
            decoded = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
            mime_type = payload.get('mimeType', '')
            if mime_type == 'text/html':
                soup = BeautifulSoup(decoded, 'html.parser')
                body_text = soup.get_text(separator=' ', strip=True)
            else:
                body_text = decoded
    return body_text.strip()

def sync_from_gmail():
    """Fetch new emails from Gmail and update cache."""
    creds = get_credentials()
    if not creds:
        raise Exception("Google credentials not configured or unauthorized.")

    service = build('gmail', 'v1', credentials=creds)
    queries = [
        'quiz',
        'exam OR midterm',
        'from:canvas OR from:blackboard OR from:moodle OR from:gradescope OR from:classroom.google.com',
        '"quiz" OR "test" assessment'
    ]

    all_messages = {}
    for q in queries:
        try:
            results = service.users().messages().list(userId='me', q=q, maxResults=50).execute()
            messages = results.get('messages', [])
            for m in messages:
                all_messages[m['id']] = m
        except Exception as e:
            print(f"Error querying {q}: {e}")

    detailed_emails = []
    for msg_id in all_messages.keys():
        try:
            msg = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
            payload = msg.get('payload', {})
            headers = payload.get('headers', [])
            header_dict = {h['name'].lower(): h['value'] for h in headers}

            detailed_emails.append({
                'id': msg_id,
                'subject': header_dict.get('subject', '(No Subject)'),
                'from': header_dict.get('from', '(Unknown Sender)'),
                'date': header_dict.get('date', ''),
                'snippet': msg.get('snippet', ''),
                'body': _extract_body(payload)[:4000]
            })
        except Exception as e:
            print(f"Error fetching {msg_id}: {e}")

    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(detailed_emails, f, indent=2, ensure_ascii=False)

    return process_quizzes(force_refresh=True)

def process_quizzes(force_refresh=False):
    """Processes cached emails into structured quiz items."""
    if not force_refresh and os.path.exists(PROCESSED_FILE):
        try:
            with open(PROCESSED_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass

    if not os.path.exists(CACHE_FILE):
        return []

    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        emails = json.load(f)

    quizzes = []
    seen_keys = set()

    for e in emails:
        subj = e.get('subject', '').lower()
        body = e.get('body', '').lower()

        # Filter out obvious marketing or unrelated emails (e.g., DataCamp)
        if 'datacamp' in e.get('from', '').lower() or 'imagine cup' in subj:
            continue

        # Check if email is actually about a quiz, test, exam, or assessment
        if any(w in subj for w in ['quiz', 'exam', 'midterm', 'test', 'assessment']) or ('quiz' in body and 'e-learning' in e.get('from', '').lower()):
            parsed = parse_quiz_email(e)
            if parsed:
                dedup_key = f"{parsed['course']}_{parsed['title']}_{parsed['date_iso']}"
                if dedup_key not in seen_keys:
                    seen_keys.add(dedup_key)
                    quizzes.append(parsed)

    # Sort upcoming first, then by date descending
    quizzes.sort(key=lambda x: (not x['is_upcoming'], x['date_iso']))

    with open(PROCESSED_FILE, 'w', encoding='utf-8') as f:
        json.dump(quizzes, f, indent=2, ensure_ascii=False)

    return quizzes

def generate_google_calendar_url(quiz):
    """Generates a direct 1-click Google Calendar add link with reminder details."""
    title = f"[{quiz['course']}] {quiz['title']}"
    date_str = quiz['date_iso'].replace('-', '')
    dates = f"{date_str}T090000/{date_str}T103000"  # default 9:00 AM slot
    
    details = f"Course: {quiz['course']}\n"
    details += f"Assessment: {quiz['title']}\n"
    details += f"Instructor: {quiz['instructor']}\n\n"
    
    if quiz['topics']:
        details += "Topics Covered:\n" + "\n".join([f"- {t}" for t in quiz['topics']]) + "\n\n"
    if quiz['warnings']:
        details += "Important Instructions:\n" + "\n".join([f"{w}" for w in quiz['warnings']]) + "\n\n"
    if quiz['elearning_url']:
        details += f"Moodle Link: {quiz['elearning_url']}\n"

    params = {
        'action': 'TEMPLATE',
        'text': title,
        'dates': dates,
        'details': details,
        'location': f"MSA University - {quiz['course']} Lecture Hall",
        'sf': 'true',
        'output': 'xml'
    }
    return f"https://calendar.google.com/calendar/render?{urllib.parse.urlencode(params)}"

def generate_ics_content(quiz):
    """Generates an RFC 5545 iCalendar (.ics) string for importing into any calendar."""
    date_clean = quiz['date_iso'].replace('-', '')
    summary = f"[{quiz['course']}] {quiz['title']}"
    description = f"Instructor: {quiz['instructor']}\\n"
    if quiz['topics']:
        description += "Topics: " + ", ".join(quiz['topics']) + "\\n"
    if quiz['warnings']:
        description += "Notes: " + " ".join(quiz['warnings']) + "\\n"
    if quiz['elearning_url']:
        description += f"Link: {quiz['elearning_url']}\\n"

    ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//QuizRadar//Academic Quiz Reminders//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:quiz-{quiz['id']}@quizradar.local",
        f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART;VALUE=DATE:{date_clean}",
        f"DTEND;VALUE=DATE:{date_clean}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{description}",
        f"LOCATION:MSA University - {quiz['course']}",
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        f"DESCRIPTION:Reminder: Upcoming {summary} tomorrow!",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
    ]
    return "\r\n".join(ics)
