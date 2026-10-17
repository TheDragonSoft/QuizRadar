import os
import sys
import json
from datetime import datetime

# Ensure clean UTF-8 console output on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, render_template, jsonify, request, Response, send_file
import gmail_service

app = Flask(__name__, static_folder="static", template_folder="templates")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/status', methods=['GET'])
def get_status():
    profile = gmail_service.get_user_profile()
    quizzes = gmail_service.process_quizzes()
    upcoming = [q for q in quizzes if q['is_upcoming']]
    
    # Courses list
    courses = sorted(list(set(q['course'] for q in quizzes if q['course'] != 'GENERAL')))
    
    return jsonify({
        "authenticated": profile.get("authenticated", False),
        "email": profile.get("email", "omar.ahmed126@msa.edu.eg"),
        "total_quizzes": len(quizzes),
        "upcoming_count": len(upcoming),
        "courses": courses,
        "last_sync": datetime.now().strftime("%Y-%m-%d %H:%M")
    })

@app.route('/api/quizzes', methods=['GET'])
def get_quizzes():
    quizzes = gmail_service.process_quizzes()
    course_filter = request.args.get('course')
    upcoming_only = request.args.get('upcoming') == 'true'
    search_query = request.args.get('search', '').lower()

    filtered = quizzes
    if course_filter and course_filter != 'ALL':
        filtered = [q for q in filtered if q['course'].lower() == course_filter.lower()]
    if upcoming_only:
        filtered = [q for q in filtered if q['is_upcoming']]
    if search_query:
        filtered = [
            q for q in filtered
            if search_query in q['title'].lower() 
            or search_query in q['course'].lower()
            or any(search_query in t.lower() for t in q['topics'])
            or any(search_query in w.lower() for w in q['warnings'])
        ]

    # Attach Google Calendar quick-add URL to each quiz
    for q in filtered:
        q['google_cal_url'] = gmail_service.generate_google_calendar_url(q)

    return jsonify(filtered)

@app.route('/api/sync', methods=['POST'])
def sync_emails():
    try:
        updated_quizzes = gmail_service.sync_from_gmail()
        for q in updated_quizzes:
            q['google_cal_url'] = gmail_service.generate_google_calendar_url(q)
        return jsonify({
            "success": True,
            "message": f"Successfully synced with Gmail! Found {len(updated_quizzes)} quizzes and assessments.",
            "quizzes": updated_quizzes
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/calendar/google_url/<quiz_id>', methods=['GET'])
def get_google_calendar_link(quiz_id):
    quizzes = gmail_service.process_quizzes()
    target = next((q for q in quizzes if q['id'] == quiz_id), None)
    if not target:
        return jsonify({"error": "Quiz not found"}), 404
    
    url = gmail_service.generate_google_calendar_url(target)
    return jsonify({"url": url})

@app.route('/api/calendar/ics/<quiz_id>', methods=['GET'])
def download_single_ics(quiz_id):
    quizzes = gmail_service.process_quizzes()
    target = next((q for q in quizzes if q['id'] == quiz_id), None)
    if not target:
        return "Quiz not found", 404
    
    ics_text = gmail_service.generate_ics_content(target)
    filename = f"{target['course']}_{target['title'].replace(' ', '_')}.ics"
    return Response(
        ics_text,
        mimetype="text/calendar",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.route('/api/calendar/ics_all', methods=['GET'])
def download_all_upcoming_ics():
    quizzes = gmail_service.process_quizzes()
    upcoming = [q for q in quizzes if q['is_upcoming']]
    
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//QuizRadar//Academic All Upcoming Quizzes//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:QuizRadar - University Quizzes"
    ]
    for q in upcoming:
        date_clean = q['date_iso'].replace('-', '')
        summary = f"[{q['course']}] {q['title']}"
        desc = f"Instructor: {q['instructor']}\\n"
        if q['topics']:
            desc += "Topics: " + ", ".join(q['topics']) + "\\n"
        if q['warnings']:
            desc += "Notes: " + " ".join(q['warnings']) + "\\n"
        
        ics_lines.extend([
            "BEGIN:VEVENT",
            f"UID:quiz-{q['id']}@quizradar.local",
            f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART;VALUE=DATE:{date_clean}",
            f"DTEND;VALUE=DATE:{date_clean}",
            f"SUMMARY:{summary}",
            f"DESCRIPTION:{desc}",
            f"LOCATION:MSA University - {q['course']}",
            "BEGIN:VALARM",
            "TRIGGER:-P1D",
            "ACTION:DISPLAY",
            f"DESCRIPTION:Reminder: Upcoming {summary} tomorrow!",
            "END:VALARM",
            "END:VEVENT"
        ])
    ics_lines.append("END:VCALENDAR")
    
    return Response(
        "\r\n".join(ics_lines),
        mimetype="text/calendar",
        headers={"Content-Disposition": "attachment; filename=QuizRadar_All_Quizzes.ics"}
    )

if __name__ == '__main__':
    print("="*60)
    print("🚀 QuizRadar is launching on http://127.0.0.1:5000")
    print("="*60)
    app.run(host='127.0.0.1', port=5000, debug=True)
