# Ardito StackForDevs API Proxy

Express API server that proxies requests to StackForDevs backend services for the Ardito Emotion Intelligence Platform.

## Services

This API provides secure access to:
- **Authentication**: User registration, login, and session management
- **Notifications**: In-app notification system
- **Mailer**: Transactional email service
- **LLM**: AI completions using OpenAI/Anthropic
- **CMS**: Content management system
- **Billing**: Stripe subscription management

## Deployment to Render

### Option 1: One-Click Deploy (Recommended)

1. Push this repository to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New +" → "Blueprint"
4. Connect your GitHub repository
5. Render will automatically detect `render.yaml` and set up the service
6. Add your environment variables in the Render dashboard:
   - `STACKFORDEVS_TENANT_ID`
   - `STACKFORDEVS_PROJECT_ID`
   - `STACKFORDEVS_API_KEY`
   - `STACKFORDEVS_SECRET_API_KEY`

### Option 2: Manual Deploy

1. Push this repository to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name**: ardito-stackfordevs-api
   - **Environment**: Docker
   - **Dockerfile Path**: ./Dockerfile
   - **Port**: 3001
6. Add environment variables (see `.env.example`)
7. Click "Create Web Service"

## Environment Variables

Get your credentials from the [StackForDevs Admin Dashboard](https://admin.stackfordevs.com):

```
STACKFORDEVS_TENANT_ID=your-tenant-id
STACKFORDEVS_PROJECT_ID=your-project-id
STACKFORDEVS_API_KEY=stk_pub_your-public-key
STACKFORDEVS_SECRET_API_KEY=stk_sec_your-secret-key
```

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your credentials

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## API Endpoints

All endpoints are proxied to StackForDevs services:

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user

### Additional Services
See StackForDevs documentation for complete API reference.

## Security

- Secret keys are kept server-side only
- All requests are proxied through this server
- Frontend never has direct access to StackForDevs APIs
- CORS configured for your frontend domain
