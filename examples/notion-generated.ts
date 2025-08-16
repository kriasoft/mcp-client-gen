/* Generated MCP Client SDK */
/* Generated at: 2025-08-16T23:15:37.436Z */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpConnection } from "./types.js";
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
function handleResourceResult<T = any>(result: any, resourceUri: string): T {
  // Validate contents exist
  if (
    !result.contents ||
    !Array.isArray(result.contents) ||
    result.contents.length === 0
  ) {
    throw new Error(`Resource '${resourceUri}' returned empty contents`);
  }

  return result.contents[0] as T;
}

/**
 * Perform a search over:
 * - "internal": Perform a semantic search over your entire Notion workspace and connected
 * sources (Slack, Google Drive, Github, Jira, Microsoft Teams, Sharepoint, OneDrive, or
 * Linear).
 * - "users": Perform a search over the Notion users in the current workspace.
 * You can use search when you need to find information which is not already available via
 * other tools, and you don't know where it's located.
 * If the user doesn't have access to Notion AI features, the search will automatically fall
 * back to a workspace search that doesn't use AI or include connected sources. This will be
 * indicated by the "type" field in the response being "workspace_search" instead of
 * "ai_search".
 * Do NOT use search to get information about a Database's integrations, views, or other
 * components.
 * If initial results do not contain all the information you need, you can try more specific
 * queries.
 * After obtaining internal search results, if the user asks for the full contents of a page or
 * database, use the "fetch" tool. This tool only shows some details like a highlight and the
 * URL and title of each search result.
 * To find pages under a Notion database, use this tool and supply the database's URL as the
 * data_source_url parameter. These look like "collection://f336d0bc-b841-465b-8045-024475c079dd".
 * You can get this URL by using the "fetch" tool to view the database and copying the URL from
 * the <data-source url="..."> block. Keep in mind that Notion-flavored Markdown has this
 * concept of a hierarchy of <database> blocks that contain <data-source> blocks, but users
 * aren't familiar with the Notion "Data Source" terminology or product. Prefer to refer to
 * both of them as "databases" in your response to humans to avoid confusion.
 * Examples of searches:
 * 1. Search for information across the workspace:
 * {
 * "query": "quarterly revenue report",
 * "query_type": "internal"
 * }
 * 2. Search within a specific page and its children:
 * {
 * "query": "meeting notes action items",
 * "query_type": "internal",
 * "page_url": "https://www.notion.so/workspace/Team-Hub-1234567890abcdef"
 * }
 * 3. Search within a database's pages:
 * {
 * "query": "design review feedback",
 * "query_type": "internal",
 * "data_source_url": "collection://f336d0bc-b841-465b-8045-024475c079dd"
 * }
 * 4. Search within a specific teamspace:
 * {
 * "query": "project updates",
 * "query_type": "internal",
 * "teamspace_id": "f336d0bc-b841-465b-8045-024475c079dd"
 * }
 * 5. Search for users:
 * {
 * "query": "john@example.com",
 * "query_type": "user"
 * }
 * 6. Find users by partial name:
 * {
 * "query": "sarah",
 * "query_type": "user"
 * }
 * Common use cases:
 * - "What does the sales team require from the product team in the next quarter?"
 * - "Find all meeting notes that mention the new pricing strategy"
 * - "Which pages discuss the API migration project?"
 * - "Find all team members with email addresses ending in @design.company.com"
 * - "What are the latest updates on the mobile app redesign?"
 */
export interface SearchInput {
  /**
   * Semantic search query over your entire Notion workspace and connected sources
   * (Slack, Google Drive, Github, Jira, Microsoft Teams, Sharepoint, OneDrive,
   * or Linear). For best results, don't provide more than one question per tool call.
   * Use a separate "search" tool call for each search you want to perform.
   * Alternatively, the query can be a substring or keyword to find users by matching
   * against their name or email address. For example: "john" or "john@example.com"
   */
  query: string;
  /**
   * Specify type of the query as either "internal" or "user". Always include this input if performing
   * "user" search.
   */
  query_type?: "internal" | "user";
  /**
   * Optionally, provide the URL of a Data source to search. This will perform a semantic search over
   * the pages in the Data Source. Note: must be a Data Source, not a Database. <data-source> tags are
   * part of the Notion flavored Markdown format returned by tools like fetch. The full spec is
   * available in the create-pages tool description.
   */
  data_source_url?: string;
  /**
   * Optionally, provide the URL or ID of a page to search within. This will perform a semantic search
   * over the content within and under the specified page. Accepts either a full page URL
   * (e.g. https://notion.so/workspace/Page-Title-1234567890) or just the page ID (UUIDv4) with or
   * without dashes.
   */
  page_url?: string;
  /**
   * Optionally, provide the ID of a teamspace to restrict search results to. This will perform a search
   * over content within the specified teamspace only. Accepts the teamspace ID (UUIDv4) with or
   * without dashes.
   */
  teamspace_id?: string;
}

/**
 * Retrieves details about a Notion entity by its URL or ID.
 * You can fetch the following types of entities:
 * - Page, i.e. from a <page> block or a <mention-page> mention
 * - Database, i.e. from a <database> block or a <mention-database> mention
 * Use the "fetch" tool when you need to see the details of a Notion entity you already know
 * exists and have its URL or ID.
 * Provide the Notion entity's URL or ID in the `id` parameter. You must make multiple calls
 * to the "fetch" tool if you want to fetch multiple entities.
 * Content for pages that are returned use the enhanced Markdown format, which is a superset of
 * the standard Markdown syntax. See the full spec in the description of the "create-pages"
 * tool.
 * Notion does not currently have a public concept of Data Sources, and only supports Databases.
 * When rendering the response from this tool, assume the database only has one data source and
 * display the details of the data source as the database, removing any mention of "data
 * sources" from the result.
 * Examples of fetching entities:
 * 1. Fetch a page by URL:
 * {
 * "id": "https://www.notion.so/workspace/Product-Requirements-1234567890abcdef"
 * }
 * 2. Fetch a page by ID (UUIDv4 with dashes):
 * {
 * "id": "12345678-90ab-cdef-1234-567890abcdef"
 * }
 * 3. Fetch a page by ID (UUIDv4 without dashes):
 * {
 * "id": "1234567890abcdef1234567890abcdef"
 * }
 * 4. Fetch a database:
 * {
 * "id": "https://www.notion.so/workspace/Projects-Database-abcdef1234567890"
 * }
 * Common use cases:
 * - "What are the product requirements still need to be implemented from this ticket
 * https://notion.so/page-url?"
 * - "Show me the details of the project database at this URL"
 * - "Get the content of page 12345678-90ab-cdef-1234-567890abcdef"
 */
export interface FetchInput {
  /** The ID or URL of the Notion page to fetch */
  id: string;
}

/**
 * Creates one or more Notion pages with specified properties and content.
 * Use "create-pages" when you need to create one or more new pages that don't exist yet.
 * Always include a title property under `properties` in each entry of the `pages` array.
 * Otherwise, the page title will appear blank even if the page content is populated. Don't
 * duplicate the page title at the top of the page's `content`.
 * When creating pages under a Notion database, the property names must match the database's
 * schema. Use the "fetch" tool with a Notion database URL to get the database schema. Or, look
 * for existing pages under the database using the "search" tool then use the "fetch" tool to see
 * the names of the property keys. One exception is the "title" property, which all pages have,
 * but can be named differently in the schema of a database. For convenience, you can use the
 * generic property name "title" in the "properties" object, and it will automatically be
 * re-mapped to the actual name of the title property in the database schema when creating the
 * page.
 * All pages created with a single call to this tool will have the same parent.
 * The parent can be a Notion page or database. If the parent is omitted, the pages will be
 * created as standalone, workspace-level private pages and the person that created them
 * can organize them as they see fit later.
 * Examples of creating pages:
 * 1. Create a standalone page with a title and content:
 * {
 * "pages": [
 * {
 * "properties": {"title":"Page title"},
 * "content": "# Section 1
 * Section 1 content
 * # Section 2
 * Section 2 content"
 * }
 * ]
 * }
 * 2. Create a page in a Tasks database with URL {{3}} and properties "Task Name" and "Status":
 * {
 * "parent": {"database_id": "f336d0bc-b841-465b-8045-024475c079dd"},
 * "pages": [
 * {
 * "properties": {
 * "Task Name": "Task 123",
 * "Status": "In Progress",
 * },
 * },
 * ],
 * }
 * 3. Create a page with an existing page as a parent:
 * {
 * "parent": {"page_id": "f336d0bc-b841-465b-8045-024475c079dd"},
 * "pages": [
 * {
 * "properties": {"title": "Page title"},
 * "content": "# Section 1
 * Section 1 content
 * # Section 2
 * Section 2 content"
 * }
 * ]
 * }
 * The enhanced Markdown format used for page content is a superset of the standard Markdown
 * syntax. Here is the full spec, but please note that Notion does not yet use the Data Source
 * terminology, and only supports Databases. Ignore anything related to "data sources" and assume
 * databases can only define one schema for now.
 * ### Notion-flavored Markdown
 * Notion-flavored Markdown is a variant of standard Markdown with additional features to support all Block and Rich text types.
 * Use tabs for indentation.
 * Use backslashes to escape characters. For example, * will render as * and not as a bold delimiter.
 * Block types:
 * Markdown blocks use a {color="Color"} attribute list to set a block color.
 * Text:
 * Rich text {color="Color"}
 * Children
 * Headings:
 * # Rich text {color="Color"}
 * ## Rich text {color="Color"}
 * ### Rich text {color="Color"}
 * (Headings 4, 5, and 6 are not supported in Notion and will be converted to heading 3.)
 * Bulleted list:
 * - Rich text {color="Color"}
 * Children
 * Numbered list:
 * 1. Rich text {color="Color"}
 * Children
 * Rich text types:
 * Bold:
 * **Rich text**
 * Italic:
 * *Rich text*
 * Strikethrough:
 * ~~Rich text~~
 * Underline:
 * <span underline="true">Rich text</span>
 * Inline code:
 * `Code`
 * Link:
 * [Link text](URL)
 * Citation:
 * [^URL]
 * To create a citation, you can either reference a compressed URL like [^{{1}}], or a full URL like [^https://example.com].
 * Colors:
 * <span color?="Color">Rich text</span>
 * Inline math:
 * $Equation$ or $`Equation`$ if you want to use markdown delimiters within the equation.
 * There must be whitespace before the starting $ symbol and after the ending $ symbol. There must not be whitespace right after the starting $ symbol or before the ending $ symbol.
 * Inline line breaks within rich text:
 * <br>
 * Mentions:
 * User:
 * <mention-user url="{{URL}}">User name</mention-user>
 * The URL must always be provided, and refer to an existing User.
 * But Providing the user name is optional. In the UI, the name will always be displayed.
 * So an alternative self-closing format is also supported: <mention-user url="{{URL}}"/>
 * Page:
 * <mention-page url="{{URL}}">Page title</mention-page>
 * The URL must always be provided, and refer to an existing Page.
 * Providing the page title is optional. In the UI, the title will always be displayed.
 * Mentioned pages can be viewed using the "view" tool.
 * Database:
 * <mention-database url="{{URL}}">Database name</mention-database>
 * The URL must always be provided, and refer to an existing Database.
 * Providing the database name is optional. In the UI, the name will always be displayed.
 * Mentioned databases can be viewed using the "view" tool.
 * Date:
 * <mention-date start="YYYY-MM-DD" end="YYYY-MM-DD"/>
 * Datetime:
 * <mention-date start="YYYY-MM-DDThh:mm:ssZ" end="YYYY-MM-DDThh:mm:ssZ"/>
 * Custom emoji:
 * :emoji_name:
 * Custom emoji are rendered as the emoji name surrounded by colons.
 * Colors:
 * Text colors (colored text with transparent background):
 * gray, brown, orange, yellow, green, blue, purple, pink, red
 * Background colors (colored background with contrasting text):
 * gray_bg, brown_bg, orange_bg, yellow_bg, green_bg, blue_bg, purple_bg, pink_bg, red_bg
 * Usage:
 * - Block colors: Add color="Color" to the first line of any block
 * - Rich text colors: Use <span color="Color">Rich text</span>
 * #### Advanced Block types for Page content
 * The following block types may only be used in page content.
 * <advanced-blocks>
 * Quote:
 * > Rich text {color="Color"}
 * Children
 * To-do:
 * - [ ] Rich text {color="Color"}
 * Children
 * - [x] Rich text {color="Color"}
 * Children
 * Toggle:
 * ▶ Rich text {color="Color"}
 * Children
 * Toggle heading 1:
 * ▶# Rich text {color="Color"}
 * Children
 * Toggle heading 2:
 * ▶## Rich text {color="Color"}
 * Children
 * Toggle heading 3:
 * ▶### Rich text {color="Color"}
 * Children
 * For toggles and toggle headings, the children must be indented in order for them to be toggleable. If you do not indent the children, they will not be contained within the toggle or toggle heading.
 * Divider:
 * ---
 * Table:
 * <table fit-page-width?="true|false" header-row?="true|false" header-column?="true|false">
 * <colgroup>
 * <col color?="Color">
 * <col color?="Color">
 * </colgroup>
 * <tr color?="Color">
 * <td>Data cell</td>
 * <td color?="Color">Data cell</td>
 * </tr>
 * <tr>
 * <td>Data cell</td>
 * <td>Data cell</td>
 * </tr>
 * </table>
 * Note: All table attributes are optional. If omitted, they default to false.
 * Table structure:
 * - <table>: Root element with optional attributes:
 * - fit-page-width: Whether the table should fill the page width
 * - header-row: Whether the first row is a header
 * - header-column: Whether the first column is a header
 * - <colgroup>: Optional element defining column-wide styles
 * - <col>: Column definition with optional attributes:
 * - color: The color of the column
 * - width: The width of the column. Leave empty to auto-size.
 * - <tr>: Table row with optional color attribute
 * - <td>: Data cell with optional color attribute
 * Color precedence (highest to lowest):
 * 1. Cell color (<td color="red">)
 * 2. Row color (<tr color="blue_bg">)
 * 3. Column color (<col color="gray">)
 * Equation:
 * $$
 * Equation
 * $$
 * Code:
 * ```language
 * Code
 * ```
 * XML blocks use the "color" attribute to set a block color.
 * Callout:
 * <callout icon?="emoji" color?="Color">
 * Children
 * </callout>
 * Columns:
 * <columns>
 * <column>
 * Children
 * </column>
 * <column>
 * Children
 * </column>
 * </columns>
 * Page:
 * <page url="{{URL}}" color?="Color">Title</page>
 * Sub-pages can be viewed using the "view" tool.
 * To create a new sub-page, omit the URL. You can then update the page content and properties with the "update-page" tool. Example: <page>New Page</page>
 * Database:
 * <database url="{{URL}}" inline?="{true|false}" color?="Color">Title</database>
 * To create a new database, omit the URL. You can then update the database properties and content with the "update-database" tool. Example: <database>New Database</database>
 * The "inline" toggles how the database is displayed in the UI. If it is true, the database is fully visible and interactive on the page. If false, the database is displayed as a sub-page.
 * There is no "Data Source" block type. Data Sources are always inside a Database, and only Databases can be inserted into a Page.
 * Audio:
 * <audio source="{{URL}}" color?="Color">Caption</audio>
 * File:
 * File content can be viewed using the "view" tool.
 * <file source="{{URL}}" color?="Color">Caption</file>
 * Image:
 * Image content can be viewed using the "view" tool.
 * <image source="{{URL}}" color?="Color">Caption</image>
 * PDF:
 * PDF content can be viewed using the "view" tool.
 * <pdf source="{{URL}}" color?="Color">Caption</pdf>
 * Video:
 * <video source="{{URL}}" color?="Color">Caption</video>
 * Table of contents:
 * <table_of_contents color?="Color"/>
 * Synced block:
 * The original source for a synced block.
 * When creating a new synced block, do not provide the URL. After inserting the synced block into a page, the URL will be provided.
 * <synced_block url?="{{URL}}">
 * Children
 * </synced_block>
 * Note: When creating new synced blocks, omit the url attribute - it will be auto-generated. When reading existing synced blocks, the url attribute will be present.
 * Synced block reference:
 * A reference to a synced block.
 * The synced block must already exist and url must be provided.
 * You can directly update the children of the synced block reference and it will update both the original synced block and the synced block reference.
 * <synced_block_reference url="{{URL}}">
 * Children
 * </synced_block_reference>
 * Meeting notes:
 * <meeting-notes>
 * Rich text (meeting title)
 * <summary>
 * AI-generated summary of the notes + transcript
 * </summary>
 * <notes>
 * User notes
 * </notes>
 * <transcript>
 * Transcript of the audio (cannot be edited)
 * </transcript>
 * </meeting-notes>
 * Note: The <transcript> tag contains a raw transcript and cannot be edited.
 * Unknown (a block type that is not supported in the API yet):
 * <unknown url="{{URL}}" alt="Alt"/>
 * </advanced-blocks>
 */
export interface NotionCreatePagesInput {
  /** The pages to create. */
  pages: {
    properties?: Record<string, any>;
    content?: string;
  }[];
  /** The parent under which the new pages will be created. This can be a page or a database. If omitted, the new pages will be created as private pages at the workspace level. */
  parent?:
    | {
        page_id: string;
        type?: "page_id";
      }
    | {
        database_id: string;
        type?: "database_id";
      };
}

/**
 * Update a Notion page's properties or content.
 * Notion page properties are a JSON map of property names to SQLite values.
 * For pages in a database, use the SQLite schema definition shown in <database>.
 * For pages outside of a database, the only allowed property is "title", which is the title of
 * the page and is automatically shown at the top of the page as a large heading.
 * Notion page content is a string in Notion-flavored Markdown format. See the "create-pages"
 * tool description for the full enhanced Markdown spec.
 * Before updating a page's content with this tool, use the "fetch" tool first to get the
 * existing content to find out the Markdown snippets to use in the "replace_content_range" or
 * "insert_content_after" commands.
 * Examples:
 * (1) Update page properties:
 * {
 * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "command": "update_properties",
 * "properties": {
 * "title": "New Page Title",
 * "status": "In Progress",
 * "checkbox": "__YES__"
 * }
 * }
 * Use the "fetch" tool to find the existing properties of the page to make sure your changes
 * include all property names and values, and are spelled correctly, for pages under a database.
 * A title property is required for pages in a database but may not be named "title" so be sure
 * to use the correct property name. For pages outside of a database, the only allowed property
 * is "title" and it will always be named "title".
 * (2) Replace the entire content of a page:
 * {
 * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "command": "replace_content",
 * "new_str": "# New Section
 * Updated content goes here"
 * }
 * (3) Replace specific content in a page:
 * {
 * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "command": "replace_content_range",
 * "selection_with_ellipsis": "# Old Section...end of section",
 * "new_str": "# New Section
 * Updated content goes here"
 * }
 * Remember you should not include the entire string to replace, only the first ~10 characters,
 * an ellipsis, and the last ~10 characters.
 * However, the start and end of the range must have enough characters to be able to uniquely
 * identify the range in the page; do not use an ambiguous or repeated selection.
 * If you get errors, try using a longer or different selection.
 * (4) Insert content after specific text:
 * {
 * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "command": "insert_content_after",
 * "selection_with_ellipsis": "## Previous section...",
 * "new_str": "
 * ## New Section
 * Content to insert goes here"
 * }
 */
export interface NotionUpdatePageInput {
  /** The data required for updating a page */
  data:
    | ({
        page_id: string;
      } & {
        command: "update_properties";
        properties: Record<string, any>;
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
  /** An array of up to 100 page or database IDs to move. IDs are v4 UUIDs and can be supplied with or without dashes (e.g. extracted from a <page> or <database> URL given by the "search" or "view" tool). Data Sources under Databases can't be moved individually. */
  page_or_database_ids: string[];
  /** The new parent under which the pages will be moved. This can be a page or a database. */
  new_parent:
    | {
        page_id: string;
        type?: "page_id";
      }
    | {
        database_id: string;
        type?: "database_id";
      };
}

/** Duplicate a Notion page. The page must be within the current workspace, and you must have permission to access it. The duplication completes asynchronously, so do not rely on the new page identified by the returned ID or URL to be populated immediately. Let the user know that the duplication is in progress and that they can check back later using the 'fetch' tool or by clicking the returned URL and viewing it in the Notion app. */
export interface NotionDuplicatePageInput {
  /** The ID of the page to duplicate. This is a v4 UUID, with or without dashes, and can be parsed from a Notion page URL. */
  page_id: string;
}

/** Creates a new Notion database with the specified properties. */
export interface NotionCreateDatabaseInput {
  /** The property schema of the new database. Must at least have a title property. */
  properties: Record<string, any>;
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
              user:
                | {
                    id: string;
                    object?: "user";
                  }
                | ({
                    id: string;
                    name?: string | null;
                    object?: "user";
                    avatar_url?: string | null;
                  } & {
                    type?: "person";
                    person: {
                      email?: string;
                    };
                  })
                | {
                    type?: "bot";
                    bot: {
                      owner?:
                        | {
                            user:
                              | {
                                  email: string;
                                }
                              | {
                                  id: string;
                                  object?: "user";
                                };
                          }
                        | {
                            workspace: "true";
                          };
                      workspace_name?: string | null;
                      workspace_limits?: {
                        max_file_upload_size_in_bytes: number;
                      };
                    };
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
              user:
                | {
                    id: string;
                    object?: "user";
                  }
                | ({
                    id: string;
                    name?: string | null;
                    object?: "user";
                    avatar_url?: string | null;
                  } & {
                    type?: "person";
                    person: {
                      email?: string;
                    };
                  })
                | {
                    type?: "bot";
                    bot: {
                      owner?:
                        | {
                            user:
                              | {
                                  email: string;
                                }
                              | {
                                  id: string;
                                  object?: "user";
                                };
                          }
                        | {
                            workspace: "true";
                          };
                      workspace_name?: string | null;
                      workspace_limits?: {
                        max_file_upload_size_in_bytes: number;
                      };
                    };
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
 * Update a Notion database's properties, name, description, or other attributes.
 * The tool returns a rendered Markdown string showing the updated database structure,
 * including its properties, data sources, and schema information.
 * Database properties define the columns/fields that pages in the database can have.
 * Each property has a type (text, number, select, etc.) and configuration options.
 * Examples:
 * (1) Update database title and description:
 * {
 * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "title": [{"type": "text", "text": {"content": "Project Tracker 2024"}}],
 * "description": [{"type": "text", "text": {"content": "Track all projects and deliverables"}}]
 * }
 * (2) Add new properties to a database:
 * {
 * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "properties": {
 * "Priority": {
 * "select": {
 * "options": [
 * {"name": "High", "color": "red"},
 * {"name": "Medium", "color": "yellow"},
 * {"name": "Low", "color": "green"}
 * ]
 * }
 * },
 * "Due Date": {"date": {}},
 * "Assigned To": {"people": {}}
 * }
 * }
 * (3) Rename an existing property (use the property ID or current name):
 * {
 * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "properties": {
 * "Status": {"name": "Project Status"}
 * }
 * }
 * (4) Remove a property (set to null):
 * {
 * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "properties": {
 * "Old Property": null
 * }
 * }
 * (5) Change display mode from inline to full page:
 * {
 * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "is_inline": false
 * }
 * (6) Move database to trash (WARNING: cannot be undone without going to the Notion app UI so
 * explicitly confirm with the user that they really want to do this):
 * {
 * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
 * "in_trash": true
 * }
 * Common property types:
 * - title: The main property (required, cannot be deleted)
 * - rich_text: Multi-line text
 * - number: Numeric values with optional formatting
 * - select: Single choice from options
 * - multi_select: Multiple choices from options
 * - date: Date with optional time
 * - people: User references
 * - checkbox: Boolean values
 * - url: Web links
 * - email: Email addresses
 * - phone_number: Phone numbers
 * - formula: Calculated values based on other properties
 * - relation: Links to pages in another database
 * - rollup: Aggregated values from related pages
 * Notes:
 * - You cannot delete or create new title properties
 * - A database can only have one unique_id property
 * - Synced databases cannot be updated
 * - Use the "fetch" tool first to see the current database schema
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
              user:
                | {
                    id: string;
                    object?: "user";
                  }
                | ({
                    id: string;
                    name?: string | null;
                    object?: "user";
                    avatar_url?: string | null;
                  } & {
                    type?: "person";
                    person: {
                      email?: string;
                    };
                  })
                | {
                    type?: "bot";
                    bot: {
                      owner?:
                        | {
                            user:
                              | {
                                  email: string;
                                }
                              | {
                                  id: string;
                                  object?: "user";
                                };
                          }
                        | {
                            workspace: "true";
                          };
                      workspace_name?: string | null;
                      workspace_limits?: {
                        max_file_upload_size_in_bytes: number;
                      };
                    };
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
              user:
                | {
                    id: string;
                    object?: "user";
                  }
                | ({
                    id: string;
                    name?: string | null;
                    object?: "user";
                    avatar_url?: string | null;
                  } & {
                    type?: "person";
                    person: {
                      email?: string;
                    };
                  })
                | {
                    type?: "bot";
                    bot: {
                      owner?:
                        | {
                            user:
                              | {
                                  email: string;
                                }
                              | {
                                  id: string;
                                  object?: "user";
                                };
                          }
                        | {
                            workspace: "true";
                          };
                      workspace_name?: string | null;
                      workspace_limits?: {
                        max_file_upload_size_in_bytes: number;
                      };
                    };
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
  properties?: Record<string, any>;
  /** Whether the database should be displayed inline in the parent page, if you want to change this setting. */
  is_inline?: boolean;
  /** Whether to move the database to the trash. WARNING: This operation currently cannot be undone without going to the Notion app UI. Make sure you want to do this before proceeding. */
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
              user:
                | {
                    id: string;
                    object?: "user";
                  }
                | ({
                    id: string;
                    name?: string | null;
                    object?: "user";
                    avatar_url?: string | null;
                  } & {
                    type?: "person";
                    person: {
                      email?: string;
                    };
                  })
                | {
                    type?: "bot";
                    bot: {
                      owner?:
                        | {
                            user:
                              | {
                                  email: string;
                                }
                              | {
                                  id: string;
                                  object?: "user";
                                };
                          }
                        | {
                            workspace: "true";
                          };
                      workspace_name?: string | null;
                      workspace_limits?: {
                        max_file_upload_size_in_bytes: number;
                      };
                    };
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

/** List all users */
export interface NotionGetUsersInput {
  query: {
    start_cursor?: string;
    page_size?: number;
  };
}

/** Retrieve your token's bot user */
export interface NotionGetSelfInput {}

/** Retrieve a user */
export interface NotionGetUserInput {
  path: {
    user_id: string;
  };
}

/**
 * MCP client for notion server
 * @generated 2025-08-16T23:15:37.841Z
 */
export class NotionClient {
  private connection: McpConnection;

  constructor(connection: McpConnection) {
    this.connection = connection;
  }

  /**
   * Perform a search over:
   * - "internal": Perform a semantic search over your entire Notion workspace and connected
   * sources (Slack, Google Drive, Github, Jira, Microsoft Teams, Sharepoint, OneDrive, or
   * Linear).
   * - "users": Perform a search over the Notion users in the current workspace.
   * You can use search when you need to find information which is not already available via
   * other tools, and you don't know where it's located.
   * If the user doesn't have access to Notion AI features, the search will automatically fall
   * back to a workspace search that doesn't use AI or include connected sources. This will be
   * indicated by the "type" field in the response being "workspace_search" instead of
   * "ai_search".
   * Do NOT use search to get information about a Database's integrations, views, or other
   * components.
   * If initial results do not contain all the information you need, you can try more specific
   * queries.
   * After obtaining internal search results, if the user asks for the full contents of a page or
   * database, use the "fetch" tool. This tool only shows some details like a highlight and the
   * URL and title of each search result.
   * To find pages under a Notion database, use this tool and supply the database's URL as the
   * data_source_url parameter. These look like "collection://f336d0bc-b841-465b-8045-024475c079dd".
   * You can get this URL by using the "fetch" tool to view the database and copying the URL from
   * the <data-source url="..."> block. Keep in mind that Notion-flavored Markdown has this
   * concept of a hierarchy of <database> blocks that contain <data-source> blocks, but users
   * aren't familiar with the Notion "Data Source" terminology or product. Prefer to refer to
   * both of them as "databases" in your response to humans to avoid confusion.
   * Examples of searches:
   * 1. Search for information across the workspace:
   * {
   * "query": "quarterly revenue report",
   * "query_type": "internal"
   * }
   * 2. Search within a specific page and its children:
   * {
   * "query": "meeting notes action items",
   * "query_type": "internal",
   * "page_url": "https://www.notion.so/workspace/Team-Hub-1234567890abcdef"
   * }
   * 3. Search within a database's pages:
   * {
   * "query": "design review feedback",
   * "query_type": "internal",
   * "data_source_url": "collection://f336d0bc-b841-465b-8045-024475c079dd"
   * }
   * 4. Search within a specific teamspace:
   * {
   * "query": "project updates",
   * "query_type": "internal",
   * "teamspace_id": "f336d0bc-b841-465b-8045-024475c079dd"
   * }
   * 5. Search for users:
   * {
   * "query": "john@example.com",
   * "query_type": "user"
   * }
   * 6. Find users by partial name:
   * {
   * "query": "sarah",
   * "query_type": "user"
   * }
   * Common use cases:
   * - "What does the sales team require from the product team in the next quarter?"
   * - "Find all meeting notes that mention the new pricing strategy"
   * - "Which pages discuss the API migration project?"
   * - "Find all team members with email addresses ending in @design.company.com"
   * - "What are the latest updates on the mobile app redesign?"
   */
  async search(input: SearchInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "search",
      arguments: input,
    });
    return handleToolResult(result, "search");
  }

  /**
   * Retrieves details about a Notion entity by its URL or ID.
   * You can fetch the following types of entities:
   * - Page, i.e. from a <page> block or a <mention-page> mention
   * - Database, i.e. from a <database> block or a <mention-database> mention
   * Use the "fetch" tool when you need to see the details of a Notion entity you already know
   * exists and have its URL or ID.
   * Provide the Notion entity's URL or ID in the `id` parameter. You must make multiple calls
   * to the "fetch" tool if you want to fetch multiple entities.
   * Content for pages that are returned use the enhanced Markdown format, which is a superset of
   * the standard Markdown syntax. See the full spec in the description of the "create-pages"
   * tool.
   * Notion does not currently have a public concept of Data Sources, and only supports Databases.
   * When rendering the response from this tool, assume the database only has one data source and
   * display the details of the data source as the database, removing any mention of "data
   * sources" from the result.
   * Examples of fetching entities:
   * 1. Fetch a page by URL:
   * {
   * "id": "https://www.notion.so/workspace/Product-Requirements-1234567890abcdef"
   * }
   * 2. Fetch a page by ID (UUIDv4 with dashes):
   * {
   * "id": "12345678-90ab-cdef-1234-567890abcdef"
   * }
   * 3. Fetch a page by ID (UUIDv4 without dashes):
   * {
   * "id": "1234567890abcdef1234567890abcdef"
   * }
   * 4. Fetch a database:
   * {
   * "id": "https://www.notion.so/workspace/Projects-Database-abcdef1234567890"
   * }
   * Common use cases:
   * - "What are the product requirements still need to be implemented from this ticket
   * https://notion.so/page-url?"
   * - "Show me the details of the project database at this URL"
   * - "Get the content of page 12345678-90ab-cdef-1234-567890abcdef"
   */
  async fetch(input: FetchInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "fetch",
      arguments: input,
    });
    return handleToolResult(result, "fetch");
  }

  /**
   * Creates one or more Notion pages with specified properties and content.
   * Use "create-pages" when you need to create one or more new pages that don't exist yet.
   * Always include a title property under `properties` in each entry of the `pages` array.
   * Otherwise, the page title will appear blank even if the page content is populated. Don't
   * duplicate the page title at the top of the page's `content`.
   * When creating pages under a Notion database, the property names must match the database's
   * schema. Use the "fetch" tool with a Notion database URL to get the database schema. Or, look
   * for existing pages under the database using the "search" tool then use the "fetch" tool to see
   * the names of the property keys. One exception is the "title" property, which all pages have,
   * but can be named differently in the schema of a database. For convenience, you can use the
   * generic property name "title" in the "properties" object, and it will automatically be
   * re-mapped to the actual name of the title property in the database schema when creating the
   * page.
   * All pages created with a single call to this tool will have the same parent.
   * The parent can be a Notion page or database. If the parent is omitted, the pages will be
   * created as standalone, workspace-level private pages and the person that created them
   * can organize them as they see fit later.
   * Examples of creating pages:
   * 1. Create a standalone page with a title and content:
   * {
   * "pages": [
   * {
   * "properties": {"title":"Page title"},
   * "content": "# Section 1
   * Section 1 content
   * # Section 2
   * Section 2 content"
   * }
   * ]
   * }
   * 2. Create a page in a Tasks database with URL {{3}} and properties "Task Name" and "Status":
   * {
   * "parent": {"database_id": "f336d0bc-b841-465b-8045-024475c079dd"},
   * "pages": [
   * {
   * "properties": {
   * "Task Name": "Task 123",
   * "Status": "In Progress",
   * },
   * },
   * ],
   * }
   * 3. Create a page with an existing page as a parent:
   * {
   * "parent": {"page_id": "f336d0bc-b841-465b-8045-024475c079dd"},
   * "pages": [
   * {
   * "properties": {"title": "Page title"},
   * "content": "# Section 1
   * Section 1 content
   * # Section 2
   * Section 2 content"
   * }
   * ]
   * }
   * The enhanced Markdown format used for page content is a superset of the standard Markdown
   * syntax. Here is the full spec, but please note that Notion does not yet use the Data Source
   * terminology, and only supports Databases. Ignore anything related to "data sources" and assume
   * databases can only define one schema for now.
   * ### Notion-flavored Markdown
   * Notion-flavored Markdown is a variant of standard Markdown with additional features to support all Block and Rich text types.
   * Use tabs for indentation.
   * Use backslashes to escape characters. For example, * will render as * and not as a bold delimiter.
   * Block types:
   * Markdown blocks use a {color="Color"} attribute list to set a block color.
   * Text:
   * Rich text {color="Color"}
   * Children
   * Headings:
   * # Rich text {color="Color"}
   * ## Rich text {color="Color"}
   * ### Rich text {color="Color"}
   * (Headings 4, 5, and 6 are not supported in Notion and will be converted to heading 3.)
   * Bulleted list:
   * - Rich text {color="Color"}
   * Children
   * Numbered list:
   * 1. Rich text {color="Color"}
   * Children
   * Rich text types:
   * Bold:
   * **Rich text**
   * Italic:
   * *Rich text*
   * Strikethrough:
   * ~~Rich text~~
   * Underline:
   * <span underline="true">Rich text</span>
   * Inline code:
   * `Code`
   * Link:
   * [Link text](URL)
   * Citation:
   * [^URL]
   * To create a citation, you can either reference a compressed URL like [^{{1}}], or a full URL like [^https://example.com].
   * Colors:
   * <span color?="Color">Rich text</span>
   * Inline math:
   * $Equation$ or $`Equation`$ if you want to use markdown delimiters within the equation.
   * There must be whitespace before the starting $ symbol and after the ending $ symbol. There must not be whitespace right after the starting $ symbol or before the ending $ symbol.
   * Inline line breaks within rich text:
   * <br>
   * Mentions:
   * User:
   * <mention-user url="{{URL}}">User name</mention-user>
   * The URL must always be provided, and refer to an existing User.
   * But Providing the user name is optional. In the UI, the name will always be displayed.
   * So an alternative self-closing format is also supported: <mention-user url="{{URL}}"/>
   * Page:
   * <mention-page url="{{URL}}">Page title</mention-page>
   * The URL must always be provided, and refer to an existing Page.
   * Providing the page title is optional. In the UI, the title will always be displayed.
   * Mentioned pages can be viewed using the "view" tool.
   * Database:
   * <mention-database url="{{URL}}">Database name</mention-database>
   * The URL must always be provided, and refer to an existing Database.
   * Providing the database name is optional. In the UI, the name will always be displayed.
   * Mentioned databases can be viewed using the "view" tool.
   * Date:
   * <mention-date start="YYYY-MM-DD" end="YYYY-MM-DD"/>
   * Datetime:
   * <mention-date start="YYYY-MM-DDThh:mm:ssZ" end="YYYY-MM-DDThh:mm:ssZ"/>
   * Custom emoji:
   * :emoji_name:
   * Custom emoji are rendered as the emoji name surrounded by colons.
   * Colors:
   * Text colors (colored text with transparent background):
   * gray, brown, orange, yellow, green, blue, purple, pink, red
   * Background colors (colored background with contrasting text):
   * gray_bg, brown_bg, orange_bg, yellow_bg, green_bg, blue_bg, purple_bg, pink_bg, red_bg
   * Usage:
   * - Block colors: Add color="Color" to the first line of any block
   * - Rich text colors: Use <span color="Color">Rich text</span>
   * #### Advanced Block types for Page content
   * The following block types may only be used in page content.
   * <advanced-blocks>
   * Quote:
   * > Rich text {color="Color"}
   * Children
   * To-do:
   * - [ ] Rich text {color="Color"}
   * Children
   * - [x] Rich text {color="Color"}
   * Children
   * Toggle:
   * ▶ Rich text {color="Color"}
   * Children
   * Toggle heading 1:
   * ▶# Rich text {color="Color"}
   * Children
   * Toggle heading 2:
   * ▶## Rich text {color="Color"}
   * Children
   * Toggle heading 3:
   * ▶### Rich text {color="Color"}
   * Children
   * For toggles and toggle headings, the children must be indented in order for them to be toggleable. If you do not indent the children, they will not be contained within the toggle or toggle heading.
   * Divider:
   * ---
   * Table:
   * <table fit-page-width?="true|false" header-row?="true|false" header-column?="true|false">
   * <colgroup>
   * <col color?="Color">
   * <col color?="Color">
   * </colgroup>
   * <tr color?="Color">
   * <td>Data cell</td>
   * <td color?="Color">Data cell</td>
   * </tr>
   * <tr>
   * <td>Data cell</td>
   * <td>Data cell</td>
   * </tr>
   * </table>
   * Note: All table attributes are optional. If omitted, they default to false.
   * Table structure:
   * - <table>: Root element with optional attributes:
   * - fit-page-width: Whether the table should fill the page width
   * - header-row: Whether the first row is a header
   * - header-column: Whether the first column is a header
   * - <colgroup>: Optional element defining column-wide styles
   * - <col>: Column definition with optional attributes:
   * - color: The color of the column
   * - width: The width of the column. Leave empty to auto-size.
   * - <tr>: Table row with optional color attribute
   * - <td>: Data cell with optional color attribute
   * Color precedence (highest to lowest):
   * 1. Cell color (<td color="red">)
   * 2. Row color (<tr color="blue_bg">)
   * 3. Column color (<col color="gray">)
   * Equation:
   * $$
   * Equation
   * $$
   * Code:
   * ```language
   * Code
   * ```
   * XML blocks use the "color" attribute to set a block color.
   * Callout:
   * <callout icon?="emoji" color?="Color">
   * Children
   * </callout>
   * Columns:
   * <columns>
   * <column>
   * Children
   * </column>
   * <column>
   * Children
   * </column>
   * </columns>
   * Page:
   * <page url="{{URL}}" color?="Color">Title</page>
   * Sub-pages can be viewed using the "view" tool.
   * To create a new sub-page, omit the URL. You can then update the page content and properties with the "update-page" tool. Example: <page>New Page</page>
   * Database:
   * <database url="{{URL}}" inline?="{true|false}" color?="Color">Title</database>
   * To create a new database, omit the URL. You can then update the database properties and content with the "update-database" tool. Example: <database>New Database</database>
   * The "inline" toggles how the database is displayed in the UI. If it is true, the database is fully visible and interactive on the page. If false, the database is displayed as a sub-page.
   * There is no "Data Source" block type. Data Sources are always inside a Database, and only Databases can be inserted into a Page.
   * Audio:
   * <audio source="{{URL}}" color?="Color">Caption</audio>
   * File:
   * File content can be viewed using the "view" tool.
   * <file source="{{URL}}" color?="Color">Caption</file>
   * Image:
   * Image content can be viewed using the "view" tool.
   * <image source="{{URL}}" color?="Color">Caption</image>
   * PDF:
   * PDF content can be viewed using the "view" tool.
   * <pdf source="{{URL}}" color?="Color">Caption</pdf>
   * Video:
   * <video source="{{URL}}" color?="Color">Caption</video>
   * Table of contents:
   * <table_of_contents color?="Color"/>
   * Synced block:
   * The original source for a synced block.
   * When creating a new synced block, do not provide the URL. After inserting the synced block into a page, the URL will be provided.
   * <synced_block url?="{{URL}}">
   * Children
   * </synced_block>
   * Note: When creating new synced blocks, omit the url attribute - it will be auto-generated. When reading existing synced blocks, the url attribute will be present.
   * Synced block reference:
   * A reference to a synced block.
   * The synced block must already exist and url must be provided.
   * You can directly update the children of the synced block reference and it will update both the original synced block and the synced block reference.
   * <synced_block_reference url="{{URL}}">
   * Children
   * </synced_block_reference>
   * Meeting notes:
   * <meeting-notes>
   * Rich text (meeting title)
   * <summary>
   * AI-generated summary of the notes + transcript
   * </summary>
   * <notes>
   * User notes
   * </notes>
   * <transcript>
   * Transcript of the audio (cannot be edited)
   * </transcript>
   * </meeting-notes>
   * Note: The <transcript> tag contains a raw transcript and cannot be edited.
   * Unknown (a block type that is not supported in the API yet):
   * <unknown url="{{URL}}" alt="Alt"/>
   * </advanced-blocks>
   */
  async notionCreatePages(input: NotionCreatePagesInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-create-pages",
      arguments: input,
    });
    return handleToolResult(result, "notion-create-pages");
  }

  /**
   * Update a Notion page's properties or content.
   * Notion page properties are a JSON map of property names to SQLite values.
   * For pages in a database, use the SQLite schema definition shown in <database>.
   * For pages outside of a database, the only allowed property is "title", which is the title of
   * the page and is automatically shown at the top of the page as a large heading.
   * Notion page content is a string in Notion-flavored Markdown format. See the "create-pages"
   * tool description for the full enhanced Markdown spec.
   * Before updating a page's content with this tool, use the "fetch" tool first to get the
   * existing content to find out the Markdown snippets to use in the "replace_content_range" or
   * "insert_content_after" commands.
   * Examples:
   * (1) Update page properties:
   * {
   * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "command": "update_properties",
   * "properties": {
   * "title": "New Page Title",
   * "status": "In Progress",
   * "checkbox": "__YES__"
   * }
   * }
   * Use the "fetch" tool to find the existing properties of the page to make sure your changes
   * include all property names and values, and are spelled correctly, for pages under a database.
   * A title property is required for pages in a database but may not be named "title" so be sure
   * to use the correct property name. For pages outside of a database, the only allowed property
   * is "title" and it will always be named "title".
   * (2) Replace the entire content of a page:
   * {
   * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "command": "replace_content",
   * "new_str": "# New Section
   * Updated content goes here"
   * }
   * (3) Replace specific content in a page:
   * {
   * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "command": "replace_content_range",
   * "selection_with_ellipsis": "# Old Section...end of section",
   * "new_str": "# New Section
   * Updated content goes here"
   * }
   * Remember you should not include the entire string to replace, only the first ~10 characters,
   * an ellipsis, and the last ~10 characters.
   * However, the start and end of the range must have enough characters to be able to uniquely
   * identify the range in the page; do not use an ambiguous or repeated selection.
   * If you get errors, try using a longer or different selection.
   * (4) Insert content after specific text:
   * {
   * "page_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "command": "insert_content_after",
   * "selection_with_ellipsis": "## Previous section...",
   * "new_str": "
   * ## New Section
   * Content to insert goes here"
   * }
   */
  async notionUpdatePage(input: NotionUpdatePageInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-update-page",
      arguments: input,
    });
    return handleToolResult(result, "notion-update-page");
  }

  /** Move one or more Notion pages or databases to a new parent. */
  async notionMovePages(input: NotionMovePagesInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-move-pages",
      arguments: input,
    });
    return handleToolResult(result, "notion-move-pages");
  }

  /** Duplicate a Notion page. The page must be within the current workspace, and you must have permission to access it. The duplication completes asynchronously, so do not rely on the new page identified by the returned ID or URL to be populated immediately. Let the user know that the duplication is in progress and that they can check back later using the 'fetch' tool or by clicking the returned URL and viewing it in the Notion app. */
  async notionDuplicatePage(input: NotionDuplicatePageInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-duplicate-page",
      arguments: input,
    });
    return handleToolResult(result, "notion-duplicate-page");
  }

  /** Creates a new Notion database with the specified properties. */
  async notionCreateDatabase(input: NotionCreateDatabaseInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-create-database",
      arguments: input,
    });
    return handleToolResult(result, "notion-create-database");
  }

  /**
   * Update a Notion database's properties, name, description, or other attributes.
   * The tool returns a rendered Markdown string showing the updated database structure,
   * including its properties, data sources, and schema information.
   * Database properties define the columns/fields that pages in the database can have.
   * Each property has a type (text, number, select, etc.) and configuration options.
   * Examples:
   * (1) Update database title and description:
   * {
   * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "title": [{"type": "text", "text": {"content": "Project Tracker 2024"}}],
   * "description": [{"type": "text", "text": {"content": "Track all projects and deliverables"}}]
   * }
   * (2) Add new properties to a database:
   * {
   * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "properties": {
   * "Priority": {
   * "select": {
   * "options": [
   * {"name": "High", "color": "red"},
   * {"name": "Medium", "color": "yellow"},
   * {"name": "Low", "color": "green"}
   * ]
   * }
   * },
   * "Due Date": {"date": {}},
   * "Assigned To": {"people": {}}
   * }
   * }
   * (3) Rename an existing property (use the property ID or current name):
   * {
   * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "properties": {
   * "Status": {"name": "Project Status"}
   * }
   * }
   * (4) Remove a property (set to null):
   * {
   * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "properties": {
   * "Old Property": null
   * }
   * }
   * (5) Change display mode from inline to full page:
   * {
   * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "is_inline": false
   * }
   * (6) Move database to trash (WARNING: cannot be undone without going to the Notion app UI so
   * explicitly confirm with the user that they really want to do this):
   * {
   * "database_id": "f336d0bc-b841-465b-8045-024475c079dd",
   * "in_trash": true
   * }
   * Common property types:
   * - title: The main property (required, cannot be deleted)
   * - rich_text: Multi-line text
   * - number: Numeric values with optional formatting
   * - select: Single choice from options
   * - multi_select: Multiple choices from options
   * - date: Date with optional time
   * - people: User references
   * - checkbox: Boolean values
   * - url: Web links
   * - email: Email addresses
   * - phone_number: Phone numbers
   * - formula: Calculated values based on other properties
   * - relation: Links to pages in another database
   * - rollup: Aggregated values from related pages
   * Notes:
   * - You cannot delete or create new title properties
   * - A database can only have one unique_id property
   * - Synced databases cannot be updated
   * - Use the "fetch" tool first to see the current database schema
   */
  async notionUpdateDatabase(input: NotionUpdateDatabaseInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-update-database",
      arguments: input,
    });
    return handleToolResult(result, "notion-update-database");
  }

  /** Add a comment to a page */
  async notionCreateComment(input: NotionCreateCommentInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-create-comment",
      arguments: input,
    });
    return handleToolResult(result, "notion-create-comment");
  }

  /** Get all comments of a page */
  async notionGetComments(input: NotionGetCommentsInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-comments",
      arguments: input,
    });
    return handleToolResult(result, "notion-get-comments");
  }

  /** List all users */
  async notionGetUsers(input: NotionGetUsersInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-users",
      arguments: input,
    });
    return handleToolResult(result, "notion-get-users");
  }

  /** Retrieve your token's bot user */
  async notionGetSelf(input: NotionGetSelfInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-self",
      arguments: input,
    });
    return handleToolResult(result, "notion-get-self");
  }

  /** Retrieve a user */
  async notionGetUser(input: NotionGetUserInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "notion-get-user",
      arguments: input,
    });
    return handleToolResult(result, "notion-get-user");
  }

  /**
   * Fetch a resource by URI
   * @param uri - Resource URI
   */
  async getResource(uri: string): Promise<any> {
    const result = await this.connection.client.readResource({ uri });
    return handleResourceResult(result, uri);
  }

  /** Complete specification for Notion's enhanced Markdown format, including all block types, rich text formatting, and XML elements. This specification is subject to change as Notion's capabilities evolve. */
  async getEnhancedMarkdownSpecification(): Promise<any> {
    return this.getResource("notion://docs/enhanced-markdown-spec");
  }
}
// Singleton instance for notion
let _notion: NotionClient | undefined;

export function getNotionClient(connection: McpConnection): NotionClient {
  if (!_notion) {
    _notion = new NotionClient(connection);
  }

  return _notion;
}
