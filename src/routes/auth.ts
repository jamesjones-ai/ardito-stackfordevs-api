import { Router, Request, Response } from 'express';

const router = Router();

// StackForDevs Auth Service configuration
const STACKFORDEVS_AUTH_URL = process.env.STACKFORDEVS_AUTH_API_URL || 'https://auth.stackfordevs.com';
const STACKFORDEVS_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.STACKFORDEVS_API_KEY!,
  'x-secret-key': process.env.STACKFORDEVS_SECRET_API_KEY!,
  'x-tenant-id': process.env.STACKFORDEVS_TENANT_ID!,
  'x-project-id': process.env.STACKFORDEVS_PROJECT_ID!,
};

// Signup endpoint - proxies to StackForDevs Auth
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name, company_name, phone } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: 'Password must include at least one uppercase letter' });
    }

    // Call StackForDevs Auth Service
    const response = await fetch(`${STACKFORDEVS_AUTH_URL}/v1/register`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({
        email,
        password,
        metadata: {
          name,
          company_name: company_name || '',
          phone: phone || '',
          app: 'payforeman'
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error || data.message || 'Signup failed'
      });
    }

    // Return StackForDevs response with token and user
    res.json({
      message: 'User created successfully',
      token: data.accessToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.metadata?.name || '',
        company_name: data.user.metadata?.company_name || '',
        phone: data.user.metadata?.phone || '',
      },
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Login endpoint - proxies to StackForDevs Auth
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Call StackForDevs Auth Service
    const response = await fetch(`${STACKFORDEVS_AUTH_URL}/v1/login`, {
      method: 'POST',
      headers: STACKFORDEVS_HEADERS,
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error || data.message || 'Login failed'
      });
    }

    // Return StackForDevs response with token and user
    res.json({
      message: 'Login successful',
      token: data.accessToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.metadata?.name || '',
        company_name: data.user.metadata?.company_name || '',
        phone: data.user.metadata?.phone || '',
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user (verify token with StackForDevs)
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    // Verify token with StackForDevs Auth Service
    const response = await fetch(`${STACKFORDEVS_AUTH_URL}/v1/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error || data.message || 'Token verification failed'
      });
    }

    // Return user data in PayForeman format
    res.json({
      user: {
        id: data.id,
        email: data.email,
        name: data.metadata?.name || '',
        company_name: data.metadata?.company_name || '',
        phone: data.metadata?.phone || '',
        created_at: data.createdAt
      }
    });
  } catch (error: any) {
    console.error('Auth verification error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
