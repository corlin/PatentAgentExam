import os
import glob
import time
import requests
import json
import zipfile
import io
import re
import hashlib
from dotenv import load_dotenv

load_dotenv()

MINERU_API_KEY = os.getenv("MINERU_API_KEY")
if not MINERU_API_KEY:
    print("Error: MINERU_API_KEY not found in .env")
    exit(1)

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {MINERU_API_KEY}"
}

BASE_DIRS = [
    "../../docs/专利代理师考试-2026（全套链接）/专利代理实务-真题",
    "../../docs/专利代理师考试-2026（全套链接）/专利法律知识-真题",
    "../../docs/专利代理师考试-2026（全套链接）/相关法律知识-真题"
]
OUTPUT_DIR = "processed_sql"

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

def upload_and_create_task(file_path):
    print(f"Applying upload URL for: {file_path}")
    api_url = "https://mineru.net/api/v4/file-urls/batch"
    file_name = os.path.basename(file_path)
    
    payload = {
        "files": [{"name": file_name, "data_id": "batch_textbook_ingest", "is_ocr": True}],
        "model_version": "vlm"
    }
    
    response = requests.post(api_url, headers=HEADERS, json=payload)
    response.raise_for_status()
    data = response.json()
    
    if data.get("code") != 0:
        raise Exception(f"Failed to apply upload URL: {data.get('msg')}")
        
    batch_id = data["data"]["batch_id"]
    upload_url = data["data"]["file_urls"][0]
    
    print(f"Uploading file to MinerU... (batch_id: {batch_id})")
    with open(file_path, 'rb') as f:
        res_upload = requests.put(upload_url, data=f)
        res_upload.raise_for_status()
        
    return batch_id

def poll_batch_task(batch_id):
    print("Polling batch task status...")
    api_url = f"https://mineru.net/api/v4/extract-results/batch/{batch_id}"
    
    while True:
        response = requests.get(api_url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        
        if data.get("code") != 0:
            raise Exception(f"Failed to poll task: {data.get('msg')}")
            
        results = data["data"]["extract_result"]
        if not results:
            time.sleep(10)
            continue
            
        result = results[0]
        status = result["state"]
        
        if status == "done":
            return result["full_zip_url"]
        elif status == "failed":
            raise Exception(f"Task failed to process. Error: {result.get('err_msg')}")
        
        time.sleep(10)

def download_and_extract(zip_url):
    response = requests.get(zip_url)
    response.raise_for_status()
    
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        md_filename = next((name for name in z.namelist() if name.endswith('full.md')), None)
        if not md_filename:
            raise Exception("Error: full.md not found in the extracted ZIP!")
            
        with z.open(md_filename) as f:
            return f.read().decode('utf-8')

def chunk_markdown(markdown_content, max_chars=800, overlap=100):
    sections = re.split(r'\n(?=#{1,3}\s)', markdown_content)
    chunks = []
    
    for section in sections:
        section = section.strip()
        if not section:
            continue
            
        if len(section) > max_chars:
            paragraphs = section.split('\n\n')
            current_chunk = ""
            for p in paragraphs:
                if len(current_chunk) + len(p) > max_chars and current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = current_chunk[-overlap:] + "\n\n" + p
                else:
                    current_chunk += "\n\n" + p
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
        else:
            chunks.append(section)
            
    return chunks

def generate_sql(chunks, source_file, output_file):
    statements = []
    source_name = os.path.basename(source_file)
    
    for i, chunk in enumerate(chunks):
        if len(chunk) < 20: continue
        
        text = chunk.replace("'", "''")
        chunk_id = "ref_" + hashlib.md5(text.encode('utf-8')).hexdigest()[:12]
        tokens = len(text)
        
        stmt = f"INSERT OR REPLACE INTO reference_materials (id, source_file, chunk_index, content, tokens) VALUES ('{chunk_id}', '{source_name}', {i}, '{text}', {tokens});"
        statements.append(stmt)
        
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("\n".join(statements))
    print(f"Generated {len(statements)} SQL statements -> {output_file}")

def main():
    extensions = ("*.pdf", "*.doc", "*.docx")
    all_files = []
    for ext in extensions:
        for base_dir in BASE_DIRS:
            all_files.extend(glob.glob(os.path.join(base_dir, "**", ext), recursive=True))
        
    all_files = [f for f in all_files if not os.path.basename(f).startswith('.')]
    print(f"Found {len(all_files)} documents to process.")
    
    generated_sqls = []

    for file_path in all_files:
        basename = os.path.basename(file_path)
        print(f"\n--- Processing {basename} ---")
        
        cache_md_file = os.path.join(OUTPUT_DIR, basename + ".md")
        sql_file = os.path.join(OUTPUT_DIR, basename + ".sql")
        
        if os.path.exists(sql_file):
            print(f"SQL file already exists: {sql_file}, skipping...")
            generated_sqls.append(sql_file)
            continue
            
        try:
            if os.path.exists(cache_md_file):
                print(f"Using cached markdown: {cache_md_file}")
                with open(cache_md_file, "r", encoding="utf-8") as f:
                    md_content = f.read()
            else:
                batch_id = upload_and_create_task(file_path)
                zip_url = poll_batch_task(batch_id)
                md_content = download_and_extract(zip_url)
                
                with open(cache_md_file, "w", encoding="utf-8") as f:
                    f.write(md_content)
                print(f"Saved extracted markdown to {cache_md_file}")
                
            chunks = chunk_markdown(md_content)
            generate_sql(chunks, file_path, sql_file)
            generated_sqls.append(sql_file)
            
        except Exception as e:
            print(f"Failed to process {basename}: {e}")

    print("\n\nAll processing finished!")
    print("To insert everything into D1, run the following commands:")
    for sql in generated_sqls:
        print(f"npx wrangler d1 execute patent-exam-db --remote --file {sql}")
    
    print("\nAfter running all inserts, don't forget to trigger vectorization:")
    print("curl -X POST http://localhost:8787/api/rag/embed-reference")

if __name__ == "__main__":
    main()
