import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from backend.config import Config
from backend.database import db, EmailRecipient

class EmailService:
    def __init__(self):
        self.config = Config()
    
    def send_email(self, recipient_email, sender_email, sender_name, subject, content, is_html=False):
        try:
            # Create message container
            msg = MIMEMultipart()
            msg['From'] = f"{sender_name} <{sender_email}>" if sender_name else sender_email
            msg['To'] = recipient_email
            msg['Subject'] = subject
            
            # Attach the email body
            if is_html:
                msg.attach(MIMEText(content, 'html'))
            else:
                msg.attach(MIMEText(content, 'plain'))
            
            # Connect to SMTP server and send
            with smtplib.SMTP(self.config.MAIL_SERVER, self.config.MAIL_PORT) as server:
                server.ehlo()
                if self.config.MAIL_USE_TLS:
                    server.starttls()
                server.login(self.config.MAIL_USERNAME, self.config.MAIL_PASSWORD)
                server.send_message(msg)
            
            return True, None
        except Exception as e:
            return False, str(e)