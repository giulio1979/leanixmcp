/**
 * LeanIX MCP Server — Tool Registrations
 *
 * Registers 3 tools on the MCP server:
 *   1. get_metamodel_summary — workspace metamodel in compact CSV format
 *   2. graphql_query — read-only GraphQL queries
 *   3. graphql_mutation — write GraphQL mutations
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LeanIXClient } from './leanix-client.js';
import { getMetamodelSummary } from './metamodel-summary.js';
import { encodeMetamodelToCsv } from './csv-encoder.js';

/**
 * Sanitize a GraphQL operation string by removing comments and string literals,
 * so keyword checks cannot be bypassed via embedded text.
 */
function sanitizeGraphql(query: string): string {
  return query
    .replace(/"""[\s\S]*?"""/g, '')      // block (triple-quote) strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '')   // regular string literals
    .replace(/#.*$/gm, '');               // line comments
}

function containsMutation(query: string): boolean {
  return /\bmutation\b/i.test(sanitizeGraphql(query));
}

function containsQueryKeyword(query: string): boolean {
  return /\bquery\b/i.test(sanitizeGraphql(query));
}

/**
 * Create and configure the MCP server with LeanIX tools.
 */
export function createMcpServer(client: LeanIXClient): McpServer {
  const server = new McpServer(
    {
      name: 'LeanIX Enterprise Architecture Server',
      version: '1.0.0',
    },
    {
      instructions: `Provides LeanIX Enterprise Architecture management capabilities via metamodel inspection and GraphQL.
HARD RULE: get_metamodel_summary should be called before using any other tools in a session to ensure we have
a good understanding of fact sheets, relations, and display names that users see.`,
      capabilities: { logging: {} },
    }
  );

  // ─── Tool 1: get_metamodel_summary ────────────────────────────────────────────

  server.registerTool(
    'get_metamodel_summary',
    {
      title: 'Get Metamodel Summary',
      description: `Get a summary of the LeanIX metamodel including available fact sheet types and relations.

HARD RULE: This tool should be called before using any other tools in a session to ensure we have
a good understanding of fact sheets, relations, and display names that users see.

Returns information about the LeanIX data model structure in compact CSV format, including:
- Fact sheet types with their internal type names and English display names
- Fields per fact sheet type: name, type, section, mandatory/readOnly flags, allowed values
- Supported relations per fact sheet type: from/to types and display name
- A global deduplicated relations map across all types

Args:
  factsheet_type: When provided (e.g. "Application", "ITComponent"), return only that
      single fact sheet type with ALL attributes — including inFacet flags and lx-prefixed
      internal custom fields. Use this for deep inspection of one type.
      When omitted (default), all fact sheet types are returned but lx-prefixed fields
      and the inFacet flag are excluded to keep the response compact.

Important: The 'display_name' field shows the user-facing label that appears in the LeanIX UI.
These labels may differ from the internal type names. For example:
- Type "Product" may display as "Business Organization"
- Type "requirement" may have a custom display name

Always use the internal type name (not display_name) when using other tools like
graphql_query or graphql_mutation.`,
      inputSchema: {
        factsheet_type: z.string().optional().describe(
          'Single fact sheet type key to inspect in detail (e.g. "Application"). Omit for all types in compact mode.'
        ),
      },
    },
    async ({ factsheet_type }): Promise<CallToolResult> => {
      try {
        const summary = await getMetamodelSummary(client, factsheet_type);
        const csv = encodeMetamodelToCsv(summary);
        return { content: [{ type: 'text', text: csv }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Error getting metamodel summary: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 2: graphql_query ────────────────────────────────────────────────────

  server.registerTool(
    'graphql_query',
    {
      title: 'GraphQL Query',
      description: `Execute a read-only GraphQL query against LeanIX.

Use this tool for fetching data — searching fact sheets, reading details, listing relations, etc.
For write operations (create, update, delete), use graphql_mutation instead.

Key Fields for Filtering:
  - fullTextSearch: Search across displayName, description, and text fields
  - displayName: Filter by exact or partial display names
  - facetFilters: Filter by type, tags, lifecycle, technical fit, etc.
  - externalIds: Filter by external ID paths (format: 'externalId/123')
  - ids: Filter by specific fact sheet IDs

Examples:

  # 1. Search applications containing "INFOR" (text search)
  query=\`
  query SearchInfor($filter: FilterInput!) {
    allFactSheets(filter: $filter) {
      totalCount
      edges { node { id displayName description } }
    }
  }
  \`
  variables={
    "filter": {
      "facetFilters": [{"facetKey": "FactSheetTypes", "keys": ["Application"]}],
      "fullTextSearch": "INFOR"
    }
  }

  # 2. Filter by type and technical fit
  query=\`
  query TechnicalFit($filter: FilterInput!) {
    allFactSheets(filter: $filter) {
      edges { node { ... on Application { id displayName technicalSuitability } } }
    }
  }
  \`
  variables={
    "filter": {
      "facetFilters": [
        {"facetKey": "FactSheetTypes", "keys": ["Application"]},
        {"facetKey": "technicalSuitability", "keys": ["unreasonable"]}
      ]
    }
  }

  # 3. Filter by lifecycle phase with date range
  variables={
    "filter": {
      "facetFilters": [
        {"facetKey": "FactSheetTypes", "keys": ["Application"]},
        {"facetKey": "lifecycle", "keys": ["phaseIn"], "dateFilter": {"type": "RANGE", "from": "2023-01-01", "to": "2029-12-31"}}
      ]
    }
  }

  # 4. Filter by tags (use tag IDs, not names)
  variables={
    "filter": {
      "facetFilters": [
        {"facetKey": "FactSheetTypes", "keys": ["Platform"]},
        {"facetKey": "_TAGS_", "operator": "AND", "keys": ["tag-id-1", "tag-id-2"]}
      ]
    }
  }

  # 5. Get a factsheet by ID with related objects
  query=\`
  query getProviderApplications($id: ID!) {
    factSheet(id: $id) {
      id displayName
      ... on Provider {
        relProviderToApplication {
          totalCount
          edges { node { factSheet { id displayName } } }
        }
      }
    }
  }
  \`

  # 6. Get subscription roles
  query=\`
  query { allSubscriptionRoles { edges { node { id name description } } } }
  \``,
      inputSchema: {
        query: z.string().describe('GraphQL query string (must be valid GraphQL syntax, read-only operations only)'),
        variables: z.record(z.unknown()).optional().describe('Optional GraphQL query variables as key-value pairs'),
      },
    },
    async ({ query, variables }): Promise<CallToolResult> => {
      // Validate: reject mutations (strip comments/strings to prevent bypass)
      if (containsMutation(query)) {
        return {
          content: [{ type: 'text', text: 'Error: This tool is for read-only queries only. Use the graphql_mutation tool for write operations (create, update, delete).' }],
          isError: true,
        };
      }

      try {
        const result = await client.executeGraphql(query, variables as Record<string, unknown> | undefined);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `GraphQL query error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 3: graphql_mutation ─────────────────────────────────────────────────

  server.registerTool(
    'graphql_mutation',
    {
      title: 'GraphQL Mutation',
      description: `Execute a GraphQL mutation against LeanIX for write operations.

Use this tool for creating, updating, or deleting data — fact sheets, relations, tags, subscriptions.
For read-only operations (search, get, list), use graphql_query instead.

Examples:

  # 1. Update fact sheet fields
  query=\`
  mutation ($patches: [Patch]!) {
    updateFactSheet(id: "fact-sheet-id", patches: $patches) {
      factSheet { id displayName description }
    }
  }
  \`
  variables={
    "patches": [{"op": "replace", "path": "/description", "value": "Updated description"}]
  }

  # 2. Add tags to fact sheet
  query=\`
  mutation ($patches: [Patch]!) {
    updateFactSheet(id: "fact-sheet-id", patches: $patches) {
      factSheet { id tags { id name } }
    }
  }
  \`
  variables={
    "patches": [{"op": "add", "path": "/tags", "value": "[{\\"tagId\\":\\"existing-tag-id\\"}]"}]
  }

  # 3. Create fact sheet relation
  query=\`
  mutation ($patches: [Patch]!) {
    updateFactSheet(id: "app-id", patches: $patches) {
      factSheet { id ... on Application { relApplicationToITComponent { edges { node { id } } } } }
    }
  }
  \`
  variables={
    "patches": [{"op": "add", "path": "/relApplicationToITComponent/new_1", "value": "{\\"factSheetId\\":\\"component-id\\"}"}]
  }

  # 4. Create subscription
  query=\`
  mutation {
    createSubscription(
      factSheetId: "fact-sheet-id",
      user: {email: "user@example.com"},
      type: RESPONSIBLE,
      roleIds: ["role-id"]
    ) { id user { email } type }
  }
  \`

  # 5. Create fact sheet with fields in one call
  query=\`
  mutation CreateApp($input: BaseFactSheetInput!, $patches: [Patch]!) {
    createFactSheet(input: $input, patches: $patches) {
      factSheet { id displayName ... on Application { category description } }
    }
  }
  \`
  variables={
    "input": {"name": "New Application", "type": "Application"},
    "patches": [
      {"op": "add", "path": "/category", "value": "Product"},
      {"op": "add", "path": "/description", "value": "Created via GraphQL"}
    ]
  }`,
      inputSchema: {
        query: z.string().describe('GraphQL mutation string (must be valid GraphQL syntax, write operations only)'),
        variables: z.record(z.unknown()).optional().describe('Optional GraphQL mutation variables as key-value pairs'),
      },
    },
    async ({ query, variables }): Promise<CallToolResult> => {
      // Validate: reject plain queries (strip comments/strings to prevent bypass)
      if (containsQueryKeyword(query) && !containsMutation(query)) {
        return {
          content: [{ type: 'text', text: 'Error: This tool is for write operations (mutations) only. Use the graphql_query tool for read-only queries.' }],
          isError: true,
        };
      }

      try {
        const result = await client.executeGraphql(query, variables as Record<string, unknown> | undefined);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `GraphQL mutation error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
