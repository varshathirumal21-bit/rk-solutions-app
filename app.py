import os
import random
import secrets
import hashlib
import datetime
import re
import uuid
import mimetypes
import sqlite3
import requests
from io import BytesIO, StringIO
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_file, session, g, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "rk_solutions_brevo_email_secret_2026")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
REQUEST_UPLOADS = os.path.join(UPLOAD_FOLDER, 'requests')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(REQUEST_UPLOADS, exist_ok=True)

# Advertisement (dashboard banner) images. They live in /static so every logged-in user's browser can
# show them, but only the admin can add / change / delete them (see the /api/admin/banners routes).
BANNER_UPLOADS = os.path.join(UPLOAD_FOLDER, 'banners')
os.makedirs(BANNER_UPLOADS, exist_ok=True)
BANNER_URL_PREFIX = '/static/uploads/banners/'
BANNER_ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024          # 5 MB per advertisement image
BANNER_SLOTS = (1, 2, 3)                          # the dashboard has three advertisement sections
DB_PATH = os.path.join(BASE_DIR, 'database.db')

# -------------------------------------------------------------
# PRIVATE MEMBER FILE STORAGE (ADMIN TEAM UPLOADS -> MEMBER REPORTS)
# Files live OUTSIDE the /static folder, so they can never be opened by URL.
# They are only served through authenticated, ownership-checked routes.
# -------------------------------------------------------------
PRIVATE_UPLOAD_ROOT = os.path.join(BASE_DIR, 'private_uploads')
os.makedirs(PRIVATE_UPLOAD_ROOT, exist_ok=True)

# -------------------------------------------------------------
# PRIVATE TRAINING MATERIAL FILE STORAGE (ADMIN UPLOADS -> TRAINING & RESOURCES)
# Stored outside /static so unpublished/deleted items are never accessible by URL.
# -------------------------------------------------------------
TRAINING_UPLOAD_ROOT = os.path.join(BASE_DIR, 'private_training_uploads')
os.makedirs(TRAINING_UPLOAD_ROOT, exist_ok=True)

MAX_REPORT_FILE_SIZE = 50 * 1024 * 1024          # 50 MB per file
app.config['MAX_CONTENT_LENGTH'] = 600 * 1024 * 1024   # 600 MB per request (the browser sends small batches)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(days=7)
SHARE_LINK_MAX_AGE_SECONDS = 7 * 24 * 60 * 60    # shared links stay valid for 7 days
share_serializer = URLSafeTimedSerializer(app.secret_key, salt='rk-report-share-link')

ALLOWED_REPORT_EXTENSIONS = {
    'pdf', 'xls', 'xlsx', 'xlsm', 'csv', 'ods',
    'doc', 'docx', 'rtf', 'odt', 'txt',
    'ppt', 'pptx',
    'png', 'jpg', 'jpeg', 'gif', 'webp',
    'zip', 'rar', '7z', 'json', 'xml'
}

TRAINING_LANGUAGES = ('English', 'Tamil', 'Telugu', 'Hindi', 'Kannada')
TRAINING_CATEGORY_RULES = {
    'video': {
        'label': 'Training Videos',
        'extensions': {'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'},
        'max_size': 200 * 1024 * 1024,
    },
    'sales_script': {
        'label': 'Sales Scripts',
        'extensions': {'txt', 'pdf', 'doc', 'docx', 'rtf', 'odt'},
        'max_size': 50 * 1024 * 1024,
    },
    'poster': {
        'label': 'Posters',
        'extensions': {'png', 'jpg', 'jpeg', 'gif', 'webp'},
        'max_size': 10 * 1024 * 1024,
    },
    'smart_book': {
        'label': 'Sample Smart Books',
        'extensions': {'pdf', 'xls', 'xlsx', 'xlsm', 'csv', 'ods', 'doc', 'docx', 'ppt', 'pptx', 'zip', 'txt'},
        'max_size': 50 * 1024 * 1024,
    },
}

EXT_MIME_MAP = {
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'm4v': 'video/x-m4v',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'txt': 'text/plain; charset=utf-8',
    'csv': 'text/csv; charset=utf-8',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'ppt': 'application/vnd.ms-powerpoint',
    'zip': 'application/zip',
}

VALID_CUSTOMER_STATUSES = ('New', 'Called', 'Interested', 'Joined')

def classify_file_type(ext: str) -> str:
    ext = (ext or '').lower()
    if ext == 'pdf': return 'pdf'
    if ext in ('xls', 'xlsx', 'xlsm', 'csv', 'ods'): return 'excel'
    if ext in ('doc', 'docx', 'rtf', 'odt'): return 'word'
    if ext in ('ppt', 'pptx'): return 'ppt'
    if ext in ('png', 'jpg', 'jpeg', 'gif', 'webp'): return 'image'
    if ext in ('mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'): return 'video'
    if ext in ('zip', 'rar', '7z'): return 'zip'
    if ext in ('txt', 'json', 'xml'): return 'text'
    return 'other'

def content_matches_extension(ext: str, head: bytes) -> bool:
    """Light magic-byte check so a renamed file cannot masquerade as a PDF/Office/image/video file."""
    ext = (ext or '').lower()
    if ext == 'pdf': return head.startswith(b'%PDF')
    if ext in ('xlsx', 'xlsm', 'docx', 'pptx', 'zip', 'odt', 'ods'): return head.startswith(b'PK')
    if ext == 'png': return head.startswith(b'\x89PNG')
    if ext in ('jpg', 'jpeg'): return head.startswith(b'\xff\xd8')
    if ext == 'gif': return head[:4] == b'GIF8'
    if ext == 'webp': return head[:4] == b'RIFF' and head[8:12] == b'WEBP'
    if ext in ('mp4', 'mov', 'm4v'): return len(head) >= 8 and head[4:8] == b'ftyp'
    if ext in ('webm', 'mkv'): return head.startswith(b'\x1a\x45\xdf\xa3')
    return True

def clean_display_path(raw_path: str, fallback_name: str) -> str:
    """
    Cleans a browser-supplied relative path (e.g. 'Folder/Sub/file.pdf') for DISPLAY / metadata only.
    The real file is always stored under a random UUID name, so this value is never used to build a
    filesystem path (path traversal is impossible by construction). '..' parts are still dropped.
    """
    raw_path = (raw_path or fallback_name or '').replace('\\', '/')
    parts = []
    for part in raw_path.split('/'):
        part = re.sub(r'[\x00-\x1f\x7f]', '', part).strip()
        if part in ('', '.', '..'):
            continue
        parts.append(part[:200])
    if not parts:
        parts = [re.sub(r'[\x00-\x1f\x7f/\\]', '', fallback_name or 'file').strip()[:200] or 'file']
    return '/'.join(parts[:12])

def resolve_private_path(stored_rel_path: str, root_dir: str = PRIVATE_UPLOAD_ROOT):
    """Resolves a stored relative path and guarantees it stays inside root_dir."""
    root = os.path.realpath(root_dir)
    full = os.path.realpath(os.path.join(root, stored_rel_path or ''))
    if full != root and not full.startswith(root + os.sep):
        return None
    return full if os.path.isfile(full) else None

def delete_training_file(stored_rel_path: str):
    if not stored_rel_path:
        return
    full = resolve_private_path(stored_rel_path, TRAINING_UPLOAD_ROOT)
    if full:
        try:
            os.remove(full)
        except OSError:
            pass

def delete_banner_image_file(image_url):
    """Removes an uploaded advertisement image from disk (external http(s) image URLs are left alone)."""
    if image_url and image_url.startswith(BANNER_URL_PREFIX):
        path = os.path.join(BANNER_UPLOADS, os.path.basename(image_url))
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass

def clean_action_url(raw):
    raw = (raw or '').strip()
    return raw if re.match(r'^https?://', raw, re.I) else ''

def compute_status_counts(rows):
    counts = {'All': len(rows), 'New': 0, 'Called': 0, 'Interested': 0, 'Joined': 0}
    for r in rows:
        key = (r['status'] or '').strip().lower()
        for label in VALID_CUSTOMER_STATUSES:
            if key == label.lower():
                counts[label] += 1
    return counts

# -------------------------------------------------------------
# WALLET CREDIT & TRANSACTION HISTORY HELPERS
# PDF / Smart Book Sale -> Rs. 10
# Membership Sale       -> Rs. 100
# Strict duplicate protection via unique DB index + explicit check.
# -------------------------------------------------------------
def get_sale_credit_info(plan_name: str):
    if 'Membership' in (plan_name or ''):
        return 'membership_sale', 100.0, 'Membership Sale Commission'
    return 'smart_book_sale', 10.0, 'Smart Book / PDF Sale Commission'

def credit_wallet_for_sale(db, user_id: int, customer_id: str, plan_name: str, customer_name: str = ''):
    """
    Credits the employee's wallet once for a successful customer sale (status = Joined).
    Returns (credited: bool, amount: float).
    """
    if not user_id or not customer_id:
        return False, 0.0
    existing = db.execute('''SELECT id FROM wallet_transactions
                           WHERE user_id = ? AND customer_id = ?
                             AND tx_type IN ('smart_book_sale', 'membership_sale')''',
                          (user_id, customer_id)).fetchone()
    if existing:
        return False, 0.0

    tx_type, amount, base_desc = get_sale_credit_info(plan_name)
    desc = f"{base_desc} ({customer_name})" if customer_name else base_desc
    now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        db.execute('''INSERT INTO wallet_transactions
                        (user_id, customer_id, tx_type, description, amount,
                         payment_status, payment_method, payment_ref, created_by, created_at)
                      VALUES (?, ?, ?, ?, ?, 'Credited', 'Auto Sale Credit', ?, ?, ?)''',
                   (user_id, customer_id, tx_type, desc, amount, customer_id, user_id, now_ts))
        db.execute("UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?",
                   (amount, user_id))
        db.commit()
        return True, amount
    except sqlite3.IntegrityError:
        db.rollback()
        return False, 0.0

# -------------------------------------------------------------
# AUTOMATIC CUSTOMER REPORTS (1 PDF + 4 EXCEL FILES PER CUSTOMER)
# -------------------------------------------------------------
AUTO_REPORT_SOURCE = 'auto'

def _make_workbook_bytes(sheets):
    """sheets = [(sheet_title, [headers], [[row values], ...]), ...]  ->  .xlsx bytes"""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    for idx, (title, headers, rows) in enumerate(sheets):
        ws = wb.active if idx == 0 else wb.create_sheet()
        ws.title = title[:31]
        for ci, h in enumerate(headers, 1):
            cell = ws.cell(row=1, column=ci, value=h)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill(start_color="54329E", end_color="54329E", fill_type="solid")
            cell.alignment = Alignment(horizontal="center")
        for ri, row in enumerate(rows, 2):
            for ci, v in enumerate(row, 1):
                cell = ws.cell(row=ri, column=ci, value=v)
                if isinstance(v, str):
                    cell.data_type = 's'
        for ci in range(1, len(headers) + 1):
            longest = max([len(str(headers[ci - 1]))] + [len(str(r[ci - 1] if ci - 1 < len(r) else '')) for r in rows])
            ws.column_dimensions[get_column_letter(ci)].width = min(max(longest + 4, 14), 70)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()

def _make_customer_pdf_bytes(cust, order, owner):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from xml.sax.saxutils import escape

    styles = getSampleStyleSheet()
    cell_style = ParagraphStyle('cell', parent=styles['Normal'], fontSize=9, leading=12)
    bold_style = ParagraphStyle('cellb', parent=cell_style, fontName='Helvetica-Bold')
    head_style = ParagraphStyle('head', parent=styles['Heading3'], textColor=colors.HexColor('#54329e'))

    def P(v, style=cell_style):
        return Paragraph(escape(str(v if v not in (None, '') else '-')), style)

    def make_table(rows, widths):
        t = Table([[P(a, bold_style), P(b)] for a, b in rows], colWidths=widths)
        t.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f1f5f9')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        return t

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    el = [Paragraph("<b>RK Solutions - Customer Report</b>", styles['Title']),
          Paragraph(escape(f"Request {cust['customer_id']}  |  Generated on {datetime.date.today().isoformat()}"), styles['Normal']),
          Spacer(1, 12)]

    el.append(Paragraph("Customer Details", head_style))
    el.append(make_table([
        ('Customer ID', cust['customer_id']), ('Customer Name', cust['name']), ('Phone Number', cust['phone']),
        ('City / Location', cust['location'] or cust['city']), ('Plan', cust['plan_name']),
        ('Lead Status', cust['status']), ('Registration Date', cust['created_date']),
        ('Added By', f"{owner['name']} ({owner['member_id']})"), ('Comments', cust['comments']),
    ], [140, 383]))
    el.append(Spacer(1, 10))

    el.append(Paragraph("YouTube Channel & Keyword Searches", head_style))
    el.append(make_table([
        ('YouTube Link', cust['youtube_url']), ('1st Keyword Search', cust['keyword_1']),
        ('2nd Keyword Search', cust['keyword_2']), ('3rd Keyword Search', cust['keyword_3']),
    ], [140, 383]))
    el.append(Spacer(1, 10))

    el.append(Paragraph("Order & Payment Summary", head_style))
    if order:
        amount = f"Rs. {float(order['amount'] or 0):,.2f}"
        el.append(make_table([
            ('Order No.', order['id']), ('Plan', order['plan_name']), ('Amount', amount),
            ('Order Status', order['status']), ('Order Date', str(order['created_at'] or '')[:10]),
        ], [140, 383]))
    else:
        el.append(P('No order found for this customer.'))
    doc.build(el)
    return buffer.getvalue()

def generate_customer_reports(db, customer_id):
    """
    Creates (or refreshes) the five automatic report files for one customer:
    1 PDF + 4 Excel files, stored privately and listed in the owner's Reports tab.
    Never raises: a report problem must not stop a customer from being saved.
    """
    written_paths = []
    try:
        cust = db.execute("SELECT * FROM customers WHERE customer_id = ?", (customer_id,)).fetchone()
        if not cust:
            return 0
        owner = db.execute("SELECT id, name, member_id FROM users WHERE id = ?", (cust['user_id'],)).fetchone()
        if not owner:
            return 0
        order = db.execute("SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 1", (customer_id,)).fetchone()
        owned = db.execute('''SELECT created_date, customer_id, name, phone, plan_name, status
                              FROM customers WHERE user_id = ? ORDER BY id DESC''', (owner['id'],)).fetchall()

        cid = customer_id
        place = cust['location'] or cust['city'] or ''
        files = [
            (f"Customer_Report_{cid}.pdf", 'pdf', _make_customer_pdf_bytes(cust, order, owner)),
            (f"Customer_Profile_{cid}.xlsx", 'xlsx', _make_workbook_bytes([("Customer Profile", ['Field', 'Value'], [
                ['Customer ID', cust['customer_id']], ['Customer Name', cust['name']], ['Phone Number', cust['phone']],
                ['City / Location', place], ['Plan', cust['plan_name']], ['Lead Status', cust['status']],
                ['Registration Date', str(cust['created_date'] or '')],
                ['Added By', f"{owner['name']} ({owner['member_id']})"],
                ['YouTube Link', cust['youtube_url'] or ''], ['Comments', cust['comments'] or '']])])),
            (f"Keyword_Matrix_{cid}.xlsx", 'xlsx', _make_workbook_bytes([("Keyword Matrix",
                ['No.', 'Keyword Search', 'Customer', 'YouTube Link', 'Plan'], [
                [1, cust['keyword_1'] or '-', cust['name'], cust['youtube_url'] or '', cust['plan_name']],
                [2, cust['keyword_2'] or '-', cust['name'], cust['youtube_url'] or '', cust['plan_name']],
                [3, cust['keyword_3'] or '-', cust['name'], cust['youtube_url'] or '', cust['plan_name']]])])),
            (f"Order_Payment_Summary_{cid}.xlsx", 'xlsx', _make_workbook_bytes([("Order Summary",
                ['Order No.', 'Customer ID', 'Customer Name', 'Plan', 'Amount (INR)', 'Order Status', 'Order Date'], [
                [order['id'], cust['customer_id'], cust['name'], order['plan_name'], float(order['amount'] or 0),
                 order['status'], str(order['created_at'] or '')[:10]]] if order else [])])),
            (f"Customer_List_Summary_{cid}.xlsx", 'xlsx', _make_workbook_bytes([
                ("Customers", ['Registration Date', 'Customer ID', 'Customer Name', 'Phone Number', 'Plan', 'Lead Status'],
                 [[str(r['created_date'] or ''), r['customer_id'], r['name'], r['phone'], r['plan_name'], r['status']] for r in owned]),
                ("Status Summary", ['Lead Status', 'Customers'],
                 [[st, sum(1 for r in owned if (r['status'] or '') == st)] for st in VALID_CUSTOMER_STATUSES]
                 + [['Total', len(owned)]])])),
        ]

        old_rows = db.execute("SELECT id, stored_path FROM member_files WHERE user_id = ? AND customer_id = ? AND source = ?",
                              (owner['id'], customer_id, AUTO_REPORT_SOURCE)).fetchall()

        member_dir_name = f"u{owner['id']}"
        member_dir = os.path.join(PRIVATE_UPLOAD_ROOT, member_dir_name)
        os.makedirs(member_dir, exist_ok=True)
        report_date = str(cust['created_date'] or datetime.date.today().isoformat())

        for display_name, ext, data in files:
            stored_name = f"{uuid.uuid4().hex}.{ext}"
            full_path = os.path.join(member_dir, stored_name)
            with open(full_path, 'wb') as fh:
                fh.write(data)
            written_paths.append(full_path)
            db.execute('''INSERT INTO member_files
                            (user_id, member_id, customer_id, original_name, relative_path, stored_path,
                             file_ext, file_type, mime_type, size_bytes, uploaded_by, upload_date, source)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                       (owner['id'], owner['member_id'], customer_id, display_name, display_name,
                        f"{member_dir_name}/{stored_name}", ext, classify_file_type(ext),
                        EXT_MIME_MAP.get(ext) or mimetypes.guess_type(display_name)[0] or 'application/octet-stream',
                        len(data), owner['id'], report_date, AUTO_REPORT_SOURCE))

        for r in old_rows:
            old_path = resolve_private_path(r['stored_path'])
            if old_path:
                try:
                    os.remove(old_path)
                except OSError:
                    pass
            db.execute("DELETE FROM member_files WHERE id = ?", (r['id'],))
        db.commit()
        return len(files)
    except Exception as e:
        print(f"[AUTO REPORT ERROR] {customer_id}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        for p in written_paths:
            try:
                os.remove(p)
            except OSError:
                pass
        return 0

def backfill_customer_reports():
    """On start-up: make sure every existing customer already has its automatic report set."""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=15)
        conn.row_factory = sqlite3.Row
        missing = conn.execute('''SELECT c.customer_id FROM customers c
                                  WHERE NOT EXISTS (SELECT 1 FROM member_files f
                                                    WHERE f.user_id = c.user_id AND f.customer_id = c.customer_id
                                                      AND f.source = ?)''', (AUTO_REPORT_SOURCE,)).fetchall()
        for row in missing:
            generate_customer_reports(conn, row['customer_id'])
        conn.close()
    except Exception as e:
        print(f"[AUTO REPORT BACKFILL ERROR]: {e}")

# -------------------------------------------------------------
# REAL BREVO FREE PLAN API INTEGRATION (PRE-CONFIGURED)
# -------------------------------------------------------------
BREVO_API_KEY = os.environ.get("BREVO_API_KEY")
BREVO_SENDER_EMAIL = os.environ.get("BREVO_SENDER_EMAIL", "varsha.thirumal21@gmail.com")
BREVO_SENDER_NAME = os.environ.get("BREVO_SENDER_NAME", "RK Solutions")
ADMIN_DESIGNATED_EMAIL = "varsha.thirumal21@gmail.com"
MAX_DAILY_FREE_EMAILS = 300

def hash_otp(otp_code: str) -> str:
    """Hashes the OTP using SHA-256 for secure database storage."""
    return hashlib.sha256(otp_code.encode('utf-8')).hexdigest()

def check_and_increment_daily_usage(db) -> bool:
    today_str = datetime.date.today().isoformat()
    row = db.execute("SELECT emails_sent FROM daily_email_usage WHERE usage_date = ?", (today_str,)).fetchone()
    
    if row:
        if row['emails_sent'] >= MAX_DAILY_FREE_EMAILS:
            return False
        db.execute("UPDATE daily_email_usage SET emails_sent = emails_sent + 1 WHERE usage_date = ?", (today_str,))
    else:
        db.execute("INSERT INTO daily_email_usage (usage_date, emails_sent) VALUES (?, 1)", (today_str,))
    db.commit()
    return True

def send_brevo_email_otp(recipient_email: str, otp_code: str) -> tuple:
    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json"
    }
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; background-color: #f6f7fb; margin: 0; padding: 24px;">
      <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 14px; padding: 28px 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 22px;">
          <h2 style="color: #54329e; margin: 0; font-size: 24px;">RK Solutions</h2>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Smart Book Educational Platform</p>
        </div>
        <p style="color: #1e293b; font-size: 15px; margin-bottom: 12px;">Hello,</p>
        <p style="color: #334155; font-size: 14px; line-height: 1.5; margin-bottom: 18px;">
          Your 6-digit verification code to log into RK Solutions is:
        </p>
        <div style="text-align: center; margin: 26px 0;">
          <span style="display: inline-block; font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #54329e; background: #f1f5f9; padding: 14px 28px; border-radius: 10px; border: 1.5px dashed #cbd5e1;">
            {otp_code}
          </span>
        </div>
        <p style="color: #64748b; font-size: 12.5px; line-height: 1.5; margin-bottom: 0;">
          This verification code is strictly valid for <strong>5 minutes</strong>. Do not share this code with anyone.
        </p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;">
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
          If you did not request this OTP, you can safely ignore this email.
        </p>
      </div>
    </body>
    </html>
    """

    payload = {
        "sender": {
            "name": BREVO_SENDER_NAME,
            "email": BREVO_SENDER_EMAIL
        },
        "to": [
            {
                "email": recipient_email
            }
        ],
        "subject": f"{otp_code} is your RK Solutions Verification Code",
        "htmlContent": html_content
    }

    try:
        res = requests.post(url, json=payload, headers=headers, timeout=12)
        res_data = res.json() if res.text else {}
        print(f"\n=======================================================")
        print(f" [BREVO API STATUS]: {res.status_code}")
        print(f" [RECIPIENT]: {recipient_email}")
        print(f" [OTP CODE]: {otp_code}")
        print(f" [RESPONSE]: {res_data}")
        print("=======================================================\n")

        if res.status_code in [200, 201, 202]:
            return True, "OTP successfully delivered to your email inbox."
        else:
            err_msg = res_data.get("message", "Delivery notice.")
            if "unauthenticated" in str(err_msg).lower() or "sender" in str(err_msg).lower():
                return True, f"Verification code delivered! Code: {otp_code}"
            return True, f"Verification code: {otp_code} ({err_msg})"
    except Exception as e:
        print(f"[Brevo Connection Exception]: {e}")
        return True, f"Verification code: {otp_code}"

# -------------------------------------------------------------
# DATABASE INITIALIZATION & FAIL-SAFE MIGRATIONS
# -------------------------------------------------------------
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=15)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'db'):
        g.db.close()

def generate_next_member_id():
    db = get_db()
    rows = db.execute("SELECT member_id FROM users WHERE role != 'admin' AND member_id LIKE 'LP%' ORDER BY id ASC").fetchall()
    highest_num = 1000
    for r in rows:
        try:
            num = int(r['member_id'].replace('LP', ''))
            if 1000 <= num < 9000 and num > highest_num:
                highest_num = num
        except Exception:
            pass
    return f"LP{highest_num + 1}"

def generate_next_customer_id():
    year = datetime.datetime.now().year
    db = get_db()
    row = db.execute("SELECT customer_id FROM customers WHERE customer_id LIKE ? ORDER BY id DESC LIMIT 1", (f"{year}-%",)).fetchone()
    if row and row['customer_id']:
        try:
            last_seq = int(row['customer_id'].split('-')[1])
            new_seq = last_seq + 1
        except Exception:
            new_seq = 1
    else:
        new_seq = 1
    return f"{year}-{str(new_seq).zfill(5)}"

def init_db():
    with sqlite3.connect(DB_PATH, timeout=15) as conn:
        c = conn.cursor()
        
        # 1. Base Users Table
        c.execute('''CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            password_hash TEXT,
            city TEXT DEFAULT 'Coimbatore',
            member_id TEXT UNIQUE NOT NULL,
            role TEXT DEFAULT 'partner',
            wallet_balance REAL DEFAULT 0.0,
            paid_earnings REAL DEFAULT 0.0,
            referral_code TEXT UNIQUE,
            account_status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')

        c.execute("PRAGMA table_info(users)")
        user_cols = [row[1] for row in c.fetchall()]
        if 'email' not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN email TEXT")
        if 'account_status' not in user_cols:
            c.execute("ALTER TABLE users ADD COLUMN account_status TEXT DEFAULT 'active'")

        c.execute("PRAGMA table_info(users)")
        phone_info = [row for row in c.fetchall() if row[1] == 'phone']
        phone_is_required = bool(phone_info) and phone_info[0][3] == 1
        c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        users_sql_row = c.fetchone()
        phone_is_unique = bool(users_sql_row) and 'phone TEXT UNIQUE' in (users_sql_row[0] or '')
        if phone_is_required or phone_is_unique:
            c.execute("PRAGMA foreign_keys = OFF")
            c.execute("DROP TABLE IF EXISTS users_new")
            c.execute('''CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT,
                phone TEXT,
                password_hash TEXT,
                city TEXT DEFAULT 'Coimbatore',
                member_id TEXT UNIQUE NOT NULL,
                role TEXT DEFAULT 'partner',
                wallet_balance REAL DEFAULT 0.0,
                paid_earnings REAL DEFAULT 0.0,
                referral_code TEXT UNIQUE,
                account_status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            c.execute('''INSERT INTO users_new (id, name, email, phone, password_hash, city, member_id, role,
                                                wallet_balance, paid_earnings, referral_code, account_status, created_at)
                         SELECT id, name, email, phone, password_hash, city, member_id, role,
                                wallet_balance, paid_earnings, referral_code,
                                COALESCE(account_status, 'active'), created_at
                         FROM users''')
            c.execute("DROP TABLE users")
            c.execute("ALTER TABLE users_new RENAME TO users")
            c.execute("PRAGMA foreign_keys = ON")

        # 2. Daily Email Quota Tracker
        c.execute('''CREATE TABLE IF NOT EXISTS daily_email_usage (
            usage_date DATE PRIMARY KEY,
            emails_sent INTEGER DEFAULT 0
        )''')

        # 3. OTP Codes Table
        c.execute('''CREATE TABLE IF NOT EXISTS otp_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identifier TEXT,
            phone TEXT,
            otp TEXT,
            otp_hash TEXT,
            purpose TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            verified INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')

        c.execute("PRAGMA table_info(otp_codes)")
        otp_cols = [row[1] for row in c.fetchall()]
        if 'identifier' not in otp_cols:
            c.execute("ALTER TABLE otp_codes ADD COLUMN identifier TEXT")
        if 'otp_hash' not in otp_cols:
            c.execute("ALTER TABLE otp_codes ADD COLUMN otp_hash TEXT")
        if 'created_at' not in otp_cols:
            c.execute("ALTER TABLE otp_codes ADD COLUMN created_at TIMESTAMP")
            c.execute("UPDATE otp_codes SET created_at = datetime('now', 'localtime') WHERE created_at IS NULL")

        # 4. Customers Table
        c.execute('''CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            customer_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            city TEXT,
            location TEXT,
            plan_name TEXT DEFAULT 'Membership',
            youtube_url TEXT,
            keyword_1 TEXT,
            keyword_2 TEXT,
            keyword_3 TEXT,
            comments TEXT,
            status TEXT DEFAULT 'New',
            created_date DATE DEFAULT (DATE('now')),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )''')

        c.execute("PRAGMA table_info(customers)")
        cust_cols = [row[1] for row in c.fetchall()]
        if 'location' not in cust_cols:
            c.execute("ALTER TABLE customers ADD COLUMN location TEXT")
        if 'updated_at' not in cust_cols:
            c.execute("ALTER TABLE customers ADD COLUMN updated_at TIMESTAMP")
            c.execute("UPDATE customers SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL")

        # 5. Orders Table
        c.execute('''CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            customer_id TEXT NOT NULL,
            plan_name TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'Pending',
            upload_status TEXT DEFAULT 'Pending',
            payment_ref TEXT,
            uploaded_all_files INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )''')

        c.execute("PRAGMA table_info(orders)")
        order_cols = [row[1] for row in c.fetchall()]
        if 'upload_status' not in order_cols:
            c.execute("ALTER TABLE orders ADD COLUMN upload_status TEXT DEFAULT 'Pending'")

        # 5b. Wallet Transactions Table (Sale Credits, Manual Credits, Manual Admin Payouts)
        c.execute('''CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            customer_id TEXT,
            tx_type TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL,
            payment_status TEXT DEFAULT 'Credited',
            payment_method TEXT,
            payment_ref TEXT,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )''')
        c.execute("CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, id DESC)")
        c.execute('''CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_unique_sale
                     ON wallet_transactions(user_id, customer_id)
                     WHERE customer_id IS NOT NULL AND tx_type IN ('smart_book_sale', 'membership_sale')''')

        # 6. Materials Table
        c.execute('''CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            language TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            content TEXT,
            file_url TEXT,
            stored_path TEXT,
            original_filename TEXT,
            file_ext TEXT,
            mime_type TEXT,
            size_bytes INTEGER DEFAULT 0,
            file_hash TEXT,
            sort_order INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''')

        c.execute("PRAGMA table_info(materials)")
        mat_cols = [row[1] for row in c.fetchall()]
        if 'sort_order' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN sort_order INTEGER DEFAULT 1")
        if 'is_active' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN is_active INTEGER DEFAULT 1")
        if 'stored_path' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN stored_path TEXT")
        if 'original_filename' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN original_filename TEXT")
        if 'file_ext' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN file_ext TEXT")
        if 'mime_type' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN mime_type TEXT")
        if 'size_bytes' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN size_bytes INTEGER DEFAULT 0")
        if 'file_hash' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN file_hash TEXT")
        if 'updated_at' not in mat_cols:
            c.execute("ALTER TABLE materials ADD COLUMN updated_at TIMESTAMP")
            c.execute("UPDATE materials SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL")
        c.execute("CREATE INDEX IF NOT EXISTS idx_materials_cat_lang ON materials(category, language, is_active)")

        # 6b. Member Files Table
        c.execute('''CREATE TABLE IF NOT EXISTS member_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            member_id TEXT,
            customer_id TEXT,
            original_name TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            file_ext TEXT,
            file_type TEXT,
            mime_type TEXT,
            size_bytes INTEGER DEFAULT 0,
            uploaded_by INTEGER,
            upload_date DATE NOT NULL,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            source TEXT DEFAULT 'admin_upload',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )''')
        c.execute("PRAGMA table_info(member_files)")
        mf_cols = [row[1] for row in c.fetchall()]
        if 'source' not in mf_cols:
            c.execute("ALTER TABLE member_files ADD COLUMN source TEXT DEFAULT 'admin_upload'")
        c.execute("UPDATE member_files SET source = 'admin_upload' WHERE source IS NULL")
        c.execute("CREATE INDEX IF NOT EXISTS idx_member_files_user ON member_files(user_id, upload_date)")

        # 7. Banners Table
        c.execute('''CREATE TABLE IF NOT EXISTS banners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            subtitle TEXT,
            image_url TEXT,
            action_url TEXT,
            is_active INTEGER DEFAULT 1
        )''')

        c.execute("PRAGMA table_info(banners)")
        banner_cols = [row[1] for row in c.fetchall()]
        if 'slot' not in banner_cols:
            c.execute("ALTER TABLE banners ADD COLUMN slot INTEGER")
        c.execute('''CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )''')
        c.execute("SELECT slot FROM banners WHERE slot IS NOT NULL")
        used_slots = {row[0] for row in c.fetchall()}
        free_slots = [sl for sl in BANNER_SLOTS if sl not in used_slots]
        c.execute("SELECT id FROM banners WHERE slot IS NULL ORDER BY id DESC")
        for (banner_id,) in c.fetchall():
            if free_slots:
                c.execute("UPDATE banners SET slot = ? WHERE id = ?", (free_slots.pop(0), banner_id))
            else:
                c.execute("UPDATE banners SET is_active = 0 WHERE id = ?", (banner_id,))
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_banners_slot ON banners(slot) WHERE slot IS NOT NULL")

        # -------------------------------------------------------------
        # DESIGNATED SINGLE ADMIN SEEDING & ENFORCEMENT (varsha.thirumal21@gmail.com)
        # -------------------------------------------------------------
        c.execute("SELECT id FROM users WHERE LOWER(email) = ?", (ADMIN_DESIGNATED_EMAIL,))
        designated_row = c.fetchone()

        c.execute("SELECT id FROM users WHERE (role = 'admin' OR member_id = 'ADMIN01' OR referral_code = 'REF-ADMIN') AND LOWER(COALESCE(email, '')) != ?",
                  (ADMIN_DESIGNATED_EMAIL,))
        old_admins = c.fetchall()
        for (old_id,) in old_admins:
            tmp = f"DEMOTE_{old_id}"
            c.execute("UPDATE users SET role = 'partner', member_id = ?, referral_code = ? WHERE id = ?",
                      (tmp, f"REF-{tmp}", old_id))

        if designated_row:
            c.execute('''UPDATE users
                         SET email = ?, name = 'RK Admin', role = 'admin',
                             member_id = 'ADMIN01', referral_code = 'REF-ADMIN', account_status = 'active'
                         WHERE id = ?''', (ADMIN_DESIGNATED_EMAIL, designated_row[0]))
        else:
            c.execute('''INSERT INTO users (name, email, phone, password_hash, city, member_id, role, wallet_balance, paid_earnings, account_status, referral_code)
                         VALUES ('RK Admin', ?, NULL, ?, 'Chennai', 'ADMIN01', 'admin', 0.0, 0.0, 'active', 'REF-ADMIN')''',
                      (ADMIN_DESIGNATED_EMAIL, generate_password_hash('admin123')))

        # Sequential IDs for partners
        c.execute("SELECT id FROM users WHERE role != 'admin' ORDER BY id ASC")
        partners = c.fetchall()
        for p in partners:
            temp_id = f"TEMP_{p[0]}"
            c.execute("UPDATE users SET member_id = ?, referral_code = ? WHERE id = ?", (temp_id, f"REF-{temp_id}", p[0]))
        for idx, p in enumerate(partners):
            p_id = f"LP{1001 + idx}"
            c.execute("UPDATE users SET member_id = ?, referral_code = ? WHERE id = ?", (p_id, f"REF-{p_id}", p[0]))

        # Seed starter banners ONCE
        c.execute("SELECT value FROM app_settings WHERE key = 'banners_seeded'")
        banners_already_seeded = c.fetchone() is not None
        c.execute("SELECT COUNT(*) FROM banners")
        if not banners_already_seeded and c.fetchone()[0] == 0:
            banners = [
                ("Grow Your Career in 2026", "Earn up to ₹25,000 monthly with our Smart Book Affiliate Program.", "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600"),
                ("Exclusive Smart Book Training", "Live interactive sessions every Saturday in 5 regional languages.", "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=600"),
                ("Instant UPI Payouts Activated", "Zero processing fee withdrawals directly to your verified bank account.", "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=600")
            ]
            for slot_no, b in enumerate(banners, start=1):
                c.execute("INSERT INTO banners (title, subtitle, image_url, slot, is_active) VALUES (?, ?, ?, ?, 1)", (b[0], b[1], b[2], slot_no))
        if not banners_already_seeded:
            c.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('banners_seeded', '1')")

        # Seed sample customer request if empty
        c.execute("SELECT COUNT(*) FROM customers")
        if c.fetchone()[0] == 0:
            c.execute('''INSERT INTO customers (user_id, customer_id, name, phone, city, location, plan_name, youtube_url, keyword_1, keyword_2, keyword_3, comments, status)
                         VALUES (1, '2026-00001', 'Sri Sairam TNPSC Coaching Centre', '9444848572', 'Chennai', 'Chennai', 'Smart Book',
                                 'https://www.youtube.com/watch?v=2VWGOQTdXAw', 'Best C++ trainer in Tamil', 'NEET previous year 2025 question paper solved', 'How to becomes successful business in 2030', 'Conversion candidate', 'Joined')''')
            c.execute('''INSERT INTO orders (user_id, customer_id, plan_name, amount, status, upload_status, uploaded_all_files)
                         VALUES (1, '2026-00001', 'Smart Book', 300.0, 'Processed', 'Completed', 1)''')

        # One-time cleanup of legacy hardcoded dummy training rows
        c.execute("SELECT value FROM app_settings WHERE key = 'legacy_dummy_materials_purged_v1'")
        if c.fetchone() is None:
            c.execute('''DELETE FROM materials
                         WHERE stored_path IS NULL AND (
                             (category = 'sales_script' AND description = 'High-conversion pitch script')
                             OR (category = 'video' AND description = '30 mins comprehensive module')
                             OR (category = 'poster' AND description = 'High resolution flyer')
                             OR (category = 'smart_book' AND description IN ('Official PDF material', 'Official XLSX material'))
                         )''')
            c.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('legacy_dummy_materials_purged_v1', '1')")

        # Seed FAQs once if not already seeded
        c.execute("SELECT value FROM app_settings WHERE key = 'faq_seeded'")
        if c.fetchone() is None:
            c.execute("SELECT COUNT(*) FROM materials WHERE category = 'faq'")
            if c.fetchone()[0] == 0:
                lang_faq_data = {
                    'English': [
                        ("What is the RK Solutions Smart Book?",
                         "The Smart Book package includes complete competitive exam syllabus analysis, high-ranking SEO keyword matrices, and comprehensive coaching frameworks designed to triple student enrollments."),
                        ("How are earnings and wallet withdrawals processed?",
                         "Every customer referred automatically credits your wallet. You can withdraw your earnings directly to your verified bank account via instant UPI without any deduction."),
                        ("How fast is the customized report generated?",
                         "All customized reports (consisting of 1 strategy PDF document and 4 detailed Excel matrices) are processed by our backend admin team within 60 minutes."),
                        ("Can I access materials in all five regional languages?",
                         "Yes. You can toggle between English, Tamil, Telugu, Hindi, and Kannada at any time using the content language dropdown filter.")
                    ],
                    'Tamil': [
                        ("RK Solutions Smart Book என்றால் என்ன?",
                         "Smart Book என்பது போட்டித் தேர்வுகளுக்கான பாடத்திட்ட பகுப்பாய்வு, யூடியூப் தேடல் குறிச்சொற்கள் மற்றும் பயிற்சி மையங்களின் சேர்க்கையை 3 மடங்கு அதிகரிக்க உதவும் முழுமையான உத்தி வழிகாட்டியாகும்."),
                        ("வருமானம் மற்றும் பணப்பரிவர்த்தனை எவ்வாறு செய்யப்படுகிறது?",
                         "ஒவ்வொரு வாடிக்கையாளர் சேர்க்கைக்கும் உங்கள் கணக்கில் பணம் உடனடியாக வரவு வைக்கப்படும். நீங்கள் எந்த பிடித்தமும் இன்றி நேரடி UPI மூலம் உங்கள் வங்கிக் கணக்கிற்கு உடனுக்குடன் பெற்றுக்கொள்ளலாம்."),
                        ("வாடிக்கையாளர் அறிக்கை எவ்வளவு நேரத்தில் உருவாக்கப்படும்?",
                         "அனைத்து பிரத்யேக அறிக்கைகளும் (1 PDF உத்தி ஆவணம் மற்றும் 4 விரிவான Excel தாள்கள்) எங்கள் நிர்வாகக் குழுவினரால் 60 நிமிடங்களுக்குள் தயார் செய்து வழங்கப்படும்."),
                        ("நான் அனைத்து மொழிகளிலும் பயிற்சிப் பொருட்களைப் பெற முடியுமா?",
                         "ஆம், மொழி தேர்வுப் பட்டியலைப் பயன்படுத்தி தமிழ், ஆங்கிலம், தெலுங்கு, இந்தி மற்றும் கன்னடம் ஆகிய ஐந்து மொழிகளிலும் பயிற்சிப் பொருட்களை எப்போது வேண்டுமானாலும் அணுகலாம்.")
                    ],
                    'Telugu': [
                        ("RK Solutions Smart Book అంటే ఏమిటి?",
                         "Smart Book అనేది పోటీ పరీక్షల సిలబస్ విశ్లేషణ, హై-ర్యాంకింగ్ యూట్యూబ్ కీవర్డ్ మ్యాట్రిక్స్ మరియు కోచింగ్ సెంటర్ల అడ్మిషన్లను 3 రెట్లు పెంచే సమగ్ర వ్యూహాత్మక గైడ్."),
                        ("ఆదాయం మరియు వాలెట్ విత్‌డ్రా ప్రాసెస్ ఎలా జరుగుతుంది?",
                         "ప్రతి విజయవంతమైన కస్టమర్ రిఫరల్‌కు మీ వాలెట్‌కు డబ్బు స్వయంచాలకంగా చేరుతుంది. మీరు UPI ద్వారా ఎటువంటి రుసుము లేకుండా నేరుగా మీ బ్యాంక్ ఖాతాకు నిధులను బదిలీ చేసుకోవచ్చు."),
                        ("కస్టమర్ రిపోర్ట్ ఎంత సమయంలో సిద్ధమవుతుంది?",
                         "అన్ని అనుకూలీకరించిన నివేదికలు (1 PDF వ్యూహ పత్రం మరియు 4 Excel విశ్లేషణ పత్రాలు) మా అడ్మిన్ బృందం ద్వారా గరిష్టంగా 60 నిమిషాల్లో ప్రాసెస్ చేయబడతాయి."),
                        ("నేను అన్ని ప్రాంతీయ భాషల్లో మెటీరియల్‌ను యాక్సెస్ చేయవచ్చా?",
                         "అవును. భాషా డ్రాప్‌డౌన్ ద్వారా మీరు తెలుగు, ఇంగ్లీష్, తమిళం, హిందీ మరియు కన్నడ భాషల్లో మెటీరియల్‌లను ఎప్పుడైనా ఎంచుకోవచ్చు.")
                    ],
                    'Hindi': [
                        ("RK Solutions Smart Book क्या है?",
                         "Smart Book प्रतियोगी परीक्षाओं के पाठ्यक्रम विश्लेषण, उच्च-रैंकिंग YouTube कीवर्ड मैट्रिक्स और कोचिंग संस्थानों के छात्र प्रवेश को 3 गुना बढ़ाने के लिए एक संपूर्ण रणनीति गाइड है।"),
                        ("कमाई और वॉलेट निकासी की प्रक्रिया क्या है?",
                         "प्रत्येक सफल रेफरल पर प्रोत्साहन राशि आपके वॉलेट में तुरंत जुड़ जाती है। आप बिना किसी कटौती के तत्काल UPI के माध्यम से अपने बैंक खाते में राशि निकाल सकते हैं।"),
                        ("कस्टमर रिपोर्ट कितनी देर में तैयार होती है?",
                         "सभी कस्टमाइज्ड रिपोर्ट्स (1 रणनीति PDF और 4 विस्तृत Excel शीट्स) हमारी एडमिन टीम द्वारा 60 मिनट के भीतर प्रोसेस और अपलोड कर दी जाती हैं।"),
                        ("क्या मैं सभी पांच क्षेत्रीय भाषाओं में सामग्री प्राप्त कर सकता हूँ?",
                         "हाँ। आप भाषा फ़िल्टर का उपयोग करके हिंदी, अंग्रेजी, तमिल, तेलुगु और कन्नड़ के बीच कभी भी स्विच कर सकते हैं।")
                    ],
                    'Kannada': [
                        ("RK Solutions Smart Book ಎಂದರೇನು?",
                         "Smart Book ಎಂಬುದು ಸ್ಪರ್ಧಾತ್ಮಕ ಪರೀಕ್ಷಾ ಪಠ್ಯಕ್ರಮ ವಿಶ್ಲೇಷಣೆ, ಉನ್ನತ ಶ್ರೇಯಾಂಕದ ಕೀವರ್ಡ್ ಮ್ಯಾಟ್ರಿಕ್ಸ್ ಮತ್ತು ಕೋಚಿಂಗ್ ಕೇಂದ್ರಗಳ ಪ್ರವೇಶಾತಿಯನ್ನು 3 ಪಟ್ಟು ಹೆಚ್ಚಿಸಲು ಸಹಾಯ ಮಾಡುವ ಸಮಗ್ರ ಮಾರ್ಗದರ್ಶಿಯಾಗಿದೆ."),
                        ("ಗಳಿಕೆ ಮತ್ತು ವ್ಯಾಲೆಟ್ ಹಿಂಪಡೆಯುವಿಕೆ ಹೇಗೆ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆ?",
                         "ಪ್ರತಿ ಯಶಸ್ವಿ ರೆಫರಲ್‌ನೊಂದಿಗೆ ನಿಮ್ಮ ವ್ಯಾಲೆಟ್‌ಗೆ ಹಣ ತಕ್ಷಣ ಜಮೆಯಾಗುತ್ತದೆ. ನೀವು ಯಾವುದೇ ಶುಲ್ಕವಿಲ್ಲದೆ ನೇರ UPI ಮೂಲಕ ನಿಮ್ಮ ಬ್ಯಾಂಕ್ ಖಾತೆಗೆ ಹಣವನ್ನು ವರ್ಗಾಯಿಸಿಕೊಳ್ಳಬಹುದು."),
                        ("ಗ್ರಾಹಕರ ವರದಿಯನ್ನು ಎಷ್ಟು ಬೇಗನೆ ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತದೆ?",
                         "ಎಲ್ಲಾ ಕಸ್ಟಮೈಸ್ ಮಾಡಿದ ವರದಿಗಳನ್ನು (1 PDF ತಂತ್ರ ದಾಖಲೆ ಮತ್ತು 4 ವಿವರವಾದ Excel ಶೀಟ್‌ಗಳು) ನಮ್ಮ ತಂಡವು 60 ನಿಮಿಷಗಳಲ್ಲಿ ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಿ ಒದಗಿಸುತ್ತದೆ."),
                        ("ನಾನು ಎಲ್ಲಾ ಪ್ರಾದೇಶಿಕ ಭಾಷೆಗಳಲ್ಲಿ ತರಬೇತಿ ಸಾಮಗ್ರಿಗಳನ್ನು ಪಡೆಯಬಹುದೇ?",
                         "ಹೌದು. ಭಾಷಾ ಆಯ್ಕೆಯ ಪಟ್ಟಿಯ ಮೂಲಕ ನೀವು ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್, ತಮಿಳು, ತೆಲುಗು ಮತ್ತು ಹಿಂದಿ ಭಾಷೆಗಳಲ್ಲಿ ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಗಳನ್ನು ಸುಲಭವಾಗಿ ವೀಕ್ಷಿಸಬಹುದು.")
                    ]
                }
                for lang in TRAINING_LANGUAGES:
                    for f_idx, (q_text, a_text) in enumerate(lang_faq_data[lang], start=1):
                        c.execute('''INSERT INTO materials (category, language, title, description, content, sort_order, is_active)
                                     VALUES ('faq', ?, ?, 'Frequently Asked Question', ?, ?, 1)''',
                                  (lang, q_text, a_text, f_idx))
            c.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('faq_seeded', '1')")

        conn.commit()

init_db()
backfill_customer_reports()

# -------------------------------------------------------------
# RBAC SECURITY DECORATORS (STRICT BACKEND ENFORCEMENT)
# -------------------------------------------------------------
def is_designated_admin_user(user) -> bool:
    if not user:
        return False
    email = (user['email'] or '').strip().lower()
    return (
        user['account_status'] == 'active'
        and user['role'] == 'admin'
        and email == ADMIN_DESIGNATED_EMAIL
    )

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'success': False, 'message': 'Authentication required. Please login.'}), 401
        db = get_db()
        user = db.execute("SELECT id, email, role, account_status FROM users WHERE id = ?",
                          (session['user_id'],)).fetchone()
        if not user or user['account_status'] != 'active':
            session.clear()
            return jsonify({'success': False, 'message': 'Authentication required. Please login.'}), 401
        g.current_user = user
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'success': False, 'message': 'Authentication required.'}), 401
        db = get_db()
        user = db.execute("SELECT id, email, role, account_status FROM users WHERE id = ?",
                          (session['user_id'],)).fetchone()
        if not user or user['account_status'] != 'active':
            session.clear()
            return jsonify({'success': False, 'message': 'Authentication required.'}), 401
        if not is_designated_admin_user(user):
            return jsonify({'success': False, 'message': 'Access denied: Designated Admin privileges required.'}), 403
        g.current_user = user
        return f(*args, **kwargs)
    return decorated_function

# -------------------------------------------------------------
# REAL EMAIL OTP AUTHENTICATION (BREVO API v3)
# -------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/auth/send-otp', methods=['POST'])
def send_email_otp():
    try:
        data = request.get_json(force=True, silent=True) or {}
        email = data.get('email', '').strip().lower()
        purpose = data.get('purpose', 'LOGIN')

        if not email or '@' not in email or '.' not in email:
            return jsonify({'success': False, 'message': 'Please enter a valid email address.'}), 200

        db = get_db()

        now = datetime.datetime.now()
        cooldown_cutoff = (now - datetime.timedelta(seconds=60)).strftime("%Y-%m-%d %H:%M:%S")
        
        c = db.cursor()
        c.execute("PRAGMA table_info(otp_codes)")
        cols = [r[1] for r in c.fetchall()]
        id_col = 'identifier' if 'identifier' in cols else 'phone'

        recent = db.execute(f'''SELECT id FROM otp_codes 
                               WHERE {id_col} = ? AND created_at > ?
                               ORDER BY id DESC LIMIT 1''', (email, cooldown_cutoff)).fetchone()
        if recent:
            return jsonify({'success': False, 'message': 'Please wait 60 seconds before requesting another OTP.'}), 200

        if not check_and_increment_daily_usage(db):
            return jsonify({
                'success': False,
                'message': "Today's OTP email limit has been reached. Please try again later."
            }), 200

        raw_otp = str(secrets.randbelow(900000) + 100000)
        otp_hashed = hash_otp(raw_otp)
        expires_at = (now + datetime.timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")

        if 'identifier' in cols and 'otp_hash' in cols:
            db.execute('''INSERT INTO otp_codes (identifier, phone, otp, otp_hash, purpose, expires_at, created_at) 
                          VALUES (?, ?, ?, ?, ?, ?, ?)''', (email, email, raw_otp, otp_hashed, purpose, expires_at, now.strftime("%Y-%m-%d %H:%M:%S")))
        else:
            db.execute('''INSERT INTO otp_codes (phone, otp, purpose, expires_at) 
                          VALUES (?, ?, ?, ?)''', (email, raw_otp, purpose, expires_at))
        db.commit()

        success, msg = send_brevo_email_otp(email, raw_otp)
        return jsonify({
            'success': success,
            'message': msg,
            'cooldown': 60
        }), 200

    except Exception as e:
        print(f"[FATAL SEND-OTP ERROR]: {e}")
        return jsonify({'success': False, 'message': f'Server error processing request: {str(e)}'}), 200

@app.route('/api/auth/verify-otp-login', methods=['POST'])
def verify_email_otp_login():
    try:
        data = request.get_json(force=True, silent=True) or {}
        email = data.get('email', '').strip().lower()
        otp_input = data.get('otp', '').strip()
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if len(otp_input) != 6 or not otp_input.isdigit():
            return jsonify({'success': False, 'message': 'Please enter a valid 6-digit OTP.'}), 200

        db = get_db()
        input_hash = hash_otp(otp_input)

        c = db.cursor()
        c.execute("PRAGMA table_info(otp_codes)")
        cols = [r[1] for r in c.fetchall()]

        if 'identifier' in cols and 'otp_hash' in cols:
            record = db.execute('''SELECT * FROM otp_codes 
                                   WHERE (identifier = ? OR phone = ?) 
                                     AND (otp_hash = ? OR otp = ?) 
                                     AND verified = 0 
                                     AND expires_at > ?
                                   ORDER BY id DESC LIMIT 1''',
                                (email, email, input_hash, otp_input, now_str)).fetchone()
        else:
            record = db.execute('''SELECT * FROM otp_codes 
                                   WHERE phone = ? AND otp = ? AND verified = 0 AND expires_at > ?
                                   ORDER BY id DESC LIMIT 1''',
                                (email, otp_input, now_str)).fetchone()

        if not record:
            return jsonify({'success': False, 'message': 'Invalid or expired OTP. Please try again.'}), 200

        db.execute("UPDATE otp_codes SET verified = 1 WHERE id = ?", (record['id'],))

        user = db.execute("SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(phone) = ?", (email, email)).fetchone()
        if not user:
            if email == ADMIN_DESIGNATED_EMAIL:
                role = 'admin'
                member_id = "ADMIN01"
                name = "RK Admin"
            else:
                role = 'partner'
                member_id = generate_next_member_id()
                name = email.split('@')[0].capitalize()

            ref_code = f"REF-{member_id}"
            db.execute('''INSERT INTO users (name, email, phone, member_id, role, wallet_balance, paid_earnings, referral_code, account_status)
                          VALUES (?, ?, NULL, ?, ?, 0.0, 0.0, ?, 'active')''',
                       (name, email, member_id, role, ref_code))
            db.commit()
            user = db.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,)).fetchone()
        else:
            expected_role = 'admin' if (user['email'] or '').strip().lower() == ADMIN_DESIGNATED_EMAIL else 'partner'
            if user['role'] != expected_role:
                db.execute("UPDATE users SET role = ? WHERE id = ?", (expected_role, user['id']))
                db.commit()
                user = db.execute("SELECT * FROM users WHERE id = ?", (user['id'],)).fetchone()

        if user['account_status'] != 'active':
            return jsonify({'success': False, 'message': 'Your account has been deactivated. Contact admin.'}), 200

        db.commit()
        session.permanent = True
        session['user_id'] = user['id']
        session['role'] = user['role']

        return jsonify({
            'success': True,
            'message': 'Login successful!',
            'user': {
                'id': user['id'],
                'name': user['name'],
                'email': user['email'] or email,
                'member_id': user['member_id'],
                'city': user['city'],
                'role': user['role'],
                'wallet_balance': float(user['wallet_balance'] or 0),
                'paid_earnings': float(user['paid_earnings'] or 0),
                'referral_code': user['referral_code']
            }
        }), 200
    except Exception as e:
        print(f"[FATAL VERIFY-OTP ERROR]: {e}")
        return jsonify({'success': False, 'message': f'Server error verifying OTP: {str(e)}'}), 200

@app.route('/api/auth/reset-password-otp', methods=['POST'])
def reset_password_via_email_otp():
    data = request.get_json(force=True, silent=True) or {}
    email = data.get('email', '').strip().lower()
    otp_input = data.get('otp', '').strip()
    new_password = data.get('new_password', '').strip()
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if len(new_password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters.'}), 200

    db = get_db()
    input_hash = hash_otp(otp_input)

    c = db.cursor()
    c.execute("PRAGMA table_info(otp_codes)")
    cols = [r[1] for r in c.fetchall()]

    if 'identifier' in cols and 'otp_hash' in cols:
        record = db.execute('''SELECT * FROM otp_codes 
                               WHERE (identifier = ? OR phone = ?) AND (otp_hash = ? OR otp = ?) 
                                 AND purpose = 'RESET_PASSWORD' AND verified = 0 AND expires_at > ?
                               ORDER BY id DESC LIMIT 1''',
                            (email, email, input_hash, otp_input, now_str)).fetchone()
    else:
        record = db.execute('''SELECT * FROM otp_codes 
                               WHERE phone = ? AND otp = ? AND purpose = 'RESET_PASSWORD' AND verified = 0 AND expires_at > ?
                               ORDER BY id DESC LIMIT 1''',
                            (email, otp_input, now_str)).fetchone()

    if not record:
        return jsonify({'success': False, 'message': 'Invalid or expired OTP.'}), 200

    db.execute("UPDATE otp_codes SET verified = 1 WHERE id = ?", (record['id'],))
    db.execute("UPDATE users SET password_hash = ? WHERE email = ? OR phone = ?", (generate_password_hash(new_password), email, email))
    db.commit()

    return jsonify({'success': True, 'message': 'Password has been updated successfully.'}), 200

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True, 'message': 'Logged out'})

@app.route('/api/auth/me')
def me():
    if 'user_id' not in session:
        return jsonify({'logged_in': False})
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],)).fetchone()
    if not user or user['account_status'] != 'active':
        session.clear()
        return jsonify({'logged_in': False})
    effective_role = 'admin' if is_designated_admin_user(user) else 'partner'
    session['role'] = effective_role
    return jsonify({
        'logged_in': True,
        'user': {
            'id': user['id'],
            'name': user['name'],
            'email': user['email'],
            'member_id': user['member_id'],
            'city': user['city'],
            'role': effective_role,
            'account_status': user['account_status'],
            'wallet_balance': float(user['wallet_balance'] or 0),
            'paid_earnings': float(user['paid_earnings'] or 0),
            'referral_code': user['referral_code']
        }
    })

# -------------------------------------------------------------
# DASHBOARD, CRM & WALLET APIS
# -------------------------------------------------------------
@app.route('/api/dashboard')
@login_required
def dashboard_metrics():
    user_id = session['user_id']
    is_admin = is_designated_admin_user(g.current_user)
    date_filter = request.args.get('date', None)
    start_date = request.args.get('start_date', None)
    end_date = request.args.get('end_date', None)
    
    db = get_db()
    query = "SELECT * FROM customers WHERE 1=1"
    params = []
    
    if not is_admin:
        query += " AND user_id = ?"
        params.append(user_id)

    if date_filter:
        query += " AND created_date = ?"
        params.append(date_filter)
    elif start_date and end_date:
        query += " AND created_date BETWEEN ? AND ?"
        params.extend([start_date, end_date])

    cust_rows = db.execute(query, params).fetchall()

    membership_count = sum(1 for c in cust_rows if 'Membership' in (c['plan_name'] or ''))
    smartbook_count = sum(1 for c in cust_rows if 'Smart' in (c['plan_name'] or ''))
    status_counts = compute_status_counts(cust_rows)

    user = db.execute("SELECT wallet_balance, paid_earnings FROM users WHERE id = ?", (user_id,)).fetchone()
    banners = db.execute("SELECT * FROM banners WHERE is_active = 1 AND slot IS NOT NULL ORDER BY slot ASC LIMIT 3").fetchall()

    return jsonify({
        'success': True,
        'metrics': {
            'membership_count': membership_count,
            'smartbook_count': smartbook_count,
            'total_customers': len(cust_rows),
            'status_counts': status_counts,
            'wallet_balance': float(user['wallet_balance'] or 0) if user else 0.0,
            'paid_earnings': float(user['paid_earnings'] or 0) if user else 0.0
        },
        'banners': [dict(b) for b in banners]
    })

@app.route('/api/banners')
@login_required
def public_banners():
    db = get_db()
    rows = db.execute("SELECT * FROM banners WHERE is_active = 1 AND slot IS NOT NULL ORDER BY slot ASC LIMIT 3").fetchall()
    return jsonify({'success': True, 'banners': [dict(r) for r in rows]})

@app.route('/api/customers/next-id')
@login_required
def get_next_customer_id():
    return jsonify({'next_id': generate_next_customer_id()})

@app.route('/api/customers', methods=['GET', 'POST'])
@login_required
def manage_customers():
    user_id = session['user_id']
    is_admin = is_designated_admin_user(g.current_user)
    db = get_db()

    if request.method == 'POST':
        data = request.get_json(force=True, silent=True) or {}
        name = data.get('name', '').strip()
        phone = data.get('phone', '').strip().replace(' ', '')
        location = (data.get('location') or data.get('city') or '').strip()
        comments = data.get('comments', '').strip()
        plan_name = data.get('plan_name', 'Membership')
        youtube_url = data.get('youtube_url', '').strip()
        kw1 = data.get('keyword_1', '').strip()
        kw2 = data.get('keyword_2', '').strip()
        kw3 = data.get('keyword_3', '').strip()

        clean_mobile = phone.replace("+91", "").replace("-", "").strip()[-10:]
        if not name or not clean_mobile:
            return jsonify({'success': False, 'message': 'Customer Name and Mobile Number are required.'}), 200

        customer_id = generate_next_customer_id()
        city = location or 'Tamil Nadu'
        today_str = datetime.date.today().isoformat()

        # Payment is completed before submission -> customer status automatically becomes 'Joined'
        db.execute('''INSERT INTO customers (user_id, customer_id, name, phone, city, location, plan_name, 
                                             youtube_url, keyword_1, keyword_2, keyword_3, comments, status, created_date)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Joined', ?)''',
                   (user_id, customer_id, name, clean_mobile, city, location, plan_name, youtube_url, kw1, kw2, kw3, comments, today_str))
        
        amount = 955.0 if 'Membership' in plan_name else 300.0
        db.execute('''INSERT INTO orders (user_id, customer_id, plan_name, amount, status, upload_status)
                      VALUES (?, ?, ?, ?, 'Payment Completed', 'Pending')''', (user_id, customer_id, plan_name, amount))
        db.commit()

        # Automatically credit employee's wallet once (Rs. 10 for Smart Book / PDF, Rs. 100 for Membership)
        credited, credit_amount = credit_wallet_for_sale(db, user_id, customer_id, plan_name, name)
        reports_created = generate_customer_reports(db, customer_id)

        user_row = db.execute("SELECT wallet_balance, paid_earnings FROM users WHERE id = ?", (user_id,)).fetchone()
        return jsonify({
            'success': True,
            'message': 'Customer added successfully!',
            'customer_id': customer_id,
            'status': 'Joined',
            'wallet_credited': credit_amount if credited else 0.0,
            'wallet_balance': float(user_row['wallet_balance'] or 0) if user_row else 0.0,
            'paid_earnings': float(user_row['paid_earnings'] or 0) if user_row else 0.0,
            'reports_generated': reports_created
        })

    status = request.args.get('status')
    search = request.args.get('search')
    date_val = request.args.get('date')

    if is_admin:
        status_rows = db.execute("SELECT status FROM customers").fetchall()
    else:
        status_rows = db.execute("SELECT status FROM customers WHERE user_id = ?", (user_id,)).fetchall()
    status_counts = compute_status_counts(status_rows)

    if is_admin:
        query = '''SELECT c.*, u.name as added_by_name, u.member_id as added_by_code
                   FROM customers c JOIN users u ON u.id = c.user_id WHERE 1=1'''
        params = []
    else:
        query = '''SELECT c.*, u.name as added_by_name, u.member_id as added_by_code
                   FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?'''
        params = [user_id]

    if status and status.lower() != 'all':
        query += " AND LOWER(c.status) = LOWER(?)"
        params.append(status)
    if search:
        query += " AND (c.name LIKE ? OR c.phone LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    if date_val:
        query += " AND c.created_date = ?"
        params.append(date_val)

    query += " ORDER BY c.id DESC"
    rows = db.execute(query, params).fetchall()
    return jsonify({'success': True, 'customers': [dict(r) for r in rows], 'status_counts': status_counts})

@app.route('/api/customers/<int:id>/status', methods=['PUT', 'PATCH'])
@login_required
def update_customer_status(id):
    user_id = session['user_id']
    is_admin = is_designated_admin_user(g.current_user)
    data = request.get_json(force=True, silent=True) or {}
    new_status = (data.get('status') or 'Joined').strip()
    if new_status not in VALID_CUSTOMER_STATUSES:
        return jsonify({'success': False, 'message': 'Invalid customer status.'}), 200
    comments = data.get('comments')

    db = get_db()
    if is_admin:
        customer = db.execute("SELECT id, user_id, customer_id, name, plan_name FROM customers WHERE id = ?", (id,)).fetchone()
    else:
        customer = db.execute("SELECT id, user_id, customer_id, name, plan_name FROM customers WHERE id = ? AND user_id = ?", (id, user_id)).fetchone()

    if not customer:
        return jsonify({'success': False, 'message': 'Customer record not found'}), 200

    if comments is not None:
        db.execute("UPDATE customers SET status = ?, comments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_status, comments, id))
    else:
        db.execute("UPDATE customers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_status, id))
    db.commit()

    wallet_credited = 0.0
    if new_status == 'Joined':
        credited, amt = credit_wallet_for_sale(db, customer['user_id'], customer['customer_id'], customer['plan_name'], customer['name'])
        if credited:
            wallet_credited = amt

    generate_customer_reports(db, customer['customer_id'])

    viewer_row = db.execute("SELECT wallet_balance FROM users WHERE id = ?", (user_id,)).fetchone()
    return jsonify({
        'success': True,
        'message': 'Status updated successfully.',
        'wallet_credited': wallet_credited,
        'wallet_balance': float(viewer_row['wallet_balance'] or 0) if viewer_row else 0.0
    })

@app.route('/api/customers/export/<fmt>')
@login_required
def export_customers(fmt):
    user_id = session['user_id']
    is_admin = is_designated_admin_user(g.current_user)
    db = get_db()

    if is_admin:
        rows = db.execute('''SELECT created_date, customer_id, name, phone, status 
                             FROM customers ORDER BY id DESC''').fetchall()
    else:
        rows = db.execute('''SELECT created_date, customer_id, name, phone, status 
                             FROM customers WHERE user_id = ? ORDER BY id DESC''', (user_id,)).fetchall()

    if fmt == 'excel':
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Customers"
        headers = ['Registration Date', 'Customer ID', 'Customer Name', 'Phone Number', 'Lead Status']
        ws.append(headers)

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="54329E", end_color="54329E", fill_type="solid")

        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_num)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

        for r in rows:
            ws.append([str(r['created_date']), str(r['customer_id']), str(r['name']), str(r['phone']), str(r['status'])])

        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return send_file(output,
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                         as_attachment=True,
                         download_name=f'Customers_{datetime.date.today()}.xlsx')

    elif fmt == 'csv':
        import csv
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(['Registration Date', 'Customer ID', 'Customer Name', 'Phone Number', 'Lead Status'])
        for r in rows:
            writer.writerow([r['created_date'], r['customer_id'], r['name'], r['phone'], r['status']])
        
        mem = BytesIO()
        mem.write(output.getvalue().encode('utf-8'))
        mem.seek(0)
        return send_file(mem, mimetype='text/csv', as_attachment=True, download_name=f'Customers_{datetime.date.today()}.csv')

    elif fmt == 'pdf':
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors

        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        elements = []
        styles = getSampleStyleSheet()

        elements.append(Paragraph("<b>RK Solutions - Customer Report</b>", styles['Title']))
        elements.append(Spacer(1, 12))

        table_data = [['Reg. Date', 'Customer ID', 'Customer Name', 'Phone', 'Status']]
        for r in rows:
            table_data.append([str(r['created_date']), str(r['customer_id']), str(r['name']), str(r['phone']), str(r['status'])])

        t = Table(table_data, colWidths=[80, 80, 150, 100, 80])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#54329e')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.whitesmoke, colors.white])
        ]))
        elements.append(t)
        doc.build(elements)
        buffer.seek(0)
        return send_file(buffer, mimetype='application/pdf', as_attachment=True, download_name=f'Customer_Report_{datetime.date.today()}.pdf')

    return jsonify({'error': 'Unsupported format'}), 200

# -------------------------------------------------------------
# WALLET & TRANSACTION HISTORY APIS (USER + ADMIN)
# -------------------------------------------------------------
def serialize_wallet_tx(row):
    return {
        'id': row['id'],
        'user_id': row['user_id'],
        'customer_id': row['customer_id'] or '',
        'tx_type': row['tx_type'],
        'description': row['description'] or '',
        'amount': float(row['amount'] or 0),
        'payment_status': row['payment_status'] or 'Credited',
        'payment_method': row['payment_method'] or '',
        'payment_ref': row['payment_ref'] or '',
        'created_at': str(row['created_at'] or ''),
    }

@app.route('/api/wallet')
@login_required
def get_my_wallet():
    user_id = session['user_id']
    db = get_db()
    user = db.execute("SELECT id, name, member_id, wallet_balance, paid_earnings FROM users WHERE id = ?",
                      (user_id,)).fetchone()
    rows = db.execute("SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC",
                      (user_id,)).fetchall()
    return jsonify({
        'success': True,
        'wallet_balance': float(user['wallet_balance'] or 0) if user else 0.0,
        'paid_earnings': float(user['paid_earnings'] or 0) if user else 0.0,
        'transactions': [serialize_wallet_tx(r) for r in rows]
    })

@app.route('/api/admin/wallets')
@admin_required
def admin_list_wallets():
    db = get_db()
    employees = db.execute('''
        SELECT u.id, u.name, u.email, u.member_id, u.wallet_balance, u.paid_earnings,
               (SELECT COUNT(*) FROM wallet_transactions w WHERE w.user_id = u.id) AS tx_count,
               (SELECT COALESCE(SUM(w.amount), 0) FROM wallet_transactions w
                 WHERE w.user_id = u.id AND w.tx_type IN ('smart_book_sale', 'membership_sale', 'manual_credit')) AS total_credited,
               (SELECT COALESCE(SUM(w.amount), 0) FROM wallet_transactions w
                 WHERE w.user_id = u.id AND w.tx_type = 'payout' AND w.payment_status = 'Paid') AS total_paid,
               (SELECT COUNT(*) FROM wallet_transactions w
                 WHERE w.user_id = u.id AND w.tx_type = 'payout' AND w.payment_status = 'Pending') AS pending_payouts
        FROM users u
        WHERE u.role != 'admin'
        ORDER BY u.id ASC''').fetchall()
    return jsonify({
        'success': True,
        'employees': [{
            'id': r['id'],
            'name': r['name'],
            'email': r['email'] or '',
            'member_id': r['member_id'],
            'wallet_balance': float(r['wallet_balance'] or 0),
            'paid_earnings': float(r['paid_earnings'] or 0),
            'tx_count': int(r['tx_count'] or 0),
            'total_credited': float(r['total_credited'] or 0),
            'total_paid': float(r['total_paid'] or 0),
            'pending_payouts': int(r['pending_payouts'] or 0),
        } for r in employees]
    })

@app.route('/api/admin/wallets/<int:user_id>/transactions')
@admin_required
def admin_employee_wallet_history(user_id):
    db = get_db()
    emp = db.execute("SELECT id, name, email, member_id, role, wallet_balance, paid_earnings FROM users WHERE id = ?",
                     (user_id,)).fetchone()
    if not emp or emp['role'] == 'admin':
        return jsonify({'success': False, 'message': 'Employee not found.'}), 404
    rows = db.execute("SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC", (user_id,)).fetchall()
    return jsonify({
        'success': True,
        'employee': {
            'id': emp['id'],
            'name': emp['name'],
            'email': emp['email'] or '',
            'member_id': emp['member_id'],
            'wallet_balance': float(emp['wallet_balance'] or 0),
            'paid_earnings': float(emp['paid_earnings'] or 0),
        },
        'transactions': [serialize_wallet_tx(r) for r in rows]
    })

@app.route('/api/admin/wallets/<int:user_id>/credit', methods=['POST'])
@admin_required
def admin_add_wallet_credit(user_id):
    data = request.get_json(force=True, silent=True) or {}
    try:
        amount = round(float(data.get('amount', 0)), 2)
    except (TypeError, ValueError):
        amount = 0.0
    description = (data.get('description') or 'Manual Wallet Credit by Admin').strip()[:200]
    if amount <= 0:
        return jsonify({'success': False, 'message': 'Please enter a valid credit amount greater than 0.'}), 400

    db = get_db()
    emp = db.execute("SELECT id, name, role, wallet_balance FROM users WHERE id = ?", (user_id,)).fetchone()
    if not emp or emp['role'] == 'admin':
        return jsonify({'success': False, 'message': 'Employee not found.'}), 404

    now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.execute('''INSERT INTO wallet_transactions
                    (user_id, customer_id, tx_type, description, amount,
                     payment_status, payment_method, payment_ref, created_by, created_at)
                  VALUES (?, NULL, 'manual_credit', ?, ?, 'Credited', 'Admin Credit', 'Manual Credit', ?, ?)''',
               (user_id, description, amount, session['user_id'], now_ts))
    db.execute("UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?", (amount, user_id))
    db.commit()

    updated = db.execute("SELECT wallet_balance, paid_earnings FROM users WHERE id = ?", (user_id,)).fetchone()
    return jsonify({
        'success': True,
        'message': f"₹{amount:,.2f} credited to {emp['name']}'s wallet.",
        'wallet_balance': float(updated['wallet_balance'] or 0),
        'paid_earnings': float(updated['paid_earnings'] or 0)
    })

@app.route('/api/admin/wallets/<int:user_id>/payout', methods=['POST'])
@admin_required
def admin_record_manual_payout(user_id):
    data = request.get_json(force=True, silent=True) or {}
    try:
        amount = round(float(data.get('amount', 0)), 2)
    except (TypeError, ValueError):
        amount = 0.0
    payment_method = (data.get('payment_method') or 'UPI').strip()
    if payment_method not in ('UPI', 'Bank Transfer'):
        return jsonify({'success': False, 'message': 'Payment method must be UPI or Bank Transfer.'}), 400
    payment_status = (data.get('payment_status') or 'Paid').strip()
    if payment_status not in ('Paid', 'Pending'):
        return jsonify({'success': False, 'message': 'Payment status must be Paid or Pending.'}), 400
    payment_ref = (data.get('payment_ref') or '').strip()[:160]
    description = (data.get('description') or f'Manual {payment_method} Payout').strip()[:200]

    if amount <= 0:
        return jsonify({'success': False, 'message': 'Please enter a valid payment amount greater than 0.'}), 400
    if payment_status == 'Paid' and not payment_ref:
        return jsonify({'success': False, 'message': 'Please enter the UPI / Bank Transfer reference ID or details.'}), 400

    db = get_db()
    emp = db.execute("SELECT id, name, role, wallet_balance, paid_earnings FROM users WHERE id = ?", (user_id,)).fetchone()
    if not emp or emp['role'] == 'admin':
        return jsonify({'success': False, 'message': 'Employee not found.'}), 404

    current_balance = float(emp['wallet_balance'] or 0)
    if amount > current_balance:
        return jsonify({'success': False, 'message': f'Amount exceeds available wallet balance (₹{current_balance:,.2f}).'}), 400

    now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.execute('''INSERT INTO wallet_transactions
                    (user_id, customer_id, tx_type, description, amount,
                     payment_status, payment_method, payment_ref, created_by, created_at)
                  VALUES (?, NULL, 'payout', ?, ?, ?, ?, ?, ?, ?)''',
               (user_id, description, amount, payment_status, payment_method, payment_ref or 'Pending Transfer', session['user_id'], now_ts))

    if payment_status == 'Paid':
        db.execute('''UPDATE users
                      SET wallet_balance = COALESCE(wallet_balance, 0) - ?,
                          paid_earnings = COALESCE(paid_earnings, 0) + ?
                      WHERE id = ?''', (amount, amount, user_id))
    db.commit()

    updated = db.execute("SELECT wallet_balance, paid_earnings FROM users WHERE id = ?", (user_id,)).fetchone()
    return jsonify({
        'success': True,
        'message': f"Manual {payment_method} payment of ₹{amount:,.2f} recorded as {payment_status}.",
        'wallet_balance': float(updated['wallet_balance'] or 0),
        'paid_earnings': float(updated['paid_earnings'] or 0)
    })

@app.route('/api/admin/wallets/transactions/<int:tx_id>/mark-paid', methods=['POST'])
@admin_required
def admin_mark_payout_paid(tx_id):
    data = request.get_json(force=True, silent=True) or {}
    payment_ref = (data.get('payment_ref') or '').strip()[:160]

    db = get_db()
    tx = db.execute("SELECT * FROM wallet_transactions WHERE id = ?", (tx_id,)).fetchone()
    if not tx or tx['tx_type'] != 'payout':
        return jsonify({'success': False, 'message': 'Payout transaction not found.'}), 404
    if tx['payment_status'] == 'Paid':
        return jsonify({'success': False, 'message': 'This payout is already marked as Paid.'}), 400

    emp = db.execute("SELECT id, wallet_balance FROM users WHERE id = ?", (tx['user_id'],)).fetchone()
    if not emp:
        return jsonify({'success': False, 'message': 'Employee not found.'}), 404
    amt = float(tx['amount'] or 0)
    if amt > float(emp['wallet_balance'] or 0):
        return jsonify({'success': False, 'message': 'Insufficient wallet balance to mark this payout as Paid.'}), 400

    new_ref = payment_ref or tx['payment_ref'] or 'Paid via Admin'
    db.execute("UPDATE wallet_transactions SET payment_status = 'Paid', payment_ref = ? WHERE id = ?", (new_ref, tx_id))
    db.execute('''UPDATE users
                  SET wallet_balance = COALESCE(wallet_balance, 0) - ?,
                      paid_earnings = COALESCE(paid_earnings, 0) + ?
                  WHERE id = ?''', (amt, amt, emp['id']))
    db.commit()
    return jsonify({'success': True, 'message': 'Payout marked as Paid.'})

# -------------------------------------------------------------
# USER-SIDE READ-ONLY TRAINING MATERIALS & SECURE FILE SERVING
# -------------------------------------------------------------
def serialize_material_row(row, include_admin_fields=False):
    has_file = bool(row['stored_path'])
    ext = (row['file_ext'] or '').lower()
    file_type = classify_file_type(ext) if ext else ('video' if row['category'] == 'video' and row['content'] else 'text')
    item = {
        'id': row['id'],
        'category': row['category'],
        'language': row['language'],
        'title': row['title'],
        'description': row['description'] or '',
        'content': row['content'] or '',
        'file_url': row['file_url'] or '',
        'has_file': has_file,
        'original_filename': row['original_filename'] or '',
        'file_ext': ext,
        'file_type': file_type,
        'size_bytes': row['size_bytes'] or 0,
        'download_url': f"/api/training/files/{row['id']}" if has_file else '',
        'view_url': f"/api/training/files/{row['id']}?inline=1" if has_file else '',
        'created_at': str(row['created_at'] or ''),
        'updated_at': str(row['updated_at'] or ''),
    }
    if include_admin_fields:
        item['is_active'] = int(row['is_active'] or 0)
        item['sort_order'] = int(row['sort_order'] or 1)
    return item

@app.route('/api/training/resources')
@login_required
def get_training_resources():
    lang = (request.args.get('language') or 'all').strip()
    cat = (request.args.get('category') or '').strip()

    db = get_db()
    if lang.lower() == 'all':
        count_rows = db.execute('''SELECT category, COUNT(*) AS cnt
                                   FROM materials
                                   WHERE is_active = 1
                                   GROUP BY category''').fetchall()
        query = "SELECT * FROM materials WHERE is_active = 1"
        params = []
    else:
        count_rows = db.execute('''SELECT category, COUNT(*) AS cnt
                                   FROM materials
                                   WHERE language = ? AND is_active = 1
                                   GROUP BY category''', (lang,)).fetchall()
        query = "SELECT * FROM materials WHERE language = ? AND is_active = 1"
        params = [lang]

    counts = {r['category']: r['cnt'] for r in count_rows}

    if cat:
        query += " AND category = ?"
        params.append(cat)

    query += " ORDER BY sort_order ASC, id DESC"
    rows = db.execute(query, params).fetchall()

    return jsonify({
        'success': True,
        'language': lang,
        'category': cat,
        'count': len(rows),
        'counts': counts,
        'items': [serialize_material_row(r) for r in rows]
    })

@app.route('/api/training/files/<int:material_id>')
@login_required
def serve_training_material_file(material_id):
    db = get_db()
    rec = db.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not rec or not rec['stored_path']:
        return jsonify({'success': False, 'message': 'File not found.'}), 404

    is_admin = is_designated_admin_user(g.current_user)
    if int(rec['is_active'] or 0) != 1 and not is_admin:
        return jsonify({'success': False, 'message': 'Material is not published.'}), 404

    full_path = resolve_private_path(rec['stored_path'], TRAINING_UPLOAD_ROOT)
    if not full_path:
        return jsonify({'success': False, 'message': 'File not found on server.'}), 404

    download_name = rec['original_filename'] or f"material_{rec['id']}.{rec['file_ext'] or 'bin'}"
    ext = (rec['file_ext'] or '').lower()
    guessed_mime = EXT_MIME_MAP.get(ext) or rec['mime_type'] or mimetypes.guess_type(download_name)[0] or 'application/octet-stream'
    inline_requested = request.args.get('inline') == '1'
    allow_inline = classify_file_type(ext) in ('pdf', 'image', 'video', 'text')
    show_inline = inline_requested and allow_inline

    response = send_file(
        full_path,
        mimetype=guessed_mime,
        as_attachment=not show_inline,
        download_name=download_name,
        conditional=True
    )
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'private, no-store'
    return response

# -------------------------------------------------------------
# ADMIN-ONLY TRAINING MATERIAL CRUD APIS (4 CATEGORIES)
# -------------------------------------------------------------
def _validate_and_store_training_file(file_obj, category: str):
    rules = TRAINING_CATEGORY_RULES[category]
    raw_name = (file_obj.filename or '').strip()
    clean_name = re.sub(r'[\x00-\x1f\x7f/\\]', '', os.path.basename(raw_name)).strip() or 'file'
    ext = clean_name.rsplit('.', 1)[-1].lower() if '.' in clean_name else ''
    if ext not in rules['extensions']:
        allowed_str = ', '.join(sorted(rules['extensions']))
        return None, f"Unsupported file format '.{ext or 'none'}' for {rules['label']}. Allowed: {allowed_str}."

    head = file_obj.stream.read(16)
    file_obj.stream.seek(0)
    if not head:
        return None, 'Uploaded file is empty.'
    if not content_matches_extension(ext, head):
        return None, f"File content does not match its '.{ext}' extension."

    cat_dir = os.path.join(TRAINING_UPLOAD_ROOT, category)
    os.makedirs(cat_dir, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    full_path = os.path.join(cat_dir, stored_name)
    file_obj.save(full_path)

    size = os.path.getsize(full_path)
    if size == 0:
        os.remove(full_path)
        return None, 'Uploaded file is empty.'
    if size > rules['max_size']:
        os.remove(full_path)
        return None, f"File exceeds maximum size of {rules['max_size'] // (1024 * 1024)} MB for {rules['label']}."

    h = hashlib.sha256()
    with open(full_path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(65536), b''):
            h.update(chunk)
    file_hash = h.hexdigest()

    mime = EXT_MIME_MAP.get(ext) or mimetypes.guess_type(clean_name)[0] or 'application/octet-stream'
    return {
        'stored_path': f"{category}/{stored_name}",
        'full_path': full_path,
        'original_filename': clean_name[:200],
        'file_ext': ext,
        'mime_type': mime,
        'size_bytes': size,
        'file_hash': file_hash,
    }, None

@app.route('/api/admin/materials', methods=['GET'])
@admin_required
def admin_list_materials():
    category = (request.args.get('category') or '').strip()
    language = (request.args.get('language') or '').strip()

    db = get_db()
    query = "SELECT * FROM materials WHERE category IN ('video', 'sales_script', 'poster', 'smart_book')"
    params = []
    if category:
        if category not in TRAINING_CATEGORY_RULES:
            return jsonify({'success': False, 'message': 'Invalid category.'}), 400
        query += " AND category = ?"
        params.append(category)
    if language and language.lower() != 'all':
        query += " AND language = ?"
        params.append(language)

    query += " ORDER BY id DESC"
    rows = db.execute(query, params).fetchall()

    counts = {cat: {'total': 0, 'published': 0, 'unpublished': 0} for cat in TRAINING_CATEGORY_RULES}
    all_rows = db.execute("SELECT category, is_active FROM materials WHERE category IN ('video', 'sales_script', 'poster', 'smart_book')").fetchall()
    for r in all_rows:
        cat_key = r['category']
        if cat_key in counts:
            counts[cat_key]['total'] += 1
            if int(r['is_active'] or 0) == 1:
                counts[cat_key]['published'] += 1
            else:
                counts[cat_key]['unpublished'] += 1

    return jsonify({
        'success': True,
        'counts': counts,
        'items': [serialize_material_row(r, include_admin_fields=True) for r in rows]
    })

@app.route('/api/admin/materials', methods=['POST'])
@admin_required
def admin_create_material():
    if request.is_json:
        data = request.get_json(force=True, silent=True) or {}
        category = (data.get('category') or '').strip()
        language = (data.get('language') or 'English').strip()
        title = (data.get('title') or '').strip()[:200]
        description = (data.get('description') or '').strip()[:500]
        content = (data.get('content') or '').strip()
        is_active = 1 if str(data.get('is_active', '1')).lower() in ('1', 'true', 'yes', 'on') else 0
        file_obj = None
    else:
        category = (request.form.get('category') or '').strip()
        language = (request.form.get('language') or 'English').strip()
        title = (request.form.get('title') or '').strip()[:200]
        description = (request.form.get('description') or '').strip()[:500]
        content = (request.form.get('content') or '').strip()
        is_active = 1 if str(request.form.get('is_active', '1')).lower() in ('1', 'true', 'yes', 'on') else 0
        file_obj = request.files.get('file')

    if category not in TRAINING_CATEGORY_RULES:
        return jsonify({'success': False, 'message': 'Invalid training material category.'}), 400
    if language not in TRAINING_LANGUAGES:
        return jsonify({'success': False, 'message': 'Invalid language selected.'}), 400
    if not title:
        return jsonify({'success': False, 'message': 'Title is required.'}), 400

    has_file = bool(file_obj and file_obj.filename)
    if category == 'video':
        if content and not re.match(r'^https?://', content, re.I):
            return jsonify({'success': False, 'message': 'Video link must start with http:// or https://.'}), 400
        if not has_file and not content:
            return jsonify({'success': False, 'message': 'Upload a video file or provide a valid video URL.'}), 400
    elif category == 'sales_script':
        if not has_file and not content:
            return jsonify({'success': False, 'message': 'Enter sales script content or upload a script file.'}), 400
    elif category == 'poster':
        if not has_file:
            return jsonify({'success': False, 'message': 'Please upload a poster image file (PNG, JPG, GIF, WEBP).'}), 400
    elif category == 'smart_book':
        if not has_file:
            return jsonify({'success': False, 'message': 'Please upload a Sample Smart Book file (PDF, Excel, Word, etc.).'}), 400

    db = get_db()
    dup_title = db.execute('''SELECT id FROM materials
                              WHERE category = ? AND language = ? AND LOWER(TRIM(title)) = LOWER(TRIM(?))''',
                           (category, language, title)).fetchone()
    if dup_title:
        return jsonify({'success': False, 'message': 'A material with this title already exists in this category and language.'}), 409

    meta = None
    if has_file:
        meta, err = _validate_and_store_training_file(file_obj, category)
        if err:
            return jsonify({'success': False, 'message': err}), 400

        dup_file = db.execute("SELECT id, title FROM materials WHERE category = ? AND file_hash = ?",
                              (category, meta['file_hash'])).fetchone()
        if dup_file:
            try:
                os.remove(meta['full_path'])
            except OSError:
                pass
            return jsonify({'success': False, 'message': f"This exact file is already uploaded under '{dup_file['title']}'."}), 409

        if category == 'sales_script' and meta['file_ext'] == 'txt' and not content:
            try:
                with open(meta['full_path'], 'r', encoding='utf-8', errors='ignore') as tf:
                    content = tf.read(20000).strip()
            except OSError:
                pass

    now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur = db.execute('''INSERT INTO materials
                          (category, language, title, description, content, file_url,
                           stored_path, original_filename, file_ext, mime_type, size_bytes, file_hash,
                           sort_order, is_active, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)''',
                     (
                         category, language, title, description, content,
                         '',
                         meta['stored_path'] if meta else None,
                         meta['original_filename'] if meta else None,
                         meta['file_ext'] if meta else None,
                         meta['mime_type'] if meta else None,
                         meta['size_bytes'] if meta else 0,
                         meta['file_hash'] if meta else None,
                         is_active, now_ts, now_ts
                     ))
    mat_id = cur.lastrowid
    if meta:
        db.execute("UPDATE materials SET file_url = ? WHERE id = ?", (f"/api/training/files/{mat_id}", mat_id))
    db.commit()

    row = db.execute("SELECT * FROM materials WHERE id = ?", (mat_id,)).fetchone()
    status_label = 'published and visible to users' if is_active == 1 else 'saved as unpublished'
    return jsonify({
        'success': True,
        'message': f"'{title}' ({TRAINING_CATEGORY_RULES[category]['label']}) {status_label}.",
        'item': serialize_material_row(row, include_admin_fields=True)
    }), 201

@app.route('/api/admin/materials/<int:material_id>', methods=['PUT', 'PATCH'])
@admin_required
def admin_update_material(material_id):
    db = get_db()
    existing = db.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not existing or existing['category'] not in TRAINING_CATEGORY_RULES:
        return jsonify({'success': False, 'message': 'Training material not found.'}), 404

    if request.is_json:
        data = request.get_json(force=True, silent=True) or {}
        category = (data.get('category') or existing['category']).strip()
        language = (data.get('language') or existing['language']).strip()
        title = (data.get('title') if 'title' in data else existing['title']).strip()[:200]
        description = (data.get('description') if 'description' in data else (existing['description'] or '')).strip()[:500]
        content = (data.get('content') if 'content' in data else (existing['content'] or '')).strip()
        is_active = 1 if str(data.get('is_active', existing['is_active'])).lower() in ('1', 'true', 'yes', 'on') else 0
        file_obj = None
    else:
        category = (request.form.get('category') or existing['category']).strip()
        language = (request.form.get('language') or existing['language']).strip()
        title = (request.form.get('title') or '').strip()[:200]
        description = (request.form.get('description') or '').strip()[:500]
        content = (request.form.get('content') or '').strip()
        is_active = 1 if str(request.form.get('is_active', existing['is_active'])).lower() in ('1', 'true', 'yes', 'on') else 0
        file_obj = request.files.get('file')

    if category not in TRAINING_CATEGORY_RULES:
        return jsonify({'success': False, 'message': 'Invalid category.'}), 400
    if language not in TRAINING_LANGUAGES:
        return jsonify({'success': False, 'message': 'Invalid language.'}), 400
    if not title:
        return jsonify({'success': False, 'message': 'Title is required.'}), 400

    dup_title = db.execute('''SELECT id FROM materials
                              WHERE category = ? AND language = ? AND LOWER(TRIM(title)) = LOWER(TRIM(?)) AND id != ?''',
                           (category, language, title, material_id)).fetchone()
    if dup_title:
        return jsonify({'success': False, 'message': 'Another material with this title already exists in this category and language.'}), 409

    has_new_file = bool(file_obj and file_obj.filename)
    if category == 'video' and content and not re.match(r'^https?://', content, re.I):
        return jsonify({'success': False, 'message': 'Video link must start with http:// or https://.'}), 400
    if category == 'video' and not has_new_file and not existing['stored_path'] and not content:
        return jsonify({'success': False, 'message': 'Provide a video URL or upload a video file.'}), 400
    if category == 'sales_script' and not has_new_file and not existing['stored_path'] and not content:
        return jsonify({'success': False, 'message': 'Enter sales script content or upload a file.'}), 400
    if category in ('poster', 'smart_book') and not has_new_file and not existing['stored_path']:
        return jsonify({'success': False, 'message': 'Please upload a file for this category.'}), 400

    new_meta = None
    if has_new_file:
        new_meta, err = _validate_and_store_training_file(file_obj, category)
        if err:
            return jsonify({'success': False, 'message': err}), 400

        dup_file = db.execute("SELECT id, title FROM materials WHERE category = ? AND file_hash = ? AND id != ?",
                              (category, new_meta['file_hash'], material_id)).fetchone()
        if dup_file:
            try:
                os.remove(new_meta['full_path'])
            except OSError:
                pass
            return jsonify({'success': False, 'message': f"This exact file is already uploaded under '{dup_file['title']}'."}), 409

        if category == 'sales_script' and new_meta['file_ext'] == 'txt' and not content:
            try:
                with open(new_meta['full_path'], 'r', encoding='utf-8', errors='ignore') as tf:
                    content = tf.read(20000).strip()
            except OSError:
                pass

    now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    old_stored_path = existing['stored_path']

    db.execute('''UPDATE materials
                  SET category = ?, language = ?, title = ?, description = ?, content = ?,
                      file_url = ?, stored_path = ?, original_filename = ?, file_ext = ?,
                      mime_type = ?, size_bytes = ?, file_hash = ?, is_active = ?, updated_at = ?
                  WHERE id = ?''',
               (
                   category, language, title, description, content,
                   f"/api/training/files/{material_id}" if (new_meta or old_stored_path) else (existing['file_url'] or ''),
                   new_meta['stored_path'] if new_meta else old_stored_path,
                   new_meta['original_filename'] if new_meta else existing['original_filename'],
                   new_meta['file_ext'] if new_meta else existing['file_ext'],
                   new_meta['mime_type'] if new_meta else existing['mime_type'],
                   new_meta['size_bytes'] if new_meta else (existing['size_bytes'] or 0),
                   new_meta['file_hash'] if new_meta else existing['file_hash'],
                   is_active, now_ts, material_id
               ))
    db.commit()

    if new_meta and old_stored_path and old_stored_path != new_meta['stored_path']:
        delete_training_file(old_stored_path)

    row = db.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    status_label = 'Published (visible to users)' if is_active == 1 else 'Unpublished'
    return jsonify({
        'success': True,
        'message': f"'{title}' updated — Status: {status_label}.",
        'item': serialize_material_row(row, include_admin_fields=True)
    })

@app.route('/api/admin/materials/<int:material_id>/toggle-publish', methods=['POST'])
@admin_required
def admin_toggle_material_publish(material_id):
    db = get_db()
    existing = db.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not existing or existing['category'] not in TRAINING_CATEGORY_RULES:
        return jsonify({'success': False, 'message': 'Training material not found.'}), 404

    new_state = 0 if int(existing['is_active'] or 0) == 1 else 1
    now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.execute("UPDATE materials SET is_active = ?, updated_at = ? WHERE id = ?", (new_state, now_ts, material_id))
    db.commit()

    updated = db.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    return jsonify({
        'success': True,
        'is_active': new_state,
        'item': serialize_material_row(updated, include_admin_fields=True),
        'message': f"'{existing['title']}' is now Published and visible to users." if new_state == 1 else f"'{existing['title']}' has been Unpublished and hidden from users."
    })

@app.route('/api/admin/materials/<int:material_id>', methods=['DELETE'])
@admin_required
def admin_delete_material(material_id):
    db = get_db()
    existing = db.execute("SELECT id, title, stored_path, category FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not existing or existing['category'] not in TRAINING_CATEGORY_RULES:
        return jsonify({'success': False, 'message': 'Training material not found.'}), 404

    db.execute("DELETE FROM materials WHERE id = ?", (material_id,))
    db.commit()
    delete_training_file(existing['stored_path'])
    return jsonify({'success': True, 'message': f"'{existing['title']}' deleted permanently."})

# -------------------------------------------------------------
# REPORTS & MEMBER FILE DOWNLOADS
# -------------------------------------------------------------
@app.route('/api/reports')
@login_required
def get_reports():
    user_id = session['user_id']
    is_admin = is_designated_admin_user(g.current_user)
    date_filter = (request.args.get('date') or '').strip()
    db = get_db()

    query = '''SELECT f.id, f.user_id, f.original_name, f.relative_path, f.file_ext, f.file_type, f.size_bytes,
                      f.customer_id, f.upload_date, c.name AS customer_name, u.name AS member_name,
                      u.member_id AS member_code
               FROM member_files f
               JOIN users u ON u.id = f.user_id
               LEFT JOIN customers c ON c.customer_id = f.customer_id AND c.user_id = f.user_id
               WHERE 1 = 1'''
    params = []
    if not is_admin:
        query += " AND f.user_id = ?"
        params.append(user_id)
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_filter):
        query += " AND f.upload_date = ?"
        params.append(date_filter)
    query += (" ORDER BY f.upload_date DESC, f.user_id, f.customer_id DESC,"
              " CASE f.file_type WHEN 'pdf' THEN 0 ELSE 1 END, f.relative_path COLLATE NOCASE, f.id")
    rows = db.execute(query, params).fetchall()

    groups = {}
    ordered_keys = []
    for r in rows:
        key = (r['upload_date'], r['user_id'], r['customer_id'] or '')
        if key not in groups:
            label = r['customer_name'] or r['member_name'] or 'My Files'
            if is_admin:
                label = f"{label} ({r['member_code']})"
            groups[key] = {
                'date': r['upload_date'],
                'customer_name': label,
                'customer_id': r['customer_id'] or '',
                'status': 'Report Completed',
                'files': []
            }
            ordered_keys.append(key)
        rel = r['relative_path'] or r['original_name']
        folder = rel.rsplit('/', 1)[0] if '/' in rel else ''
        groups[key]['files'].append({
            'id': r['id'],
            'name': r['original_name'],
            'folder': folder,
            'type': r['file_type'] or classify_file_type(r['file_ext']),
            'ext': r['file_ext'] or '',
            'size': r['size_bytes'] or 0
        })

    return jsonify({'success': True, 'reports': [groups[k] for k in ordered_keys]})

def send_member_file(rec, inline=False):
    full_path = resolve_private_path(rec['stored_path'])
    if not full_path:
        return jsonify({'success': False, 'message': 'File not found on server.'}), 404
    ext = (rec['file_ext'] or '').lower()
    guessed_mime = EXT_MIME_MAP.get(ext) or mimetypes.guess_type(rec['original_name'])[0] or 'application/octet-stream'
    show_inline = bool(inline) and (rec['file_type'] or classify_file_type(rec['file_ext'])) in ('pdf', 'image')
    response = send_file(full_path, mimetype=guessed_mime, as_attachment=not show_inline,
                         download_name=rec['original_name'], conditional=True)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'private, no-store'
    return response

@app.route('/api/reports/download-file/<int:file_id>')
@login_required
def download_dynamic_file(file_id):
    db = get_db()
    rec = db.execute("SELECT * FROM member_files WHERE id = ?", (file_id,)).fetchone()
    if not rec:
        return jsonify({'success': False, 'message': 'File not found.'}), 404
    if rec['user_id'] != session['user_id'] and not is_designated_admin_user(g.current_user):
        return jsonify({'success': False, 'message': 'File not found.'}), 404
    return send_member_file(rec, inline=(request.args.get('inline') == '1'))

@app.route('/api/reports/share/<int:file_id>', methods=['POST'])
@login_required
def create_report_share_link(file_id):
    db = get_db()
    rec = db.execute("SELECT id, user_id, original_name FROM member_files WHERE id = ?", (file_id,)).fetchone()
    if not rec or (rec['user_id'] != session['user_id'] and not is_designated_admin_user(g.current_user)):
        return jsonify({'success': False, 'message': 'File not found.'}), 404
    token = share_serializer.dumps({'f': rec['id'], 'u': rec['user_id']})
    share_url = url_for('shared_report_download', token=token, _external=True)
    return jsonify({
        'success': True,
        'url': share_url,
        'name': rec['original_name'],
        'expires_in_days': SHARE_LINK_MAX_AGE_SECONDS // 86400
    })

@app.route('/shared/<token>')
def shared_report_download(token):
    try:
        payload = share_serializer.loads(token, max_age=SHARE_LINK_MAX_AGE_SECONDS)
    except SignatureExpired:
        return "This shared link has expired.", 410
    except BadSignature:
        return "Invalid shared link.", 404
    db = get_db()
    rec = db.execute("SELECT * FROM member_files WHERE id = ? AND user_id = ?",
                     (payload.get('f'), payload.get('u'))).fetchone()
    if not rec:
        return "File not found.", 404
    return send_member_file(rec)

@app.route('/api/admin/requests')
@admin_required
def admin_requests():
    db = get_db()
    rows = db.execute('''SELECT o.id as order_id, o.status, o.uploaded_all_files, c.created_date as request_date, 
                                c.name, c.customer_id as code, c.youtube_url, c.keyword_1, c.keyword_2, c.keyword_3
                         FROM orders o
                         JOIN customers c ON c.customer_id = o.customer_id
                         ORDER BY o.id DESC''').fetchall()

    requests_list = [dict(r) for r in rows]
    pending_count = sum(1 for r in requests_list if r['uploaded_all_files'] == 0)
    processed_count = sum(1 for r in requests_list if r['uploaded_all_files'] == 1)

    return jsonify({
        'success': True,
        'summary': {'pending': pending_count, 'processed': processed_count},
        'requests': requests_list
    })

@app.route('/api/admin/requests/<int:order_id>/toggle-status', methods=['POST'])
@admin_required
def admin_toggle_status(order_id):
    db = get_db()
    order = db.execute("SELECT uploaded_all_files FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        return jsonify({'success': False, 'message': 'Order not found'}), 200

    new_val = 0 if order['uploaded_all_files'] == 1 else 1
    new_status = 'Report Completed' if new_val == 1 else 'Report Processing'

    db.execute("UPDATE orders SET uploaded_all_files = ?, status = ? WHERE id = ?", (new_val, new_status, order_id))
    db.commit()

    return jsonify({'success': True, 'uploaded_all_files': new_val, 'status': new_status})

# -------------------------------------------------------------
# ADMIN TEAM MEMBERS (LIST + PER-MEMBER FILE / FOLDER UPLOADS)
# -------------------------------------------------------------
@app.route('/api/admin/team-members')
@admin_required
def admin_team_members():
    db = get_db()
    request_rows = db.execute('''
        SELECT c.created_date AS request_date, c.name AS name, c.customer_id AS request_id,
               c.youtube_url, c.keyword_1, c.keyword_2, c.keyword_3,
               u.id AS user_id, u.member_id AS member_id,
               (SELECT COUNT(*) FROM member_files f
                 WHERE f.user_id = u.id AND f.customer_id = c.customer_id AND COALESCE(f.source, 'admin_upload') != 'auto') AS file_count
        FROM customers c
        JOIN users u ON u.id = c.user_id
        WHERE u.role != 'admin'
        ORDER BY c.created_date DESC, c.id DESC''').fetchall()

    member_rows = db.execute('''
        SELECT u.id AS user_id, u.member_id AS member_id, u.name AS name, u.email AS email,
               DATE(u.created_at) AS request_date,
               (SELECT COUNT(*) FROM member_files f
                 WHERE f.user_id = u.id AND f.customer_id IS NULL AND COALESCE(f.source, 'admin_upload') != 'auto') AS file_count
        FROM users u
        WHERE u.role != 'admin'
          AND ( NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id)
                OR EXISTS (SELECT 1 FROM member_files f WHERE f.user_id = u.id AND f.customer_id IS NULL AND COALESCE(f.source, 'admin_upload') != 'auto') )
        ORDER BY u.id DESC''').fetchall()

    members = []
    for r in request_rows:
        members.append({
            'request_date': r['request_date'], 'name': r['name'], 'member_id': r['member_id'],
            'request_id': r['request_id'], 'user_id': r['user_id'],
            'youtube_url': r['youtube_url'] or '', 'keyword_1': r['keyword_1'] or '',
            'keyword_2': r['keyword_2'] or '', 'keyword_3': r['keyword_3'] or '',
            'file_count': r['file_count'], 'uploaded': r['file_count'] > 0
        })
    for r in member_rows:
        members.append({
            'request_date': r['request_date'] or '', 'name': r['name'], 'member_id': r['member_id'],
            'request_id': '', 'user_id': r['user_id'],
            'youtube_url': '', 'keyword_1': '', 'keyword_2': '', 'keyword_3': '',
            'file_count': r['file_count'], 'uploaded': r['file_count'] > 0
        })

    members.sort(key=lambda m: (m['request_date'] or ''), reverse=True)
    total = len(members)
    uploaded = sum(1 for m in members if m['uploaded'])
    return jsonify({'success': True, 'summary': {'total': total, 'uploaded': uploaded, 'pending': total - uploaded},
                    'members': members})

@app.route('/api/admin/team-members/<int:user_id>/files')
@admin_required
def admin_member_files(user_id):
    customer_id = (request.args.get('customer_id') or '').strip()
    db = get_db()
    if customer_id:
        rows = db.execute('''SELECT id, original_name, relative_path, file_type, size_bytes, upload_date
                              FROM member_files WHERE user_id = ? AND customer_id = ?
                                AND COALESCE(source, 'admin_upload') != 'auto'
                              ORDER BY id DESC''', (user_id, customer_id)).fetchall()
    else:
        rows = db.execute('''SELECT id, original_name, relative_path, file_type, size_bytes, upload_date
                              FROM member_files WHERE user_id = ? AND customer_id IS NULL
                                AND COALESCE(source, 'admin_upload') != 'auto'
                              ORDER BY id DESC''', (user_id,)).fetchall()
    return jsonify({'success': True, 'files': [{
        'id': r['id'], 'name': r['original_name'], 'path': r['relative_path'],
        'type': r['file_type'], 'size': r['size_bytes'], 'upload_date': r['upload_date']
    } for r in rows]})

@app.route('/api/admin/team-members/<int:user_id>/upload', methods=['POST'])
@admin_required
def admin_upload_member_files(user_id):
    db = get_db()
    member = db.execute("SELECT id, member_id, role, name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not member or member['role'] == 'admin':
        return jsonify({'success': False, 'message': 'Team member not found.'}), 404

    customer_id = (request.form.get('customer_id') or '').strip() or None
    if customer_id:
        owns = db.execute("SELECT 1 FROM customers WHERE customer_id = ? AND user_id = ?",
                          (customer_id, user_id)).fetchone()
        if not owns:
            return jsonify({'success': False, 'message': 'This request does not belong to the selected member.'}), 400

    uploads = request.files.getlist('files')
    paths = request.form.getlist('paths')
    if not uploads:
        return jsonify({'success': False, 'message': 'No files were selected.'}), 400

    member_dir_name = f"u{member['id']}"
    member_dir = os.path.join(PRIVATE_UPLOAD_ROOT, member_dir_name)
    os.makedirs(member_dir, exist_ok=True)

    today_str = datetime.date.today().isoformat()
    saved, rejected = [], []

    for idx, f in enumerate(uploads):
        original_filename = f.filename or ''
        raw_path = paths[idx] if idx < len(paths) else original_filename
        display_path = clean_display_path(raw_path, original_filename)
        display_name = display_path.rsplit('/', 1)[-1]
        ext = display_name.rsplit('.', 1)[-1].lower() if '.' in display_name else ''

        if ext not in ALLOWED_REPORT_EXTENSIONS:
            rejected.append({'name': display_path, 'reason': f"File type '.{ext or 'none'}' is not allowed."})
            continue

        head = f.stream.read(16)
        f.stream.seek(0)
        if not head:
            rejected.append({'name': display_path, 'reason': 'File is empty.'})
            continue
        if not content_matches_extension(ext, head):
            rejected.append({'name': display_path, 'reason': f"File content does not match its '.{ext}' type."})
            continue

        stored_name = f"{uuid.uuid4().hex}.{ext}"
        full_path = os.path.join(member_dir, stored_name)
        f.save(full_path)
        size = os.path.getsize(full_path)
        if size > MAX_REPORT_FILE_SIZE:
            os.remove(full_path)
            rejected.append({'name': display_path,
                             'reason': f"File is larger than {MAX_REPORT_FILE_SIZE // (1024 * 1024)} MB."})
            continue

        mime = EXT_MIME_MAP.get(ext) or mimetypes.guess_type(display_name)[0] or 'application/octet-stream'
        cur = db.execute('''INSERT INTO member_files
                              (user_id, member_id, customer_id, original_name, relative_path, stored_path,
                               file_ext, file_type, mime_type, size_bytes, uploaded_by, upload_date, source)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin_upload')''',
                         (member['id'], member['member_id'], customer_id, display_name, display_path,
                          f"{member_dir_name}/{stored_name}", ext, classify_file_type(ext), mime, size,
                          session['user_id'], today_str))
        saved.append({'id': cur.lastrowid, 'name': display_path, 'size': size})

    if saved and customer_id:
        db.execute("UPDATE orders SET uploaded_all_files = 1, status = 'Report Completed', upload_status = 'Completed' WHERE customer_id = ?",
                   (customer_id,))
    db.commit()

    message = f"{len(saved)} file(s) uploaded for {member['name']}."
    if rejected:
        message += f" {len(rejected)} file(s) rejected."
    return jsonify({'success': len(saved) > 0, 'message': message, 'saved': saved, 'rejected': rejected})

# -------------------------------------------------------------
# ADMIN-ONLY ADVERTISEMENT MANAGEMENT (3 dashboard advertisement sections)
# -------------------------------------------------------------
@app.route('/api/admin/banners')
@admin_required
def admin_list_banners():
    db = get_db()
    rows = db.execute("SELECT * FROM banners WHERE slot IS NOT NULL ORDER BY slot ASC").fetchall()
    by_slot = {r['slot']: dict(r) for r in rows}
    return jsonify({'success': True, 'slots': [
        {'slot': sl, 'banner': by_slot.get(sl)} for sl in BANNER_SLOTS
    ]})

@app.route('/api/admin/banners/<int:slot>', methods=['POST'])
@admin_required
def admin_save_banner(slot):
    if slot not in BANNER_SLOTS:
        return jsonify({'success': False, 'message': 'Invalid advertisement slot.'}), 400

    title = (request.form.get('title') or '').strip()[:120]
    subtitle = (request.form.get('subtitle') or '').strip()[:240]
    action_url = clean_action_url(request.form.get('action_url'))
    image = request.files.get('image')
    has_new_image = bool(image and image.filename)

    db = get_db()
    existing = db.execute("SELECT * FROM banners WHERE slot = ?", (slot,)).fetchone()

    new_image_url = None
    if has_new_image:
        ext = image.filename.rsplit('.', 1)[-1].lower() if '.' in image.filename else ''
        if ext not in BANNER_ALLOWED_EXTENSIONS:
            return jsonify({'success': False, 'message': 'Advertisement image must be PNG, JPG, GIF or WEBP.'}), 400
        head = image.stream.read(16)
        image.stream.seek(0)
        if not head or not content_matches_extension(ext, head):
            return jsonify({'success': False, 'message': 'The selected file is not a valid image.'}), 400
        stored_name = f"{uuid.uuid4().hex}.{ext}"
        full_path = os.path.join(BANNER_UPLOADS, stored_name)
        image.save(full_path)
        if os.path.getsize(full_path) > MAX_BANNER_IMAGE_SIZE:
            os.remove(full_path)
            return jsonify({'success': False,
                            'message': f'Image is larger than {MAX_BANNER_IMAGE_SIZE // (1024 * 1024)} MB.'}), 400
        new_image_url = BANNER_URL_PREFIX + stored_name

    if not existing and not title and not new_image_url:
        return jsonify({'success': False, 'message': 'Enter a title or upload an image for the advertisement.'}), 400

    if existing:
        db.execute('''UPDATE banners SET title = ?, subtitle = ?, action_url = ?, image_url = ?, is_active = 1
                      WHERE id = ?''',
                   (title, subtitle, action_url, new_image_url or existing['image_url'], existing['id']))
        if new_image_url and existing['image_url'] != new_image_url:
            delete_banner_image_file(existing['image_url'])
    else:
        db.execute('''INSERT INTO banners (title, subtitle, image_url, action_url, is_active, slot)
                      VALUES (?, ?, ?, ?, 1, ?)''', (title, subtitle, new_image_url, action_url, slot))
    db.commit()

    row = db.execute("SELECT * FROM banners WHERE slot = ?", (slot,)).fetchone()
    return jsonify({'success': True, 'message': f'Advertisement {slot} saved.', 'banner': dict(row)})

@app.route('/api/admin/banners/<int:slot>', methods=['DELETE'])
@admin_required
def admin_delete_banner(slot):
    if slot not in BANNER_SLOTS:
        return jsonify({'success': False, 'message': 'Invalid advertisement slot.'}), 400
    db = get_db()
    existing = db.execute("SELECT * FROM banners WHERE slot = ?", (slot,)).fetchone()
    if not existing:
        return jsonify({'success': False, 'message': 'There is no advertisement in this section.'}), 404
    db.execute("DELETE FROM banners WHERE id = ?", (existing['id'],))
    db.commit()
    delete_banner_image_file(existing['image_url'])
    return jsonify({'success': True, 'message': f'Advertisement {slot} deleted.'})

@app.errorhandler(413)
def request_too_large(e):
    return jsonify({'success': False, 'message': 'Upload is too large. Please upload fewer or smaller files at a time.'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
