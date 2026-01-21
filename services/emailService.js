const nodemailer = require('nodemailer');

/**
 * Email Service
 * Handles sending emails for submission review notifications
 */

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  /**
   * Initialize email transporter
   */
  initialize() {
    if (this.initialized) return;

    const emailUser = process.env.EMAIL_USER;
    const emailPassword = process.env.EMAIL_PASSWORD;

    if (!emailUser || !emailPassword) {
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: emailUser,
          pass: emailPassword
        }
      });

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize email service:', error.message);
    }
  }

  /**
   * Send email with HTML content
   */
  async sendEmail(to, subject, html) {
    if (!this.initialized) {
      return { success: false, reason: 'Email service not configured' };
    }

    try {
      const mailOptions = {
        from: `PoemsIndia <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html
      };

      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send plain text email (with minimal HTML to prevent Gmail auto-formatting)
   */
  async sendPlainTextEmail(to, subject, text) {
    if (!this.initialized) {
      return { success: false, reason: 'Email service not configured' };
    }

    try {
      // Convert plain text to simple HTML with preserved line breaks
      // This prevents Gmail from adding its own fancy formatting
      const simpleHtml = `<pre style="font-family: Arial, sans-serif; font-size: 14px; white-space: pre-wrap; word-wrap: break-word;">${text}</pre>`;

      const mailOptions = {
        from: `PoemsIndia <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html: simpleHtml
      };

      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send submission approved notification
   */
  async sendSubmissionApproved(submission, author, reviewNotes) {
    const subject = `🎉 Your submission "${submission.title}" has been approved!`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #777; font-size: 12px; }
          .notes { background: #fff; padding: 15px; border-left: 4px solid #667eea; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Congratulations!</h1>
            <p>Your submission has been approved</p>
          </div>
          <div class="content">
            <p>Dear ${author.name || author.username},</p>

            <p>Great news! Your submission <strong>"${submission.title}"</strong> has been approved by our editorial team.</p>

            ${reviewNotes ? `
              <div class="notes">
                <strong>Reviewer's Notes:</strong>
                <p>${reviewNotes}</p>
              </div>
            ` : ''}

            <p>Your work will be published on PoemsIndia soon. We'll notify you once it goes live.</p>

            <a href="https://poemsindia.in/my-submissions" class="button">View My Submissions</a>

            <p>Thank you for contributing to PoemsIndia!</p>

            <p>Best regards,<br>The PoemsIndia Editorial Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} PoemsIndia. All rights reserved.</p>
            <p>You received this email because you submitted content to PoemsIndia.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(author.email, subject, html);
  }

  /**
   * Send submission rejected notification
   */
  async sendSubmissionRejected(submission, author, reviewNotes) {
    const subject = `Regarding your submission "${submission.title}"`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #777; font-size: 12px; }
          .notes { background: #fff; padding: 15px; border-left: 4px solid #f5576c; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Submission Update</h1>
            <p>Thank you for your submission</p>
          </div>
          <div class="content">
            <p>Dear ${author.name || author.username},</p>

            <p>Thank you for submitting <strong>"${submission.title}"</strong> to PoemsIndia.</p>

            <p>After careful review, we've decided not to publish this submission at this time. Please don't be discouraged – our editorial decisions are subjective and based on many factors including current themes and publication schedule.</p>

            <div class="notes">
              <strong>Feedback from our Editorial Team:</strong>
              <p>${reviewNotes}</p>
            </div>

            <p>We encourage you to continue writing and submitting your work. Every piece you create helps you grow as a writer.</p>

            <a href="https://poemsindia.in/submit" class="button">Submit New Work</a>

            <p>Thank you for your interest in PoemsIndia.</p>

            <p>Best regards,<br>The PoemsIndia Editorial Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} PoemsIndia. All rights reserved.</p>
            <p>You received this email because you submitted content to PoemsIndia.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(author.email, subject, html);
  }

  /**
   * Send revision requested notification
   */
  async sendRevisionRequested(submission, author, reviewNotes) {
    const subject = `📝 Revision requested for "${submission.title}"`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ffa751 0%, #ffe259 100%); color: #333; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #777; font-size: 12px; }
          .notes { background: #fff; padding: 15px; border-left: 4px solid #ffa751; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📝 Revision Requested</h1>
            <p>Your submission needs some changes</p>
          </div>
          <div class="content">
            <p>Dear ${author.name || author.username},</p>

            <p>Thank you for submitting <strong>"${submission.title}"</strong> to PoemsIndia.</p>

            <p>Our editorial team has reviewed your work and would like to see some revisions before we can publish it. We believe in your work and want to help make it the best it can be!</p>

            <div class="notes">
              <strong>Suggested Changes:</strong>
              <p>${reviewNotes}</p>
            </div>

            <p>Please review the feedback above and resubmit your work after making the requested changes. We're looking forward to seeing the revised version!</p>

            <a href="https://poemsindia.in/my-submissions" class="button">Edit & Resubmit</a>

            <p>If you have any questions about the feedback, please don't hesitate to reach out.</p>

            <p>Best regards,<br>The PoemsIndia Editorial Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} PoemsIndia. All rights reserved.</p>
            <p>You received this email because you submitted content to PoemsIndia.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(author.email, subject, html);
  }

  /**
   * Send submission shortlisted notification
   */
  async sendSubmissionShortlisted(submission, author, reviewNotes) {
    const subject = `⭐ Your submission "${submission.title}" has been shortlisted!`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #777; font-size: 12px; }
          .notes { background: #fff; padding: 15px; border-left: 4px solid #667eea; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⭐ Shortlisted!</h1>
            <p>Your submission is being considered for publication</p>
          </div>
          <div class="content">
            <p>Dear ${author.name || author.username},</p>

            <p>Great news! Your submission <strong>"${submission.title}"</strong> has been shortlisted by our editorial team.</p>

            <p>This means your work has caught our attention and is being considered for publication. We'll be reviewing it further and will notify you of the final decision soon.</p>

            ${reviewNotes ? `
              <div class="notes">
                <strong>Reviewer's Notes:</strong>
                <p>${reviewNotes}</p>
              </div>
            ` : ''}

            <a href="https://poemsindia.in/my-submissions" class="button">View My Submissions</a>

            <p>Thank you for your patience!</p>

            <p>Best regards,<br>The PoemsIndia Editorial Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} PoemsIndia. All rights reserved.</p>
            <p>You received this email because you submitted content to PoemsIndia.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(author.email, subject, html);
  }
}

// Export singleton instance
const emailService = new EmailService();
module.exports = emailService;
