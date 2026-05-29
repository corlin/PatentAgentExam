import os
import time
import requests
import json
from dotenv import load_dotenv

load_dotenv()

MINERU_API_KEY = os.getenv("MINERU_API_KEY")
if not MINERU_API_KEY:
    print("Error: MINERU_API_KEY not found in .env")
    exit(1)

# 本地 PDF 路径
PDF_PATH = "../../docs/2026年度专利代理师资格考试大纲.pdf"

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {MINERU_API_KEY}"
}

def upload_and_create_task(file_path):
    print(f"Applying upload URL for: {file_path}")
    api_url = "https://mineru.net/api/v4/file-urls/batch"
    
    file_name = os.path.basename(file_path)
    
    payload = {
        "files": [
            {"name": file_name, "data_id": "syllabus_2026", "is_ocr": True}
        ],
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
        # Note: PUT request should not include Content-Type header from our HEADERS dict
        res_upload = requests.put(upload_url, data=f)
        res_upload.raise_for_status()
        
    print("Upload successful!")
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
            print("No results returned yet, waiting...")
            time.sleep(5)
            continue
            
        result = results[0]
        status = result["state"]
        print(f"Current status: {status}")
        
        if status == "done":
            return result["full_zip_url"]
        elif status == "failed":
            raise Exception(f"Task failed to process. Error: {result.get('err_msg')}")
        
        time.sleep(5)

import zipfile
import io
import re

def parse_markdown_to_json(markdown_text):
    # A simple parser assuming `# ` is subject, `## ` is chapter, list items are knowledge points
    subjects = []
    current_subject = None
    current_chapter = None
    
    lines = markdown_text.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        if line.startswith('# '):
            current_subject = {
                "name": line[2:].strip(),
                "description": "",
                "sort_order": len(subjects) + 1,
                "chapters": []
            }
            subjects.append(current_subject)
            current_chapter = None
        elif line.startswith('## '):
            if current_subject:
                current_chapter = {
                    "name": line[3:].strip(),
                    "sort_order": len(current_subject["chapters"]) + 1,
                    "knowledge_points": []
                }
                current_subject["chapters"].append(current_chapter)
        elif line.startswith('- ') or line.startswith('* '):
            if current_chapter:
                # Remove prefix and check for importance marker like (重点)
                kp_text = line[2:].strip()
                importance = "high" if "重点" in kp_text else "medium"
                current_chapter["knowledge_points"].append({
                    "name": kp_text,
                    "importance": importance
                })
        else:
            # Append description to subject if it's text under subject
            if current_subject and not current_chapter:
                current_subject["description"] += line + " "

    return {"subjects": subjects}

def download_and_extract(zip_url):
    print(f"Task completed successfully!\nResult ZIP URL: {zip_url}")
    print("Downloading and extracting ZIP file...")
    
    # Download the ZIP
    response = requests.get(zip_url)
    response.raise_for_status()
    
    # Unzip in memory
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        # MinerU usually outputs full.md at the root or within a directory named after the file.
        # Let's find full.md
        md_filename = next((name for name in z.namelist() if name.endswith('full.md')), None)
        if not md_filename:
            print("Error: full.md not found in the extracted ZIP!")
            print("Available files:", z.namelist())
            return
            
        with z.open(md_filename) as f:
            markdown_content = f.read().decode('utf-8')
            
    print(f"Successfully extracted {md_filename}. Saving Markdown to full.md...")
    
    with open("full.md", "w", encoding="utf-8") as f:
        f.write(markdown_content)
    
    syllabus = parse_markdown_to_json(markdown_content)
    
    output_file = "syllabus.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(syllabus, f, ensure_ascii=False, indent=2)
    print(f"Saved extracted hierarchy to {output_file}")

if __name__ == "__main__":
    if not os.path.exists(PDF_PATH):
        print(f"Error: Could not find PDF file at {PDF_PATH}")
        exit(1)
        
    try:
        batch_id = upload_and_create_task(PDF_PATH)
        zip_url = poll_batch_task(batch_id)
        download_and_extract(zip_url)
    except Exception as e:
        print(f"Error: {e}")
