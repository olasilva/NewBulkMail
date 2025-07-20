document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const emailForm = document.getElementById('emailForm');
    const recipientsTextarea = document.getElementById('recipients');
    const recipientCount = document.getElementById('recipientCount');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const statusContainer = document.getElementById('statusContainer');
    const statusMessage = document.getElementById('statusMessage');
    const sentCount = document.getElementById('sentCount');
    const failedCount = document.getElementById('failedCount');
    const testBtn = document.getElementById('testBtn');
    const sendBtn = document.getElementById('sendBtn');
    const testModal = document.getElementById('testModal');
    const closeBtn = document.querySelector('.close-btn');
    const confirmTestBtn = document.getElementById('confirmTestBtn');
    const testEmailInput = document.getElementById('testEmail');
    const emailBody = document.getElementById('emailBody');
    const toolButtons = document.querySelectorAll('.tool-btn');

    // Toolbar buttons functionality
    toolButtons.forEach(button => {
        button.addEventListener('click', function() {
            const command = this.getAttribute('data-command');
            if (command === 'createLink') {
                const url = prompt('Enter the URL:');
                if (url) document.execCommand(command, false, url);
            } else {
                document.execCommand(command, false, null);
            }
            emailBody.focus();
        });
    });

    // Count recipients
    recipientsTextarea.addEventListener('input', updateRecipientCount);

    function updateRecipientCount() {
        const emails = extractEmails(recipientsTextarea.value);
        recipientCount.textContent = `${emails.length} emails detected`;
        
        // Warn if exceeding 5000
        if (emails.length > 5000) {
            recipientCount.innerHTML += ' - <span style="color: var(--danger-color);">Exceeds 5000 limit!</span>';
            sendBtn.disabled = true;
        } else {
            sendBtn.disabled = false;
        }
    }

    function extractEmails(text) {
        if (!text) return [];
        
        // Split by commas, newlines, or semicolons, then trim and filter
        return text.split(/[,;\n]/)
            .map(email => email.trim())
            .filter(email => {
                // Simple email validation
                const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return re.test(email);
            });
    }

    // Test email modal
    testBtn.addEventListener('click', function() {
        testModal.style.display = 'flex';
    });

    closeBtn.addEventListener('click', function() {
        testModal.style.display = 'none';
    });

    window.addEventListener('click', function(event) {
        if (event.target === testModal) {
            testModal.style.display = 'none';
        }
    });

    // Form submission handlers
    emailForm.addEventListener('submit', function(e) {
        e.preventDefault();
        sendBulkEmails();
    });

    confirmTestBtn.addEventListener('click', function() {
        const testEmail = testEmailInput.value.trim();
        if (!testEmail) {
            alert('Please enter a test email address');
            return;
        }
        
        sendTestEmail(testEmail);
        testModal.style.display = 'none';
    });

    // Mock email sending functions
    function sendTestEmail(email) {
        // In a real app, you would make an AJAX call to your backend here
        showStatus('Sending test email to ' + email + '...');
        
        // Simulate API call delay
        setTimeout(() => {
            showStatus('Test email sent successfully to ' + email);
            
            // In a real app, you would handle errors too
            // showStatus('Failed to send test email: ' + error.message, true);
        }, 2000);
    }

    function sendBulkEmails() {
        const senderEmail = document.getElementById('senderEmail').value;
        const senderName = document.getElementById('senderName').value;
        const subject = document.getElementById('subject').value;
        const isHTML = document.getElementById('isHTML').checked;
        const content = isHTML ? emailBody.innerHTML : emailBody.innerText;
        
        const emails = extractEmails(recipientsTextarea.value);
        
        if (emails.length === 0) {
            alert('Please enter at least one valid email address');
            return;
        }
        
        // Disable form during sending
        sendBtn.disabled = true;
        testBtn.disabled = true;
        
        // Show progress
        progressContainer.style.display = 'block';
        statusContainer.style.display = 'block';
        showStatus('Starting bulk email send to ' + emails.length + ' recipients...');
        
        // In a real app, you would:
        // 1. Make an AJAX call to your backend with the email data
        // 2. Your backend would handle the actual email sending (possibly in batches)
        // 3. Your backend would provide progress updates via WebSocket or polling
        
        // For this demo, we'll simulate sending with progress updates
        simulateBulkSend(emails, senderEmail, senderName, subject, content, isHTML);
    }

    function simulateBulkSend(emails, senderEmail, senderName, subject, content, isHTML) {
        const total = emails.length;
        let sent = 0;
        let failed = 0;
        
        // Simulate sending in batches (for a real app, your backend would do this)
        const batchSize = 100;
        const batchCount = Math.ceil(total / batchSize);
        
        let currentBatch = 0;
        
        const sendNextBatch = () => {
            if (currentBatch >= batchCount) {
                // All batches complete
                showStatus('Bulk email send completed!');
                sendBtn.disabled = false;
                testBtn.disabled = false;
                return;
            }
            
            const startIdx = currentBatch * batchSize;
            const endIdx = Math.min(startIdx + batchSize, total);
            const batchEmails = emails.slice(startIdx, endIdx);
            
            showStatus(`Sending batch ${currentBatch + 1} of ${batchCount} (emails ${startIdx + 1}-${endIdx})...`);
            
            // Simulate API call delay
            setTimeout(() => {
                // Simulate some successes and failures
                const batchTotal = batchEmails.length;
                const batchSent = Math.floor(batchTotal * 0.95); // 95% success rate for demo
                const batchFailed = batchTotal - batchSent;
                
                sent += batchSent;
                failed += batchFailed;
                
                updateProgress(sent + failed, total);
                sentCount.textContent = sent;
                failedCount.textContent = failed;
                
                if (batchFailed > 0) {
                    showStatus(`Batch ${currentBatch + 1} completed with ${batchFailed} failures`, true);
                }
                
                currentBatch++;
                sendNextBatch();
            }, 1500);
        };
        
        sendNextBatch();
    }

    function updateProgress(current, total) {
        const percent = Math.round((current / total) * 100);
        progressBar.style.width = percent + '%';
        progressText.textContent = percent + '%';
    }

    function showStatus(message, isError = false) {
        const now = new Date().toLocaleTimeString();
        const statusLine = document.createElement('div');
        statusLine.innerHTML = `<strong>[${now}]</strong> ${message}`;
        
        if (isError) {
            statusLine.style.color = 'var(--danger-color)';
        }
        
        statusMessage.prepend(statusLine);
    }

    // Initialize
    updateRecipientCount();
});