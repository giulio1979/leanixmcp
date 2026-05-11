/**
 * LeanIX API Client
 *
 * HTTP client for interacting with LeanIX APIs with OAuth2 authentication,
 * token refresh, and metamodel caching.
 */

export interface LeanIXConfig {
  baseUrl: string;
  workspaceId: string;
  apiToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl: string;
  pathfinderUrl: string;
  verifySsl: boolean;
}

export function loadConfig(): LeanIXConfig {
  return {
    baseUrl: process.env.LEANIX_BASE_URL || 'https://app.leanix.net',
    workspaceId: process.env.LEANIX_WORKSPACE_ID || '',
    apiToken: process.env.LEANIX_API_TOKEN || process.env.LEANIX_APIKEY,
    clientId: process.env.LEANIX_CLIENT_ID,
    clientSecret: process.env.LEANIX_CLIENT_SECRET,
    tokenUrl: '/services/mtm/v1/oauth2/token',
    pathfinderUrl: '/services/pathfinder/v1',
    verifySsl: (process.env.LEANIX_VERIFY_SSL || 'true').toLowerCase() !== 'false',
  };
}

export class LeanIXClient {
  private config: LeanIXConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null; // epoch ms
  private metamodelCache: Record<string, unknown> | null = null;

  constructor(config: LeanIXConfig) {
    this.config = config;
  }

  /**
   * Authenticate with LeanIX and obtain an access token.
   * Supports API token (HTTP Basic) and OAuth2 client_credentials.
   */
  async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return; // Still valid
    }

    const tokenUrl = new URL(this.config.tokenUrl, this.config.baseUrl).href;

    if (this.config.apiToken) {
      // LeanIX API token flow: HTTP Basic with 'apitoken' as username
      // Use redirect:'manual' because Node.js fetch strips Authorization on cross-origin redirects
      const credentials = Buffer.from(`apitoken:${this.config.apiToken}`).toString('base64');
      const headers: Record<string, string> = {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      let response = await fetch(tokenUrl, {
        method: 'POST',
        headers,
        body: 'grant_type=client_credentials',
        redirect: 'manual',
      });

      // Follow redirect manually, preserving the Authorization header
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          response = await fetch(location, {
            method: 'POST',
            headers,
            body: 'grant_type=client_credentials',
          });
        }
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LeanIX authentication failed (API token): ${response.status} ${text}`);
      }

      const data = await response.json() as { access_token: string; expires_in?: number };
      this.accessToken = data.access_token;
      const expiresIn = data.expires_in ?? 3600;
      this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000; // 5 min buffer
      return;
    }

    if (this.config.clientId && this.config.clientSecret) {
      // OAuth2 client_credentials flow
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LeanIX authentication failed (OAuth2): ${response.status} ${text}`);
      }

      const data = await response.json() as { access_token: string; expires_in?: number };
      this.accessToken = data.access_token;
      const expiresIn = data.expires_in ?? 3600;
      this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;
      return;
    }

    throw new Error('No LeanIX credentials configured. Provide LEANIX_API_TOKEN or LEANIX_CLIENT_ID + LEANIX_CLIENT_SECRET.');
  }

  /**
   * Make an authenticated request to LeanIX API.
   * Handles token refresh and one 401 retry.
   */
  private async request(method: string, endpoint: string, options?: { json?: unknown; headers?: Record<string, string> }): Promise<Response> {
    await this.authenticate();

    const url = new URL(endpoint, this.config.baseUrl).href;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      ...options?.headers,
    };

    const fetchOptions: RequestInit = { method, headers };
    if (options?.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.json);
    }

    let response = await fetch(url, fetchOptions);

    // On 401, re-authenticate once and retry
    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiresAt = null;
      await this.authenticate();
      headers['Authorization'] = `Bearer ${this.accessToken}`;
      response = await fetch(url, { ...fetchOptions, headers });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LeanIX request failed: ${method} ${endpoint} → ${response.status} ${text}`);
    }

    return response;
  }

  /**
   * Get the workspace metamodel. Returns compressed version by default.
   */
  async getMetamodel(options?: { refresh?: boolean; compressed?: boolean }): Promise<Record<string, unknown>> {
    const { refresh = false, compressed = true } = options || {};

    if (this.metamodelCache && !refresh) {
      return this.metamodelCache;
    }

    const endpoint = `${this.config.pathfinderUrl}/metaModel`;
    const response = await this.request('GET', endpoint);
    const rawMetamodel = await response.json() as Record<string, unknown>;

    if (compressed) {
      const { compressMetamodel } = await import('./metamodel-utils.js');
      this.metamodelCache = compressMetamodel(rawMetamodel);
    } else {
      this.metamodelCache = rawMetamodel;
    }

    return this.metamodelCache;
  }

  /**
   * Execute a GraphQL query/mutation against the LeanIX Pathfinder API.
   */
  async executeGraphql(query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const endpoint = `${this.config.pathfinderUrl}/graphql`;
    const payload: Record<string, unknown> = { query };
    if (variables && Object.keys(variables).length > 0) {
      payload.variables = variables;
    }

    const response = await this.request('POST', endpoint, { json: payload });
    return await response.json() as Record<string, unknown>;
  }
}
