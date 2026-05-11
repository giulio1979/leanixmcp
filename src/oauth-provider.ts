/**
 * MCP-Level OAuth Provider (Demo/Reference Implementation)
 *
 * Implements the OAuthServerProvider interface from the MCP SDK.
 * This is an in-memory demo — production deployments should integrate
 * with a real identity provider (Azure AD, LeanIX OAuth, etc.).
 *
 * Based on the SDK's demoInMemoryOAuthProvider.ts pattern.
 */

import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * In-memory client registration store.
 */
export class DemoClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(clientMetadata: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    this.clients.set(clientMetadata.client_id, clientMetadata);
    return clientMetadata;
  }
}

interface CodeData {
  params: AuthorizationParams;
  client: OAuthClientInformationFull;
}

/**
 * In-memory OAuth provider for MCP-level authentication.
 *
 * WARNING: Demo only — not for production use.
 * Missing: persistent storage, rate limiting, proper user authentication.
 */
export class DemoOAuthProvider implements OAuthServerProvider {
  clientsStore = new DemoClientsStore();
  private codes = new Map<string, CodeData>();
  private tokens = new Map<string, AuthInfo>();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const code = randomUUID();

    const searchParams = new URLSearchParams({ code });
    if (params.state !== undefined) {
      searchParams.set('state', params.state);
    }

    this.codes.set(code, { client, params });

    // Validate redirect_uri
    if (!client.redirect_uris || !client.redirect_uris.includes(params.redirectUri)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Unregistered redirect_uri' });
      return;
    }

    // Auto-approve (demo only — real implementation would show login/consent UI)
    const targetUrl = new URL(params.redirectUri);
    targetUrl.search = searchParams.toString();
    res.redirect(targetUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error('Invalid authorization code');
    }
    return codeData.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string
  ): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error('Invalid authorization code');
    }

    if (codeData.client.client_id !== client.client_id) {
      throw new Error('Authorization code was not issued to this client');
    }

    this.codes.delete(authorizationCode);
    const token = randomUUID();

    const tokenData: AuthInfo = {
      token,
      clientId: client.client_id,
      scopes: codeData.params.scopes || [],
      expiresAt: Math.floor((Date.now() + 3600000) / 1000), // 1 hour
    };

    this.tokens.set(token, tokenData);

    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      scope: (codeData.params.scopes || []).join(' '),
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
    _scopes?: string[]
  ): Promise<OAuthTokens> {
    throw new Error('Refresh tokens not supported in demo provider');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = this.tokens.get(token);
    if (!tokenData || !tokenData.expiresAt || tokenData.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new Error('Invalid or expired token');
    }
    return tokenData;
  }
}
