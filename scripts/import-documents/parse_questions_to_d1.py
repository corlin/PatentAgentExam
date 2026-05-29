import re
import hashlib
import json
import os

def get_id(text):
    return "q_" + hashlib.md5(text.encode('utf-8')).hexdigest()[:12]

def get_opt_id(text):
    return "opt_" + hashlib.md5(text.encode('utf-8')).hexdigest()[:12]

def get_exp_id(text):
    return "exp_" + hashlib.md5(text.encode('utf-8')).hexdigest()[:12]

def clean_text(text):
    return text.replace("'", "''").strip()

def parse_markdown(md_file):
    with open(md_file, 'r', encoding='utf-8') as f:
        text = f.read()

    questions = []
    
    # Split text into blocks by looking for "1. ", "2. ", etc at start of line
    # Wait, simple split by regex `\n\d+\. `
    
    blocks = re.split(r'\n(?=\d+\.\s)', text)
    
    # First block is preamble, skip it
    if len(blocks) > 0:
        blocks = blocks[1:]
        
    for block in blocks:
        block = block.strip()
        if not block:
            continue
            
        lines = block.split('\n')
        
        # Stem is the first line(s) until A/B/C/D or 答案
        stem_lines = []
        options_lines = []
        answer_line = ""
        explanation_lines = []
        
        state = "STEM" # STEM -> OPTIONS -> ANSWER -> EXPLANATION
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            if line.startswith("答案：") or line.startswith("答案:") or line.startswith("# 答案"):
                state = "ANSWER"
                answer_line = line
                continue
                
            if line.startswith("解析：") or line.startswith("解析:"):
                state = "EXPLANATION"
                explanation_lines.append(line.replace("解析：", "").replace("解析:", "").strip())
                continue
                
            if state == "STEM":
                if re.match(r'^[A-D]\.', line):
                    state = "OPTIONS"
                    options_lines.append(line)
                else:
                    stem_lines.append(line)
            elif state == "OPTIONS":
                options_lines.append(line)
            elif state == "EXPLANATION":
                explanation_lines.append(line)
                
        stem = " ".join(stem_lines)
        # Remove the leading "1. " from stem
        stem = re.sub(r'^\d+\.\s*', '', stem).strip()
        
        options_text = " ".join(options_lines)
        answer = answer_line.replace("答案：", "").replace("答案:", "").replace("# 答案:", "").replace("# 答案：", "").strip()
        explanation = " ".join(explanation_lines)
        
        # Parse options A. xxx B. xxx C. xxx D. xxx
        parsed_options = {}
        opt_matches = list(re.finditer(r'([A-D])\.\s*(.*?)(?=(?:[A-D]\.|$))', options_text))
        for match in opt_matches:
            key = match.group(1)
            val = match.group(2).strip()
            parsed_options[key] = val
            
        if not stem or not answer:
            continue
            
        question_type = "single" if len(answer) == 1 else "multiple"
        
        q = {
            "stem": stem,
            "options": parsed_options,
            "answer": answer,
            "explanation": explanation,
            "question_type": question_type
        }
        questions.append(q)
        
    return questions

def generate_sql(questions, output_file="insert_questions.sql"):
    statements = []
    
    statements.append("PRAGMA foreign_keys = ON;")
    statements.append("DELETE FROM wrong_questions;")
    statements.append("DELETE FROM user_answers;")
    statements.append("DELETE FROM question_explanations;")
    statements.append("DELETE FROM question_options;")
    statements.append("DELETE FROM questions;")
    
    for i, q in enumerate(questions):
        q_id = get_id(q['stem'])
        
        statements.append(f"INSERT OR REPLACE INTO questions (id, year, subject_id, chapter_id, question_type, stem, answer, difficulty, source) VALUES ('{q_id}', 2026, 'subj_law', 'chap_mock', '{q['question_type']}', '{clean_text(q['stem'])}', '{clean_text(q['answer'])}', 'medium', '2026 Mock Exam');")
        
        for key, text in q['options'].items():
            opt_id = get_opt_id(q_id + key)
            is_correct = 1 if key in q['answer'] else 0
            statements.append(f"INSERT OR REPLACE INTO question_options (id, question_id, option_key, option_text, is_correct) VALUES ('{opt_id}', '{q_id}', '{key}', '{clean_text(text)}', {is_correct});")
            
        exp_id = get_exp_id(q_id)
        statements.append(f"INSERT OR REPLACE INTO question_explanations (id, question_id, explanation, created_by) VALUES ('{exp_id}', '{q_id}', '{clean_text(q['explanation'])}', 'system');")
        
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("\n".join(statements))
    print(f"Generated {len(statements)} SQL statements (for {len(questions)} questions) in {output_file}")

if __name__ == "__main__":
    if not os.path.exists("questions_2019_full.md"):
        print("Error: questions_2019_full.md not found.")
        exit(1)
        
    print("Parsing Markdown to extract questions...")
    qs = parse_markdown("questions_2019_full.md")
    generate_sql(qs)
    print("Done! You can now run: npx wrangler d1 execute patent-exam-db --remote --file insert_questions.sql")
