/**
 * JWT Verification Example
 *
 * This file demonstrates how to verify JWT tokens from StackForDevs
 * on your backend using public keys from the JWKS endpoint.
 *
 * This is OPTIONAL - you don't need to verify tokens yourself unless
 * you want to validate them before calling StackForDevs APIs.
 *
 * SETUP REQUIRED:
 * To use this example, install the required dependencies:
 *   npm install jsonwebtoken jwks-rsa
 *   npm install --save-dev @types/jsonwebtoken @types/jwks-rsa
 *
 * Then rename this file from .example.ts to .ts and import it in your routes.
 *
 * For full documentation, see: https://docs.stackfordevs.com/jwt-verification.html
 */

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { Request, Response, NextFunction } from 'express';

const PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID!;

// Create JWKS client to fetch public keys
const client = jwksClient({
  jwksUri: `https://auth.stackfordevs.com/projects/${PROJECT_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
  rateLimit: true,
  jwksRequestsPerMinute: 10
});

/**
 * Interface for the JWT payload from StackForDevs
 */
interface StackForDevsTokenPayload {
  sub: string;             // User ID
  tenantId: string;        // Tenant ID
  projectId: string;       // Project ID
  type: 'access' | 'refresh';
  email: string;           // User's email address
  email_verified: boolean; // Whether email is verified
  iat: number;             // Issued at
  exp: number;             // Expires at
}

/**
 * Verify a JWT token from StackForDevs
 *
 * @param token - The JWT token to verify
 * @returns The decoded token payload
 * @throws Error if token is invalid
 */
export async function verifyStackForDevsToken(token: string): Promise<StackForDevsTokenPayload> {
  // Decode to get the kid (key ID) from the header
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw new Error('Invalid token format');
  }

  const kid = decoded.header.kid;

  // Get the signing key from JWKS endpoint
  const key = await client.getSigningKey(kid);
  const publicKey = key.getPublicKey();

  // Verify the token
  const verified = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
  }) as StackForDevsTokenPayload;

  // Validate the projectId matches
  if (verified.projectId !== PROJECT_ID) {
    throw new Error('Token projectId does not match this application');
  }

  return verified;
}

/**
 * Express middleware to verify JWT tokens
 *
 * Usage:
 * app.get('/api/protected', verifyTokenMiddleware, (req, res) => {
 *   res.json({ user: req.user });
 * });
 */
export async function verifyTokenMiddleware(
  req: Request & { user?: StackForDevsTokenPayload },
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const verified = await verifyStackForDevsToken(token);
    req.user = verified; // Attach user info to request
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).json({
      error: 'Invalid token',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Example usage in your API routes:
 *
 * import { verifyTokenMiddleware } from './jwt-verification.example';
 *
 * // Protect a route
 * app.get('/api/protected', verifyTokenMiddleware, (req, res) => {
 *   res.json({
 *     message: 'Hello authenticated user!',
 *     userId: req.user.sub,
 *     email: req.user.email,
 *     emailVerified: req.user.email_verified,
 *     tenantId: req.user.tenantId,
 *     projectId: req.user.projectId
 *   });
 * });
 *
 * // Or verify tokens manually
 * app.post('/api/custom-auth', async (req, res) => {
 *   try {
 *     const token = req.headers.authorization?.replace('Bearer ', '');
 *     const payload = await verifyStackForDevsToken(token);
 *
 *     // Do something with the verified payload
 *     res.json({ success: true, userId: payload.sub });
 *   } catch (error) {
 *     res.status(401).json({ error: 'Invalid token' });
 *   }
 * });
 */
