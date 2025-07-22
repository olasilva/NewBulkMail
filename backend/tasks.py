from celery import Celery
from backend.config import Config
from backend.database import db, EmailCampaign, EmailRecipient
from backend.email_service import EmailService
from datetime import datetime

celery = Celery(__name__)
celery.config_from_object(Config)

@celery.task(bind=True)
def send_bulk_emails(self, campaign_id):
    campaign = EmailCampaign.query.get(campaign_id)
    if not campaign:
        return {'status': 'error', 'message': 'Campaign not found'}
    
    campaign.status = 'sending'
    db.session.commit()
    
    recipients = EmailRecipient.query.filter_by(campaign_id=campaign_id, status='pending').all()
    total = len(recipients)
    email_service = EmailService()
    
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
                recipient.error_message = error
                campaign.emails_failed += 1
            
            db.session.commit()
            
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
    
    campaign.status = 'completed'
    db.session.commit()
    
    return {
        'current': total,
        'total': total,
        'sent': campaign.emails_sent,
        'failed': campaign.emails_failed,
        'status': 'Completed'
    }