import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all invoices for a user
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await query(
      `SELECT i.*, p.project_name, p.general_contractor
       FROM invoices i
       LEFT JOIN projects p ON i.project_id = p.id
       WHERE i.user_id = $1
       ORDER BY i.created_at DESC`,
      [userId]
    );

    res.json({ invoices: result.rows });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get single invoice with payment history
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const invoiceResult = await query(
      `SELECT i.*, p.project_name, p.general_contractor
       FROM invoices i
       LEFT JOIN projects p ON i.project_id = p.id
       WHERE i.id = $1`,
      [id]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const paymentsResult = await query(
      `SELECT * FROM payments
       WHERE invoice_id = $1
       ORDER BY payment_date DESC`,
      [id]
    );

    res.json({
      invoice: invoiceResult.rows[0],
      payments: paymentsResult.rows
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Create invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      projectId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      amount,
      retainagePercent = 0,
      description,
      notes
    } = req.body;

    if (!userId || !invoiceNumber || !invoiceDate || !dueDate || !amount) {
      return res.status(400).json({
        error: 'userId, invoiceNumber, invoiceDate, dueDate, and amount are required'
      });
    }

    const id = uuidv4();
    const retainageAmount = (amount * retainagePercent) / 100;

    const result = await query(
      `INSERT INTO invoices (
        id, user_id, project_id, invoice_number, invoice_date, due_date,
        amount, retainage_percent, retainage_amount, description, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id, userId, projectId, invoiceNumber, invoiceDate, dueDate,
        amount, retainagePercent, retainageAmount, description, notes
      ]
    );

    res.status(201).json({ invoice: result.rows[0] });
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Update invoice
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      invoiceNumber,
      invoiceDate,
      dueDate,
      amount,
      retainagePercent,
      paymentStatus,
      paidDate,
      description,
      notes
    } = req.body;

    // Calculate retainage if amount or percent changes
    let retainageAmount;
    if (amount !== undefined && retainagePercent !== undefined) {
      retainageAmount = (amount * retainagePercent) / 100;
    }

    const result = await query(
      `UPDATE invoices SET
        invoice_number = COALESCE($1, invoice_number),
        invoice_date = COALESCE($2, invoice_date),
        due_date = COALESCE($3, due_date),
        amount = COALESCE($4, amount),
        retainage_percent = COALESCE($5, retainage_percent),
        retainage_amount = COALESCE($6, retainage_amount),
        payment_status = COALESCE($7, payment_status),
        paid_date = COALESCE($8, paid_date),
        description = COALESCE($9, description),
        notes = COALESCE($10, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *`,
      [
        invoiceNumber, invoiceDate, dueDate, amount, retainagePercent,
        retainageAmount, paymentStatus, paidDate, description, notes, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ invoice: result.rows[0] });
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Add payment to invoice
router.post('/:id/payments', async (req: Request, res: Response) => {
  try {
    const { id: invoiceId } = req.params;
    const { paymentDate, amount, paymentMethod, checkNumber, notes } = req.body;

    if (!paymentDate || !amount) {
      return res.status(400).json({
        error: 'paymentDate and amount are required'
      });
    }

    const paymentId = uuidv4();

    // Insert payment
    const paymentResult = await query(
      `INSERT INTO payments (id, invoice_id, payment_date, amount, payment_method, check_number, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [paymentId, invoiceId, paymentDate, amount, paymentMethod, checkNumber, notes]
    );

    // Update invoice amount_paid and status
    await query(
      `UPDATE invoices
       SET amount_paid = amount_paid + $1,
           payment_status = CASE
             WHEN amount_paid + $1 >= amount THEN 'paid'
             WHEN amount_paid + $1 > 0 THEN 'partial'
             ELSE 'pending'
           END,
           paid_date = CASE
             WHEN amount_paid + $1 >= amount THEN $2
             ELSE paid_date
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [amount, paymentDate, invoiceId]
    );

    res.status(201).json({ payment: paymentResult.rows[0] });
  } catch (error) {
    console.error('Error adding payment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

// Get dashboard stats
router.get('/stats/dashboard', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Total outstanding
    const outstandingResult = await query(
      `SELECT COALESCE(SUM(amount - amount_paid), 0) as total_outstanding
       FROM invoices
       WHERE user_id = $1 AND payment_status != 'paid'`,
      [userId]
    );

    // Overdue amount
    const overdueResult = await query(
      `SELECT COALESCE(SUM(amount - amount_paid), 0) as total_overdue
       FROM invoices
       WHERE user_id = $1 AND payment_status != 'paid' AND due_date < CURRENT_DATE`,
      [userId]
    );

    // Active projects count
    const projectsResult = await query(
      `SELECT COUNT(*) as active_projects
       FROM projects
       WHERE user_id = $1 AND project_status = 'active'`,
      [userId]
    );

    res.json({
      totalOutstanding: parseFloat(outstandingResult.rows[0].total_outstanding),
      totalOverdue: parseFloat(overdueResult.rows[0].total_overdue),
      activeProjects: parseInt(projectsResult.rows[0].active_projects)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Delete invoice
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM invoices WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// Import invoices from CSV
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { userId, invoices } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({ error: 'No invoices to import' });
    }

    console.log(`📥 Importing ${invoices.length} invoices for user ${userId}`);

    // Map CSV columns to database fields
    const mappedInvoices = invoices.map((inv: any) => ({
      user_id: userId,
      invoice_number: inv.InvoiceNo || inv.invoice_number || '',
      project_name: inv.Project || inv.project || '',
      general_contractor: inv.Manager || inv.manager || '',
      category: inv.GroupBy || inv.category || '',
      amount: parseFloat(inv.Billed || inv.amount || 0),
      amount_paid: parseFloat(inv.Paid || inv.amount_paid || 0),
      due_date: inv.Date || inv.due_date || new Date().toISOString().split('T')[0],
      description: `Imported from CSV - ${inv.Project || ''}`,
      notes: inv.Notes || inv.notes || '',
      retainage_percent: 0,
      retainage_amount: 0,
    }));

    // Calculate payment status for each invoice
    const invoicesWithStatus = mappedInvoices.map((inv: any) => {
      const paid = parseFloat(inv.amount_paid) || 0;
      const billed = parseFloat(inv.amount) || 0;
      const dueDate = new Date(inv.due_date);
      const today = new Date();

      let payment_status = 'pending';
      if (paid >= billed) {
        payment_status = 'paid';
      } else if (paid > 0 && paid < billed) {
        payment_status = 'partial';
      } else if (dueDate < today && paid < billed) {
        payment_status = 'overdue';
      }

      return {
        ...inv,
        payment_status
      };
    });

    // Save to database
    let imported = 0;

    for (const invoice of invoicesWithStatus) {
      const result = await query(
        `INSERT INTO invoices (
          user_id, invoice_number, project_name, general_contractor, category,
          amount, amount_paid, invoice_date, due_date, description, notes, payment_status,
          retainage_percent, retainage_amount, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
        [
          invoice.user_id,
          invoice.invoice_number,
          invoice.project_name,
          invoice.general_contractor,
          invoice.category,
          invoice.amount,
          invoice.amount_paid,
          invoice.due_date,  // using as invoice_date
          invoice.due_date,  // also as due_date
          invoice.description,
          invoice.notes || '',
          invoice.payment_status,
          invoice.retainage_percent,
          invoice.retainage_amount
        ]
      );
      imported++;
    }

    console.log(`✅ Successfully imported ${imported} invoices`);
    return res.json({
      success: true,
      imported,
      message: `Successfully imported ${imported} invoices`
    });
  } catch (error: any) {
    console.error('❌ Import error:', error);
    return res.status(500).json({
      error: 'Failed to import invoices',
      details: error.message
    });
  }
});

export default router;
