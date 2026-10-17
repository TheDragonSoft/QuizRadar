import sys
sys.stdout.reconfigure(encoding='utf-8')
import gmail_service

res = gmail_service.process_quizzes(force_refresh=True)
fall_quizzes = [r for r in res if r['semester'] == 'Fall 2026']

print("="*60)
print(f"FALL 2026 ITEMS ({len(fall_quizzes)}):")
print("="*60)
for q in fall_quizzes:
    print(f"[{'UPCOMING' if q['is_upcoming'] else 'PAST'}] {q['course']} - {q['title']} -> Date: {q['date_iso']}")
    if q['topics']:
        print(f"   Topics: {', '.join(q['topics'])}")
    if q['warnings']:
        print(f"   Warnings: {q['warnings']}")
