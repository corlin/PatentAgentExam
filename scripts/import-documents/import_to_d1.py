import json
import subprocess
import os

DB_NAME = "patent-exam-db"
SYLLABUS_FILE = "syllabus.json"
SQL_FILE = "insert_syllabus.sql"

def generate_sql():
    if not os.path.exists(SYLLABUS_FILE):
        print(f"{SYLLABUS_FILE} not found. Please run process_via_mineru.py first.")
        return

    with open(SYLLABUS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    sql_statements = []
    
    # Generate unique IDs based on names (simplified for script)
    import hashlib
    def get_id(name):
        return hashlib.md5(name.encode()).hexdigest()[:10]

    for subj in data.get("subjects", []):
        subj_id = f"subj_{get_id(subj['name'])}"
        sql_statements.append(f"INSERT OR REPLACE INTO exam_subjects (id, name, description, sort_order) VALUES ('{subj_id}', '{subj['name']}', '{subj.get('description', '')}', {subj['sort_order']});")
        
        for chap in subj.get("chapters", []):
            chap_id = f"chap_{get_id(chap['name'])}"
            sql_statements.append(f"INSERT OR REPLACE INTO exam_chapters (id, subject_id, name, sort_order) VALUES ('{chap_id}', '{subj_id}', '{chap['name']}', {chap['sort_order']});")
            
            for i, kp in enumerate(chap.get("knowledge_points", [])):
                kp_id = f"kp_{get_id(kp['name'])}"
                importance = kp.get("importance", "medium")
                sql_statements.append(f"INSERT OR REPLACE INTO knowledge_points (id, subject_id, chapter_id, name, importance, sort_order) VALUES ('{kp_id}', '{subj_id}', '{chap_id}', '{kp['name']}', '{importance}', {i+1});")

    with open(SQL_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_statements))
    
    print(f"Generated SQL insert statements in {SQL_FILE}")

def execute_sql(use_remote=False):
    target_env = "REMOTE" if use_remote else "LOCAL"
    print(f"Executing SQL on {target_env} D1 database: {DB_NAME}")
    
    cmd = [
        "npx", "wrangler", "d1", "execute", DB_NAME,
        "--remote" if use_remote else "--local",
        "--file", os.path.abspath(SQL_FILE)
    ]
    # Note: Assumes run from a directory where wrangler is available (e.g. apps/web or workers/api)
    # We will run this from workers/api
    try:
        subprocess.run(cmd, cwd="../../workers/api", check=True)
        print("Successfully imported syllabus into D1!")
    except subprocess.CalledProcessError as e:
        print(f"Error executing wrangler: {e}")

if __name__ == "__main__":
    import sys
    use_remote = "--remote" in sys.argv
    generate_sql()
    execute_sql(use_remote)
