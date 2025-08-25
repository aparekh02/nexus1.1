from flask import Flask, request, jsonify, session, make_response
from flask_cors import CORS
import os
from dotenv import dotenv_values
from supabase import create_client, Client
import base64
from datetime import datetime
import uuid
from werkzeug.security import generate_password_hash, check_password_hash
import json
import fitz # PyMuPDF
from PIL import Image
import pytesseract
import io
import time
import functools
import nltk
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from nltk.tokenize import word_tokenize, sent_tokenize

# Download required NLTK data
import nltk
nltk.download('punkt_tab')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet')

try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

# Adding explicit download for 'punkt_tab' as suggested by traceback, just in case.
# This might be redundant if 'punkt' covers it, but ensures the resource is present.
try:
    nltk.data.find('tokenizers/punkt/PY3/english.pickle') # A common file within punkt
except LookupError:
    nltk.download('punkt') # Re-download punkt if the specific file is not found.

# Environment file paths
GROQ_ENV_PATH = os.path.join( "groqapi.env")
SB_ENV_PATH = os.path.join("sb.env")
sb_config = dotenv_values(SB_ENV_PATH)

# Load configs separately
groq_config = dotenv_values(GROQ_ENV_PATH)

# Extract keys from respective .env files
GROQ_API_KEY = groq_config.get("GROQ_API_KEY")
SUPABASE_URL = sb_config.get("SUPABASE_URL")
SUPABASE_ANON_KEY = sb_config.get("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    print("Warning: Supabase environment variables not found in sb.env. Supabase features will not work.")
else:
    print("Supabase URL and Anon Key loaded from sb.env.")

if not GROQ_API_KEY:
    print("Warning: GROQ_API_KEY not found in groqapi.env. AI features will not work.")
else:
    print("GROQ_API_KEY loaded from groqapi.env.")

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

from groq import Groq

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=["http://localhost:5173"] )

# --- Path Configuration ---
UPLOAD_FOLDER = os.path.join("uploads")
# Configure Flask session
app.secret_key = sb_config.get("FLASK_SECRET_KEY")
app.config['SESSION_TYPE'] = 'filesystem'
EXTRACTED_TEXT_FOLDER = os.path.join("extracted_texts")
COMPRESSED_DATA_FOLDER = os.path.join("compressed_data")

# Create directories if they don't exist
for folder in [UPLOAD_FOLDER, EXTRACTED_TEXT_FOLDER, COMPRESSED_DATA_FOLDER]:
    if not os.path.exists(folder):
        os.makedirs(folder)

# --- Path Configuration ---
UPLOAD_FOLDER = os.path.join("uploads")
# Configure Flask session
app.secret_key = sb_config.get("FLASK_SECRET_KEY")
app.config['SESSION_TYPE'] = 'filesystem'
EXTRACTED_TEXT_FOLDER = os.path.join("extracted_texts")
COMPRESSED_DATA_FOLDER = os.path.join("compressed_data")

# Create directories if they don't exist
for folder in [UPLOAD_FOLDER, EXTRACTED_TEXT_FOLDER, COMPRESSED_DATA_FOLDER]:
    if not os.path.exists(folder):
        os.makedirs(folder)

groq_client = Groq(api_key=GROQ_API_KEY)

def get_authenticated_user():
    """
    Get the authenticated user from session or Supabase JWT
    Returns the user's email if authenticated and exists in users table, None otherwise
    """
    try:
        # First check if user is in session (from login)
        user_email = session.get("user_email")
        if user_email:
            print(f"User found in session: {user_email}")
            return user_email
            
        # If not in session, try Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            print("No session user or valid Authorization header found")
            return None
        
        # Extract the JWT token
        token = auth_header.split(" ")[1]
        
        # Get user from Supabase using the token
        user_response = supabase.auth.get_user(token)
        
        if user_response.user and user_response.user.email:
            user_email = user_response.user.email
            
            # Verify the email exists in our users table
            try:
                user_check = supabase.table("users").select("email").eq("email", user_email).execute()
                if user_check.data:
                    # User exists in our users table
                    print(f"Authenticated user verified via JWT: {user_email}")
                    return user_email
                else:
                    # User authenticated with Supabase but not in our users table
                    print(f"Warning: User {user_email} authenticated but not found in users table")
                    return None
            except Exception as db_error:
                print(f"Error checking user in users table: {db_error}")
                return None
        else:
            return None
            
    except Exception as e:
        print(f"Error getting authenticated user: {e}")
        return None

CLASSES = ["Math", "Science", "History", "Art", "Computer Science", "English"]

# Define available access levels for projects
ACCESS_LEVELS = ['private', 'view_only', 'edit']

# Decorator for exponential backoff
def retry_with_backoff(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        max_retries = 5
        base_delay = 1 # seconds
        for i in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                # Check for specific Groq API errors
                error_message = str(e)
                if "rate_limit_exceeded" in error_message or "Request Entity Too Large" in error_message or "json_validate_failed" in error_message:
                    delay = base_delay * (2 ** i)
                    print(f"Groq API error: {e}. Retrying in {delay} seconds...")
                    time.sleep(delay)
                else:
                    raise # Re-raise other exceptions immediately
        raise Exception(f"Failed after {max_retries} retries due to persistent errors.")
    return wrapper

# Helper function to extract text from PDF or image files
def _extract_text_from_file(file_path):
    text_content = ""
    file_extension = os.path.splitext(file_path)[1].lower()

    if file_extension == '.pdf':
        try:
            doc = fitz.open(file_path)
            for page_num in range(doc.page_count):
                page = doc.load_page(page_num)
                # Try to get text directly
                page_text = page.get_text()
                if page_text.strip():
                    text_content += page_text + "\n"
                else:
                    # If no text, try OCR (e.g., for scanned PDFs)
                    pix = page.get_pixmap()
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    ocr_text = pytesseract.image_to_string(img)
                    text_content += ocr_text + "\n"
            doc.close()
        except Exception as e:
            print(f"Error processing PDF {file_path}: {e}")
            # Fallback to OCR if PDF processing fails
            try:
                img = Image.open(file_path) # Might be a PDF that Pillow can open as image
                text_content = pytesseract.image_to_string(img)
            except Exception as img_e:
                print(f"Error trying OCR on PDF as image {file_path}: {img_e}")
    elif file_extension in ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff']:
        try:
            img = Image.open(file_path)
            text_content = pytesseract.image_to_string(img)
        except Exception as e:
            print(f"Error processing image {file_path} with OCR: {e}")
    else:
        # For other text-based files, just read directly
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                text_content = f.read()
        except Exception as e:
            print(f"Error reading plain text file {file_path}: {e}")

    return text_content.strip()

# Helper function to read extracted text content from disk
def read_extracted_text_content(file_path):
    try:
        # Ensure the path is within the EXTRACTED_TEXT_FOLDER for security
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(os.path.abspath(EXTRACTED_TEXT_FOLDER)):
            print(f"Attempted to read file outside EXTRACTED_TEXT_FOLDER: {file_path}")
            return "" # Prevent directory traversal attacks

        with open(abs_file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Error reading extracted text file {file_path}: {e}")
        return ""

# Helper function to read/write compressed JSON data
def read_compressed_data(file_path):
    try:
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(os.path.abspath(COMPRESSED_DATA_FOLDER)):
            print(f"Attempted to read file outside COMPRESSED_DATA_FOLDER: {file_path}")
            return None
        with open(abs_file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading compressed data from {file_path}: {e}")
        return None

def write_compressed_data(data, file_path):
    try:
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(os.path.abspath(COMPRESSED_DATA_FOLDER)):
            print(f"Attempted to write file outside COMPRESSED_DATA_FOLDER: {file_path}")
            return False
        with open(abs_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error writing compressed data to {file_path}: {e}")
        return False

# IMPROVED NLTK-based compression
def _nltk_compress_and_filter(structured_data):
    """
    Further compresses structured data using NLTK to focus on definitions and Q&A.
    Returns a highly concise string.
    """
    lemmatizer = WordNetLemmatizer()
    stop_words = set(stopwords.words('english'))

    concise_parts = []

    # Prioritize definitions and make them very concise
    for definition in structured_data.get('definitions', []):
        tokens = word_tokenize(definition.lower())
        filtered_tokens = [lemmatizer.lemmatize(w) for w in tokens if w.isalnum() and w not in stop_words]
        concise_parts.append("Definition: " + " ".join(filtered_tokens[:15])) # Limit to first 15 relevant words

    # Prioritize questions and answers
    questions = structured_data.get('questions', [])
    answers = structured_data.get('answers', [])
    for i in range(min(len(questions), len(answers))):
        q_tokens = word_tokenize(questions[i].lower())
        q_filtered = [lemmatizer.lemmatize(w) for w in q_tokens if w.isalnum() and w not in stop_words]
        
        a_tokens = word_tokenize(answers[i].lower())
        a_filtered = [lemmatizer.lemmatize(w) for w in a_tokens if w.isalnum() and w not in stop_words]
        
        concise_parts.append(f"Q: {' '.join(q_filtered[:20])} A: {' '.join(a_filtered[:20])}") # Limit Q&A to 20 words each

    # Add terms if they haven't been covered by definitions
    terms_added = set()
    for def_str in concise_parts:
        if def_str.startswith("Definition: "):
            # Simple way to get the potential term from the definition string
            term_part = def_str.split(":")[1].strip().split(" ")[0] 
            terms_added.add(lemmatizer.lemmatize(term_part.lower()))
    
    for term in structured_data.get('terms', []):
        if lemmatizer.lemmatize(term.lower()) not in terms_added:
            concise_parts.append("Term: " + term)

    # Join all concise parts, ensuring overall length is managed
    final_concise_text = "\n".join(concise_parts)
    
    # Final check to ensure it's not excessively long for Groq input
    # Aim for a very small fraction of original, so keep this tight
    MAX_FINAL_COMPRESSED_CHARS = 2000 # Roughly 500 tokens for context
    if len(final_concise_text) > MAX_FINAL_COMPRESSED_CHARS:
        final_concise_text = final_concise_text[:MAX_FINAL_COMPRESSED_CHARS] + "..."

    return final_concise_text

# IMPROVED: AI-driven text compression/structured extraction for a single chunk
@retry_with_backoff
def _extract_key_study_elements_from_chunk(text_chunk):
    if not text_chunk.strip():
        return {
            "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
        }

    prompt = (
        "From the following study material, extract and categorize the key information. "
        "Provide the output as a JSON object with the following keys:\n"
        "'terms': A list of important terms found (e.g., ['Term1', 'Term2']).\n"
        "'definitions': A list of definitions, explicitly linking to a term if possible (e.g., ['Term1: Definition of Term1', 'Definition of concept']).\n"
        "'examples': A list of specific examples related to concepts (e.g., ['Example 1 description', 'Example 2 description']).\n"
        "'questions': A list of questions (from quizzes, practice problems, etc.) as plain strings (e.g., ['What is X?', 'How does Y work?']).\n"
        "'answers': A list of answers corresponding to the questions, as plain strings. If an answer is not explicitly given, state 'Not provided' (e.g., ['Answer to Q1', 'Not provided']).\n\n"
        "If a category is not found, its list should be empty. Output ONLY the JSON object. "
        "Be extremely concise and extract only the most critical information to minimize output size. "
        "Ensure ALL list items are plain strings, not nested objects or complex structures. Prioritize conciseness."
    )

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt + "\n\nMaterial:\n" + text_chunk}
            ],
            model="gemma2-9b-it",
            response_format={"type": "json_object"},
            temperature=0.2, # Lower temperature for more factual extraction
            max_tokens=4000, # Reduced max tokens for the extracted JSON output to enforce conciseness
        )
        response_content = chat_completion.choices[0].message.content
        extracted_data = json.loads(response_content)

        # Post-process to ensure all list items are strings, handling potential AI errors
        def ensure_strings_in_list(lst):
            if not isinstance(lst, list):
                return []
            return [str(item) if not isinstance(item, (dict, list)) else json.dumps(item) for item in lst]

        return {
            "terms": ensure_strings_in_list(extracted_data.get("terms", [])),
            "definitions": ensure_strings_in_list(extracted_data.get("definitions", [])),
            "examples": ensure_strings_in_list(extracted_data.get("examples", [])),
            "questions": ensure_strings_in_list(extracted_data.get("questions", [])),
            "answers": ensure_strings_in_list(extracted_data.get("answers", []))
        }

    except json.JSONDecodeError as e:
        print(f"JSONDecodeError in _extract_key_study_elements_from_chunk: {e}. Raw response: {response_content[:500]}...")
        return { "terms": [], "definitions": [], "examples": [], "questions": [], "answers": [] }
    except Exception as e:
        print(f"Error extracting key study elements from chunk with Groq API: {e}")
        return { "terms": [], "definitions": [], "examples": [], "questions": [], "answers": [] }

# IMPROVED: Main text processing and compression pipeline
def _process_and_compress_text(raw_text_content, file_id):
    # This function will handle token limits and return a path to compressed JSON

    # Define a safe chunk size for the LLM input
    # gemma2-9b-it has 8192 context window. Let's aim for 4000-6000 tokens per chunk
    # Assuming ~4 chars per token for English, 4000 tokens is ~16000 characters.
    # We'll use a character-based chunking for simplicity.
    CHUNK_SIZE_CHARS = 13000 # Roughly 3000 tokens input to extraction LLM
    OVERLAP_CHARS = 500 # To maintain context across chunks

    full_extracted_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }

    if not raw_text_content.strip():
        return None # Return None if no content to process

    # Chunk the text
    chunks = []
    start = 0
    while start < len(raw_text_content):
        end = min(start + CHUNK_SIZE_CHARS, len(raw_text_content))
        chunks.append(raw_text_content[start:end])
        start = end - OVERLAP_CHARS # Move back by overlap amount
        if start >= len(raw_text_content):
            break

    print(f"Processing {len(chunks)} chunks for file {file_id}")

    # Process each chunk
    for i, chunk in enumerate(chunks):
        print(f"Processing chunk {i+1}/{len(chunks)}")
        chunk_data = _extract_key_study_elements_from_chunk(chunk)
        
        # Merge chunk data into full data
        for key in full_extracted_data:
            full_extracted_data[key].extend(chunk_data.get(key, []))

    # Remove duplicates while preserving order
    for key in full_extracted_data:
        seen = set()
        unique_items = []
        for item in full_extracted_data[key]:
            if item not in seen:
                seen.add(item)
                unique_items.append(item)
        full_extracted_data[key] = unique_items

    # Apply NLTK compression
    compressed_text = _nltk_compress_and_filter(full_extracted_data)
    
    # Save compressed data to file
    compressed_filename = f"{file_id}_compressed.json"
    compressed_file_path = os.path.join(COMPRESSED_DATA_FOLDER, compressed_filename)
    
    # Save both the structured data and the compressed text
    save_data = {
        "structured_data": full_extracted_data,
        "compressed_text": compressed_text,
        "original_length": len(raw_text_content),
        "compressed_length": len(compressed_text)
    }
    
    if write_compressed_data(save_data, compressed_file_path):
        print(f"Compressed data saved to {compressed_file_path}")
        return compressed_file_path
    else:
        print(f"Failed to save compressed data")
        return None

# ==================== FILE IMPORTS (DB) API ====================

def _insert_file_import_record(user_email: str, project_id: str, filename: str, compressed_text: str, text_length: int):
    """Helper to insert a record into file_imports and return inserted row or None."""
    try:
        payload = {
            "user_id": user_email,            # References users.email
            "project_id": project_id or "",   # Text column, default empty
            "filename": filename,
            "compressed_text": compressed_text,
            "text_length": int(text_length),
            "created_at": datetime.now().isoformat()
        }
        resp = supabase.table("file_imports").insert(payload).execute()
        if resp.data:
            return resp.data[0]
        return None
    except Exception as e:
        print(f"Error inserting into file_imports: {e}")
        return None

def _serialize_file_import_row(row: dict):
    """Normalize DB row for frontend consumption."""
    return {
        "id": row.get("id"),
        "user_id": row.get("user_id"),
        "project_id": row.get("project_id"),
        "name": row.get("filename"),
        "filename": row.get("filename"),
        "text_length": row.get("text_length"),
        "created_at": row.get("created_at"),
        # Do not include compressed_text by default to avoid large payloads
    }

@app.route('/api/files', methods=['POST'])
def api_files_upload():
    """
    Upload a file, extract and compress, and persist compressed_text into file_imports.
    Request: multipart/form-data with fields: file (required), project_id (optional)
    Response: { success, file: {id, name, text_length, created_at}, extracted_text_path, compressed_file_path }
    """
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    if 'file' not in request.files:
        return jsonify({"success": False, "message": "No file part"}), 400

    f = request.files['file']
    if f.filename == '':
        return jsonify({"success": False, "message": "No selected file"}), 400

    project_id = request.form.get('project_id', '')

    # Save original file
    original_save_path = os.path.join(UPLOAD_FOLDER, f.filename)
    try:
        f.save(original_save_path)
    except Exception as e:
        return jsonify({"success": False, "message": f"Failed saving file: {e}"}), 500

    # Extract and compress using existing pipeline
    extracted_text = _extract_text_from_file(original_save_path)
    file_uuid = str(uuid.uuid4())

    extracted_filename = f"{file_uuid}_extracted.txt"
    extracted_file_path = os.path.join(EXTRACTED_TEXT_FOLDER, extracted_filename)
    try:
        with open(extracted_file_path, 'w', encoding='utf-8') as ef:
            ef.write(extracted_text)
    except Exception as e:
        print(f"Error writing extracted text: {e}")

    compressed_file_path = _process_and_compress_text(extracted_text, file_uuid)

    # Read compressed JSON and serialize as text for DB storage
    compressed_text_str = ""
    try:
        if compressed_file_path and os.path.exists(compressed_file_path):
            with open(compressed_file_path, 'r', encoding='utf-8') as cf:
                # Store the JSON string representation in DB
                compressed_text_str = cf.read()
    except Exception as e:
        print(f"Error reading compressed file for DB storage: {e}")

    # Insert into file_imports
    inserted = _insert_file_import_record(
        user_email=user_email,
        project_id=project_id,
        filename=f.filename,
        compressed_text=compressed_text_str,
        text_length=len(compressed_text_str) if compressed_text_str else len(extracted_text or "")
    )

    if not inserted:
        return jsonify({"success": False, "message": "Failed to save record to database"}), 500

    return jsonify({
        "success": True,
        "file": _serialize_file_import_row(inserted),
        # Return paths for compatibility with existing flows
        "extracted_text_path": extracted_file_path,
        "compressed_file_path": compressed_file_path
    }), 200

@app.route('/api/files', methods=['GET'])
def api_files_list():
    """
    List file_imports for the authenticated user. Optional filter by project_id.
    Query params: project_id (optional)
    """
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"success": False, "message": "Unauthorized", "files": []}), 401

    project_id = request.args.get('project_id')
    try:
        query = supabase.table('file_imports').select('*').eq('user_id', user_email)
        if project_id is not None:
            query = query.eq('project_id', project_id)
        # Order by created_at desc (matches index)
        res = query.order('created_at', desc=True).execute()
        files = [_serialize_file_import_row(r) for r in (res.data or [])]
        return jsonify({"success": True, "files": files}), 200
    except Exception as e:
        print(f"Error listing file_imports: {e}")
        return jsonify({"success": False, "message": str(e), "files": []}), 500

@app.route('/api/files/<int:file_id>', methods=['GET'])
def api_files_get(file_id: int):
    """Fetch a single file_imports row (without compressed_text by default)."""
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    try:
        res = supabase.table('file_imports').select('*').eq('id', file_id).eq('user_id', user_email).single().execute()
        if not res.data:
            return jsonify({"success": False, "message": "Not found"}), 404
        return jsonify({"success": True, "file": _serialize_file_import_row(res.data)}), 200
    except Exception as e:
        print(f"Error fetching file_imports row: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/files/<int:file_id>/content', methods=['GET'])
def api_files_get_content(file_id: int):
    """
    Fetch the compressed_text content for a file_imports row. This can be large.
    """
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    try:
        res = supabase.table('file_imports').select('id,user_id,filename,compressed_text,text_length,created_at').eq('id', file_id).eq('user_id', user_email).single().execute()
        if not res.data:
            return jsonify({"success": False, "message": "Not found"}), 404
        return jsonify({"success": True, "file": res.data}), 200
    except Exception as e:
        print(f"Error fetching file_imports content: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/files/<int:file_id>', methods=['DELETE'])
def api_files_delete(file_id: int):
    """Delete a file_imports row for the authenticated user."""
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    try:
        # Ensure the row belongs to this user
        existing = supabase.table('file_imports').select('id').eq('id', file_id).eq('user_id', user_email).single().execute()
        if not existing.data:
            return jsonify({"success": False, "message": "Not found"}), 404
        supabase.table('file_imports').delete().eq('id', file_id).execute()
        return jsonify({"success": True}), 200
    except Exception as e:
        print(f"Error deleting file_imports row: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

# ==================== END FILE IMPORTS (DB) API ====================

# ==================== EXISTING ROUTES (PRESERVED) ====================

@app.route("/", methods=["GET"])
def home():
    return jsonify({"message": "Student Project Platform API is running!"})

# --- NEW: Change Logging and Project Data Endpoints ---

@app.route('/api/change-logs', methods=['GET'])
def get_change_logs():
    """Get change logs for a project"""
    try:
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        project_id = request.args.get('project_id')
        if not project_id:
            return jsonify({"success": False, "error": "Project ID required"}), 400

        # Verify user has access to this project
        project_response = supabase.table("projects").select("id").eq("id", project_id).eq("owner_email", user_email).execute()
        if not project_response.data:
            return jsonify({"success": False, "error": "Project not found or access denied"}), 404

        # Get change logs from database
        logs_response = supabase.table("change_logs").select("*").eq("project_id", project_id).order("created_at", desc=True).limit(1000).execute()
        
        return jsonify({
            "success": True,
            "logs": logs_response.data
        })

    except Exception as e:
        print(f"Error getting change logs: {e}")
        return jsonify({"success": False, "error": "Failed to get change logs"}), 500

@app.route('/api/change-logs', methods=['POST'])
def save_change_log():
    """Save a change log entry"""
    try:
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        data = request.get_json()
        project_id = data.get('project_id')
        action = data.get('action')
        details = data.get('details')

        if not all([project_id, action, details]):
            return jsonify({"success": False, "error": "Missing required fields"}), 400

        # Verify user has access to this project
        project_response = supabase.table("projects").select("id").eq("id", project_id).eq("owner_email", user_email).execute()
        if not project_response.data:
            return jsonify({"success": False, "error": "Project not found or access denied"}), 404

        # Save change log to database
        log_entry = {
            "project_id": project_id,
            "user_email": user_email,
            "action": action,
            "details": details,
        }

        log_response = supabase.table("change_logs").insert(log_entry).execute()
        
        return jsonify({
            "success": True,
            "log": log_response.data[0] if log_response.data else log_entry
        })

    except Exception as e:
        print(f"Error saving change log: {e}")
        return jsonify({"success": False, "error": "Failed to save change log"}), 500

@app.route('/api/project-data', methods=['GET'])
def get_project_data():
    """Get saved project data (nodes, edges) for a project"""
    try:
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        project_id = request.args.get('project_id')
        if not project_id:
            return jsonify({"success": False, "error": "Project ID required"}), 400

        # Verify user has access to this project
        project_response = supabase.table("projects").select("id").eq("id", project_id).eq("owner_email", user_email).execute()
        if not project_response.data:
            return jsonify({"success": False, "error": "Project not found or access denied"}), 404

        # Get project data from database
        data_response = supabase.table("project_data").select("*").eq("project_id", project_id).single().execute()
        
        if data_response.data:
            project_data = data_response.data
            return jsonify({
                "success": True,
                "nodes": project_data.get('nodes', []),
                "edges": project_data.get('edges', []),
                "last_saved": project_data.get('updated_at')
            })
        else:
            # If no data is found, return empty arrays, which is a valid state
            return jsonify({
                "success": True,
                "nodes": [],
                "edges": [],
                "last_saved": None
            })

    except Exception as e:
        print(f"Error getting project data: {e}")
        return jsonify({"success": False, "error": "Failed to get project data"}), 500

@app.route('/api/project-data', methods=['POST'])
def save_project_data():
    """Save or update project data (nodes, edges) for a project"""
    try:
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        data = request.get_json()
        project_id = data.get('project_id')
        nodes = data.get('nodes', [])
        edges = data.get('edges', [])

        if not project_id:
            return jsonify({"success": False, "error": "Project ID required"}), 400

        # Verify user has access to this project
        project_response = supabase.table("projects").select("id").eq("id", project_id).eq("owner_email", user_email).execute()
        if not project_response.data:
            return jsonify({"success": False, "error": "Project not found or access denied"}), 404

        # Upsert project data (insert if not exists, update if it does)
        project_data = {
            "project_id": project_id,
            "nodes": nodes,
            "edges": edges,
            "updated_at": datetime.utcnow().isoformat()
        }

        response = supabase.table("project_data").upsert(project_data, on_conflict="project_id").execute()
        
        return jsonify({
            "success": True,
            "message": "Project data saved successfully"
        })

    except Exception as e:
        print(f"Error saving project data: {e}")
        return jsonify({"success": False, "error": "Failed to save project data"}), 500


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    name = data.get("name")
    email = data.get("email")
    password = data.get("password")
    school = data.get("school")
    classes = data.get("classes", [])

    if not all([name, email, password, school]):
        return jsonify({"error": "All fields are required"}), 400

    # Hash the password
    hashed_password = generate_password_hash(password)

    try:
        # Insert user into Supabase
        user_data = {
            "name": name,
            "email": email,
            "password": hashed_password,
            "school": school,
            "classes": ",".join(classes) if isinstance(classes, list) else classes
        }
        
        response = supabase.table("users").insert(user_data).execute()
        
        if response.data:
            return jsonify({"message": "User registered successfully!"}), 201
        else:
            return jsonify({"error": "Failed to register user"}), 500
            
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({"error": "Registration failed"}), 500

@app.route("/profile", methods=["GET"])
def get_profile():
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        response = supabase.table("users").select("*").eq("email", user_email).execute()
        
        if response.data:
            user = response.data[0]
            return jsonify({
                "name": user["name"],
                "email": user["email"],
                "school": user["school"],
                "classes": user["classes"]
            }), 200
        else:
            return jsonify({"error": "User not found"}), 404
            
    except Exception as e:
        print(f"Profile error: {e}")
        return jsonify({"error": "Failed to get profile"}), 500

# ==================== PROJECT ROUTES ====================

@app.route("/api/projects", methods=["GET"])
def get_projects():
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        # Get user_id from email
        user_response = supabase.table("users").select("id").eq("email", user_email).execute()
        if not user_response.data:
            return jsonify({"error": "User not found"}), 404
        
        user_id = user_response.data[0]["id"]
        
        response = supabase.table("projects").select("*").eq("user_id", user_id).execute()
        
        return jsonify({"projects": response.data or []}), 200
        
    except Exception as e:
        print(f"Error fetching projects: {e}")
        return jsonify({"error": "Failed to fetch projects"}), 500

@app.route("/api/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        # Get user_id from email
        user_response = supabase.table("users").select("id").eq("email", user_email).execute()
        if not user_response.data:
            return jsonify({"error": "User not found"}), 404
        
        user_id = user_response.data[0]["id"]
        
        response = supabase.table("projects").select("*").eq("id", project_id).eq("user_id", user_id).execute()
        
        if response.data:
            return jsonify({"project": response.data[0]}), 200
        else:
            return jsonify({"error": "Project not found"}), 404
            
    except Exception as e:
        print(f"Error fetching project: {e}")
        return jsonify({"error": "Failed to fetch project"}), 500

@app.route("/api/projects/<project_id>", methods=["PUT"])
def update_project(project_id):
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    
    try:
        # Get user_id from email
        user_response = supabase.table("users").select("id").eq("email", user_email).execute()
        if not user_response.data:
            return jsonify({"error": "User not found"}), 404
        
        user_id = user_response.data[0]["id"]
        
        # Check if project exists and belongs to user
        project_response = supabase.table("projects").select("*").eq("id", project_id).eq("user_id", user_id).execute()
        
        if not project_response.data:
            return jsonify({"error": "Project not found"}), 404
        
        # Update project
        update_data = {
            "updated_at": datetime.now().isoformat()
        }
        
        # Only update fields that are provided
        if "title" in data:
            update_data["title"] = data["title"]
        if "description" in data:
            update_data["description"] = data["description"]
        if "subject" in data:
            update_data["subject"] = data["subject"]
        if "access_level" in data:
            if data["access_level"] not in ACCESS_LEVELS:
                return jsonify({"error": f"Invalid access level. Must be one of: {ACCESS_LEVELS}"}), 400
            update_data["access_level"] = data["access_level"]
        
        response = supabase.table("projects").update(update_data).eq("id", project_id).execute()
        
        if response.data:
            return jsonify({
                "message": "Project updated successfully!",
                "project": response.data[0]
            }), 200
        else:
            return jsonify({"error": "Failed to update project"}), 500
            
    except Exception as e:
        print(f"Error updating project: {e}")
        return jsonify({"error": "Failed to update project"}), 500

@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    try:
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        # Verify user owns the project
        project_result = supabase.table("projects").select("id").eq("id", project_id).eq("owner_email", user_email).execute()
        if not project_result.data:
            return jsonify({"success": False, "error": "Project not found or access denied"}), 404

        # --- Start of changes ---
        # 1. Delete associated project data
        supabase.table("project_data").delete().eq("project_id", project_id).execute()
        
        # 2. Delete associated change logs
        supabase.table("change_logs").delete().eq("project_id", project_id).execute()
        # --- End of changes ---

        # Delete associated files (this part should already exist)
        files_result = supabase.table("files").select("file_path").eq("project_id", project_id).execute()
        for file_record in files_result.data:
            file_path = file_record.get('file_path')
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    print(f"Error deleting physical file {file_path}: {e}")
        supabase.table("files").delete().eq("project_id", project_id).execute()

        # Finally, delete the project itself
        supabase.table("projects").delete().eq("id", project_id).execute()
        
        return jsonify({"success": True, "message": "Project and all associated data deleted successfully"})

    except Exception as e:
        print(f"Error deleting project: {e}")
        return jsonify({"success": False, "error": "Failed to delete project"}), 500


# ==================== AI TOOLS ROUTES ====================

@app.route("/api/ai-tools/execute", methods=["POST"])
def execute_ai_tool():
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Handle both old format (tool_type) and new format (tool_name)
        tool_type = data.get("tool_type") or data.get("tool_name")
        input_text = data.get("input_text") or data.get("input", "")
        project_id = data.get("project_id")
        selected_files = data.get("selected_files", [])

        if not tool_type:
            return jsonify({"error": "Tool type is required"}), 400

        # Get additional context from selected files if available
        file_context = ""
        if selected_files:
            try:
                # Get file content from Supabase for the selected files
                for file_id in selected_files:
                    file_response = supabase.table('file_imports').select('compressed_text').eq('id', file_id).eq('user_id', user_email).execute()
                    if file_response.data:
                        for file_record in file_response.data:
                            compressed_text = file_record.get('compressed_text', '')
                            if compressed_text:
                                try:
                                    parsed_data = json.loads(compressed_text)
                                    if isinstance(parsed_data, dict) and "compressed_text" in parsed_data:
                                        file_context += parsed_data["compressed_text"] + "\n\n"
                                except json.JSONDecodeError:
                                    file_context += compressed_text + "\n\n"
            except Exception as e:
                print(f"Error fetching file context: {e}")

        # Combine input text with file context
        combined_input = input_text
        if file_context:
            combined_input = f"{input_text}\n\nAdditional Context:\n{file_context}"

        if tool_type == "summarize":
            result = _ai_summarize(combined_input)
        elif tool_type == "analyze":
            result = _ai_analyze(combined_input)
        elif tool_type == "translate":
            target_language = data.get("target_language", "Spanish")
            result = _ai_translate(combined_input, target_language)
        elif tool_type == "extract_key_points":
            result = _ai_extract_key_points(combined_input)
        elif tool_type == "generate_test":
            result = _ai_generate_test(combined_input)
        else:
            return jsonify({"error": "Invalid tool type"}), 400

        # Log AI tool usage
        try:
            supabase.table('ai_usage_logs').insert({
                "user_id": user_email,
                "tool_type": tool_type,
                "input_length": len(input_text),
                "created_at": datetime.now().isoformat()
            }).execute()
        except Exception as log_err:
            print(f"Error logging AI tool usage: {log_err}")

        return jsonify({
            "success": True,
            "tool_type": tool_type,
            "output": result  # Changed from "result" to "output" to match frontend expectations
        }), 200

    except Exception as e:
        print(f"Error executing AI tool: {e}")
        return jsonify({"error": str(e), "message": "Failed to execute AI tool"}), 500

# AI Helper Functions
@retry_with_backoff
def _ai_summarize(text):
    if not text.strip():
        return "No text provided to summarize."
    
    prompt = f"Summarize the following text in a concise manner:\n\n{text}"
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemma2-9b-it",
            temperature=0.3,
            max_tokens=500
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Error in AI summarize: {e}")
        return "Failed to generate summary."

@retry_with_backoff
def _ai_analyze(text):
    if not text.strip():
        return "No text provided to analyze."
    
    prompt = f"Analyze the following text and provide key insights:\n\n{text}"
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemma2-9b-it",
            temperature=0.3,
            max_tokens=600
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Error in AI analyze: {e}")
        return "Failed to generate analysis."

@retry_with_backoff
def _ai_translate(text, target_language):
    if not text.strip():
        return "No text provided to translate."
    
    prompt = f"Translate the following text to {target_language}:\n\n{text}"
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemma2-9b-it",
            temperature=0.2,
            max_tokens=800
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Error in AI translate: {e}")
        return "Failed to generate translation."

@retry_with_backoff
def _ai_extract_key_points(text):
    if not text.strip():
        return "No text provided to extract key points from."
    
    prompt = f"Extract the key points from the following text as a bulleted list:\n\n{text}"
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemma2-9b-it",
            temperature=0.3,
            max_tokens=600
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Error in AI extract key points: {e}")
        return "Failed to extract key points."

@retry_with_backoff
def _ai_generate_test(text):
    if not text.strip():
        return "No text provided to generate test from."
    
    prompt = f"Generate 5 multiple choice questions based on the following text. Include the correct answers:\n\n{text}"
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemma2-9b-it",
            temperature=0.4,
            max_tokens=800
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Error in AI generate test: {e}")
        return "Failed to generate test."

# Helper function to read extracted text content from disk
def read_extracted_text_content(file_path):
    try:
        # Ensure the path is within the EXTRACTED_TEXT_FOLDER for security
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(os.path.abspath(EXTRACTED_TEXT_FOLDER)):
            print(f"Attempted to read file outside EXTRACTED_TEXT_FOLDER: {file_path}")
            return "" # Prevent directory traversal attacks

        with open(abs_file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Error reading extracted text file {file_path}: {e}")
        return ""

# Helper function to read/write compressed JSON data
def read_compressed_data(file_path):
    try:
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(os.path.abspath(COMPRESSED_DATA_FOLDER)):
            print(f"Attempted to read file outside COMPRESSED_DATA_FOLDER: {file_path}")
            return None
        with open(abs_file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading compressed data from {file_path}: {e}")
        return None

def write_compressed_data(data, file_path):
    try:
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(os.path.abspath(COMPRESSED_DATA_FOLDER)):
            print(f"Attempted to write file outside COMPRESSED_DATA_FOLDER: {file_path}")
            return False
        with open(abs_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error writing compressed data to {file_path}: {e}")
        return False

# IMPROVED NLTK-based compression
def _nltk_compress_and_filter(structured_data):
    """
    Further compresses structured data using NLTK to focus on definitions and Q&A.
    Returns a highly concise string.
    """
    lemmatizer = WordNetLemmatizer()
    stop_words = set(stopwords.words('english'))

    concise_parts = []

    # Prioritize definitions and make them very concise
    for definition in structured_data.get('definitions', []):
        tokens = word_tokenize(definition.lower())
        filtered_tokens = [lemmatizer.lemmatize(w) for w in tokens if w.isalnum() and w not in stop_words]
        concise_parts.append("Definition: " + " ".join(filtered_tokens[:15])) # Limit to first 15 relevant words

    # Prioritize questions and answers
    questions = structured_data.get('questions', [])
    answers = structured_data.get('answers', [])
    for i in range(min(len(questions), len(answers))):
        q_tokens = word_tokenize(questions[i].lower())
        q_filtered = [lemmatizer.lemmatize(w) for w in q_tokens if w.isalnum() and w not in stop_words]
        
        a_tokens = word_tokenize(answers[i].lower())
        a_filtered = [lemmatizer.lemmatize(w) for w in a_tokens if w.isalnum() and w not in stop_words]
        
        concise_parts.append(f"Q: {' '.join(q_filtered[:20])} A: {' '.join(a_filtered[:20])}") # Limit Q&A to 20 words each

    # Add terms if they haven't been covered by definitions
    terms_added = set()
    for def_str in concise_parts:
        if def_str.startswith("Definition: "):
            # Simple way to get the potential term from the definition string
            term_part = def_str.split(":")[1].strip().split(" ")[0] 
            terms_added.add(lemmatizer.lemmatize(term_part.lower()))
    
    for term in structured_data.get('terms', []):
        if lemmatizer.lemmatize(term.lower()) not in terms_added:
            concise_parts.append("Term: " + term)


    # Join all concise parts, ensuring overall length is managed
    final_concise_text = "\n".join(concise_parts)
    
    # Final check to ensure it's not excessively long for Groq input
    # Aim for a very small fraction of original, so keep this tight
    MAX_FINAL_COMPRESSED_CHARS = 2000 # Roughly 500 tokens for context
    if len(final_concise_text) > MAX_FINAL_COMPRESSED_CHARS:
        final_concise_text = final_concise_text[:MAX_FINAL_COMPRESSED_CHARS] + "..."

    return final_concise_text


# IMPROVED: AI-driven text compression/structured extraction for a single chunk
@retry_with_backoff
def _extract_key_study_elements_from_chunk(text_chunk):
    if not text_chunk.strip():
        return {
            "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
        }

    prompt = (
        "From the following study material, extract and categorize the key information. "
        "Provide the output as a JSON object with the following keys:\n"
        "'terms': A list of important terms found (e.g., ['Term1', 'Term2']).\n"
        "'definitions': A list of definitions, explicitly linking to a term if possible (e.g., ['Term1: Definition of Term1', 'Definition of concept']).\n"
        "'examples': A list of specific examples related to concepts (e.g., ['Example 1 description', 'Example 2 description']).\n"
        "'questions': A list of questions (from quizzes, practice problems, etc.) as plain strings (e.g., ['What is X?', 'How does Y work?']).\n"
        "'answers': A list of answers corresponding to the questions, as plain strings. If an answer is not explicitly given, state 'Not provided' (e.g., ['Answer to Q1', 'Not provided']).\n\n"
        "If a category is not found, its list should be empty. Output ONLY the JSON object. "
        "Be extremely concise and extract only the most critical information to minimize output size. "
        "Ensure ALL list items are plain strings, not nested objects or complex structures. Prioritize conciseness."
    )

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt + "\n\nMaterial:\n" + text_chunk}
            ],
            model="gemma2-9b-it",
            response_format={"type": "json_object"},
            temperature=0.2, # Lower temperature for more factual extraction
            max_tokens=4000, # Reduced max tokens for the extracted JSON output to enforce conciseness
        )
        response_content = chat_completion.choices[0].message.content
        extracted_data = json.loads(response_content)

        # Post-process to ensure all list items are strings, handling potential AI errors
        def ensure_strings_in_list(lst):
            if not isinstance(lst, list):
                return []
            return [str(item) if not isinstance(item, (dict, list)) else json.dumps(item) for item in lst]

        return {
            "terms": ensure_strings_in_list(extracted_data.get("terms", [])),
            "definitions": ensure_strings_in_list(extracted_data.get("definitions", [])),
            "examples": ensure_strings_in_list(extracted_data.get("examples", [])),
            "questions": ensure_strings_in_list(extracted_data.get("questions", [])),
            "answers": ensure_strings_in_list(extracted_data.get("answers", []))
        }

    except json.JSONDecodeError as e:
        print(f"JSONDecodeError in _extract_key_study_elements_from_chunk: {e}. Raw response: {response_content[:500]}...")
        return { "terms": [], "definitions": [], "examples": [], "questions": [], "answers": [] }
    except Exception as e:
        print(f"Error extracting key study elements from chunk with Groq API: {e}")
        return { "terms": [], "definitions": [], "examples": [], "questions": [], "answers": [] }

# IMPROVED: Main text processing and compression pipeline
def _process_and_compress_text(raw_text_content, file_id):
    # This function will handle token limits and return structured data

    # Define a safe chunk size for the LLM input
    # gemma2-9b-it has 8192 context window. Let's aim for 4000-6000 tokens per chunk
    # Assuming ~4 chars per token for English, 4000 tokens is ~16000 characters.
    # We'll use a character-based chunking for simplicity.
    CHUNK_SIZE_CHARS = 13000 # Roughly 3000 tokens input to extraction LLM
    OVERLAP_CHARS = 500 # To maintain context across chunks

    full_extracted_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }

    if not raw_text_content.strip():
        return None # Return None if no content to process

    # Chunk the text
    chunks = []
    start = 0
    while start < len(raw_text_content):
        end = min(start + CHUNK_SIZE_CHARS, len(raw_text_content))
        chunks.append(raw_text_content[start:end])
        start += CHUNK_SIZE_CHARS - OVERLAP_CHARS # Move start by chunk size minus overlap
        if start >= len(raw_text_content) - OVERLAP_CHARS: # Ensure last chunk is processed
            break

    if not chunks: # Handle very small texts that don't form a full chunk
        chunks.append(raw_text_content)

    print(f"Processing {len(chunks)} chunks for compression...")
    for i, chunk in enumerate(chunks):
        print(f"Processing chunk {i+1}/{len(chunks)}")
        extracted_chunk_data = _extract_key_study_elements_from_chunk(chunk)
        
        # Aggregate results, avoiding duplicates (simple check for now)
        full_extracted_data["terms"].extend([t for t in extracted_chunk_data["terms"] if t and t not in full_extracted_data["terms"]])
        full_extracted_data["definitions"].extend([d for d in extracted_chunk_data["definitions"] if d and d not in full_extracted_data["definitions"]])
        full_extracted_data["examples"].extend([e for e in extracted_chunk_data["examples"] if e and e not in full_extracted_data["examples"]])
        full_extracted_data["questions"].extend([q for q in extracted_chunk_data["questions"] if q and q not in full_extracted_data["questions"]])
        full_extracted_data["answers"].extend([a for a in extracted_chunk_data["answers"] if a and a not in full_extracted_data["answers"]])

    # Return both the structured data and the compressed string
    compressed_string = _nltk_compress_and_filter(full_extracted_data)
    
    return {
        "structured_data": full_extracted_data,
        "compressed_text": compressed_string
    }


@app.route('/import-file', methods=['POST'])
def import_file():
    """
    Handles file uploads, extracts text (PDF/OCR), saves it,
    and triggers AI-driven text compression.
    Returns the path to the extracted text file AND the compressed JSON file.
    """
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file part"}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No selected file"}), 400
        
        doc_type = request.form.get("type", "unknown")
        project_id = request.form.get("project_id")

        if not project_id:
            return jsonify({"error": "Project ID is required"}), 400

        # Get authenticated user
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({"error": "Unauthorized"}), 401

        # Save original file with unique name to avoid conflicts
        file_id = str(uuid.uuid4())
        file_extension = os.path.splitext(file.filename)[1]
        unique_filename = f"{file_id}_{file.filename}"
        original_save_path = os.path.join(UPLOAD_FOLDER, unique_filename)
        
        try:
            file.save(original_save_path)
        except Exception as e:
            print(f"Error saving file: {e}")
            return jsonify({"error": "Failed to save uploaded file"}), 500

        # Extract text and save to extracted_texts folder
        try:
            extracted_text = _extract_text_from_file(original_save_path)
        except Exception as e:
            print(f"Error extracting text from file: {e}")
            return jsonify({"error": "Failed to extract text from file"}), 500
        
        # Save extracted text to file
        extracted_filename = f"{file_id}_extracted.txt"
        extracted_file_path = os.path.join(EXTRACTED_TEXT_FOLDER, extracted_filename)
        
        try:
            with open(extracted_file_path, 'w', encoding='utf-8') as ef:
                ef.write(extracted_text)
        except Exception as e:
            print(f"Error writing extracted text: {e}")
            return jsonify({"error": "Failed to save extracted text"}), 500
        
        # Process and compress the text using AI
        try:
            compression_result = _process_and_compress_text(extracted_text, file_id)
        except Exception as e:
            print(f"Error compressing text: {e}")
            return jsonify({"error": "Failed to compress file content"}), 500

        if not compression_result:
            return jsonify({"error": "Failed to compress file content"}), 500
        
        # Extract both structured data and compressed text
        structured_data = compression_result.get("structured_data", {})
        compressed_text_content = compression_result.get("compressed_text", "")
        
        # Save compressed data to file (now includes both structured and compressed text)
        compressed_filename = f"{file_id}_compressed.json"
        compressed_file_path = os.path.join(COMPRESSED_DATA_FOLDER, compressed_filename)
        
        try:
            compressed_data = {
                "structured_data": structured_data,
                "compressed_text": compressed_text_content,
                "original_filename": file.filename,
                "file_id": file_id,
                "doc_type": doc_type
            }
            write_compressed_data(compressed_data, compressed_file_path)
        except Exception as e:
            print(f"Error writing compressed data: {e}")
            return jsonify({"error": "Failed to save compressed data"}), 500

        # Insert file metadata into Supabase
        try:
            # Store the full structured data as JSON string in Supabase
            compressed_data_for_db = {
                "structured_data": structured_data,
                "compressed_text": compressed_text_content,
                "original_filename": file.filename,
                "file_id": file_id,
                "doc_type": doc_type
            }
            
            response = supabase.table("file_imports").insert({
                "user_id": user_email,
                "project_id": project_id,
                "filename": file.filename,
                "compressed_text": json.dumps(compressed_data_for_db),  # Store as JSON string
                "text_length": len(extracted_text) if extracted_text else 0
            }).execute()

            print("Supabase insert response:", response)

            if response.data and len(response.data) > 0:
                inserted_row = response.data[0]
                return jsonify({
                    "success": True,
                    "message": "File imported and processed successfully",
                    "file_id": inserted_row["id"],
                    "original_filename": file.filename,
                    "extracted_text_length": len(extracted_text) if extracted_text else 0,
                    "doc_type": doc_type,
                    "path": extracted_file_path,  # Add expected path field
                    "compressed_path": compressed_file_path  # Add expected compressed_path field
                }), 200
            else:
                return jsonify({"error": "Failed to record file import in database"}), 500

        except Exception as e:
            print(f"Error inserting file import into database: {e}")
            return jsonify({"error": f"Database error during file import: {str(e)}"}), 500

    except Exception as e:
        print(f"Unexpected error in import_file: {e}")
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500



# ==================== USER AUTHENTICATION ROUTES ====================

@app.route('/signup', methods=['POST'])
def signup():
    """
    Create a new user account and store in Supabase
    """
    data = request.json
    email = data.get('email', '').lower()
    name = data.get('name', '')
    school = data.get('school', '')
    password = data.get('password', '')
    selected_classes = data.get('classes', [])
    
    if not all([email, name, school, password]):
        return jsonify({"error": "Missing required fields"}), 400
    
    if not selected_classes or len(selected_classes) < 1:
        return jsonify({"error": "Please select at least one class"}), 400
    
    # Check if user already exists
    try:
        existing_user = supabase.table('users').select('email').eq('email', email).execute()
        if existing_user.data:
            return jsonify({"error": "Email already registered"}), 400
    except Exception as e:
        print(f"Error checking existing user: {e}")
        return jsonify({"error": "Database error during signup"}), 500
    
    # Create new user
    try:
        user_data = {
            "name": name,
            "school": school,
            "email": email,
            "password_hash": generate_password_hash(password),
            "classes": ','.join(selected_classes),
            "created_at": datetime.now().isoformat()
        }
        
        response = supabase.table('users').insert(user_data).execute()
        
        if response.data:
            user = response.data[0]
            return jsonify({
                "success": True,
                "message": "Account created successfully!",
                "user": {
                    "id": user['id'],
                    "name": user['name'],
                    "email": user['email'],
                    "school": user['school'],
                    "classes": user['classes']
                }
            }), 201
        else:
            return jsonify({"error": "Failed to create account"}), 500
            
    except Exception as e:
        print(f"Error creating user: {e}")
        return jsonify({"error": "Database error during account creation"}), 500

@app.route('/login', methods=['POST'])
def login():
    """
    Authenticate user and return user data
    """
    data = request.json
    email = data.get("email", "").lower()
    password = data.get("password", "")
    
    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400
    
    try:
        # Get user from Supabase
        response = supabase.table("users").select("*").eq("email", email).execute()
        
        if not response.data:
            return jsonify({"error": "Invalid email or password"}), 401
        
        user = response.data[0]
        
        # Check password
        if not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Invalid email or password"}), 401
        
        # Update last login
        supabase.table("users").update({
            "last_login": datetime.now().isoformat()
        }).eq("id", user["id"]).execute()

        session["user_email"] = email
        user_email = session.get("user_email")
        print(f"User {user_email} logged in successfully and stored in session")
        
        return jsonify({
            "success": True,
            "message": "Logged in successfully",
            "user": {
                "id": user["id"],
                "name": user["name"],
                "email": user["email"],
                "school": user["school"],
                "classes": user["classes"]
            }
        }), 200
        
    except Exception as e:
        print(f"Error during login: {e}")
        return jsonify({"error": "Database error during login"}), 500



# ==================== PROJECT MANAGEMENT ROUTES ====================

@app.route('/create-project', methods=['POST'])
def create_project():
    """
    Create a new project and store in Supabase
    """
    data = request.json
    user_email = get_authenticated_user()
    title = data.get('title', '')
    subject = data.get('subject', '')
    content = data.get('description', '')
    location = data.get('location', '')
    access_level = data.get('access_level', 'private')
    canvas_snapshot_base64 = data.get('canvas_snapshot', '')
    
    if not all([user_email, title, subject, location]):
        return jsonify({"error": "Missing required project fields"}), 400
    
    if access_level not in ACCESS_LEVELS:
        access_level = 'private'
    
    try:
        # Handle canvas snapshot upload
        image_url = None
        if canvas_snapshot_base64:
            try:
                header, base64_string = canvas_snapshot_base64.split(",", 1)
                image_data = base64.b64decode(base64_string)
                file_name = f"project_snapshots/{uuid.uuid4()}.png"
                
                response = supabase.storage.from_("project-snapshots").upload(
                    file_name, image_data, {"content-type": "image/png"}
                )
                
                if response.status_code == 200:
                    image_url_response = supabase.storage.from_("project-snapshots").get_public_url(file_name)
                    image_url = image_url_response.data.get("publicUrl")
                    print(f"Uploaded project snapshot to: {image_url}")
                    
            except Exception as e:
                print(f"Error uploading project snapshot: {e}")
                image_url = None
        
        # Insert project into Supabase
        project_data = {
            "user_email": user_email,
            "title": title,
            "subject": subject,
            "content": content,
            "location": location,
            "access_level": access_level,
            "created_at": datetime.now().isoformat()
        }
        
        response = supabase.table("projects").insert(project_data).execute()
        
        if response.data:
            project = response.data[0]
            return jsonify({
                "success": True,
                "message": "Project created successfully!",
                "project_id": project["id"]
            }), 201
        else:
            return jsonify({"error": "Failed to create project"}), 500
            
    except Exception as e:
        print(f"Error creating project: {e}")
        return jsonify({"error": str(e)}), 500

def get_user_projects(user_id):
    """
    Get all projects for a specific user
    """
    try:
        response = supabase.table('projects').select('*').eq('user_id', user_id).order('created_at', desc=True).execute()
        return jsonify({"projects": response.data}), 200
    except Exception as e:
        print(f"Error fetching user projects: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/get-recommended-projects/<int:user_id>', methods=['GET'])
def get_recommended_projects(user_id):
    """
    Get recommended projects based on user's classes
    """
    try:
        # Get user's classes
        user_response = supabase.table('users').select('classes').eq('id', user_id).execute()
        if not user_response.data:
            return jsonify({"projects": []}), 200
        
        user_classes = user_response.data[0]['classes'].split(',') if user_response.data[0]['classes'] else []
        
        if not user_classes:
            return jsonify({"projects": []}), 200
        
        # Get projects from other users in the same classes with view_only or edit access
        recommended_projects = []
        for subject in user_classes:
            response = supabase.table('projects').select('*, users!inner(name)').neq('user_id', user_id).eq('subject', subject).in_('access_level', ['view_only', 'edit']).order('created_at', desc=True).execute()
            recommended_projects.extend(response.data)
        
        return jsonify({"projects": recommended_projects}), 200
        
    except Exception as e:
        print(f"Error fetching recommended projects: {e}")
        return jsonify({"error": str(e)}), 500

# ==================== FILE MANAGEMENT ROUTES ====================

@app.route('/upload-file', methods=['POST'])
@app.route('/upload-file', methods=['POST'])
def upload_file():
    """
    Upload and process a file, extract text, compress it, and store directly in the database.
    Matches file_imports schema (user_id, project_id, filename, compressed_text, text_length).
    """
    # Validate incoming file
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Authenticated user (email) and required project_id
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "User not authenticated"}), 401

    project_id = request.form.get('project_id')
    if not project_id:
        return jsonify({"error": "Project ID required"}), 400

    try:
        # Temporarily save file for text extraction
        temp_name = f"{uuid.uuid4()}_{file.filename}"
        temp_path = os.path.join(UPLOAD_FOLDER, temp_name)
        file.save(temp_path)

        # Extract text and remove temp file
        extracted_text = _extract_text_from_file(temp_path)
        try:
            os.remove(temp_path)
        except Exception:
            pass

        # Compress extracted text to a concise string
        compressed_text = _process_and_compress_text(extracted_text, str(uuid.uuid4()))
        if not compressed_text:
            return jsonify({"error": "Failed to compress file content"}), 500

        # Insert record into file_imports with compressed_text stored directly
        response = supabase.table('file_imports').insert({
            'user_id': user_email,
            'project_id': project_id,
            'filename': file.filename,
            'compressed_text': compressed_text,
            'text_length': len(extracted_text)
        }).execute()

        if not response.data:
            return jsonify({"error": "Failed to record file import in database"}), 500

        row = response.data[0]
        return jsonify({
            'success': True,
            'message': 'File uploaded and processed successfully',
            'id': row['id'],
            'filename': row['filename'],
            'project_id': row['project_id'],
            'text_length': row['text_length']
        }), 200

    except Exception as e:
        print(f"Error uploading file: {e}")
        return jsonify({"error": str(e)}), 500




@app.route('/get-uploaded-files/<int:user_id>', methods=['GET'])
def get_uploaded_files(user_id):
    """
    Get all uploaded files for a user
    """
    try:
        response = supabase.table('file_imports').select('*').eq('user_id', user_id).order('created_at', desc=True).execute()
        return jsonify({"files": response.data}), 200
    except Exception as e:
        print(f"Error fetching uploaded files: {e}")
        return jsonify({"error": str(e)}), 500

# ==================== AI GENERATION ROUTES ====================

@app.route('/generate-flashcards', methods=['POST'])
def generate_flashcards():
    """
    Generates flashcards based on provided context.
    Logs flashcard generation to Supabase.
    """
    data = request.json
    num_flashcards = data.get('numFlashcards', 10)
    source_file_paths = data.get('sourceFilePaths', [])
    compressed_file_paths = data.get('compressedFilePaths', [])
    user_id = data.get('user_id')  # Get user_id for logging

    combined_structured_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }
    
    for path in compressed_file_paths:
        try:
            compressed_data = read_compressed_data(path)
            if compressed_data:
                # Handle both old format (string) and new format (dict)
                if isinstance(compressed_data, str):
                    # If it's a string, it's the old compressed format
                    print(f"Skipping old format compressed data from {path}")
                    continue
                elif isinstance(compressed_data, dict):
                    # New format - check if it has the expected structure
                    if "compressed_text" in compressed_data:
                        # This is the new format where compressed_text contains the actual compressed string
                        print(f"Found new format compressed data from {path}, but it's a string format")
                        continue
                    else:
                        # This should be the structured format with terms, definitions, etc.
                        # Safely extract each field with defaults
                        terms = compressed_data.get("terms", [])
                        definitions = compressed_data.get("definitions", [])
                        examples = compressed_data.get("examples", [])
                        questions = compressed_data.get("questions", [])
                        answers = compressed_data.get("answers", [])
                        
                        # Ensure all are lists
                        if isinstance(terms, list):
                            combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                        if isinstance(definitions, list):
                            combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                        if isinstance(examples, list):
                            combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                        if isinstance(questions, list):
                            combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                        if isinstance(answers, list):
                            combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
        except Exception as e:
            print(f"Error processing compressed data from {path}: {e}")
            continue

    further_compressed_context = _nltk_compress_and_filter(combined_structured_data)

    if not further_compressed_context.strip():
        combined_raw_content = ""
        for path in source_file_paths:
            combined_raw_content += read_extracted_text_content(path) + "\n\n"
        if not combined_raw_content.strip():
            return jsonify({"error": "No context provided for flashcard generation."}), 400
        context_for_llm = combined_raw_content
    else:
        context_for_llm = further_compressed_context

    prompt = (
        f"Generate exactly {num_flashcards} flashcards based on the following highly concise study material. "
        "Each flashcard should have a 'front' (question/term) and 'back' (answer/definition). "
        "Focus on the most important concepts, terms, and definitions. "
        "Output as a JSON array of objects, each with 'front' and 'back' keys. "
        "Be concise but informative. Output ONLY the JSON array."
        "\n\nHighly Concise Study Material:\n" + context_for_llm
    )

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="gemma2-9b-it",
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=4000,
        )
        response_content = chat_completion.choices[0].message.content
        response_data = json.loads(response_content)
        
        flashcards = response_data.get('flashcards', [])
        if not flashcards and isinstance(response_data, list):
            flashcards = response_data

        # Log flashcard generation to Supabase
        if user_id:
            try:
                supabase.table('generated_flashcards').insert({
                    "user_id": int(user_id),
                    "flashcard_count": len(flashcards),
                    "flashcards_content": json.dumps(flashcards),
                    "source_files_count": len(source_file_paths) + len(compressed_file_paths),
                    "created_at": datetime.now().isoformat()
                }).execute()
            except Exception as e:
                print(f"Error logging flashcard generation: {e}")

        return jsonify({"flashcards": flashcards})

    except json.JSONDecodeError as e:
        print(f"JSONDecodeError in generate_flashcards: {e}. Raw response: {response_content[:500]}...")
        return jsonify({"error": "AI response was not valid JSON.", "flashcards": []}), 500
    except Exception as e:
        print(f"Error calling Groq API for Flashcards: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/generate-test', methods=['POST'])
def generate_test():
    """
    Generates a test based on provided context.
    Logs test generation to Supabase.
    """
    data = request.json
    test_name = data.get('testName', 'Generated Test')
    question_type = data.get('questionType', 'multiple_choice')
    num_questions = data.get('numQuestions', 10)
    source_file_paths = data.get('sourceFilePaths', [])
    compressed_file_paths = data.get('compressedFilePaths', [])
    user_id = data.get('user_id')  # Get user_id for logging

    combined_structured_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }
    
    for path in compressed_file_paths:
        try:
            compressed_data = read_compressed_data(path)
            if compressed_data:
                # Handle both old format (string) and new format (dict)
                if isinstance(compressed_data, str):
                    # If it's a string, it's the old compressed format
                    print(f"Skipping old format compressed data from {path}")
                    continue
                elif isinstance(compressed_data, dict):
                    # New format - check if it has the expected structure
                    if "compressed_text" in compressed_data:
                        # This is the new format where compressed_text contains the actual compressed string
                        print(f"Found new format compressed data from {path}, but it's a string format")
                        continue
                    else:
                        # This should be the structured format with terms, definitions, etc.
                        # Safely extract each field with defaults
                        terms = compressed_data.get("terms", [])
                        definitions = compressed_data.get("definitions", [])
                        examples = compressed_data.get("examples", [])
                        questions = compressed_data.get("questions", [])
                        answers = compressed_data.get("answers", [])
                        
                        # Ensure all are lists
                        if isinstance(terms, list):
                            combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                        if isinstance(definitions, list):
                            combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                        if isinstance(examples, list):
                            combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                        if isinstance(questions, list):
                            combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                        if isinstance(answers, list):
                            combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
        except Exception as e:
            print(f"Error processing compressed data from {path}: {e}")
            continue

    further_compressed_context = _nltk_compress_and_filter(combined_structured_data)

    if not further_compressed_context.strip():
        combined_raw_content = ""
        for path in source_file_paths:
            combined_raw_content += read_extracted_text_content(path) + "\n\n"
        if not combined_raw_content.strip():
            return jsonify({"error": "No content available to generate test."}), 400
        context_for_llm = combined_raw_content
    else:
        context_for_llm = further_compressed_context


    prompt = (
        f"Generate a {num_questions} question {question_type} test "
        f"titled '{test_name}' based on the following highly concise study material. "
        "For Multiple Choice Questions (MCQ), provide the question, 4 options (A, B, C, D), and clearly state the correct answer (e.g., 'Correct Answer: B'). "
        "For Free Response Questions (FRQ), provide the question and a brief, accurate expected answer. "
        "Ensure the questions and answers are clear, directly related to the provided content, and cover key definitions, terms, and specific examples. "
        "Format the output as a clean, readable text block, suitable for display in a simple text viewer. "
        "Include a clear title for the test."
        "\n\nHighly Concise Study Material:\n" + context_for_llm
    )

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="gemma2-9b-it",
            temperature=0.7,
            max_tokens=5000,
        )
        test_content = chat_completion.choices[0].message.content

        # Log test generation to Supabase
        if user_id:
            try:
                supabase.table('generated_tests').insert({
                    "user_id": int(user_id),
                    "test_name": test_name,
                    "question_type": question_type,
                    "num_questions": num_questions,
                    "test_content": test_content,
                    "source_files_count": len(source_file_paths) + len(compressed_file_paths),
                    "created_at": datetime.now().isoformat()
                }).execute()
            except Exception as e:
                print(f"Error logging test generation: {e}")

        return jsonify({"testContent": test_content})

    except Exception as e:
        print(f"Error calling Groq API for Test Generation: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/generate-notes', methods=['POST'])
def generate_notes():
    """
    Generates detailed notes based on a topic and provided context (from selected node and uploaded files).
    Expects {topic: string, existingContent: string, sourceFilePaths: [], compressedFilePaths: []}
    """
    data = request.json
    topic = data.get('topic', 'General Study Notes')
    existing_content = data.get('existingContent', '')
    source_file_paths = data.get('sourceFilePaths', [])
    compressed_file_paths = data.get('compressedFilePaths', [])
    user_id = data.get('user_id')  # Get user_id for logging

    combined_structured_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }
    for path in compressed_file_paths:
        try:
            compressed_data = read_compressed_data(path)
            if compressed_data:
                # Handle both old format (string) and new format (dict)
                if isinstance(compressed_data, str):
                    # If it's a string, it's the old compressed format
                    print(f"Skipping old format compressed data from {path}")
                    continue
                elif isinstance(compressed_data, dict):
                    # New format - check if it has the expected structure
                    if "compressed_text" in compressed_data:
                        # This is the new format where compressed_text contains the actual compressed string
                        print(f"Found new format compressed data from {path}, but it's a string format")
                        continue
                    else:
                        # This should be the structured format with terms, definitions, etc.
                        # Safely extract each field with defaults
                        terms = compressed_data.get("terms", [])
                        definitions = compressed_data.get("definitions", [])
                        examples = compressed_data.get("examples", [])
                        questions = compressed_data.get("questions", [])
                        answers = compressed_data.get("answers", [])
                        
                        # Ensure all are lists
                        if isinstance(terms, list):
                            combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                        if isinstance(definitions, list):
                            combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                        if isinstance(examples, list):
                            combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                        if isinstance(questions, list):
                            combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                        if isinstance(answers, list):
                            combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
        except Exception as e:
            print(f"Error processing compressed data from {path}: {e}")
            continue

    # Further compress the combined structured data for notes generation context
    further_compressed_context = _nltk_compress_and_filter(combined_structured_data)

    if not further_compressed_context.strip() and not existing_content.strip():
        # Fallback to raw text if structured data is empty
        combined_raw_content = ""
        for path in source_file_paths:
            combined_raw_content += read_extracted_text_content(path) + "\n\n"
        if not combined_raw_content.strip():
            return jsonify({"error": "No context provided for notes generation."}), 400
        context_for_llm = combined_raw_content
    else:
        context_for_llm = further_compressed_context


    prompt = (
        f"Generate comprehensive study notes on the topic of '{topic}'. "
        "Use the following highly concise content and extracted key elements as a primary source for information. "
        "Organize the notes clearly with headings, bullet points, and important terms, definitions, and *extremely specific examples*. "
        "Format the output using HTML tags (e.g., <h3>, <p>, <ul>, <li>) suitable for a rich text editor like Quill."
        "\n\nExisting Content (as a starting point):\n" + existing_content +
        "\n\nHighly Concise Relevant Study Material:\n" + context_for_llm
    )

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="gemma2-9b-it",
            temperature=0.7,
            max_tokens=4000,
        )
        notes_content = chat_completion.choices[0].message.content

        # Log notes generation to Supabase
        if user_id:
            try:
                supabase.table('generated_notes').insert({
                    "user_id": int(user_id),
                    "topic": topic,
                    "notes_content": notes_content,
                    "source_files_count": len(source_file_paths) + len(compressed_file_paths),
                    "created_at": datetime.now().isoformat()
                }).execute()
            except Exception as e:
                print(f"Error logging notes generation: {e}")

        return jsonify({"notesContent": notes_content})

    except Exception as e:
        print(f"Error calling Groq API for Notes Generation: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/generate-study-guide', methods=['POST'])
def generate_study_guide():
    """
    Generates a full visual study guide structure.
    Logs study guide generation to Supabase.
    """
    data = request.json
    topics = data.get('topics', [])
    source_file_paths = data.get('sourceFilePaths', [])
    compressed_file_paths = data.get('compressedFilePaths', [])
    user_id = data.get('user_id')  # Get user_id for logging

    # Get authenticated user
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized", "nodes": [], "edges": []}), 401

    combined_structured_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }
    
    # Extract data directly from Supabase instead of files
    try:
        # Get all file imports for this user
        response = supabase.table('file_imports').select('compressed_text').eq('user_id', user_email).execute()
        
        if response.data:
            for file_record in response.data:
                compressed_text = file_record.get('compressed_text', '')
                if compressed_text:
                    try:
                        # Try to parse as JSON first (new structured format)
                        parsed_data = json.loads(compressed_text)
                        if isinstance(parsed_data, dict) and "structured_data" in parsed_data:
                            # New format with structured data
                            structured_data = parsed_data["structured_data"]
                            if isinstance(structured_data, dict):
                                # Safely extract each field with defaults
                                terms = structured_data.get("terms", [])
                                definitions = structured_data.get("definitions", [])
                                examples = structured_data.get("examples", [])
                                questions = structured_data.get("questions", [])
                                answers = structured_data.get("answers", [])
                                
                                # Ensure all are lists and extend combined data
                                if isinstance(terms, list):
                                    combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                                if isinstance(definitions, list):
                                    combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                                if isinstance(examples, list):
                                    combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                                if isinstance(questions, list):
                                    combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                                if isinstance(answers, list):
                                    combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
                        elif isinstance(parsed_data, dict):
                            # Old structured format (direct terms, definitions, etc.)
                            terms = parsed_data.get("terms", [])
                            definitions = parsed_data.get("definitions", [])
                            examples = parsed_data.get("examples", [])
                            questions = parsed_data.get("questions", [])
                            answers = parsed_data.get("answers", [])
                            
                            # Ensure all are lists
                            if isinstance(terms, list):
                                combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                            if isinstance(definitions, list):
                                combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                            if isinstance(examples, list):
                                combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                            if isinstance(questions, list):
                                combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                            if isinstance(answers, list):
                                combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
                    except json.JSONDecodeError:
                        # If it's not JSON, it's probably the old compressed string format
                        # We can't extract structured data from it easily, so skip
                        print(f"Skipping non-JSON compressed text: {compressed_text[:100]}...")
                        continue
                    except Exception as e:
                        print(f"Error processing compressed text: {e}")
                        continue
    except Exception as e:
        print(f"Error fetching data from Supabase: {e}")
        return jsonify({"error": "Failed to fetch file data", "nodes": [], "edges": []}), 500

    further_compressed_context = _nltk_compress_and_filter(combined_structured_data)

    if not further_compressed_context.strip() and not topics:
        return jsonify({"error": "No relevant study elements or topics found for study guide generation.", "nodes": [], "edges": []}), 400

    prompt = (
        "You are an AI assistant for creating visual study guides. "
        "Based on the following topics and highly concise extracted study elements, "
        "generate a structured study guide. "
        "Represent this as a JSON object with 'nodes' and 'edges' for a visual flow. "
        "Nodes should cover main topics, subtopics, key terms, their definitions, and *extremely specific examples*. "
        "Each node should have an 'id' (string), 'type' (e.g., 'mainTopic', 'subTopic', 'term', 'definition', 'example', 'question', 'answer'), "
        "'data' (with 'label' and 'description'), and 'position' (with 'x' and 'y' numbers between 50 and 500). "
        "The 'label' should be concise. The 'description' for each node should be a brief summary of what the node represents, "
        "drawing from the definitions and examples provided. "
        "Edges should have an 'id' (string), 'source' node id, and 'target' node id, showing logical relationships (e.g., mainTopic to subTopic, subTopic to term, term to definition/example). "
        "Ensure the nodes are spread out and don't overlap too much, forming a clear tree-like or hierarchical structure. "
        "Output ONLY the JSON object."
        "\n\nTopics to prioritize: " + ", ".join(topics) +
        "\n\nHighly Concise Extracted Study Elements:\n" + further_compressed_context
    )

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="gemma2-9b-it",
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=4000,
        )
        response_content = chat_completion.choices[0].message.content
        response_data = json.loads(response_content)

        nodes = response_data.get('nodes', [])
        edges = response_data.get('edges', [])

        for node in nodes:
            if 'position' in node and isinstance(node['position'], dict):
                node['position']['x'] = max(50, min(500, node['position'].get('x', 100)))
                node['position']['y'] = max(50, min(500, node['position'].get('y', 100)))
            else:
                node['position'] = {"x": 100, "y": 100}
            if 'type' not in node:
                node['type'] = 'default'

        # Log study guide generation to Supabase
        if user_id:
            try:
                supabase.table('generated_study_guides').insert({
                    "user_id": int(user_id),
                    "topics": ','.join(topics) if topics else 'Auto-generated',
                    "nodes_count": len(nodes),
                    "edges_count": len(edges),
                    "source_files_count": len(source_file_paths) + len(compressed_file_paths),
                    "created_at": datetime.now().isoformat()
                }).execute()
            except Exception as e:
                print(f"Error logging study guide generation: {e}")

        return jsonify({"nodes": nodes, "edges": edges})

    except json.JSONDecodeError as e:
        print(f"JSONDecodeError in generate_study_guide: {e}. Raw response: {response_content[:500]}...")
        return jsonify({"error": "AI response was not valid JSON.", "nodes": [], "edges": []}), 500
    except Exception as e:
        print(f"Error calling Groq API for Study Guide: {e}")
        return jsonify({"error": str(e), "nodes": [], "edges": []}), 500

@app.route('/autofill-info', methods=['POST'])
def autofill_info():
    """
    Autofills or expands information for a given topic.
    Logs autofill usage to Supabase.
    """
    data = request.json
    topic = data.get('topic', '')
    existing_content = data.get('existingContent', '')
    source_file_paths = data.get('sourceFilePaths', [])
    compressed_file_paths = data.get('compressed_file_paths', [])
    user_id = data.get('user_id')  # Get user_id for logging

    if not topic:
        return jsonify({"error": "No topic provided for autofill."}), 400

    # Get authenticated user
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    combined_structured_data = {
        "terms": [], "definitions": [], "examples": [], "questions": [], "answers": []
    }
    
    # Extract data directly from Supabase instead of files
    try:
        # Get all file imports for this user
        response = supabase.table('file_imports').select('compressed_text').eq('user_id', user_email).execute()
        
        if response.data:
            for file_record in response.data:
                compressed_text = file_record.get('compressed_text', '')
                if compressed_text:
                    try:
                        # Try to parse as JSON first (new structured format)
                        parsed_data = json.loads(compressed_text)
                        if isinstance(parsed_data, dict) and "structured_data" in parsed_data:
                            # New format with structured data
                            structured_data = parsed_data["structured_data"]
                            if isinstance(structured_data, dict):
                                # Safely extract each field with defaults
                                terms = structured_data.get("terms", [])
                                definitions = structured_data.get("definitions", [])
                                examples = structured_data.get("examples", [])
                                questions = structured_data.get("questions", [])
                                answers = structured_data.get("answers", [])
                                
                                # Ensure all are lists and extend combined data
                                if isinstance(terms, list):
                                    combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                                if isinstance(definitions, list):
                                    combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                                if isinstance(examples, list):
                                    combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                                if isinstance(questions, list):
                                    combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                                if isinstance(answers, list):
                                    combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
                        elif isinstance(parsed_data, dict):
                            # Old structured format (direct terms, definitions, etc.)
                            terms = parsed_data.get("terms", [])
                            definitions = parsed_data.get("definitions", [])
                            examples = parsed_data.get("examples", [])
                            questions = parsed_data.get("questions", [])
                            answers = parsed_data.get("answers", [])
                            
                            # Ensure all are lists
                            if isinstance(terms, list):
                                combined_structured_data["terms"].extend([t for t in terms if t and t not in combined_structured_data["terms"]])
                            if isinstance(definitions, list):
                                combined_structured_data["definitions"].extend([d for d in definitions if d and d not in combined_structured_data["definitions"]])
                            if isinstance(examples, list):
                                combined_structured_data["examples"].extend([e for e in examples if e and e not in combined_structured_data["examples"]])
                            if isinstance(questions, list):
                                combined_structured_data["questions"].extend([q for q in questions if q and q not in combined_structured_data["questions"]])
                            if isinstance(answers, list):
                                combined_structured_data["answers"].extend([a for a in answers if a and a not in combined_structured_data["answers"]])
                    except json.JSONDecodeError:
                        # If it's not JSON, it's probably the old compressed string format
                        print(f"Skipping non-JSON compressed text: {compressed_text[:100]}...")
                        continue
                    except Exception as e:
                        print(f"Error processing compressed text: {e}")
                        continue
    except Exception as e:
        print(f"Error fetching data from Supabase: {e}")
        return jsonify({"error": "Failed to fetch file data"}), 500

    further_compressed_context = _nltk_compress_and_filter(combined_structured_data)

    if not further_compressed_context.strip() and not existing_content.strip():
        combined_raw_content = ""
        for path in source_file_paths:
            combined_raw_content += read_extracted_text_content(path) + "\n\n"
        if not combined_raw_content.strip():
            return jsonify({"error": "No context available for autofill."}), 400
        context_for_llm = combined_raw_content
    else:
        context_for_llm = further_compressed_context

    prompt = f"""
You are an AI assistant trained to highlight only specific terms and definitions in academics.

Topic: {topic}

Context:
{context_for_llm}

Instructions:
Generate exactly 5 bullet points, one each on the following:
Definition
Understanding
Use Cases
Meaning
Examples

Each bullet must:
- Be concise but content-rich
- Pull specific points from the context where applicable
- Avoid preambles or section headings

Respond with **only** the bullet points (minimum 10), don't add any filler words, be to the point as the students you are teaching are only there for the information and are studying the night before.

Also, when writing the bulletpoints, do not write with bullet points and use font styles like bold or underline like how you normally would. DO NOT USE any type of text font format accept regular.

Do not include ANY information of the AI thinking, besides the fact that the required information above. Do not say "Let me think" or "I will now generate the bullet points" or anything like that. Just give the bullet points directly. Do not add bullet points for spaces between two bullet points.
DO NOT ADD ANY EXTRA WORDS, BULLETPOINTS, SPACES, ENTERS, OR ANYTHING ELSE THAT IS NOT THE INFORMATION REQUIRED ABOVE. PLEASE FOR GOD's SAKE
"""

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="compound-beta-mini",
            temperature=0.4,
            max_tokens=100,
        )
        filled_content = chat_completion.choices[0].message.content

        # Log autofill usage to Supabase
        if user_id:
            try:
                supabase.table('autofill_usage').insert({
                    "user_id": int(user_id),
                    "topic": topic,
                    "filled_content": filled_content,
                    "source_files_count": len(source_file_paths) + len(compressed_file_paths),
                    "created_at": datetime.now().isoformat()
                }).execute()
            except Exception as e:
                print(f"Error logging autofill usage: {e}")

        return jsonify({"filledContent": filled_content})

    except Exception as e:
        print(f"Error calling Groq API for Autofill: {e}")
        return jsonify({"error": str(e)}), 500

# ==================== ANALYTICS AND UTILITY ROUTES ====================

@app.route('/get-user-analytics/<int:user_id>', methods=['GET'])
def get_user_analytics(user_id):
    """
    Get analytics data for a specific user
    """
    try:
        analytics = {}
        
        # Get project count
        projects = supabase.table('projects').select('id').eq('user_id', user_id).execute()
        analytics['total_projects'] = len(projects.data)
        
        # Get file import count
        files = supabase.table('file_imports').select('id').eq('user_id', user_id).execute()
        analytics['total_files_imported'] = len(files.data)
        
        # Get AI usage count
        ai_usage = supabase.table('ai_usage_logs').select('id').eq('user_id', user_id).execute()
        analytics['total_ai_generations'] = len(ai_usage.data)
        
        # Get test generation count
        tests = supabase.table('generated_tests').select('id').eq('user_id', user_id).execute()
        analytics['total_tests_generated'] = len(tests.data)
        
        # Get notes generation count
        notes = supabase.table('generated_notes').select('id').eq('user_id', user_id).execute()
        analytics['total_notes_generated'] = len(notes.data)
        
        # Get study guide generation count
        study_guides = supabase.table('generated_study_guides').select('id').eq('user_id', user_id).execute()
        analytics['total_study_guides_generated'] = len(study_guides.data)
        
        return jsonify({"analytics": analytics}), 200
        
    except Exception as e:
        print(f"Error fetching user analytics: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/get-classes', methods=['GET'])
def get_classes():
    """
    Get available class options
    """
    return jsonify({"classes": CLASSES}), 200

@app.route('/get-access-levels', methods=['GET'])
def get_access_levels():
    """
    Get available access levels for projects
    """
    return jsonify({"access_levels": ACCESS_LEVELS}), 200

# ==================== NEW API ENDPOINTS FOR FRONTEND ====================

# In-memory storage for demo purposes (in addition to Supabase)
projects_memory = []
files_memory = []
ai_tools = [
    {"name": "summarize", "display_name": "Summarize Content"},
    {"name": "analyze", "display_name": "Analyze Files"},
    {"name": "translate", "display_name": "Translate Text"},
    {"name": "extract", "display_name": "Extract Key Points"}
]

@app.route('/api/projects', methods=['POST'])
def create_api_project():
    """
    Create a new project with full user validation and comprehensive project creation
    """
    user_email = session.get('user_email')  # Assuming user email is stored in session
    print(f"Authenticated user creating project: {user_email}")

    
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('title') or not data.get('description') or not data.get('subject'):
            return jsonify({
                'success': False,
                'message': 'Missing required fields: title, description, and subject are required'
            }), 400
        
        # Get authenticated user email from session or JWT
        if not user_email:
            return jsonify({
                'success': False,
                'message': 'User not authenticated. Please log in to create projects.'
            }), 401
        
        print(f"Authenticated user creating project: {user_email}")
        
        # Get user details from database for comprehensive logging and validation
        try:
            user_details = supabase.table('users').select('id, name, school, classes').eq('email', user_email).execute()
            if not user_details.data:
                return jsonify({
                    'success': False,
                    'message': 'User account not found. Please contact support.'
                }), 404
            
            user_info = user_details.data[0]
            user_id = user_info['id']
            print(f"Project creation by authenticated user - ID: {user_id}, Name: {user_info['name']}, School: {user_info['school']}, Email: {user_email}")
            
            # Validate subject against user's enrolled classes
            user_classes = user_info['classes'].split(',') if user_info['classes'] else []
            if data['subject'] not in user_classes:
                print(f"Warning: User {user_email} creating project in subject '{data['subject']}' not in their enrolled classes: {user_classes}")
            
        except Exception as e:
            print(f"Error fetching user details for {user_email}: {e}")
            return jsonify({
                'success': False,
                'message': 'Error validating user account'
            }), 500
        
        # Generate unique project ID
        project_id = str(uuid.uuid4())
        
        # Create comprehensive project object
        project = {
            'id': project_id,
            'title': data['title'],
            'description': data['description'],
            'subject': data['subject'],
            'access_level': data.get('access_level', 'private'),
            "user_email": user_email,

            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'files': [],
            'status': 'active',
            'metadata': {
                'creator_name': user_info['name'],
                'creator_school': user_info['school'],
                'creation_source': 'api'
            }
        }
        
        # Add to in-memory storage
        projects_memory.append(project)
        
        # Save to multiple Supabase tables for comprehensive tracking
        try:
            # Save to projects table
            project_data = {
                'user_id': user_email,
                'title': data['title'],
                'subject': data['subject'],
                'content': data['description'],  # Use description as content
                'location': data.get('location', 'API Created'),
                'access_level': data.get('access_level', 'private'),
                'created_at': datetime.now().isoformat()
            }
            
            projects_response = supabase.table('projects').insert(project_data).execute()
            
            if projects_response.data:
                project['supabase_project_id'] = projects_response.data[0]['id']
                print(f"Successfully saved project to projects table: {projects_response.data[0]['id']}")
            
            # Save to feed_posts table for community visibility
            feed_post_data = {
                'project_name': data['title'],
                'description': data['description'],
                'subject': data['subject'],
                'canvas_snapshot_url': data.get('canvas_snapshot_url'),
                'user_id': user_email,
                'user_username': user_info['name'],  # Use actual name as username
                'created_at': datetime.now().isoformat()
            }
            
            # Remove None values
            feed_post_data = {k: v for k, v in feed_post_data.items() if v is not None}
            
            feed_response = supabase.table('feed_posts').insert(feed_post_data).execute()
            
            if feed_response.data:
                project['feed_post_id'] = feed_response.data[0]['id']
                print(f"Successfully saved project to feed_posts: {feed_response.data[0]['id']}")
            
            # Log project creation activity
            activity_data = {
                'user_id': user_id,
                'activity_type': 'project_created',
                'description': f"Created project '{data['title']}' in {data['subject']}",
                'metadata': json.dumps({
                    'project_id': project_id,
                    'subject': data['subject'],
                    'access_level': data.get('access_level', 'private')
                }),
                'created_at': datetime.now().isoformat()
            }
            
            supabase.table('user_activities').insert(activity_data).execute()
            print(f"Logged project creation activity for user {user_id}")
                
        except Exception as supabase_error:
            print(f"Error saving to Supabase tables: {supabase_error}")
            # Continue execution even if some Supabase operations fail
        
        # Return comprehensive response
        return jsonify({
            'success': True,
            'message': f'Project "{data["title"]}" created successfully in {data["subject"]}',
            'project': project,
            'user_info': {
                'id': user_id,
                'name': user_info['name'],
                'email': user_email,
                'school': user_info['school']
            },
            'next_steps': [
                'Upload study materials to enhance your project',
                'Use AI tools to generate flashcards, tests, or notes',
                'Share your project with classmates if desired'
            ]
        }), 201
        
    except Exception as e:
        print(f"Error in create_api_project: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'message': 'Failed to create project. Please try again.'
        }), 500

@app.route('/api/projects', methods=['GET'])
def get_api_projects():
    try:
        return jsonify({
            'success': True,
            'projects': projects_memory
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/projects/<project_id>', methods=['GET'])
def get_api_project(project_id):
    try:
        project = next((p for p in projects_memory if p['id'] == project_id), None)
        
        if not project:
            return jsonify({
                'success': False,
                'message': 'Project not found'
            }), 404
        
        return jsonify({
            'success': True,
            'project': project
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/projects/<project_id>', methods=['PUT'])
def update_api_project(project_id):
    try:
        data = request.get_json()
        project = next((p for p in projects_memory if p['id'] == project_id), None)
        
        if not project:
            return jsonify({
                'success': False,
                'message': 'Project not found'
            }), 404
        
        # Update project fields
        if 'title' in data:
            project['title'] = data['title']
        if 'description' in data:
            project['description'] = data['description']
        if 'subject' in data:
            project['subject'] = data['subject']
        
        project['updated_at'] = datetime.now().isoformat()
        
        return jsonify({
            'success': True,
            'message': 'Project updated successfully',
            'project': project
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_api_project(project_id):
    try:
        global projects_memory
        projects_memory = [p for p in projects_memory if p['id'] != project_id]
        
        return jsonify({
            'success': True,
            'message': 'Project deleted successfully'
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/files', methods=['POST'])
def upload_api_file():
    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'message': 'No file provided'
            }), 400
        
        file = request.files['file']
        project_id = request.form.get('project_id')
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'message': 'No file selected'
            }), 400
        
        # Generate unique file ID
        file_id = str(uuid.uuid4())
        
        # Create file record
        file_record = {
            'id': file_id,
            'name': file.filename,
            'size': 0,  # Would calculate actual size in real implementation
            'type': file.content_type,
            'project_id': project_id,
            'uploaded_at': datetime.now().isoformat(),
            'status': 'uploaded'
        }
        
        # Add to in-memory storage
        files_memory.append(file_record)
        
        # Add file to project
        if project_id:
            project = next((p for p in projects_memory if p['id'] == project_id), None)
            if project:
                project['files'].append(file_id)
        
        return jsonify({
            'success': True,
            'message': 'File uploaded successfully',
            'file': file_record
        }), 201
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/files', methods=['GET'])
def get_api_files():
    try:
        project_id = request.args.get('project_id')
        
        if project_id:
            project_files = [f for f in files_memory if f.get('project_id') == project_id]
            return jsonify({
                'success': True,
                'files': project_files
            }), 200
        
        return jsonify({
            'success': True,
            'files': files_memory
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/files/<file_id>', methods=['DELETE'])
def delete_file(file_id):
    try:
        global files_memory
        files_memory = [f for f in files_memory if f['id'] != file_id]
        
        return jsonify({
            'success': True,
            'message': 'File deleted successfully'
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/files/<file_id>/download', methods=['GET'])
def download_file(file_id):
    try:
        file_record = next((f for f in files_memory if f['id'] == file_id), None)
        
        if not file_record:
            return jsonify({
                'success': False,
                'message': 'File not found'
            }), 404
        
        # For demo purposes, return a simple text response
        return f"File content for {file_record['name']}", 200, {
            'Content-Disposition': f'attachment; filename={file_record["name"]}'
        }
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/ai-tools', methods=['GET'])
def get_ai_tools():
    try:
        return jsonify({
            'success': True,
            'tools': ai_tools
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
def like_post(post_id):
    """
    Like or unlike a feed post
    """
    try:
        # Get authenticated user email from session or JWT
        user_email = get_authenticated_user()
        if not user_email:
            return jsonify({
                'success': False,
                'message': 'User not authenticated'
            }), 401
        
        # Log which user is liking/unliking the post
        print(f"User {user_email} is interacting with post {post_id}")
        
        # Check if user already liked this post
        existing_like = supabase.table('post_likes').select('*').eq('post_id', post_id).eq('user_id', user_email).execute()
        
        if existing_like.data:
            # Unlike the post (remove the like)
            supabase.table('post_likes').delete().eq('post_id', post_id).eq('user_id', user_email).execute()
            action = 'unliked'
            print(f"User {user_email} unliked post {post_id}")
        else:
            # Like the post (add the like)
            supabase.table('post_likes').insert({
                'post_id': post_id,
                'user_id': user_email,
                'created_at': datetime.now().isoformat()
            }).execute()
            action = 'liked'
            print(f"User {user_email} liked post {post_id}")
        
        # Get updated like count
        like_count_response = supabase.table('post_likes').select('id').eq('post_id', post_id).execute()
        like_count = len(like_count_response.data)
        
        return jsonify({
            'success': True,
            'action': action,
            'like_count': like_count,
            'message': f'Post {action} successfully'
        }), 200
        
    except Exception as e:
        print(f"Error liking/unliking post: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'message': 'Failed to like/unlike post'
        }), 500

@app.route('/logout', methods=['POST'])
def logout():
    """
    Logout user and clear session
    """
    try:
        user_email = session.get('user_email')
        if user_email:
            print(f"User {user_email} is logging out")
        else:
            print("No user found in session during logout attempt")
        
        # Clear the session completely
        session.clear()
        
        # Verify session is cleared
        if 'user_email' not in session:
            print("Session cleared successfully")
        else:
            print("Warning: Session may not have been cleared properly")
        
        return jsonify({
            "success": True,
            "message": "Logged out successfully"
        }), 200
        
    except Exception as e:
        print(f"Error during logout: {e}")
        return jsonify({
            "success": False,
            "error": "Error during logout"
        }), 500

@app.route('/api/posts/<int:post_id>/likes', methods=['GET'])
def get_post_likes(post_id):
    """
    Get like count and check if current user liked the post
    """
    try:
        # Get authenticated user email from session or JWT
        user_email = get_authenticated_user()
        
        # Get total like count
        like_count_response = supabase.table('post_likes').select('id').eq('post_id', post_id).execute()
        like_count = len(like_count_response.data)
        
        # Check if current user liked this post
        user_liked = False
        if user_email:
            user_like_response = supabase.table('post_likes').select('id').eq('post_id', post_id).eq('user_id', user_email).execute()
            user_liked = len(user_like_response.data) > 0
        
        return jsonify({
            'success': True,
            'like_count': like_count,
            'user_liked': user_liked
        }), 200
        
    except Exception as e:
        print(f"Error getting post likes: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ==================== HEALTH CHECK ROUTE ====================

@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint
    """
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "projects": len(projects_memory),
        "files": len(files_memory),
        "services": {
            "supabase": "connected" if SUPABASE_URL and SUPABASE_ANON_KEY else "not configured",
            "groq": "connected" if GROQ_API_KEY else "not configured"
        }
    }), 200


@app.route('/api/posts', methods=['POST'])
def create_post():
    """Create a new post in feed_posts table"""
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    try:
        data = request.get_json()
        project_name = data.get('project_name')
        description = data.get('description')
        subject = data.get('subject')
        
        if not project_name or not project_name.strip():
            return jsonify({"success": False, "error": "Project name is required"}), 400
        
        if not description or not description.strip():
            return jsonify({"success": False, "error": "Description is required"}), 400
            
        if not subject or not subject.strip():
            return jsonify({"success": False, "error": "Subject is required"}), 400

        # Get user details from the users table
        user_response = supabase.table("users").select("name").eq("email", user_email).execute()
        if not user_response.data:
            return jsonify({"success": False, "error": "User not found"}), 404
        
        user_data = user_response.data[0]
        user_username = user_data.get("name", "Anonymous")

        # Create the post record for feed_posts table
        post_data = {
            "project_name": project_name.strip(),
            "description": description.strip(),
            "subject": subject.strip(),
            "canvas_snapshot_url": None,  # Always null as requested
            "user_id": user_email,
            "user_username": user_username,
            "created_at": datetime.utcnow().isoformat()
        }

        # Insert into feed_posts table
        response = supabase.table("feed_posts").insert(post_data).execute()
        
        if response.data:
            return jsonify({
                "success": True,
                "post": response.data[0]
            }), 201
        else:
            return jsonify({"success": False, "error": "Failed to create post"}), 500

    except Exception as e:
        print(f"Error creating post: {e}")
        return jsonify({"success": False, "error": "Failed to create post"}), 500

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        res = make_response()
        res.headers.add("Access-Control-Allow-Origin", "http://localhost:5173" )
        res.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        res.headers.add("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        res.headers.add("Access-Control-Allow-Credentials", "true")
        return res


@app.route("/api/posts/<int:post_id>/comments", methods=["POST"])
def add_comment(post_id):
    user_email = get_authenticated_user()
    if not user_email:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    comment_text = data.get("comment_text")

    if not comment_text:
        return jsonify({"error": "Comment text is required"}), 400

    try:
        response = supabase.table("post_comments").insert({
            "post_id": post_id,
            "user_id": user_email,
            "comment_text": comment_text
        }).execute()

        if response.data:
            return jsonify({"success": True, "comment": response.data[0]}), 201
        else:
            return jsonify({"error": "Failed to add comment"}), 500

    except Exception as e:
        print(f"Error adding comment: {e}")
        return jsonify({"error": "Failed to add comment"}), 500

@app.route("/api/posts/<int:post_id>/comments", methods=["GET"])
def get_comments(post_id):
    try:
        response = supabase.table("post_comments").select("*, users(name)").eq("post_id", post_id).order("created_at", desc=True).execute()
        return jsonify({"success": True, "comments": response.data or []}), 200
    except Exception as e:
        print(f"Error getting comments: {e}")
        return jsonify({"error": "Failed to get comments"}), 500

# ==================== END POSTS API ====================

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

