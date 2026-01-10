import { Router, Request, Response } from 'express';

const router = Router();

// StackForDevs Notifications Service configuration
const STACKFORDEVS_NOTIFICATIONS_URL = process.env.STACKFORDEVS_NOTIFICATIONS_API_URL || 'https://notifications.stackfordevs.com';
const STACKFORDEVS_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.STACKFORDEVS_API_KEY!,
  'x-secret-key': process.env.STACKFORDEVS_SECRET_API_KEY!,
  'x-tenant-id': process.env.STACKFORDEVS_TENANT_ID!,
  'x-project-id': process.env.STACKFORDEVS_PROJECT_ID!,
};

// Create a notification
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { userId, title, message, type, link, metadata, expiresIn } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    // Call StackForDevs Notifications Service
    const response = await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        userId: userId || null,
        title,
        message,
        type: type || 'info',
        link: link || null,
        metadata: metadata || {},
        expiresIn: expiresIn || 2592000 // 30 days default
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create notification');
    }

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// Get notifications for a user
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { userId, unreadOnly, limit, offset } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Build query string
    const params = new URLSearchParams({
      userId: userId as string,
      ...(unreadOnly && { unreadOnly: unreadOnly as string }),
      ...(limit && { limit: limit as string }),
      ...(offset && { offset: offset as string })
    });

    const response = await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications?${params}`, {
      method: 'GET',
      headers: STACKFORDEVS_HEADERS
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch notifications');
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get a single notification
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const response = await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications/${id}`, {
      method: 'GET',
      headers: STACKFORDEVS_HEADERS
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching notification:', error);
    res.status(500).json({ error: 'Failed to fetch notification' });
  }
});

// Mark a notification as read
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const response = await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications/${id}/read`, {
      method: 'PATCH',
      headers: STACKFORDEVS_HEADERS
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to mark as read');
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read for a user
router.patch('/mark-all-read', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    const params = userId ? new URLSearchParams({ userId: userId as string }) : '';

    const response = await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications/mark-all-read${params ? `?${params}` : ''}`, {
      method: 'PATCH',
      headers: STACKFORDEVS_HEADERS
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to mark all as read');
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Delete a notification (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const response = await fetch(`${STACKFORDEVS_NOTIFICATIONS_URL}/api/notifications/${id}`, {
      method: 'DELETE',
      headers: STACKFORDEVS_HEADERS
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete notification');
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

export default router;
