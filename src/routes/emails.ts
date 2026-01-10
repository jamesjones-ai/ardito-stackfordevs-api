import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
// import formData from 'form-data';
// import Mailgun from 'mailgun.js';

const router = Router();

// Mailgun configuration - TEMPORARILY DISABLED
// const mailgun = new Mailgun(formData);
// const mg = mailgun.client({
//   username: 'api',
//   key: process.env.MAILGUN_API_KEY || '',
// });

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || '';
const FROM_EMAIL = process.env.FROM_EMAIL || `noreply@${MAILGUN_DOMAIN}`;
const STACKFORDEVS_MAILER_URL = process.env.STACKFORDEVS_MAILER_API_URL || 'https://mailer.stackfordevs.com';

// StackForDevs Notifications (still used for in-app notifications)
const STACKFORDEVS_NOTIFICATIONS_URL = process.env.STACKFORDEVS_NOTIFICATIONS_API_URL || 'https://notifications.stackfordevs.com';
const STACKFORDEVS_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.STACKFORDEVS_API_KEY!,
  'x-secret-key': process.env.STACKFORDEVS_SECRET_API_KEY!,
  'x-tenant-id': process.env.STACKFORDEVS_TENANT_ID!,
  'x-project-id': process.env.STACKFORDEVS_PROJECT_ID!,
};

// Send payment reminder for an overdue invoice
router.post('/send-payment-reminder', async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId is required' });
    }

    // Get invoice details
    const invoiceResult = await query(
      `SELECT i.*, p.project_name, p.general_contractor, u.email, u.name
       FROM invoices i
       LEFT JOIN projects p ON i.project_id = p.id
       LEFT JOIN users u ON i.user_id = u.id
       WHERE i.id = $1`,
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Calculate days overdue
    const dueDate = new Date(invoice.due_date);
    const today = new Date();
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    // Create email content
    const subject = `Payment Reminder: Invoice ${invoice.invoice_number} - ${daysOverdue} Days Overdue`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Payment Reminder</h2>

        <p>Hi ${invoice.name},</p>

        <p>This is a friendly reminder that the following invoice is <strong style="color: #DC2626;">${daysOverdue} days overdue</strong>:</p>

        <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Invoice #:</strong> ${invoice.invoice_number}</p>
          <p style="margin: 5px 0;"><strong>Project:</strong> ${invoice.project_name || 'N/A'}</p>
          <p style="margin: 5px 0;"><strong>General Contractor:</strong> ${invoice.general_contractor || 'N/A'}</p>
          <p style="margin: 5px 0;"><strong>Amount Due:</strong> $${Number(invoice.amount - invoice.amount_paid).toLocaleString()}</p>
          <p style="margin: 5px 0;"><strong>Original Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString()}</p>
        </div>

        <p><strong>Next Steps:</strong></p>
        <ul>
          <li>Send a formal demand letter to the general contractor</li>
          <li>Call their accounts payable department</li>
          <li>Verify your preliminary notice was filed</li>
          <li>Check your lien deadline (4 months from last work)</li>
        </ul>

        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">
          This is an automated reminder from PayForeman AI to help you stay on top of your collections.
        </p>

        <p style="color: #6B7280; font-size: 14px;">
          <a href="${process.env.FRONTEND_URL}/dashboard" style="color: #4F46E5;">View in Dashboard</a>
        </p>
      </div>
    `;

    const text = `Payment Reminder

Hi ${invoice.name},

This is a reminder that Invoice #${invoice.invoice_number} is ${daysOverdue} days overdue.

Details:
- Project: ${invoice.project_name || 'N/A'}
- General Contractor: ${invoice.general_contractor || 'N/A'}
- Amount Due: $${Number(invoice.amount - invoice.amount_paid).toLocaleString()}
- Original Due Date: ${new Date(invoice.due_date).toLocaleDateString()}

Next Steps:
1. Send a formal demand letter
2. Call their accounts payable department
3. Verify preliminary notice was filed
4. Check your lien deadline (4 months from last work)

View in Dashboard: ${process.env.FRONTEND_URL}/dashboard`;

    // Send email via StackForDevs Mailer
    const response = await fetch(`${STACKFORDEVS_MAILER_URL}/v1/emails/send`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        to: invoice.email,
        from: FROM_EMAIL,
        subject,
        html,
        text
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send email');
    }

    // Also create an in-app notification
    await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        userId: invoice.user_id,
        title: `Invoice ${invoice.invoice_number} is ${daysOverdue} Days Overdue`,
        message: `Your invoice for ${invoice.project_name || 'N/A'} is overdue. Amount due: $${Number(invoice.amount - invoice.amount_paid).toLocaleString()}`,
        type: 'error',
        link: `/dashboard`,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number,
          daysOverdue,
          category: 'payment'
        }
      })
    });

    res.json({
      success: true,
      message: 'Payment reminder sent',
      messageId: data.messageId
    });
  } catch (error: any) {
    console.error('Error sending payment reminder:', error);
    res.status(500).json({ error: 'Failed to send payment reminder' });
  }
});

// Send deadline warning email
router.post('/send-deadline-warning', async (req: Request, res: Response) => {
  try {
    const { deadlineId } = req.body;

    if (!deadlineId) {
      return res.status(400).json({ error: 'deadlineId is required' });
    }

    // Get deadline details
    const deadlineResult = await query(
      `SELECT d.*, p.project_name, p.general_contractor, u.email, u.name
       FROM deadlines d
       LEFT JOIN projects p ON d.project_id = p.id
       LEFT JOIN users u ON d.user_id = u.id
       WHERE d.id = $1`,
      [deadlineId]
    );

    if (deadlineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    const deadline = deadlineResult.rows[0];

    // Calculate days remaining
    const deadlineDate = new Date(deadline.deadline_date);
    const today = new Date();
    const daysRemaining = Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const urgencyLevel = daysRemaining <= 7 ? 'URGENT' : daysRemaining <= 14 ? 'Important' : 'Upcoming';
    const urgencyColor = daysRemaining <= 7 ? '#DC2626' : daysRemaining <= 14 ? '#F59E0B' : '#4F46E5';

    const subject = `${urgencyLevel}: ${deadline.title} - ${daysRemaining} Days Remaining`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${urgencyColor};">${urgencyLevel} Deadline Alert</h2>

        <p>Hi ${deadline.name},</p>

        <p>You have <strong style="color: ${urgencyColor};">${daysRemaining} days remaining</strong> for the following deadline:</p>

        <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Deadline:</strong> ${deadline.title}</p>
          <p style="margin: 5px 0;"><strong>Type:</strong> ${deadline.deadline_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
          <p style="margin: 5px 0;"><strong>Project:</strong> ${deadline.project_name || 'N/A'}</p>
          <p style="margin: 5px 0;"><strong>Due Date:</strong> ${deadlineDate.toLocaleDateString()}</p>
          ${deadline.trigger_date ? `<p style="margin: 5px 0;"><strong>Trigger Date:</strong> ${new Date(deadline.trigger_date).toLocaleDateString()}</p>` : ''}
        </div>

        ${deadline.description ? `<p><strong>Details:</strong> ${deadline.description}</p>` : ''}

        <p><strong>Action Required:</strong></p>
        <p>Make sure to complete this deadline before ${deadlineDate.toLocaleDateString()} to protect your lien rights and payment entitlements under Colorado law.</p>

        <p style="background: #FEF3C7; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0;">
          <strong>⚠️ Important:</strong> Missing this deadline could jeopardize your ability to collect payment or file a mechanics lien.
        </p>

        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">
          This is an automated alert from PayForeman AI to help you protect your lien rights.
        </p>

        <p style="color: #6B7280; font-size: 14px;">
          <a href="${process.env.FRONTEND_URL}/dashboard" style="color: #4F46E5;">View in Dashboard</a>
        </p>
      </div>
    `;

    const text = `${urgencyLevel} Deadline Alert

Hi ${deadline.name},

You have ${daysRemaining} days remaining for this deadline:

${deadline.title}
Type: ${deadline.deadline_type.replace(/_/g, ' ')}
Project: ${deadline.project_name || 'N/A'}
Due Date: ${deadlineDate.toLocaleDateString()}

${deadline.description ? `Details: ${deadline.description}` : ''}

⚠️ IMPORTANT: Missing this deadline could jeopardize your ability to collect payment or file a mechanics lien.

View in Dashboard: ${process.env.FRONTEND_URL}/dashboard`;

    // Send email via StackForDevs Mailer
    const response = await fetch(`${STACKFORDEVS_MAILER_URL}/v1/emails/send`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        to: deadline.email,
        from: FROM_EMAIL,
        subject,
        html,
        text
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send email');
    }

    // Also create an in-app notification
    const notificationType = daysRemaining <= 7 ? 'error' : daysRemaining <= 14 ? 'warning' : 'info';
    await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        userId: deadline.user_id,
        title: `${urgencyLevel}: ${deadline.title}`,
        message: `You have ${daysRemaining} days remaining for this ${deadline.deadline_type.replace(/_/g, ' ')} deadline${deadline.project_name ? ` on ${deadline.project_name}` : ''}.`,
        type: notificationType,
        link: `/dashboard`,
        metadata: {
          deadlineId: deadline.id,
          deadlineType: deadline.deadline_type,
          daysRemaining,
          category: 'deadline'
        }
      })
    });

    res.json({
      success: true,
      message: 'Deadline warning sent',
      messageId: data.messageId
    });
  } catch (error: any) {
    console.error('Error sending deadline warning:', error);
    res.status(500).json({ error: 'Failed to send deadline warning' });
  }
});

export default router;
