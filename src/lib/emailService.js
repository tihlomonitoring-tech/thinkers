import nodemailer from "nodemailer";

export async function sendEmail({ to, subject, body, html = true, text, cc, attachments }) {
    try {
        console.log('📧 EmailService: Starting email send...', { 
            to: to, 
            subject: subject.substring(0, 50),
            html: html,
            htmlType: typeof html,
            bodyIsHtml: body && body.trim().startsWith('<!DOCTYPE'),
            bodyPreview: body ? body.substring(0, 100) : 'EMPTY',
            hasAttachments: !!attachments && attachments.length > 0,
            attachmentCount: attachments ? attachments.length : 0,
            hasCC: !!cc
        });
        
        // Strip whitespace, newlines, and surrounding quotes (from .env copy-paste)
        const rawUser = (process.env.EMAIL_USER || "").replace(/[\r\n]+/g, "").trim();
        const rawPass = (process.env.EMAIL_PASS || "").replace(/[\r\n]+/g, "").trim();
        const emailUser = (rawUser.startsWith('"') && rawUser.endsWith('"')) || (rawUser.startsWith("'") && rawUser.endsWith("'")) ? rawUser.slice(1, -1) : rawUser;
        const emailPass = (rawPass.startsWith('"') && rawPass.endsWith('"')) || (rawPass.startsWith("'") && rawPass.endsWith("'")) ? rawPass.slice(1, -1) : rawPass;
        
        if (!emailUser || !emailPass) {
            console.warn('📧 EmailService: EMAIL_USER and EMAIL_PASS not set in .env. Skipping send. Add them to enable alerts/emails.');
            return null;
        }
        
        const emailHost = (process.env.EMAIL_HOST || '').trim() || 'smtp.gmail.com';
        const emailPort = parseInt(process.env.EMAIL_PORT || '587', 10) || 587;
        const emailSecure = process.env.EMAIL_SECURE === 'true' || process.env.EMAIL_SECURE === '1';
        const isOutlook = emailHost.includes('office365') || emailHost.includes('outlook');

        console.log('📧 EmailService: Using SMTP:', { host: emailHost, port: emailPort, user: emailUser, passLength: emailPass.length });

        const transportOptions = {
            host: emailHost,
            port: emailPort,
            secure: emailSecure,
            auth: {
                user: emailUser,
                pass: emailPass
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 15000,
            greetingTimeout: 10000,
        };
        // Office 365 / Outlook: port 587 with STARTTLS (Microsoft recommendation)
        if (!emailSecure && emailPort === 587 && isOutlook) {
            transportOptions.requireTLS = true;
            transportOptions.secure = false;
            transportOptions.tls = { rejectUnauthorized: false, minVersion: 'TLSv1.2' };
        }
        const transporter = nodemailer.createTransport(transportOptions);

        // Verify transporter configuration with timeout
        console.log('📧 EmailService: Verifying transporter...');
        try {
            const verifyPromise = transporter.verify();
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Transporter verification timeout')), 15000)
            );
            await Promise.race([verifyPromise, timeoutPromise]);
            console.log('✅ EmailService: Transporter verified successfully');
        } catch (verifyError) {
            // Log exact server response to diagnose (no passwords)
            const code = verifyError.responseCode || verifyError.code;
            const response = verifyError.response || (typeof verifyError.response === 'string' ? verifyError.response : '');
            console.error('❌ SMTP server response:', { code, response: String(response).slice(0, 500), command: verifyError.command });
            const msg = (verifyError.message || '').toLowerCase();
            const fullResponse = String(response).toLowerCase();
            if (msg.includes('invalid login') || msg.includes('535') || msg.includes('authentication') || fullResponse.includes('535') || fullResponse.includes('5.7.139')) {
                console.error('❌ SMTP Authentication Error.');
                if (isOutlook) {
                    console.error('   • 535 5.7.139 = Tenant policy: enable "Authenticated SMTP" for this mailbox in Microsoft 365 admin (Mailbox → Mail flow settings), or allow in Azure AD Security defaults.');
                    console.error('   • Wrong password = Use the account password, or an App Password if MFA is on (https://account.microsoft.com/security).');
                } else {
                    console.error('   • Gmail: Use an App Password from https://myaccount.google.com/apppasswords');
                }
                throw new Error('SMTP authentication failed. Check server response above and EMAIL_USER/EMAIL_PASS (or tenant SMTP policy).');
            }
            throw verifyError;
        }

        // Process attachments if provided
        const processedAttachments = [];
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
            console.log(`📎 EmailService: Processing ${attachments.length} attachment(s)...`);
            for (const attachment of attachments) {
                if (attachment.content && attachment.filename) {
                    try {
                        const contentString = typeof attachment.content === 'string' 
                            ? attachment.content 
                            : String(attachment.content);
                        const buffer = Buffer.from(contentString, attachment.encoding || 'base64');
                        if (buffer.length === 0) {
                            console.error(`❌ EmailService: Buffer is empty for attachment ${attachment.filename}`);
                            continue;
                        }
                        processedAttachments.push({
                            filename: attachment.filename,
                            content: buffer
                        });
                    } catch (bufferError) {
                        console.error(`❌ EmailService: Error processing attachment ${attachment.filename}:`, bufferError.message);
                    }
                } else {
                    console.warn(`⚠️ EmailService: Skipping attachment - missing content or filename`);
                }
            }
        }

        // When there are attachments: send HTML ONLY (no text). First MIME part = text/html (template), then attachments.
        // This avoids multipart/alternative so clients (especially with CC) don't hide or drop the template.
        const fromName = process.env.EMAIL_FROM_NAME || 'Thinkers';
        const fromAddress = emailUser.includes('@') ? emailUser : (emailHost.includes('office365') || emailHost.includes('outlook') ? emailUser : `${emailUser}@gmail.com`);
        const bodyStr = body != null ? String(body).trim() : '';
        const looksLikeHtml = bodyStr.length > 0 && (html === true || /<\s*!?\s*DOCTYPE\s+html|<\s*html\s/i.test(bodyStr));
        const textStr = (text != null ? String(text).trim() : '') || (looksLikeHtml ? 'Thinkers – Access management – List distribution. Please find the attached documents.' : bodyStr);
        const hasAttachments = processedAttachments.length > 0;

        const mailOptions = {
            from: `"${fromName}" <${fromAddress}>`,
            to: Array.isArray(to) ? to.join(', ') : to,
            subject,
        };

        if (looksLikeHtml && bodyStr) {
            if (hasAttachments) {
                // HTML only + inline: first part = template (Content-Disposition: inline), then attachments. Fixes template not showing with CC.
                mailOptions.html = { content: bodyStr, contentDisposition: 'inline' };
            } else {
                mailOptions.text = textStr;
                mailOptions.html = bodyStr;
            }
        } else if (bodyStr || textStr) {
            mailOptions.text = bodyStr || textStr;
        }

        const ccNormalized = cc ? (Array.isArray(cc) ? cc.filter(Boolean).join(', ') : String(cc).trim()) : '';
        if (ccNormalized) mailOptions.cc = ccNormalized;
        if (hasAttachments) mailOptions.attachments = processedAttachments;

        const sendPromise = transporter.sendMail(mailOptions);
        const sendTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Email send timeout')), 30000)
        );
        const info = await Promise.race([sendPromise, sendTimeoutPromise]);

        console.log('✅ EmailService: Email sent successfully!', { messageId: info.messageId });
        return info;
    } catch (error) {
        console.error('❌ EmailService: Error sending email:', error.message);
        if (error.response) console.error('❌ EmailService: SMTP response:', error.response);
        if (error.code) console.error('❌ EmailService: Code:', error.code);
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('invalid login') || msg.includes('535') || msg.includes('authentication') || msg.includes('credentials')) {
            const helpfulError = new Error('SMTP authentication failed. Check EMAIL_USER and EMAIL_PASS; use an App Password if you have 2FA/MFA.');
            helpfulError.code = 'AUTH_FAILED';
            throw helpfulError;
        }
        throw error;
    }
}

/** Returns true if EMAIL_USER and EMAIL_PASS are set (for alerts/emails). */
export function isEmailConfigured() {
    const user = (process.env.EMAIL_USER || '').trim();
    const pass = (process.env.EMAIL_PASS || '').trim();
    return !!user && !!pass;
}

/** Format a date for display in emails (timezone-aware). Uses EMAIL_TIMEZONE or Africa/Johannesburg so timestamps are not behind. */
export function formatDateForEmail(date) {
    if (date == null) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const tz = (process.env.EMAIL_TIMEZONE || 'Africa/Johannesburg').trim();
    return d.toLocaleString('en-ZA', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' });
}
