import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// StackForDevs LLM Service configuration
const STACKFORDEVS_LLM_URL = process.env.STACKFORDEVS_LLM_API_URL || 'https://llm.stackfordevs.com';
const STACKFORDEVS_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.STACKFORDEVS_API_KEY!,
  'x-secret-key': process.env.STACKFORDEVS_SECRET_API_KEY!,
  'x-tenant-id': process.env.STACKFORDEVS_TENANT_ID!,
  'x-project-id': process.env.STACKFORDEVS_PROJECT_ID!,
};

// System prompt for the AI Collections Specialist
const SYSTEM_PROMPT = `You are an AI Collections Specialist for PayForeman AI, specifically helping Colorado subcontractors collect payment from general contractors. You are an expert in:

1. Colorado Mechanics Lien Law (C.R.S. § 38-22-101 et seq.)
2. Construction payment collection strategies
3. Preliminary notice requirements in Colorado
4. Payment bond claims on public projects
5. Retainage management and release

Key Colorado Lien Law Facts:
- Preliminary Notice: Must be sent within 10 days of first furnishing labor or materials on private projects
- Mechanics Lien Filing: Must file within 4 months (120 days) from last day of work
- Public Projects: Payment bond claims instead of liens
- Retainage: Typically 5-10%, released after project completion

Your Role:
- Provide accurate, actionable advice on Colorado construction payment issues
- Help subcontractors understand their lien rights
- Suggest next steps for overdue payments
- Calculate deadlines based on work dates
- Explain payment terms and contract clauses
- Be professional, empathetic, and solution-focused

Always:
- Reference specific Colorado statutes when relevant
- Provide clear step-by-step guidance
- Warn about critical deadlines
- Suggest documentation to preserve lien rights
- Recommend when to consult an attorney for complex issues

Never:
- Provide legal advice (you assist, not replace attorneys)
- Guarantee outcomes
- Suggest illegal or unethical collection tactics`;

// Get chat history for a user
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { userId, limit = 50 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await query(
      `SELECT * FROM chat_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({ messages: result.rows.reverse() });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Send message to AI and get response
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { userId, message, projectId, invoiceId } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    // Save user message to history
    const userMessageId = uuidv4();
    await query(
      `INSERT INTO chat_history (id, user_id, message, role, project_id, invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userMessageId, userId, message, 'user', projectId, invoiceId]
    );

    // Get recent chat history for context (last 10 messages)
    const historyResult = await query(
      `SELECT message, role FROM chat_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    const chatHistory = historyResult.rows.reverse();

    // Build messages array for Claude with system prompt
    const messages = [
      { role: 'user', content: SYSTEM_PROMPT },
      { role: 'assistant', content: 'Understood. I am your AI Collections Specialist for Colorado construction payment issues. How can I help you today?' },
      ...chatHistory.map(msg => ({
        role: msg.role,
        content: msg.message
      }))
    ];

    // Call StackForDevs LLM Service
    const llmResponse = await fetch(`${STACKFORDEVS_LLM_URL}/v1/completion`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        messages,
        model: 'claude-3-5-sonnet-20241022',
        providerType: 'anthropic',
        maxTokens: 2048,
        temperature: 0.7,
        complexityScore: 50
      })
    });

    if (!llmResponse.ok) {
      const errorData = await llmResponse.json().catch(() => ({}));
      throw new Error(`LLM Service error: ${llmResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const llmData = await llmResponse.json();
    const assistantMessage = llmData.content || 'Sorry, I could not generate a response.';

    // Save assistant response to history
    const assistantMessageId = uuidv4();
    await query(
      `INSERT INTO chat_history (id, user_id, message, role, project_id, invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [assistantMessageId, userId, assistantMessage, 'assistant', projectId, invoiceId]
    );

    res.json({
      message: assistantMessage,
      messageId: assistantMessageId
    });
  } catch (error: any) {
    console.error('Error processing chat message:', error);

    if (error?.status === 401) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    res.status(500).json({
      error: 'Failed to process message',
      details: error?.message
    });
  }
});

// Get AI suggestions for a specific invoice
router.post('/suggest-action', async (req: Request, res: Response) => {
  try {
    const { userId, invoiceId } = req.body;

    if (!userId || !invoiceId) {
      return res.status(400).json({ error: 'userId and invoiceId are required' });
    }

    // Get invoice details
    const invoiceResult = await query(
      `SELECT i.*, p.project_name, p.general_contractor, p.project_type, p.work_start_date, p.work_end_date
       FROM invoices i
       LEFT JOIN projects p ON i.project_id = p.id
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

    const userPrompt = `I have an invoice with the following details:
- Invoice #${invoice.invoice_number}
- Amount: $${invoice.amount}
- Amount Paid: $${invoice.amount_paid}
- Balance Due: $${invoice.amount - invoice.amount_paid}
- Due Date: ${invoice.due_date}
- Days ${daysOverdue > 0 ? 'Overdue' : 'Until Due'}: ${Math.abs(daysOverdue)}
- Status: ${invoice.payment_status}
- General Contractor: ${invoice.general_contractor}
- Project: ${invoice.project_name}
${invoice.work_start_date ? `- Work Start Date: ${invoice.work_start_date}` : ''}
${invoice.work_end_date ? `- Work End Date: ${invoice.work_end_date}` : ''}

What should I do next to collect payment? Please provide specific, actionable steps.`;

    // Call StackForDevs LLM Service
    const llmResponse = await fetch(`${STACKFORDEVS_LLM_URL}/v1/completion`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        messages: [
          { role: 'user', content: SYSTEM_PROMPT },
          { role: 'assistant', content: 'Understood. I am your AI Collections Specialist for Colorado construction payment issues.' },
          { role: 'user', content: userPrompt }
        ],
        model: 'claude-3-5-sonnet-20241022',
        providerType: 'anthropic',
        maxTokens: 2048,
        temperature: 0.7,
        complexityScore: 50
      })
    });

    if (!llmResponse.ok) {
      const errorData = await llmResponse.json().catch(() => ({}));
      throw new Error(`LLM Service error: ${llmResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const llmData = await llmResponse.json();
    const suggestion = llmData.content || 'Unable to generate suggestion';

    res.json({ suggestion });
  } catch (error) {
    console.error('Error generating AI suggestion:', error);
    res.status(500).json({ error: 'Failed to generate suggestion' });
  }
});

// Clear chat history for a user
router.delete('/history', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await query(
      'DELETE FROM chat_history WHERE user_id = $1',
      [userId]
    );

    res.json({ message: 'Chat history cleared successfully' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

export default router;
