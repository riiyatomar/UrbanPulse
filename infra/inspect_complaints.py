import os
import sys
import json
import psycopg2
from psycopg2.extras import RealDictCursor

sys.stdout.reconfigure(encoding='utf-8')

DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/urbanpulse")

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 1. Total counts in complaints
    cur.execute("SELECT COUNT(*) AS count FROM complaints;")
    total_complaints = cur.fetchone()["count"]
    print(f"=== TOTAL COMPLAINTS: {total_complaints} ===")

    # 2. Inspect all complaint rows
    cur.execute("""
        SELECT 
            id, issue_class, status, confidence, severity_score, priority_score,
            department_id, citizen_id, duplicate_of_id, source, location_source,
            created_at, updated_at, description, location_address
        FROM complaints
        ORDER BY created_at ASC;
    """)
    rows = cur.fetchall()
    print(f"\n=== COMPLAINT DETAILS ({len(rows)} rows) ===")
    for i, r in enumerate(rows, 1):
        print(f"[{i}] ID: {r['id']} | class: {r['issue_class']} | status: {r['status']} | citizen: {r['citizen_id']} | dept: {r['department_id']} | dup_of: {r['duplicate_of_id']}")
        print(f"    source: {r['source']} | loc_src: {r['location_source']} | created: {r['created_at']}")
        print(f"    desc: {r['description']} | addr: {r['location_address']}")

    # 3. Check dependent records in complaint_embeddings
    print("\n=== DEPENDENT RECORDS COUNTS ===")
    try:
        cur.execute("SELECT COUNT(*) AS count FROM complaint_embeddings;")
        emb_count = cur.fetchone()["count"]
        print(f"complaint_embeddings: {emb_count}")
    except Exception as e:
        conn.rollback()
        print(f"complaint_embeddings query failed (pgvector library): {e}")

    # 4. Check dependent records in repair_verifications
    try:
        cur.execute("SELECT COUNT(*) AS count FROM repair_verifications;")
        verif_count = cur.fetchone()["count"]
        print(f"repair_verifications: {verif_count}")
        if verif_count > 0:
            cur.execute("SELECT id, complaint_id, verified FROM repair_verifications;")
            for v in cur.fetchall():
                print(f"  verif: {v['id']} for complaint {v['complaint_id']} (verified={v['verified']})")
    except Exception as e:
        conn.rollback()
        print(f"repair_verifications query failed: {e}")

    # 5. Check dependent records in complaint_status_history
    try:
        cur.execute("SELECT COUNT(*) AS count FROM complaint_status_history;")
        history_count = cur.fetchone()["count"]
        print(f"complaint_status_history: {history_count}")
        if history_count > 0:
            cur.execute("SELECT id, complaint_id, previous_status, new_status, actor, actor_user_id, changed_at FROM complaint_status_history;")
            for h in cur.fetchall():
                print(f"  history: {h['id']} complaint={h['complaint_id']} {h['previous_status']}->{h['new_status']} by {h['actor']}")
    except Exception as e:
        conn.rollback()
        print(f"complaint_status_history query failed: {e}")

    # 6. Check dependent records in department_notifications
    try:
        cur.execute("SELECT COUNT(*) AS count FROM department_notifications;")
        notif_count = cur.fetchone()["count"]
        print(f"department_notifications: {notif_count}")
        if notif_count > 0:
            cur.execute("SELECT id, department_id, complaint_id, type, title FROM department_notifications;")
            for n in cur.fetchall():
                print(f"  notification: {n['id']} dept={n['department_id']} complaint={n['complaint_id']} title={n['title']}")
    except Exception as e:
        conn.rollback()
        print(f"department_notifications query failed: {e}")

    # 7. Check preserved tables (users, departments)
    try:
        cur.execute("SELECT COUNT(*) AS count FROM users;")
        user_count = cur.fetchone()["count"]
        cur.execute("SELECT id, name, email, role, is_active FROM users;")
        users = cur.fetchall()
        print(f"\n=== USERS ({user_count}) ===")
        for u in users:
            print(f"  User: {u['name']} ({u['email']}) - Role: {u['role']} - Active: {u['is_active']} - ID: {u['id']}")
    except Exception as e:
        conn.rollback()
        print(f"users query failed: {e}")

    try:
        cur.execute("SELECT COUNT(*) AS count FROM departments;")
        dept_count = cur.fetchone()["count"]
        cur.execute("SELECT id, name FROM departments;")
        depts = cur.fetchall()
        print(f"\n=== DEPARTMENTS ({dept_count}) ===")
        for d in depts:
            print(f"  Dept: {d['name']} ({d['id']})")
    except Exception as e:
        conn.rollback()
        print(f"departments query failed: {e}")

    # 8. Check any image URLs in complaints
    try:
        cur.execute("SELECT id, image_url, blurred_image_url FROM complaints;")
        images = cur.fetchall()
        print(f"\n=== COMPLAINT IMAGES ({len(images)}) ===")
        for img in images:
            print(f"  Complaint {img['id']}: orig={img['image_url']}, blurred={img['blurred_image_url']}")
    except Exception as e:
        conn.rollback()
        print(f"complaint images query failed: {e}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
