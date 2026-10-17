import re
from datetime import datetime, timedelta

# Helper to normalize dates and extract rich quiz metadata
def parse_quiz_email(email):
    msg_id = email.get('id', '')
    subject = email.get('subject', '')
    sender = email.get('from', '')
    date_str = email.get('date', '')
    body = email.get('body', '')
    snippet = email.get('snippet', '')

    # Determine course code (e.g., CSE263, CSE354, GSE211, CSE252, CSE241, COM245, etc.)
    course_match = re.search(r'\b([A-Z]{2,4}\s*\d{3}[a-zA-Z]?)\b', subject + " " + body[:300])
    course = course_match.group(1).replace(" ", "") if course_match else "GENERAL"
    if "Embedded Systems" in subject or "Embedded Systems" in body:
        course = "CSE252"
    elif "Electronic Design" in subject:
        course = "CSE241"

    # Exclude pure upload notifications that aren't quiz announcements
    if "is new in the course" in body.lower() and not ("there will be a quiz" in body.lower() or "announcement" in subject.lower()):
        return None

    # Title / Assessment Type normalization
    title_match = re.search(r'(Class\s*Quiz\s*\d+|Online\s*Quiz\s*\d+|Quiz\s*\d+|Midterm\s*(?:Examinations|Exam)?|Final\s*Exam|In-Class\s*Assignment)', subject, re.IGNORECASE)
    if title_match:
        title = title_match.group(0).title()
    elif "quiz" in subject.lower():
        title = "Lecture Quiz"
    elif "midterm" in subject.lower():
        title = "Midterm Exam"
    else:
        title = subject

    # Extract Moodle / E-Learning URL if available
    url_match = re.search(r'(https://e-learning\.msa\.edu\.eg/[^\s]+)', body)
    elearning_url = url_match.group(1) if url_match else ""

    # Topics extraction
    topics = []
    if "trapezoidal" in body.lower() or "simpson" in body.lower():
        topics.extend(["Trapezoidal Rule", "Simpson’s 1/3 Rule", "Numerical Integration Methods"])
    if "regression" in body.lower() or "nearest neighbors" in body.lower() or "naïve bayes" in body.lower():
        topics.extend(["Introduction", "Regression", "k-Nearest Neighbors (k-NN) Classifier", "Naïve Bayes Classifier"])
    if "algorithm efficiency" in body.lower() or "recursion" in body.lower():
        topics.extend(["Lecture 1: Algorithm Efficiency", "Lecture 2: Recursion"])
    if "bjt" in body.lower() or "mosfet" in body.lower():
        topics.extend(["BJT Transistors", "MOSFET Transistors"])
    if "linear algebra" in body.lower() or "chapter 4" in body.lower():
        topics.extend(["Linear Algebra", "Chapter 4"])
    if not topics:
        topic_header = re.search(r'TOPICS COVERED:?([^\n\r]+(?:\n[^\n\r]+){1,5})', body, re.IGNORECASE)
        if topic_header:
            raw_lines = topic_header.group(1).split('\n')
            for line in raw_lines:
                clean = re.sub(r'[*•\-\d\.]', '', line).strip()
                if clean and len(clean) > 3:
                    topics.append(clean)

    # Important Warnings & Instructions
    warnings = []
    if "quiz template" in body.lower():
        warnings.append("⚠️ Bring your printed Quiz Template to the lecture!")
    if "move to the next question, you will not be able to go back" in body.lower() or "cannot go back" in body.lower() or "won't be able to go back" in body.lower():
        warnings.append("⚠️ Strict Navigation: Once you move to the next question, you CANNOT go back!")
    if "closed-book" in body.lower() or "mobile phones are strictly prohibited" in body.lower():
        warnings.append("⚠️ Closed Book: Mobile phones & outside materials are strictly prohibited.")
    if "15 minutes" in body.lower() or "15 mins" in body.lower():
        warnings.append("⏱️ Duration: 15 minutes.")
    if "mcq" in body.lower():
        warnings.append("📝 Format: Multiple Choice Questions (MCQ) + Explain & Discuss.")
    if "assigned time slot" in body.lower() or "assigned group" in body.lower():
        warnings.append("📍 Attendance: You must attend ONLY at your assigned time slot / group.")

    # Instructor
    instructor = sender.split("<")[0].replace('"', '').replace('(via Home-Su25)', '').strip()
    if not instructor or "noreply" in instructor:
        doc_match = re.search(r'(Dr\.\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|Eng\.\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', body)
        if doc_match:
            instructor = doc_match.group(1)

    # Parse email sent date
    sent_date = datetime(2026, 10, 17)
    try:
        clean_date = re.sub(r'\s*\([A-Z]+\)', '', date_str).strip()
        sent_date = datetime.strptime(clean_date[:25].strip(), "%a, %d %b %Y %H:%M:%S")
    except Exception:
        try:
            sent_date = datetime.strptime(clean_date[:16].strip(), "%d %b %Y %H:%M")
        except Exception:
            pass

    # Split out the Moodle header to avoid matching the post creation date
    if '----' in body:
        parts = re.split(r'-{10,}', body)
        announcement_content = parts[1] if len(parts) > 1 else body
    else:
        announcement_content = body

    # Date resolution
    explicit_date = None

    # Special check for "New Date:" (e.g. Midterms updated date)
    new_date_match = re.search(r'New Date:\s*([A-Za-z]+,\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})', announcement_content, re.IGNORECASE)
    if new_date_match:
        for fmt in ("%A, %d %B %Y", "%d %B %Y"):
            try:
                explicit_date = datetime.strptime(new_date_match.group(1).strip(), fmt)
                break
            except ValueError:
                pass

    if not explicit_date:
        date_patterns = [
            r'(\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b)',
            r'(\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b)',
            r'(\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b)'
        ]
        for pattern in date_patterns:
            match = re.search(pattern, subject + " " + announcement_content, re.IGNORECASE)
            if match:
                date_str_found = match.group(1)
                for fmt in ("%A, %d %B %Y", "%d %B %Y", "%d-%m-%Y", "%d/%m/%Y"):
                    try:
                        explicit_date = datetime.strptime(date_str_found, fmt)
                        break
                    except ValueError:
                        pass
                if explicit_date:
                    break

    target_date = explicit_date
    if not target_date:
        norm_content = re.sub(r'\s+', ' ', announcement_content.lower())
        if "monday and wednesday" in norm_content and ("quiz" in norm_content or "this week" in norm_content):
            # Sent Fri 16 Oct -> Upcoming Monday is 19 Oct 2026
            target_date = sent_date + timedelta(days=3)
        elif "next week (not this week)" in norm_content:
            # Sent Sat 10 Oct -> Next week lectures start Sun 18 / Mon 19 Oct 2026
            target_date = sent_date + timedelta(days=9)
        elif "next week's lecture" in norm_content or "lecture next week" in norm_content:
            target_date = sent_date + timedelta(days=5)
        elif "this week's lecture" in norm_content or "this week lecture" in norm_content:
            target_date = sent_date + timedelta(days=3)
        else:
            target_date = sent_date

    # Status relative to 2026-10-17
    reference_date = datetime(2026, 10, 17, 0, 0, 0)
    is_upcoming = target_date >= reference_date

    # Semester classification
    if target_date.year == 2026 and target_date.month >= 9:
        semester = "Fall 2026"
    elif target_date.year == 2026 and target_date.month in (7, 8):
        semester = "Summer 2026"
    elif target_date.year == 2026 and target_date.month in range(2, 7):
        semester = "Spring 2026"
    elif target_date.year == 2025:
        semester = "Fall 2025"
    else:
        semester = "Earlier"

    # Color coding for courses
    course_colors = {
        "CSE263": "#6366f1",  # Indigo
        "CSE354": "#ec4899",  # Pink
        "GSE211": "#3b82f6",  # Blue
        "CSE252": "#8b5cf6",  # Purple
        "CSE241": "#10b981",  # Emerald
        "COM245": "#f59e0b",  # Amber
        "CSE144": "#ef4444",  # Red
        "MAT261": "#06b6d4",  # Cyan
        "ESE262": "#14b8a6",  # Teal
        "MAT251": "#84cc16",  # Lime
        "BSC252": "#f97316",  # Orange
        "CSE141": "#a855f7",  # Violet
        "CSE142": "#eab308",  # Yellow
    }
    color = course_colors.get(course, "#64748b")

    return {
        "id": msg_id,
        "course": course,
        "title": title,
        "subject": subject,
        "date_iso": target_date.strftime("%Y-%m-%d"),
        "time_display": target_date.strftime("%A, %d %B %Y"),
        "sent_date": sent_date.strftime("%Y-%m-%d %H:%M"),
        "instructor": instructor,
        "topics": topics,
        "warnings": warnings,
        "elearning_url": elearning_url,
        "body_preview": snippet or body[:200],
        "is_upcoming": is_upcoming,
        "semester": semester,
        "color": color
    }
