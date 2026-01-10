import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all deadlines for a user
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, status } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let sql = `
      SELECT d.*, p.project_name, p.general_contractor
      FROM deadlines d
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE d.user_id = $1
    `;

    const params: any[] = [userId];

    if (status) {
      sql += ` AND d.status = $2`;
      params.push(status);
    }

    sql += ` ORDER BY d.deadline_date ASC`;

    const result = await query(sql, params);

    // Calculate days remaining for each deadline
    const deadlinesWithDays = result.rows.map(deadline => {
      const deadlineDate = new Date(deadline.deadline_date);
      const today = new Date();
      const diffTime = deadlineDate.getTime() - today.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Determine priority based on days remaining if not manually set
      let autoPriority = deadline.priority;
      if (!autoPriority || autoPriority === 'normal') {
        if (daysRemaining < 0) autoPriority = 'critical';
        else if (daysRemaining <= 7) autoPriority = 'critical';
        else if (daysRemaining <= 14) autoPriority = 'high';
        else if (daysRemaining <= 30) autoPriority = 'normal';
        else autoPriority = 'low';
      }

      return {
        ...deadline,
        days_remaining: daysRemaining,
        calculated_priority: autoPriority
      };
    });

    res.json({ deadlines: deadlinesWithDays });
  } catch (error) {
    console.error('Error fetching deadlines:', error);
    res.status(500).json({ error: 'Failed to fetch deadlines' });
  }
});

// Get upcoming deadlines (next 30 days)
router.get('/upcoming', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await query(
      `SELECT d.*, p.project_name, p.general_contractor
       FROM deadlines d
       LEFT JOIN projects p ON d.project_id = p.id
       WHERE d.user_id = $1
         AND d.status = 'pending'
         AND d.deadline_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
       ORDER BY d.deadline_date ASC
       LIMIT 10`,
      [userId]
    );

    res.json({ deadlines: result.rows });
  } catch (error) {
    console.error('Error fetching upcoming deadlines:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming deadlines' });
  }
});

// Create deadline
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      projectId,
      deadlineType,
      deadlineDate,
      triggerDate,
      title,
      description,
      priority = 'normal',
      notes
    } = req.body;

    if (!userId || !deadlineType || !deadlineDate || !title) {
      return res.status(400).json({
        error: 'userId, deadlineType, deadlineDate, and title are required'
      });
    }

    const id = uuidv4();

    const result = await query(
      `INSERT INTO deadlines (
        id, user_id, project_id, deadline_type, deadline_date, trigger_date,
        title, description, priority, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id, userId, projectId, deadlineType, deadlineDate, triggerDate,
        title, description, priority, notes
      ]
    );

    res.status(201).json({ deadline: result.rows[0] });
  } catch (error) {
    console.error('Error creating deadline:', error);
    res.status(500).json({ error: 'Failed to create deadline' });
  }
});

// Calculate deadline based on Colorado lien law
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { deadlineType, triggerDate, projectType = 'private' } = req.body;

    if (!deadlineType || !triggerDate) {
      return res.status(400).json({
        error: 'deadlineType and triggerDate are required'
      });
    }

    // Get Colorado lien law rule
    const ruleResult = await query(
      `SELECT * FROM colorado_lien_rules
       WHERE rule_type = $1 AND project_type = $2
       LIMIT 1`,
      [deadlineType, projectType]
    );

    if (ruleResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No Colorado lien law rule found for this deadline type'
      });
    }

    const rule = ruleResult.rows[0];
    const trigger = new Date(triggerDate);
    const deadline = new Date(trigger);
    deadline.setDate(deadline.getDate() + rule.deadline_days);

    res.json({
      deadlineDate: deadline.toISOString().split('T')[0],
      deadlineDays: rule.deadline_days,
      description: rule.description,
      triggerEvent: rule.trigger_event,
      statutoryReference: rule.statutory_reference
    });
  } catch (error) {
    console.error('Error calculating deadline:', error);
    res.status(500).json({ error: 'Failed to calculate deadline' });
  }
});

// Auto-create deadlines for a project
router.post('/auto-create', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      projectId,
      workStartDate,
      workEndDate,
      projectType = 'private'
    } = req.body;

    if (!userId || !projectId) {
      return res.status(400).json({
        error: 'userId and projectId are required'
      });
    }

    const createdDeadlines: any[] = [];

    // Get project details
    const projectResult = await query(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = projectResult.rows[0];
    const startDate = new Date(workStartDate || project.work_start_date);
    const endDate = workEndDate ? new Date(workEndDate) : null;

    // Create preliminary notice deadline (10 days from start)
    if (startDate && projectType === 'private') {
      const prelimDeadline = new Date(startDate);
      prelimDeadline.setDate(prelimDeadline.getDate() + 10);

      const prelimId = uuidv4();
      const prelimResult = await query(
        `INSERT INTO deadlines (
          id, user_id, project_id, deadline_type, deadline_date, trigger_date,
          title, description, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          prelimId,
          userId,
          projectId,
          'preliminary_notice',
          prelimDeadline.toISOString().split('T')[0],
          startDate.toISOString().split('T')[0],
          `Preliminary Notice - ${project.project_name}`,
          'Send preliminary notice within 10 days of starting work (Colorado law)',
          'high'
        ]
      );
      createdDeadlines.push(prelimResult.rows[0]);
    }

    // Create mechanics lien deadline (120 days from end)
    if (endDate) {
      const lienDeadline = new Date(endDate);
      lienDeadline.setDate(lienDeadline.getDate() + 120);

      const lienId = uuidv4();
      const lienResult = await query(
        `INSERT INTO deadlines (
          id, user_id, project_id, deadline_type, deadline_date, trigger_date,
          title, description, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          lienId,
          userId,
          projectId,
          projectType === 'private' ? 'mechanics_lien' : 'payment_bond_claim',
          lienDeadline.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          `${projectType === 'private' ? 'Mechanics Lien' : 'Payment Bond Claim'} Filing - ${project.project_name}`,
          `File ${projectType === 'private' ? 'mechanics lien' : 'payment bond claim'} within 4 months of last work (Colorado law)`,
          'critical'
        ]
      );
      createdDeadlines.push(lienResult.rows[0]);
    }

    res.status(201).json({ deadlines: createdDeadlines });
  } catch (error) {
    console.error('Error auto-creating deadlines:', error);
    res.status(500).json({ error: 'Failed to auto-create deadlines' });
  }
});

// Update deadline
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      deadlineDate,
      title,
      description,
      status,
      priority,
      notes,
      completedDate
    } = req.body;

    const result = await query(
      `UPDATE deadlines SET
        deadline_date = COALESCE($1, deadline_date),
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        status = COALESCE($4, status),
        priority = COALESCE($5, priority),
        notes = COALESCE($6, notes),
        completed_date = COALESCE($7, completed_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *`,
      [deadlineDate, title, description, status, priority, notes, completedDate, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    res.json({ deadline: result.rows[0] });
  } catch (error) {
    console.error('Error updating deadline:', error);
    res.status(500).json({ error: 'Failed to update deadline' });
  }
});

// Mark deadline as completed
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE deadlines SET
        status = 'completed',
        completed_date = CURRENT_DATE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    res.json({ deadline: result.rows[0] });
  } catch (error) {
    console.error('Error completing deadline:', error);
    res.status(500).json({ error: 'Failed to complete deadline' });
  }
});

// Delete deadline
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM deadlines WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    res.json({ message: 'Deadline deleted successfully' });
  } catch (error) {
    console.error('Error deleting deadline:', error);
    res.status(500).json({ error: 'Failed to delete deadline' });
  }
});

export default router;
