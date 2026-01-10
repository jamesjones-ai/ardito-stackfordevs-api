import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all projects for a user
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await query(
      `SELECT * FROM projects
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ projects: result.rows });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM projects WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ project: result.rows[0] });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create project
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      projectName,
      generalContractor,
      projectAddress,
      projectCity,
      projectState = 'CO',
      projectType,
      workStartDate,
      workEndDate,
      notes
    } = req.body;

    if (!userId || !projectName || !generalContractor) {
      return res.status(400).json({
        error: 'userId, projectName, and generalContractor are required'
      });
    }

    const id = uuidv4();

    const result = await query(
      `INSERT INTO projects (
        id, user_id, project_name, general_contractor, project_address,
        project_city, project_state, project_type, work_start_date,
        work_end_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id, userId, projectName, generalContractor, projectAddress,
        projectCity, projectState, projectType, workStartDate,
        workEndDate, notes
      ]
    );

    res.status(201).json({ project: result.rows[0] });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      projectName,
      generalContractor,
      projectAddress,
      projectCity,
      projectState,
      projectType,
      workStartDate,
      workEndDate,
      projectStatus,
      notes
    } = req.body;

    const result = await query(
      `UPDATE projects SET
        project_name = COALESCE($1, project_name),
        general_contractor = COALESCE($2, general_contractor),
        project_address = COALESCE($3, project_address),
        project_city = COALESCE($4, project_city),
        project_state = COALESCE($5, project_state),
        project_type = COALESCE($6, project_type),
        work_start_date = COALESCE($7, work_start_date),
        work_end_date = COALESCE($8, work_end_date),
        project_status = COALESCE($9, project_status),
        notes = COALESCE($10, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *`,
      [
        projectName, generalContractor, projectAddress, projectCity,
        projectState, projectType, workStartDate, workEndDate,
        projectStatus, notes, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ project: result.rows[0] });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM projects WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
