/* Generated MCP Client SDK */
/* Import individual createXClient() functions for optimal tree-shaking */
import type {
  BlobResourceContents,
  Client,
  PromptMessage,
  TextResourceContents,
} from "@modelcontextprotocol/client";
import type { McpConnection } from "mcp-client-gen";
/**
 * Helper function to handle MCP tool call results with proper error checking
 * @param result - The result from client.callTool()
 * @param toolName - Name of the tool for error messages
 * @returns The first content item from the result
 * @throws Error if the tool returned an error or invalid content
 */
function handleToolResult<T = any>(result: any, toolName: string): T {
  // Check if the tool returned an error
  if (result.isError) {
    const errorContent = result.content?.[0];
    const errorMessage =
      errorContent && typeof errorContent === "object" && "text" in errorContent
        ? String(errorContent.text)
        : "Tool execution failed";
    throw new Error(`Tool '${toolName}' error: ${errorMessage}`);
  }

  // Validate content exists and is non-empty
  if (
    !result.content ||
    !Array.isArray(result.content) ||
    result.content.length === 0
  ) {
    throw new Error(`Tool '${toolName}' returned empty content`);
  }

  // Extract the first content item
  const content = result.content[0];
  if (!content || typeof content !== "object") {
    throw new Error(`Tool '${toolName}' returned invalid content structure`);
  }

  return content as T;
}

/**
 * Helper function to handle MCP resource read results
 * @param result - The result from client.readResource()
 * @param resourceUri - URI of the resource for error messages
 * @returns The first content item from the result
 * @throws Error if the resource returned empty contents
 */
function handleResourceResult(
  result: any,
  resourceUri: string,
): TextResourceContents | BlobResourceContents {
  // Validate contents exist
  if (
    !result.contents ||
    !Array.isArray(result.contents) ||
    result.contents.length === 0
  ) {
    throw new Error(`Resource '${resourceUri}' returned empty contents`);
  }

  return result.contents[0];
}

/**
 * Perform a search over:
 * - "internal": Semantic search over Notion workspace and connected sources (Slack, Google Drive, Github, Jira, Microsoft Teams, Sharepoint, OneDrive, Linear). Supports filtering by creation date and creator.
 * - "user": Search for users by name or email.
 *
 * Auto-selects AI search (with connected sources) or workspace search (workspace-only, faster) based on user's access to Notion AI. Use content_search_mode to override.
 * Use "fetch" tool for full page/database contents after getting search results.
 * To search within a database: First fetch the database to get the data source URL (collection://...) from <data-source url="..."> tags, then use that as data_source_url. For multi-source databases, match by view ID (?v=...) in URL or search all sources separately.
 * Don't combine database URL/ID with collection:// prefix for data_source_url. Don't use database URL as page_url.
 * 		<example description="Search with date range filter (only documents created in 2024)">
 * 		{
 * 			"query": "quarterly revenue report",
 * 			"query_type": "internal",
 * 			"filters": {
 * 				"created_date_range": {
 * 					"start_date": "2024-01-01",
 * 					"end_date": "2025-01-01"
 * 				}
 * 			}
 * 		}
 * 		</example>
 * 		<example description="Teamspace + creator filter">
 * 		{"query": "project updates", "query_type": "internal", "teamspace_id": "f336d0bc-b841-465b-8045-024475c079dd", "filters": {"created_by_user_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]}}
 * 		</example>
 * 		<example description="Database with date + creator filters">
 * 		{"query": "design review", "data_source_url": "collection://f336d0bc-b841-465b-8045-024475c079dd", "filters": {"created_date_range": {"start_date": "2024-10-01"}, "created_by_user_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "b2c3d4e5-f6a7-8901-bcde-f12345678901"]}}
 * 		</example>
 * 		<example description="User search">
 * 		{"query": "john@example.com", "query_type": "user"}
 * 		</example>
 */
export interface NotionSearchInput {
  /**
   * Semantic search query over your entire Notion workspace and connected sources (Slack, Google Drive, Github, Jira, Microsoft Teams, Sharepoint, OneDrive, or Linear). For best results, don't provide more than one question per tool call. Use a separate "search" tool call for each search you want to perform.
   * Alternatively, the query can be a substring or keyword to find users by matching against their name or email address. For example: "john" or "john@example.com"
   */
  query: string;
  query_type?: "internal" | "user";
  content_search_mode?: "workspace_search" | "ai_search";
  /** Optionally, provide the URL of a Data source to search. This will perform a semantic search over the pages in the Data Source. Note: must be a Data Source, not a Database. <data-source> tags are part of the Notion flavored Markdown format returned by tools like fetch. The full spec is available in the create-pages tool description. */
  data_source_url?: string;
  /** Optionally, provide the URL or ID of a page to search within. This will perform a semantic search over the content within and under the specified page. Accepts either a full page URL (e.g. https://notion.so/workspace/Page-Title-1234567890) or just the page ID (UUIDv4) with or without dashes. */
  page_url?: string;
  /** Optionally, provide the ID of a teamspace to restrict search results to. This will perform a search over content within the specified teamspace only. Accepts the teamspace ID (UUIDv4) with or without dashes. */
  teamspace_id?: string;
  /** Optionally provide filters to apply to the search results. Only valid when query_type is 'internal'. */
  filters?: {
    created_date_range?: {
      start_date?: string;
      end_date?: string;
    };
    created_by_user_ids?: string[];
  };
}

/**
 * Retrieves details about a Notion entity (page or database) by URL or ID.
 * Provide URL or ID in `id` parameter. Make multiple calls to fetch multiple entities.
 * Pages use enhanced Markdown format. For the complete specification, fetch the MCP resource at `notion://docs/enhanced-markdown-spec`.
 * Databases return all data sources (collections of pages with same schema). For multi-source databases with URLs like notion.so/db-id?v=view-id, the view ID helps identify which data source to use (check response for view's dataSourceUrl).
 * 		<example>{"id": "https://notion.so/workspace/Page-a1b2c3d4e5f67890"}</example>
 * 		<example>{"id": "12345678-90ab-cdef-1234-567890abcdef"}</example>
 */
export interface NotionFetchInput {
  /** The ID or URL of the Notion page to fetch */
  id: string;
}

/**
 * ## Overview
 * Creates one or more Notion pages, with the specified properties and content.
 * ## Parent
 * All pages created with a single call to this tool will have the same parent. The parent can be a Notion page ("page_id") or data source ("data_source_id"). If the parent is omitted, the pages are created as standalone, workspace-level private pages, and the person that created them can organize them later as they see fit.
 * If you have a database URL, ALWAYS pass it to the "fetch" tool first to get the schema and URLs of each data source under the database. You can't use the "database_id" parent type if the database has more than one data source, so you'll need to identify which "data_source_id" to use based on the situation and the results from the fetch tool (data source URLs look like collection://<data_source_id>).
 * If you know the pages should be created under a data source, do NOT use the database ID or URL under the "page_id" parameter; "page_id" is only for regular, non-database pages.
 * ## Content
 * Notion page content is a string in Notion-flavored Markdown format.
 * Don't include the page title at the top of the page's content. Only include it under "properties".
 * **IMPORTANT**: For the complete Markdown specification, always first fetch the MCP resource at `notion://docs/enhanced-markdown-spec`. Do NOT guess or hallucinate Markdown syntax. This spec is also applicable to other tools like update-page and fetch.
 * ## Properties
 * Notion page properties are a JSON map of property names to SQLite values.
 * When creating pages in a database:
 * - Use the correct property names from the data source schema shown in the fetch tool results.
 * - Always include a title property. Data sources always have exactly one title property, but it may not be named "title", so, again, rely on the fetched data source schema.
 *
 * For pages outside of a database:
 * - The only allowed property is "title",	which is the title of the page in inline markdown format. Always include a "title" property.
 *
 * **IMPORTANT**: Some property types require expanded formats:
 * - Date properties: Split into "date:{property}:start", "date:{property}:end" (optional), and "date:{property}:is_datetime" (0 or 1)
 * - Place properties: Split into "place:{property}:name", "place:{property}:address", "place:{property}:latitude", "place:{property}:longitude", and "place:{property}:google_place_id" (optional)
 * - Number properties: Use JavaScript numbers (not strings)
 * - Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked
 *
 * **Special property naming**: Properties named "id" or "url" (case insensitive) must be prefixed with "userDefined:" (e.g., "userDefined:URL", "userDefined:id")
 * ## Examples
 * 		<example description="Create a standalone page with a title and content">
 * 		{
 * 			"pages": [
 * 				{
 * 					"properties": {"title": "Page title"},
 * 					"content": "# Section 1 {color="blue"}
 * Section 1 content
 * ▶ Toggle block
 * 	Hidden content inside toggle"
 * 				}
 * 			]
 * 		}
 * 		</example>
 * 		<example description="Create a page under a database's data source">
 * 		{
 * 			"parent": {"data_source_id": "f336d0bc-b841-465b-8045-024475c079dd"},
 * 			"pages": [
 * 				{
 * 					"properties": {
 * 						"Task Name": "Task 123",
 * 						"Status": "In Progress",
 * 						"Priority": 5,
 * 						"Is Complete": "__YES__",
 * 						"date:Due Date:start": "2024-12-25",
 * 						"date:Due Date:is_datetime": 0
 * 					}
 * 				}
 * 			]
 * 		}
 * 		</example>
 * 		<example description="Create a page with an existing page as a parent">
 * 		{
 * 			"parent": {"page_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"},
 * 			"pages": [
 * 				{
 * 					"properties": {"title": "Page title"},
 * 					"content": "# Section 1
 * Section 1 content
 * # Section 2
 * Section 2 content"
 * 				}
 * 			]
 * 		}
 * 		</example>
 */
export interface NotionCreatePagesInput {
  /** The pages to create. */
  pages: {
    properties?: Record<string, unknown>;
    content?: string;
  }[];
  /** The parent under which the new pages will be created. This can be a page (page_id), a database page (database_id), or a data source/collection under a database (data_source_id). If omitted, the new pages will be created as private pages at the workspace level. Use data_source_id when you have a collection:// URL from the fetch tool. */
  parent?:
    | {
        page_id: string;
        type?: "page_id";
      }
    | {
        database_id: string;
        type?: "database_id";
      }
    | {
        data_source_id: string;
        type?: "data_source_id";
      };
}

/**
 * ## Overview
 * Update a Notion page's properties or content.
 * ## Properties
 * Notion page properties are a JSON map of property names to SQLite values.
 * For pages in a database:
 * - ALWAYS use the "fetch" tool first to get the data source schema and the	exact property names.
 * - Provide a non-null value to update a property's value.
 * - Omitted properties are left unchanged.
 *
 * **IMPORTANT**: Some property types require expanded formats:
 * - Date properties: Split into "date:{property}:start", "date:{property}:end" (optional), and "date:{property}:is_datetime" (0 or 1)
 * - Place properties: Split into "place:{property}:name", "place:{property}:address", "place:{property}:latitude", "place:{property}:longitude", and "place:{property}:google_place_id" (optional)
 * - Number properties: Use JavaScript numbers (not strings)
 * - Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked
 *
 * **Special property naming**: Properties named "id" or "url" (case insensitive) must be prefixed with "userDefined:" (e.g., "userDefined:URL", "userDefined:id")
 * For pages outside of a database:
 * - The only allowed property is "title",	which is the title of the page in inline markdown format.
 *
 * ## Content
 * Notion page content is a string in Notion-flavored Markdown format.
 * **IMPORTANT**: For the complete Markdown specification, first fetch the MCP resource at `notion://docs/enhanced-markdown-spec`. Do NOT guess or hallucinate Markdown syntax.
 * Before updating a page's content with this tool, use the "fetch" tool first to get the existing content to find out the Markdown snippets to use in the "replace_content_range" or "insert_content_after" commands.
 * ## Examples
 * 		<example description="Update page properties">
 * 		{
 * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * 			"command": "update_properties",
 * 			"properties": {
 * 				"title": "New Page Title",
 * 				"status": "In Progress",
 * 				"priority": 5,
 * 				"checkbox": "__YES__",
 * 				"date:deadline:start": "2024-12-25",
 * 				"date:deadline:is_datetime": 0,
 * 				"place:office:name": "HQ",
 * 				"place:office:latitude": 37.7749,
 * 				"place:office:longitude": -122.4194
 * 			}
 * 		}
 * 		</example>
 * 		<example description="Replace the entire content of a page">
 * 		{
 * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * 			"command": "replace_content",
 * 			"new_str": "# New Section
 * Updated content goes here"
 * 		}
 * 		</example>
 * 		<example description="Replace specific content in a page">
 * 		{
 * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * 			"command": "replace_content_range",
 * 			"selection_with_ellipsis": "# Old Section...end of section",
 * 			"new_str": "# New Section
 * Updated content goes here"
 * 		}
 * 		</example>
 * 		<example description="Insert content after specific text">
 * 		{
 * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * 			"command": "insert_content_after",
 * 			"selection_with_ellipsis": "## Previous section...",
 * 			"new_str": "
 * ## New Section
 * Content to insert goes here"
 * 		}
 * 		</example>
 * **Note**: For selection_with_ellipsis, provide only the first ~10 characters, an ellipsis, and the last ~10 characters. Ensure the selection is unique; use longer snippets if needed to avoid ambiguity.
 */
export interface NotionUpdatePageInput {
  /** The data required for updating a page */
  data:
    | ({
        page_id: string;
      } & {
        command: "update_properties";
        properties: Record<string, unknown>;
      })
    | {
        command: "replace_content";
        new_str: string;
      }
    | {
        command: "replace_content_range";
        selection_with_ellipsis: string;
        new_str: string;
      }
    | {
        command: "insert_content_after";
        selection_with_ellipsis: string;
        new_str: string;
      };
}

/** Move one or more Notion pages or databases to a new parent. */
export interface NotionMovePagesInput {
  /** An array of up to 100 page or database IDs to move. IDs are v4 UUIDs and can be supplied with or without dashes (e.g. extracted from a <page> or <database> URL given by the "search" or "fetch" tool). Data Sources under Databases can't be moved individually. */
  page_or_database_ids: string[];
  /** The new parent under which the pages will be moved. This can be a page, the workspace, a database, or a specific data source under a database when there are multiple. Moving pages to the workspace level adds them as private pages and should rarely be used. */
  new_parent:
    | {
        page_id: string;
        type?: "page_id";
      }
    | {
        database_id: string;
        type?: "database_id";
      }
    | {
        data_source_id: string;
        type?: "data_source_id";
      }
    | {
        type: "workspace";
      };
}

/** Duplicate a Notion page. The page must be within the current workspace, and you must have permission to access it. The duplication completes asynchronously, so do not rely on the new page identified by the returned ID or URL to be populated immediately. Let the user know that the duplication is in progress and that they can check back later using the 'fetch' tool or by clicking the returned URL and viewing it in the Notion app. */
export interface NotionDuplicatePageInput {
  /** The ID of the page to duplicate. This is a v4 UUID, with or without dashes, and can be parsed from a Notion page URL. */
  page_id: string;
}

/**
 * Creates a new Notion database with the specified properties schema.
 * If no title property provided, "Name" is auto-added. Returns Markdown with schema and SQLite definition.
 * Property types: title (required), rich_text, number, select, multi_select, date, people, checkbox, url, email, phone_number, formula, relation, rollup.
 *
 * 		<example description="Minimal">{"properties": {}}</example>
 * 		<example description="Task DB">{"parent": {"page_id": "f336d0bc-b841-465b-8045-024475c079dd"}, "title": [{"text": {"content": "Tasks"}}], "properties": {"Status": {"type": "select", "select": {"options": [{"name": "To Do", "color": "red"}, {"name": "Done", "color": "green"}]}}, "Due Date": {"type": "date", "date": {}}}}</example>
 */
export interface NotionCreateDatabaseInput {
  /** The property schema of the new database. If no title property is provided, one will be automatically added. */
  properties: Record<string, unknown>;
  /** The parent under which to create the new database. If omitted, the database will be created as a private page at the workspace level. */
  parent?: {
    page_id: string;
    type?: "page_id";
  };
  /** The title of the new database, as a rich text object. */
  title?:
    | ({
        annotations?: {
          bold?: boolean;
          italic?: boolean;
          strikethrough?: boolean;
          underline?: boolean;
          code?: boolean;
          color?: string;
        };
      } & {
        type?: "text";
        text: {
          content: string;
          link?: {
            url: string;
          } | null;
        };
      })
    | {
        type?: "mention";
        mention:
          | {
              type?: "user";
              user: {
                id: string;
                object?: "user";
              };
            }
          | {
              type?: "date";
              date: {
                start: string;
                end?: string | null;
                time_zone?: string | null;
              };
            }
          | {
              type?: "page";
              page: {
                id: string;
              };
            }
          | {
              type?: "database";
              database: {
                id: string;
              };
            }
          | {
              type?: "template_mention";
              template_mention:
                | {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                  }
                | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                  };
            }
          | {
              type?: "custom_emoji";
              custom_emoji: {
                id: string;
                name?: string;
                url?: string;
              };
            };
      }
    | {
        type?: "equation";
        equation: {
          expression: string;
        };
      }[];
  /** The description of the new database, as a rich text object. */
  description?:
    | ({
        annotations?: {
          bold?: boolean;
          italic?: boolean;
          strikethrough?: boolean;
          underline?: boolean;
          code?: boolean;
          color?: string;
        };
      } & {
        type?: "text";
        text: {
          content: string;
          link?: {
            url: string;
          } | null;
        };
      })
    | {
        type?: "mention";
        mention:
          | {
              type?: "user";
              user: {
                id: string;
                object?: "user";
              };
            }
          | {
              type?: "date";
              date: {
                start: string;
                end?: string | null;
                time_zone?: string | null;
              };
            }
          | {
              type?: "page";
              page: {
                id: string;
              };
            }
          | {
              type?: "database";
              database: {
                id: string;
              };
            }
          | {
              type?: "template_mention";
              template_mention:
                | {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                  }
                | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                  };
            }
          | {
              type?: "custom_emoji";
              custom_emoji: {
                id: string;
                name?: string;
                url?: string;
              };
            };
      }
    | {
        type?: "equation";
        equation: {
          expression: string;
        };
      }[];
}

/**
 * Update a Notion database's properties, name, description, or other attributes. Returns Markdown showing updated structure and schema.
 * Database properties define columns/fields. See create_database for property types.
 * Examples:
 * (1) Update database title and description: { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "title": [{"type": "text", "text": {"content": "Project Tracker 2024"}}], "description": [{"type": "text", "text": {"content": "Track all projects and deliverables"}}] }
 * (2) Add new properties to a database: { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "properties": { "Priority": { "select": { "options": [ {"name": "High", "color": "red"}, {"name": "Medium", "color": "yellow"}, {"name": "Low", "color": "green"} ] } }, "Due Date": {"date": {}}, "Assigned To": {"people": {}} } }
 * (3) Rename an existing property (use the property ID or current name): { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "properties": { "Status": {"name": "Project Status"} } }
 * (4) Remove a property (set to null): { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "properties": { "Old Property": null } }
 * (5) Change display mode from inline to full page: { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "is_inline": false }
 * (6) Move to trash (DANGER: confirm with user, cannot undo without Notion UI): {"database_id": "f336d0bc-b841-465b-8045-024475c079dd", "in_trash": true}
 * Notes: Cannot delete/create title properties. Max one unique_id property. Cannot update synced databases. Use "fetch" first to see current schema.
 */
export interface NotionUpdateDatabaseInput {
  /** The ID of the database to update. This is a UUID v4, with or without dashes, and can be parsed from a database URL. */
  database_id: string;
  /** The new title of the database, as a rich text object, if you want to update it. */
  title?:
    | ({
        annotations?: {
          bold?: boolean;
          italic?: boolean;
          strikethrough?: boolean;
          underline?: boolean;
          code?: boolean;
          color?: string;
        };
      } & {
        type?: "text";
        text: {
          content: string;
          link?: {
            url: string;
          } | null;
        };
      })
    | {
        type?: "mention";
        mention:
          | {
              type?: "user";
              user: {
                id: string;
                object?: "user";
              };
            }
          | {
              type?: "date";
              date: {
                start: string;
                end?: string | null;
                time_zone?: string | null;
              };
            }
          | {
              type?: "page";
              page: {
                id: string;
              };
            }
          | {
              type?: "database";
              database: {
                id: string;
              };
            }
          | {
              type?: "template_mention";
              template_mention:
                | {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                  }
                | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                  };
            }
          | {
              type?: "custom_emoji";
              custom_emoji: {
                id: string;
                name?: string;
                url?: string;
              };
            };
      }
    | {
        type?: "equation";
        equation: {
          expression: string;
        };
      }[];
  /** The new description of the database, as a rich text object, if you want to update it. */
  description?:
    | ({
        annotations?: {
          bold?: boolean;
          italic?: boolean;
          strikethrough?: boolean;
          underline?: boolean;
          code?: boolean;
          color?: string;
        };
      } & {
        type?: "text";
        text: {
          content: string;
          link?: {
            url: string;
          } | null;
        };
      })
    | {
        type?: "mention";
        mention:
          | {
              type?: "user";
              user: {
                id: string;
                object?: "user";
              };
            }
          | {
              type?: "date";
              date: {
                start: string;
                end?: string | null;
                time_zone?: string | null;
              };
            }
          | {
              type?: "page";
              page: {
                id: string;
              };
            }
          | {
              type?: "database";
              database: {
                id: string;
              };
            }
          | {
              type?: "template_mention";
              template_mention:
                | {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                  }
                | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                  };
            }
          | {
              type?: "custom_emoji";
              custom_emoji: {
                id: string;
                name?: string;
                url?: string;
              };
            };
      }
    | {
        type?: "equation";
        equation: {
          expression: string;
        };
      }[];
  /** Updates to make to the database's schema. Use null to remove a property, or provide the `name` only to rename a property. */
  properties?: Record<string, unknown>;
  is_inline?: boolean;
  in_trash?: boolean;
}

/** Add a comment to a page */
export interface NotionCreateCommentInput {
  /** The parent of the comment. This must be a page. */
  parent: {
    page_id: string;
    type?: "page_id";
  };
  /** An array of rich text objects that represent the content of the comment. */
  rich_text:
    | ({
        annotations?: {
          bold?: boolean;
          italic?: boolean;
          strikethrough?: boolean;
          underline?: boolean;
          code?: boolean;
          color?: string;
        };
      } & {
        type?: "text";
        text: {
          content: string;
          link?: {
            url: string;
          } | null;
        };
      })
    | {
        type?: "mention";
        mention:
          | {
              type?: "user";
              user: {
                id: string;
                object?: "user";
              };
            }
          | {
              type?: "date";
              date: {
                start: string;
                end?: string | null;
                time_zone?: string | null;
              };
            }
          | {
              type?: "page";
              page: {
                id: string;
              };
            }
          | {
              type?: "database";
              database: {
                id: string;
              };
            }
          | {
              type?: "template_mention";
              template_mention:
                | {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                  }
                | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                  };
            }
          | {
              type?: "custom_emoji";
              custom_emoji: {
                id: string;
                name?: string;
                url?: string;
              };
            };
      }
    | {
        type?: "equation";
        equation: {
          expression: string;
        };
      }[];
}

/** Get all comments of a page */
export interface NotionGetCommentsInput {
  /** Identifier for a Notion page. */
  page_id: string;
}

/**
 * Retrieves a list of teams (teamspaces) in the current workspace. Shows which teams exist, user membership status, IDs, names, and roles.
 * Teams are returned split by membership status and limited to a maximum of 10 results.
 * <examples>
 * 1. List all teams (up to the limit of each type): {}
 * 2. Search for teams by name: {"query": "engineering"}
 * 3. Find a specific team: {"query": "Product Design"}
 * </examples>
 */
export interface NotionGetTeamsInput {
  /** Optional search query to filter teams by name (case-insensitive). */
  query?: string;
}

/**
 * Retrieves a list of users in the current workspace. Shows workspace members and guests with their IDs, names, emails (if available), and types (person or bot).
 * Supports cursor-based pagination to iterate through all users in the workspace.
 * <examples>
 * 1. List all users (first page): {}
 * 2. Search for users by name or email: {"query": "john"}
 * 3. Get next page of results: {"start_cursor": "abc123"}
 * 4. Set custom page size: {"page_size": 20}
 * 5. Fetch a specific user by ID: {"user_id": "00000000-0000-4000-8000-000000000000"}
 * 6. Fetch the current user: {"user_id": "self"}
 * </examples>
 */
export interface NotionGetUsersInput {
  /** Optional search query to filter users by name or email (case-insensitive). */
  query?: string;
  /** Cursor for pagination. Use the next_cursor value from the previous response to get the next page. */
  start_cursor?: string;
  /** Number of users to return per page (default: 100, max: 100). */
  page_size?: number;
  /** Return only the user matching this ID. Pass "self" to fetch the current user. */
  user_id?: string;
}

/** MCP client for notion server */
export class NotionClient {
  private connection: McpConnection;

  constructor(connection: McpConnection) {
    this.connection = connection;
  }

  /** Access underlying MCP client for advanced operations (streaming, raw requests) */
  get client(): Client {
    return this.connection.client;
  }

  /**
   * Perform a search over:
   * - "internal": Semantic search over Notion workspace and connected sources (Slack, Google Drive, Github, Jira, Microsoft Teams, Sharepoint, OneDrive, Linear). Supports filtering by creation date and creator.
   * - "user": Search for users by name or email.
   *
   * Auto-selects AI search (with connected sources) or workspace search (workspace-only, faster) based on user's access to Notion AI. Use content_search_mode to override.
   * Use "fetch" tool for full page/database contents after getting search results.
   * To search within a database: First fetch the database to get the data source URL (collection://...) from <data-source url="..."> tags, then use that as data_source_url. For multi-source databases, match by view ID (?v=...) in URL or search all sources separately.
   * Don't combine database URL/ID with collection:// prefix for data_source_url. Don't use database URL as page_url.
   * 		<example description="Search with date range filter (only documents created in 2024)">
   * 		{
   * 			"query": "quarterly revenue report",
   * 			"query_type": "internal",
   * 			"filters": {
   * 				"created_date_range": {
   * 					"start_date": "2024-01-01",
   * 					"end_date": "2025-01-01"
   * 				}
   * 			}
   * 		}
   * 		</example>
   * 		<example description="Teamspace + creator filter">
   * 		{"query": "project updates", "query_type": "internal", "teamspace_id": "f336d0bc-b841-465b-8045-024475c079dd", "filters": {"created_by_user_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]}}
   * 		</example>
   * 		<example description="Database with date + creator filters">
   * 		{"query": "design review", "data_source_url": "collection://f336d0bc-b841-465b-8045-024475c079dd", "filters": {"created_date_range": {"start_date": "2024-10-01"}, "created_by_user_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "b2c3d4e5-f6a7-8901-bcde-f12345678901"]}}
   * 		</example>
   * 		<example description="User search">
   * 		{"query": "john@example.com", "query_type": "user"}
   * 		</example>
   */
  async notionSearch(input: NotionSearchInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-search",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-search");
  }

  /**
   * Retrieves details about a Notion entity (page or database) by URL or ID.
   * Provide URL or ID in `id` parameter. Make multiple calls to fetch multiple entities.
   * Pages use enhanced Markdown format. For the complete specification, fetch the MCP resource at `notion://docs/enhanced-markdown-spec`.
   * Databases return all data sources (collections of pages with same schema). For multi-source databases with URLs like notion.so/db-id?v=view-id, the view ID helps identify which data source to use (check response for view's dataSourceUrl).
   * 		<example>{"id": "https://notion.so/workspace/Page-a1b2c3d4e5f67890"}</example>
   * 		<example>{"id": "12345678-90ab-cdef-1234-567890abcdef"}</example>
   */
  async notionFetch(input: NotionFetchInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-fetch",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-fetch");
  }

  /**
   * ## Overview
   * Creates one or more Notion pages, with the specified properties and content.
   * ## Parent
   * All pages created with a single call to this tool will have the same parent. The parent can be a Notion page ("page_id") or data source ("data_source_id"). If the parent is omitted, the pages are created as standalone, workspace-level private pages, and the person that created them can organize them later as they see fit.
   * If you have a database URL, ALWAYS pass it to the "fetch" tool first to get the schema and URLs of each data source under the database. You can't use the "database_id" parent type if the database has more than one data source, so you'll need to identify which "data_source_id" to use based on the situation and the results from the fetch tool (data source URLs look like collection://<data_source_id>).
   * If you know the pages should be created under a data source, do NOT use the database ID or URL under the "page_id" parameter; "page_id" is only for regular, non-database pages.
   * ## Content
   * Notion page content is a string in Notion-flavored Markdown format.
   * Don't include the page title at the top of the page's content. Only include it under "properties".
   * **IMPORTANT**: For the complete Markdown specification, always first fetch the MCP resource at `notion://docs/enhanced-markdown-spec`. Do NOT guess or hallucinate Markdown syntax. This spec is also applicable to other tools like update-page and fetch.
   * ## Properties
   * Notion page properties are a JSON map of property names to SQLite values.
   * When creating pages in a database:
   * - Use the correct property names from the data source schema shown in the fetch tool results.
   * - Always include a title property. Data sources always have exactly one title property, but it may not be named "title", so, again, rely on the fetched data source schema.
   *
   * For pages outside of a database:
   * - The only allowed property is "title",	which is the title of the page in inline markdown format. Always include a "title" property.
   *
   * **IMPORTANT**: Some property types require expanded formats:
   * - Date properties: Split into "date:{property}:start", "date:{property}:end" (optional), and "date:{property}:is_datetime" (0 or 1)
   * - Place properties: Split into "place:{property}:name", "place:{property}:address", "place:{property}:latitude", "place:{property}:longitude", and "place:{property}:google_place_id" (optional)
   * - Number properties: Use JavaScript numbers (not strings)
   * - Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked
   *
   * **Special property naming**: Properties named "id" or "url" (case insensitive) must be prefixed with "userDefined:" (e.g., "userDefined:URL", "userDefined:id")
   * ## Examples
   * 		<example description="Create a standalone page with a title and content">
   * 		{
   * 			"pages": [
   * 				{
   * 					"properties": {"title": "Page title"},
   * 					"content": "# Section 1 {color="blue"}
   * Section 1 content
   * ▶ Toggle block
   * 	Hidden content inside toggle"
   * 				}
   * 			]
   * 		}
   * 		</example>
   * 		<example description="Create a page under a database's data source">
   * 		{
   * 			"parent": {"data_source_id": "f336d0bc-b841-465b-8045-024475c079dd"},
   * 			"pages": [
   * 				{
   * 					"properties": {
   * 						"Task Name": "Task 123",
   * 						"Status": "In Progress",
   * 						"Priority": 5,
   * 						"Is Complete": "__YES__",
   * 						"date:Due Date:start": "2024-12-25",
   * 						"date:Due Date:is_datetime": 0
   * 					}
   * 				}
   * 			]
   * 		}
   * 		</example>
   * 		<example description="Create a page with an existing page as a parent">
   * 		{
   * 			"parent": {"page_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"},
   * 			"pages": [
   * 				{
   * 					"properties": {"title": "Page title"},
   * 					"content": "# Section 1
   * Section 1 content
   * # Section 2
   * Section 2 content"
   * 				}
   * 			]
   * 		}
   * 		</example>
   */
  async notionCreatePages(input: NotionCreatePagesInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-create-pages",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-create-pages");
  }

  /**
   * ## Overview
   * Update a Notion page's properties or content.
   * ## Properties
   * Notion page properties are a JSON map of property names to SQLite values.
   * For pages in a database:
   * - ALWAYS use the "fetch" tool first to get the data source schema and the	exact property names.
   * - Provide a non-null value to update a property's value.
   * - Omitted properties are left unchanged.
   *
   * **IMPORTANT**: Some property types require expanded formats:
   * - Date properties: Split into "date:{property}:start", "date:{property}:end" (optional), and "date:{property}:is_datetime" (0 or 1)
   * - Place properties: Split into "place:{property}:name", "place:{property}:address", "place:{property}:latitude", "place:{property}:longitude", and "place:{property}:google_place_id" (optional)
   * - Number properties: Use JavaScript numbers (not strings)
   * - Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked
   *
   * **Special property naming**: Properties named "id" or "url" (case insensitive) must be prefixed with "userDefined:" (e.g., "userDefined:URL", "userDefined:id")
   * For pages outside of a database:
   * - The only allowed property is "title",	which is the title of the page in inline markdown format.
   *
   * ## Content
   * Notion page content is a string in Notion-flavored Markdown format.
   * **IMPORTANT**: For the complete Markdown specification, first fetch the MCP resource at `notion://docs/enhanced-markdown-spec`. Do NOT guess or hallucinate Markdown syntax.
   * Before updating a page's content with this tool, use the "fetch" tool first to get the existing content to find out the Markdown snippets to use in the "replace_content_range" or "insert_content_after" commands.
   * ## Examples
   * 		<example description="Update page properties">
   * 		{
   * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * 			"command": "update_properties",
   * 			"properties": {
   * 				"title": "New Page Title",
   * 				"status": "In Progress",
   * 				"priority": 5,
   * 				"checkbox": "__YES__",
   * 				"date:deadline:start": "2024-12-25",
   * 				"date:deadline:is_datetime": 0,
   * 				"place:office:name": "HQ",
   * 				"place:office:latitude": 37.7749,
   * 				"place:office:longitude": -122.4194
   * 			}
   * 		}
   * 		</example>
   * 		<example description="Replace the entire content of a page">
   * 		{
   * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * 			"command": "replace_content",
   * 			"new_str": "# New Section
   * Updated content goes here"
   * 		}
   * 		</example>
   * 		<example description="Replace specific content in a page">
   * 		{
   * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * 			"command": "replace_content_range",
   * 			"selection_with_ellipsis": "# Old Section...end of section",
   * 			"new_str": "# New Section
   * Updated content goes here"
   * 		}
   * 		</example>
   * 		<example description="Insert content after specific text">
   * 		{
   * 			"page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * 			"command": "insert_content_after",
   * 			"selection_with_ellipsis": "## Previous section...",
   * 			"new_str": "
   * ## New Section
   * Content to insert goes here"
   * 		}
   * 		</example>
   * **Note**: For selection_with_ellipsis, provide only the first ~10 characters, an ellipsis, and the last ~10 characters. Ensure the selection is unique; use longer snippets if needed to avoid ambiguity.
   */
  async notionUpdatePage(input: NotionUpdatePageInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-update-page",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-update-page");
  }

  /** Move one or more Notion pages or databases to a new parent. */
  async notionMovePages(input: NotionMovePagesInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-move-pages",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-move-pages");
  }

  /** Duplicate a Notion page. The page must be within the current workspace, and you must have permission to access it. The duplication completes asynchronously, so do not rely on the new page identified by the returned ID or URL to be populated immediately. Let the user know that the duplication is in progress and that they can check back later using the 'fetch' tool or by clicking the returned URL and viewing it in the Notion app. */
  async notionDuplicatePage(input: NotionDuplicatePageInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-duplicate-page",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-duplicate-page");
  }

  /**
   * Creates a new Notion database with the specified properties schema.
   * If no title property provided, "Name" is auto-added. Returns Markdown with schema and SQLite definition.
   * Property types: title (required), rich_text, number, select, multi_select, date, people, checkbox, url, email, phone_number, formula, relation, rollup.
   *
   * 		<example description="Minimal">{"properties": {}}</example>
   * 		<example description="Task DB">{"parent": {"page_id": "f336d0bc-b841-465b-8045-024475c079dd"}, "title": [{"text": {"content": "Tasks"}}], "properties": {"Status": {"type": "select", "select": {"options": [{"name": "To Do", "color": "red"}, {"name": "Done", "color": "green"}]}}, "Due Date": {"type": "date", "date": {}}}}</example>
   */
  async notionCreateDatabase(input: NotionCreateDatabaseInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-create-database",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-create-database");
  }

  /**
   * Update a Notion database's properties, name, description, or other attributes. Returns Markdown showing updated structure and schema.
   * Database properties define columns/fields. See create_database for property types.
   * Examples:
   * (1) Update database title and description: { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "title": [{"type": "text", "text": {"content": "Project Tracker 2024"}}], "description": [{"type": "text", "text": {"content": "Track all projects and deliverables"}}] }
   * (2) Add new properties to a database: { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "properties": { "Priority": { "select": { "options": [ {"name": "High", "color": "red"}, {"name": "Medium", "color": "yellow"}, {"name": "Low", "color": "green"} ] } }, "Due Date": {"date": {}}, "Assigned To": {"people": {}} } }
   * (3) Rename an existing property (use the property ID or current name): { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "properties": { "Status": {"name": "Project Status"} } }
   * (4) Remove a property (set to null): { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "properties": { "Old Property": null } }
   * (5) Change display mode from inline to full page: { "database_id": "f336d0bc-b841-465b-8045-024475c079dd", "is_inline": false }
   * (6) Move to trash (DANGER: confirm with user, cannot undo without Notion UI): {"database_id": "f336d0bc-b841-465b-8045-024475c079dd", "in_trash": true}
   * Notes: Cannot delete/create title properties. Max one unique_id property. Cannot update synced databases. Use "fetch" first to see current schema.
   */
  async notionUpdateDatabase(input: NotionUpdateDatabaseInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-update-database",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-update-database");
  }

  /** Add a comment to a page */
  async notionCreateComment(input: NotionCreateCommentInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-create-comment",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-create-comment");
  }

  /** Get all comments of a page */
  async notionGetComments(input: NotionGetCommentsInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-comments",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-get-comments");
  }

  /**
   * Retrieves a list of teams (teamspaces) in the current workspace. Shows which teams exist, user membership status, IDs, names, and roles.
   * Teams are returned split by membership status and limited to a maximum of 10 results.
   * <examples>
   * 1. List all teams (up to the limit of each type): {}
   * 2. Search for teams by name: {"query": "engineering"}
   * 3. Find a specific team: {"query": "Product Design"}
   * </examples>
   */
  async notionGetTeams(input: NotionGetTeamsInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-teams",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-get-teams");
  }

  /**
   * Retrieves a list of users in the current workspace. Shows workspace members and guests with their IDs, names, emails (if available), and types (person or bot).
   * Supports cursor-based pagination to iterate through all users in the workspace.
   * <examples>
   * 1. List all users (first page): {}
   * 2. Search for users by name or email: {"query": "john"}
   * 3. Get next page of results: {"start_cursor": "abc123"}
   * 4. Set custom page size: {"page_size": 20}
   * 5. Fetch a specific user by ID: {"user_id": "00000000-0000-4000-8000-000000000000"}
   * 6. Fetch the current user: {"user_id": "self"}
   * </examples>
   */
  async notionGetUsers(input: NotionGetUsersInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-users",
      arguments: { ...input },
    });
    return handleToolResult(result, "notion-get-users");
  }

  /**
   * Fetch a resource by URI
   * @param uri - Resource URI
   */
  async getResource(
    uri: string,
  ): Promise<TextResourceContents | BlobResourceContents> {
    const result = await this.connection.client.readResource({ uri });
    return handleResourceResult(result, uri);
  }

  /** Complete specification for Notion's enhanced Markdown format, including all block types, rich text formatting, and XML elements. This specification is subject to change as Notion's capabilities evolve. */
  async getEnhancedMarkdownSpecification(): Promise<
    TextResourceContents | BlobResourceContents
  > {
    return this.getResource("notion://docs/enhanced-markdown-spec");
  }
}

export function createNotionClient(connection: McpConnection): NotionClient {
  return new NotionClient(connection);
}
