document.addEventListener('DOMContentLoaded', function() {
    // Configuration
    const config = {
        API_BASE_URL: 'http://localhost:5000', // Your Flask backend URL
        MAX_RECIPIENTS: 5000,
        BATCH_WARNING_THRESHOLD: 1000,
        POLLING_INTERVAL: 2000 // 2 seconds
    };

    // DOM Elements
    const elements = {
        emailForm: document.getElementById('emailForm'),
        recipientsTextarea: document.getElementById('recipients'),
        recipientCount: document.getElementById('recipientCount'),
        progressContainer: document.getElementById('progressContainer'),
        progressBar: document.getElementById('progressBar'),
        progressText: document.getElementById('progressText'),
        statusContainer: document.getElementById('statusContainer'),
        statusMessage: document.getElementById('statusMessage'),
        sentCount: document.getElementById('sentCount'),
        failedCount: document.getElementById('failedCount'),
        testBtn: document.getElementById('testBtn'),
        sendBtn: document.getElementById('sendBtn'),
        testModal: document.getElementById('testModal'),
        closeBtn: document.querySelector('.close-btn'),
        confirmTestBtn: document.getElementById('confirmTestBtn'),
        testEmailInput: document.getElementById('testEmail'),
        emailBody: document.getElementById('emailBody'),
        senderEmail: document.getElementById('senderEmail'),
        senderName: document.getElementById('senderName'),
        subject: document.getElementById('subject'),
        isHTML: document.getElementById('isHTML'),
        toolButtons: document.querySelectorAll('.tool-btn')
    };

    // Initialize the application
    function init() {
        setupEventListeners();
        updateRecipientCount();
    }

    // Set up all event listeners
    function setupEventListeners() {
        // Toolbar buttons
        elements.toolButtons.forEach(button => {
            button.addEventListener('click', handleToolButtonClick);
        });

        // Recipients textarea
        elements.recipientsTextarea.addEventListener('input', updateRecipientCount);

        // Test email modal
        elements.testBtn.addEventListener('click', showTestModal);
        elements.closeBtn.addEventListener('click', hideTestModal);
        window.addEventListener('click', closeModalOnOutsideClick);

        // Form submissions
        elements.emailForm.addEventListener('submit', handleFormSubmit);
        elements.confirmTestBtn.addEventListener('click', handleTestEmail);
    }

    // Handle toolbar button clicks
    function handleToolButtonClick() {
        const command = this.getAttribute('data-command');
        if (command === 'createLink') {
            const url = prompt('Enter the URL:');
            if (url) document.execCommand(command, false, url);
        } else {
            document.execCommand(command, false, null);
        }
        elements.emailBody.focus();
    }

    // Handle form submission
    function handleFormSubmit(e) {
        e.preventDefault();
        sendBulkEmails();
    }

    // Handle test email
    function handleTestEmail() {
        const testEmail = elements.testEmailInput.value.trim();
        if (!validateEmail(testEmail)) {
            alert('Please enter a valid email address');
            return;
        }
        sendTestEmail(testEmail);
        hideTestModal();
    }

    // Modal functions
    function showTestModal() {
        elements.testModal.style.display = 'flex';
        elements.testEmailInput.value = elements.senderEmail.value || '';
    }

    function hideTestModal() {
        elements.testModal.style.display = 'none';
    }

    function closeModalOnOutsideClick(event) {
        if (event.target === elements.testModal) {
            hideTestModal();
        }
    }

    // Email validation
    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // Extract emails from text
    function extractEmails(text) {
        if (!text) return [];
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g;
        const emails = text.match(emailRegex) || [];
        return [...new Set(emails.map(email => email.toLowerCase().trim()))];
    }

    // Update recipient count display
    function updateRecipientCount() {
        const emails = extractEmails(elements.recipientsTextarea.value);
        elements.recipientCount.textContent = `${emails.length} emails detected`;
        
        if (emails.length > config.MAX_RECIPIENTS) {
            elements.recipientCount.innerHTML += ' - <span style="color: var(--danger-color);">Exceeds limit!</span>';
            elements.sendBtn.disabled = true;
        } else {
            elements.sendBtn.disabled = false;
        }
    }

    // API: Send test email
    async function sendTestEmail(testEmail) {
        const emailData = {
            sender_email: elements.senderEmail.value,
            sender_name: elements.senderName.value,
            recipient_email: testEmail,
            subject: elements.subject.value,
            content: elements.isHTML.checked ? elements.emailBody.innerHTML : elements.emailBody.innerText,
            is_html: elements.isHTML.checked
        };

        showStatus(`Sending test email to ${testEmail}...`);
        
        try {
            const response = await fetch(`${config.API_BASE_URL}/api/test-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(emailData)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showStatus(`Test email sent successfully to ${testEmail}`);
            } else {
                showStatus(`Failed to send test email: ${data.message || 'Unknown error'}`, true);
            }
        } catch (error) {
            showStatus(`Failed to send test email: ${error.message}`, true);
        }
    }

    // API: Send bulk emails
    async function sendBulkEmails() {
        const emails = extractEmails(elements.recipientsTextarea.value);
        
        if (emails.length === 0) {
            alert('Please enter at least one valid email address');
            return;
        }
        
        if (emails.length > config.BATCH_WARNING_THRESHOLD && 
            !confirm(`You are about to send ${emails.length} emails. Continue?`)) {
            return;
        }
        
        // Disable form during sending
        toggleFormDisabled(true);
        showProgress(emails.length);
        
        try {
            const campaignData = {
                sender_email: elements.senderEmail.value,
                sender_name: elements.senderName.value,
                recipients: elements.recipientsTextarea.value,
                subject: elements.subject.value,
                content: elements.isHTML.checked ? elements.emailBody.innerHTML : elements.emailBody.innerText,
                is_html: elements.isHTML.checked
            };
            
            const response = await createCampaign(campaignData);
            pollTaskProgress(response.task_id, response.campaign_id, emails.length);
        } catch (error) {
            showStatus(`Failed to start email campaign: ${error.message}`, true);
            toggleFormDisabled(false);
        }
    }

    // API: Create campaign
    async function createCampaign(campaignData) {
        const response = await fetch(`${config.API_BASE_URL}/api/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campaignData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create campaign');
        }
        
        return await response.json();
    }

    // Poll for task progress
    async function pollTaskProgress(taskId, campaignId, totalRecipients) {
        const checkProgress = async () => {
            try {
                const response = await fetch(`${config.API_BASE_URL}/api/tasks/${taskId}`);
                const data = await response.json();
                
                if (!response.ok) throw new Error('Failed to get task status');
                
                if (data.state === 'PROGRESS' || data.state === 'SUCCESS') {
                    updateProgressUI(data, totalRecipients);
                }
                
                if (data.state === 'SUCCESS') {
                    handleCompletion();
                    return;
                } else if (data.state === 'FAILURE') {
                    handleFailure(data);
                    return;
                }
                
                setTimeout(checkProgress, config.POLLING_INTERVAL);
            } catch (error) {
                handlePollingError(error);
            }
        };
        
        checkProgress();
    }

    // UI Update functions
    function updateProgressUI(taskData, totalRecipients) {
        const current = taskData.current || 0;
        const sent = taskData.sent || 0;
        const failed = taskData.failed || 0;
        
        updateProgress(current, totalRecipients);
        elements.sentCount.textContent = sent;
        elements.failedCount.textContent = failed;
        
        if (taskData.status) {
            showStatus(taskData.status);
        }
    }

    function updateProgress(current, total) {
        const percent = Math.round((current / total) * 100);
        elements.progressBar.style.width = `${percent}%`;
        elements.progressText.textContent = `${percent}%`;
    }

    function showProgress(totalRecipients) {
        elements.progressContainer.style.display = 'block';
        elements.statusContainer.style.display = 'block';
        showStatus(`Starting bulk email send to ${totalRecipients} recipients...`);
    }

    function showStatus(message, isError = false) {
        const now = new Date().toLocaleTimeString();
        const statusLine = document.createElement('div');
        statusLine.innerHTML = `<strong>[${now}]</strong> ${message}`;
        
        if (isError) {
            statusLine.style.color = 'var(--danger-color)';
        }
        
        elements.statusMessage.prepend(statusLine);
        elements.statusMessage.scrollTop = 0;
    }

    function toggleFormDisabled(disabled) {
        elements.sendBtn.disabled = disabled;
        elements.testBtn.disabled = disabled;
    }

    function handleCompletion() {
        showStatus('Bulk email send completed!');
        toggleFormDisabled(false);
        const summary = `Successfully sent ${elements.sentCount.textContent} emails with ${elements.failedCount.textContent} failures.`;
        showStatus(summary);
    }

    function handleFailure(taskData) {
        showStatus(`Bulk email send failed: ${taskData.status}`, true);
        toggleFormDisabled(false);
    }

    function handlePollingError(error) {
        showStatus(`Error checking progress: ${error.message}`, true);
        toggleFormDisabled(false);
    }

    // Initialize the application
    init();
});