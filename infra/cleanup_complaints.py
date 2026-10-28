import os
import sys
import boto3
import redis
import psycopg2
from psycopg2.extras import RealDictCursor

sys.stdout.reconfigure(encoding='utf-8')

DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/urbanpulse")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
S3_BUCKET = os.getenv("S3_BUCKET", "urbanpulse-images")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

def cleanup():
    print("=== STARTING TARGETED COMPLAINTS CLEANUP ===")

    # 1. Connect to PostgreSQL
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Step A: Inspect existing complaints
        cur.execute("SELECT id, issue_class, status, created_at, description FROM complaints;")
        complaints_before = cur.fetchall()
        count_before = len(complaints_before)
        print(f"Complaints found before cleanup: {count_before}")

        if count_before == 0:
            print("No complaints to delete. Database already has 0 complaints.")
            return

        complaint_ids = [str(c["id"]) for c in complaints_before]

        # Step B: Check dependent records counts before deletion
        cur.execute("SELECT COUNT(*) AS c FROM complaint_status_history WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        status_history_before = cur.fetchone()["c"]

        cur.execute("SELECT COUNT(*) AS c FROM department_notifications WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        notifications_before = cur.fetchone()["c"]

        cur.execute("SELECT COUNT(*) AS c FROM repair_verifications WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        verifications_before = cur.fetchone()["c"]

        cur.execute("SELECT COUNT(*) AS c FROM complaint_embeddings WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        embeddings_before = cur.fetchone()["c"]

        print(f"Dependent records to delete:")
        print(f"  - complaint_status_history: {status_history_before}")
        print(f"  - department_notifications: {notifications_before}")
        print(f"  - repair_verifications: {verifications_before}")
        print(f"  - complaint_embeddings: {embeddings_before}")

        # Step C: Null out duplicate_of_id self-references first
        cur.execute("UPDATE complaints SET duplicate_of_id = NULL WHERE duplicate_of_id IS NOT NULL;")

        # Step D: Delete dependent records explicitly (or let CASCADE handle it, but explicit ensures clean audit)
        cur.execute("DELETE FROM complaint_status_history WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        del_history = cur.rowcount

        cur.execute("DELETE FROM department_notifications WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        del_notifs = cur.rowcount

        cur.execute("DELETE FROM repair_verifications WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        del_verifs = cur.rowcount

        cur.execute("DELETE FROM complaint_embeddings WHERE complaint_id = ANY(%s::uuid[]);", (complaint_ids,))
        del_embeddings = cur.rowcount

        # Step E: Delete complaints
        cur.execute("DELETE FROM complaints WHERE id = ANY(%s::uuid[]);", (complaint_ids,))
        del_complaints = cur.rowcount

        # Step F: Commit transaction
        conn.commit()
        print(f"\nTransaction committed successfully.")
        print(f"Deleted {del_complaints} complaints from 'complaints' table.")
        print(f"Deleted {del_history} status history records.")
        print(f"Deleted {del_notifs} department notifications.")
        print(f"Deleted {del_verifs} repair verifications.")
        print(f"Deleted {del_embeddings} embeddings.")

    except Exception as e:
        conn.rollback()
        print(f"ERROR during cleanup: {e}. Transaction rolled back.")
        raise
    finally:
        cur.close()
        conn.close()

    # Step G: MinIO Object Storage Cleanup
    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
        )
        resp = s3.list_objects_v2(Bucket=S3_BUCKET)
        objects = resp.get("Contents", [])
        if objects:
            delete_keys = [{"Key": o["Key"]} for o in objects]
            s3.delete_objects(Bucket=S3_BUCKET, Delete={"Objects": delete_keys})
            print(f"Deleted {len(delete_keys)} objects from MinIO bucket '{S3_BUCKET}'.")
        else:
            print(f"MinIO bucket '{S3_BUCKET}' was already empty.")
    except Exception as e:
        print(f"Warning: MinIO cleanup encountered: {e}")

    # Step H: Redis Queue Cleanup
    try:
        r = redis.Redis.from_url(REDIS_URL)
        q_len = r.llen("detection_jobs")
        r.delete("detection_jobs")
        print(f"Cleared {q_len} detection_jobs queue messages from Redis.")
    except Exception as e:
        print(f"Warning: Redis cleanup encountered: {e}")

    # Step I: Verification queries directly on DB
    conn2 = psycopg2.connect(DB_URL)
    cur2 = conn2.cursor(cursor_factory=RealDictCursor)

    cur2.execute("SELECT COUNT(*) AS c FROM complaints;")
    rem_complaints = cur2.fetchone()["c"]

    cur2.execute("SELECT COUNT(*) AS c FROM complaint_status_history;")
    rem_history = cur2.fetchone()["c"]

    cur2.execute("SELECT COUNT(*) AS c FROM department_notifications;")
    rem_notifs = cur2.fetchone()["c"]

    cur2.execute("SELECT COUNT(*) AS c FROM repair_verifications;")
    rem_verifs = cur2.fetchone()["c"]

    cur2.execute("SELECT COUNT(*) AS c FROM complaint_embeddings;")
    rem_embeddings = cur2.fetchone()["c"]

    cur2.execute("SELECT COUNT(*) AS c FROM users;")
    rem_users = cur2.fetchone()["c"]

    cur2.execute("SELECT COUNT(*) AS c FROM departments;")
    rem_depts = cur2.fetchone()["c"]

    print("\n=== POST-CLEANUP VERIFICATION ===")
    print(f"Remaining complaints: {rem_complaints} (Expected: 0)")
    print(f"Remaining complaint_status_history: {rem_history} (Expected: 0)")
    print(f"Remaining department_notifications: {rem_notifs} (Expected: 0)")
    print(f"Remaining repair_verifications: {rem_verifs} (Expected: 0)")
    print(f"Remaining complaint_embeddings: {rem_embeddings} (Expected: 0)")
    print(f"Remaining users: {rem_users} (Expected: 14 preserved)")
    print(f"Remaining departments: {rem_depts} (Expected: 6 preserved)")

    cur2.close()
    conn2.close()

if __name__ == "__main__":
    cleanup()
