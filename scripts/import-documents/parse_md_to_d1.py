import os
import re
import hashlib

def get_id(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:12]

def clean_text(text):
    # Escape single quotes for SQL
    return text.replace("'", "''").strip()

def parse_markdown(md_file):
    with open(md_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    subjects = []
    
    current_subject = None
    current_chapter = None
    current_kp = None
    
    # Regex for hierarchies
    re_subject = re.compile(r'^#*\s*(第[一二三四五六七八九十]+部分)\s+(.*)')
    re_chapter = re.compile(r'^#*\s*(第[一二三四五六七八九十]+章)\s+(.*)')
    re_section = re.compile(r'^#*\s*(第[一二三四五六七八九十]+节)\s+(.*)')
    
    # Matches Table of Contents lines with page numbers
    re_toc = re.compile(r'(\.{2,}|\s+)\d+\s*$')

    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Skip Table of Contents entries completely
        if re_toc.search(line):
            continue
            
        # MinerU often prepends # to everything. Let's clean it up for non-structural lines.
        clean_line = line
        if clean_line.startswith('# '):
            clean_line = clean_line[2:].strip()

        # Check Subject
        m_subj = re_subject.match(line)
        if m_subj:
            name = m_subj.group(2).strip()
            current_subject = {
                "name": name,
                "description": "",
                "chapters": []
            }
            subjects.append(current_subject)
            current_chapter = None
            current_kp = None
            continue
            
        # Check Chapter
        m_chap = re_chapter.match(line)
        if m_chap and current_subject is not None:
            name = m_chap.group(2).strip()
            current_chapter = {
                "name": name,
                "description": "",
                "knowledge_points": []
            }
            current_subject["chapters"].append(current_chapter)
            current_kp = None
            continue
            
        # Check Knowledge Point (Section)
        m_sec = re_section.match(line)
        if m_sec and current_chapter is not None:
            name = m_sec.group(2).strip()
            current_kp = {
                "name": name,
                "importance": "high" if "重点" in name else "medium",
                "description": ""
            }
            current_chapter["knowledge_points"].append(current_kp)
            continue
            
        # If it's none of the structural headers, it's content!
        # Append to the deepest active node
        if current_kp is not None:
            current_kp["description"] += clean_line + "\n"
        elif current_chapter is not None:
            current_chapter["description"] += clean_line + "\n"
        elif current_subject is not None:
            current_subject["description"] += clean_line + "\n"
            
    return subjects

def generate_sql(subjects, output_file="insert_syllabus.sql"):
    statements = []
    
    # Clear existing data to remove old garbage
    statements.append("PRAGMA foreign_keys = ON;")
    statements.append("DELETE FROM knowledge_points;")
    statements.append("DELETE FROM exam_chapters;")
    statements.append("DELETE FROM exam_subjects;")
    
    for i, subj in enumerate(subjects):
        subj_id = f"subj_{get_id(subj['name'])}"
        desc = clean_text(subj['description'])
        statements.append(f"INSERT OR REPLACE INTO exam_subjects (id, name, description, sort_order) VALUES ('{subj_id}', '{clean_text(subj['name'])}', '{desc}', {i+1});")
        
        for j, chap in enumerate(subj.get("chapters", [])):
            chap_id = f"chap_{get_id(chap['name'])}"
            desc = clean_text(chap['description'])
            statements.append(f"INSERT OR REPLACE INTO exam_chapters (id, subject_id, name, description, sort_order) VALUES ('{chap_id}', '{subj_id}', '{clean_text(chap['name'])}', '{desc}', {j+1});")
            
            for k, kp in enumerate(chap.get("knowledge_points", [])):
                kp_id = f"kp_{get_id(kp['name'])}"
                desc = clean_text(kp['description'])
                statements.append(f"INSERT OR REPLACE INTO knowledge_points (id, subject_id, chapter_id, name, description, importance, sort_order) VALUES ('{kp_id}', '{subj_id}', '{chap_id}', '{clean_text(kp['name'])}', '{desc}', '{kp['importance']}', {k+1});")

    with open(output_file, "w", encoding="utf-8") as f:
        f.write("\n".join(statements))
    print(f"Generated {len(statements)} SQL statements in {output_file}")

if __name__ == "__main__":
    if not os.path.exists("full.md"):
        print("Error: full.md not found. Please run MinerU extraction first.")
        exit(1)
        
    print("Parsing full.md with semantic structure...")
    subjects = parse_markdown("full.md")
    generate_sql(subjects)
    print("Done! You can now run: npx wrangler d1 execute patent-exam-db --remote --file insert_syllabus.sql")
