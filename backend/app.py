import os
import re
import smtplib
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from celery import Celery
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

# Initialize Flask app with CORS
app = Flask(__name__,
           static_folder='../frontend/templates/static',
           static_url_path='/static',
           template_folder='../frontend/templates')
CORS(app)  # Enable CORS for all routes

# Configuration
app.config.update(
    SQLALCHEMY_DATABASE_URI='sqlite:///emails.db',
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MAIL_SERVER='smtp.gmail.com',  # Using Gmail SMTP
    MAIL_PORT=587,
    MAIL_USE_TLS=True,
    MAIL_USERNAME='your_email@gmail.com',  # Replace with your email
    MAIL_PASSWORD='your_app_password',  # Use App Password, not your main password
    CELERY_BROKER_URL='redis://localhost:6379/0',
    CELERY_RESULT_BACKEND='redis://localhost:6379/0'
)

# Initialize extensions
db = SQLAlchemy(app)
celery = Celery(app.name, broker=app.config['CELERY_BROKER_URL'])
celery.conf.update(app.config)

# Database Models
class EmailCampaign(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_email = db.Column(db.String(120), nullable=False)
    sender_name = db.Column(db.String(120))
    subject = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False)
    is_html = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='pending')  # pending, sending, completed, failed
    total_recipients = db.Column(db.Integer)
    emails_sent = db.Column(db.Integer, default=0)
    emails_failed = db.Column(db.Integer, default=0)

class EmailRecipient(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, sent, failed
    campaign_id = db.Column(db.Integer, db.ForeignKey('email_campaign.id'), nullable=False)
    error_message = db.Column(db.String(255))

# Email Service
class EmailService:
    def __init__(self, app_config):
        self.config = app_config
    
    def send_email(self, recipient_email, sender_email, sender_name, subject, content, is_html=False):
        try:
            msg = MIMEMultipart()
            msg['From'] = f"{sender_name} <{sender_email}>" if sender_name else sender_email
            msg['To'] = recipient_email
            msg['Subject'] = subject
            
            body = MIMEText(content, 'html' if is_html else 'plain')
            msg.attach(body)
            
            with smtplib.SMTP(self.config['MAIL_SERVER'], self.config['MAIL_PORT']) as server:
                server.ehlo()
                if self.config['MAIL_USE_TLS']:
                    server.starttls()
                server.login(self.config['MAIL_USERNAME'], self.config['MAIL_PASSWORD'])
                server.send_message(msg)
            
            return True, None
        except Exception as e:
            return False, str(e)

# Helper Functions
def extract_emails(text):
    if not text:
        return []
    email_regex = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?'
    return list(set(re.findall(email_regex, text.lower())))

# Celery Task
@celery.task(bind=True)
def send_bulk_emails(self, campaign_id):
    campaign = EmailCampaign.query.get(campaign_id)
    if not campaign:
        return {'status': 'error', 'message': 'Campaign not found'}
    
    campaign.status = 'sending'
    db.session.commit()
    
    recipients = EmailRecipient.query.filter_by(campaign_id=campaign_id, status='pending').all()
    total = len(recipients)
    email_service = EmailService(app.config)
    batch_size = 50  # Emails per batch
    delay_between_batches = 10  # Seconds
    
    for i, recipient in enumerate(recipients):
        try:
            success, error = email_service.send_email(
                recipient.email,
                campaign.sender_email,
                campaign.sender_name,
                campaign.subject,
                campaign.content,
                campaign.is_html
            )
            
            if success:
                recipient.status = 'sent'
                campaign.emails_sent += 1
            else:
                recipient.status = 'failed'
                recipient.error_message = error[:255]  # Truncate to fit in DB
                campaign.emails_failed += 1
            
            db.session.commit()
            
            # Add delay between batches
            if (i + 1) % batch_size == 0:
                time.sleep(delay_between_batches)
            
            # Update progress
            self.update_state(
                state='PROGRESS',
                meta={
                    'current': i + 1,
                    'total': total,
                    'sent': campaign.emails_sent,
                    'failed': campaign.emails_failed,
                    'status': f'Sent {i+1} of {total}'
                }
            )
        except Exception as e:
            db.session.rollback()
            continue
    
    campaign.status = 'completed'
    db.session.commit()
    
    return {
        'current': total,
        'total': total,
        'sent': campaign.emails_sent,
        'failed': campaign.emails_failed,
        'status': 'Completed'
    }

# Frontend Serving

@app.route('/')
def home():
    return send_from_directory(app.template_folder, 'bulkEmail.html')
    
@app.route('/')
def serve_frontend():
    return send_from_directory(app.static_folder, 'bulkEmail.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return jsonify({"error": "Not found"}), 404

# API Routes
@app.route('/api/campaigns', methods=['POST'])
def create_campaign():
    data = request.json
    
    required_fields = ['sender_email', 'recipients', 'subject', 'content']
    if not all(field in data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    emails = extract_emails(data['recipients'])
    if not emails:
        return jsonify({'error': 'No valid email addresses provided'}), 400
    
    if len(emails) > 5000:
        return jsonify({'error': 'Maximum 5000 recipients allowed'}), 400
    
    campaign = EmailCampaign(
        sender_email=data['sender_email'],
        sender_name=data.get('sender_name'),
        subject=data['subject'],
        content=data['content'],
        is_html=data.get('is_html', False),
        total_recipients=len(emails),
        status='pending'
    )
    db.session.add(campaign)
    db.session.commit()
    
    for email in emails:
        recipient = EmailRecipient(email=email, campaign_id=campaign.id)
        db.session.add(recipient)
    db.session.commit()
    
    task = send_bulk_emails.delay(campaign.id)
    
    return jsonify({
        'campaign_id': campaign.id,
        'task_id': task.id,
        'total_recipients': len(emails)
    }), 201

@app.route('/api/test-email', methods=['POST'])
def send_test_email():
    data = request.json
    
    required_fields = ['sender_email', 'recipient_email', 'subject', 'content']
    if not all(field in data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    email_service = EmailService(app.config)
    success, error = email_service.send_email(
        data['recipient_email'],
        data['sender_email'],
        data.get('sender_name'),
        data['subject'],
        data['content'],
        data.get('is_html', False)
    )
    
    if success:
        return jsonify({'status': 'success'})
    else:
        return jsonify({'status': 'error', 'message': error}), 500

@app.route('/api/campaigns/<int:campaign_id>/status', methods=['GET'])
def get_campaign_status(campaign_id):
    campaign = EmailCampaign.query.get(campaign_id)
    if not campaign:
        return jsonify({'error': 'Campaign not found'}), 404
    
    return jsonify({
        'status': campaign.status,
        'total': campaign.total_recipients,
        'sent': campaign.emails_sent,
        'failed': campaign.emails_failed
    })

@app.route('/api/tasks/<task_id>', methods=['GET'])
def get_task_status(task_id):
    task = send_bulk_emails.AsyncResult(task_id)
    
    if task.state == 'PENDING':
        response = {
            'state': task.state,
            'status': 'Pending...'
        }
    elif task.state != 'FAILURE':
        response = {
            'state': task.state,
            'current': task.info.get('current', 0),
            'total': task.info.get('total', 1),
            'sent': task.info.get('sent', 0),
            'failed': task.info.get('failed', 0),
            'status': task.info.get('status', '')
        }
    else:
        response = {
            'state': task.state,
            'status': str(task.info)
        }
    
    return jsonify(response)

@app.cli.command('init-db')
def init_db():
    """Initialize the database."""
    db.create_all()
    print('Database initialized.')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)