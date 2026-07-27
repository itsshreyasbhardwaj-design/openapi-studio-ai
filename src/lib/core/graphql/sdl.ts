/**
 * A focused GraphQL SDL reader.
 *
 * OpenAPI Studio supports GraphQL as a *design* surface: browse the schema,
 * inspect fields, and generate runnable operations for the API client. That
 * needs structure, not a full spec-compliant execution engine, so this module
 * implements a dependency-free tokenizer for the SDL subset that matters —
 * types, interfaces, inputs, enums, unions, scalars and their fields.
 */

export type GraphQLKind = "type" | "interface" | "input" | "enum" | "union" | "scalar";

export interface GraphQLField {
  readonly name: string;
  readonly type: string;
  readonly description: string | null;
  readonly args: readonly GraphQLArgument[];
  readonly deprecated: boolean;
}

export interface GraphQLArgument {
  readonly name: string;
  readonly type: string;
  readonly defaultValue: string | null;
}

export interface GraphQLType {
  readonly kind: GraphQLKind;
  readonly name: string;
  readonly description: string | null;
  readonly fields: readonly GraphQLField[];
  /** For enums: the member names. For unions: the member types. */
  readonly members: readonly string[];
  readonly implements: readonly string[];
}

export interface GraphQLSchemaModel {
  readonly types: readonly GraphQLType[];
  readonly queries: readonly GraphQLField[];
  readonly mutations: readonly GraphQLField[];
  readonly subscriptions: readonly GraphQLField[];
  readonly errors: readonly string[];
}

const DEFINITION =
  /(?:"""([\s\S]*?)"""\s*)?\b(type|interface|input|enum|union|scalar)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

function stripComments(source: string): string {
  return source.replace(/(^|\s)#[^\n]*/g, "$1");
}

function findBlock(source: string, from: number): { body: string; end: number } | null {
  const open = source.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, index), end: index };
    }
  }
  return null;
}

function parseArguments(raw: string): GraphQLArgument[] {
  if (!raw.trim()) return [];
  const args: GraphQLArgument[] = [];
  let depth = 0;
  let current = "";
  const flush = (): void => {
    const text = current.trim();
    current = "";
    if (!text) return;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/.exec(text);
    if (!match) return;
    args.push({
      name: match[1] ?? "",
      type: (match[2] ?? "").trim(),
      defaultValue: match[3]?.trim() ?? null,
    });
  };

  for (const char of raw) {
    if (char === "[" || char === "(" || char === "{") depth += 1;
    if (char === "]" || char === ")" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return args;
}

function parseFields(body: string): GraphQLField[] {
  const fields: GraphQLField[] = [];
  const lines = body.split("\n");
  let pendingDescription: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (!line) continue;

    if (line.startsWith('"""')) {
      const single = line.length > 3 && line.endsWith('"""') && line !== '"""';
      if (single) {
        pendingDescription = line.slice(3, -3).trim();
      } else {
        const collected: string[] = [];
        index += 1;
        while (index < lines.length && !(lines[index] ?? "").trim().startsWith('"""')) {
          collected.push((lines[index] ?? "").trim());
          index += 1;
        }
        pendingDescription = collected.join(" ").trim();
      }
      continue;
    }
    if (line.startsWith('"')) {
      pendingDescription = line.replace(/^"|"$/g, "");
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*([^@]+?)(\s*@.*)?$/.exec(
      line,
    );
    if (!match) continue;
    fields.push({
      name: match[1] ?? "",
      args: parseArguments(match[3] ?? ""),
      type: (match[4] ?? "").trim(),
      description: pendingDescription,
      deprecated: (match[5] ?? "").includes("@deprecated"),
    });
    pendingDescription = null;
  }
  return fields;
}

/** Parse a GraphQL SDL document into a browsable model. */
export function parseSdl(source: string): GraphQLSchemaModel {
  const clean = stripComments(source);
  const types: GraphQLType[] = [];
  const errors: string[] = [];

  DEFINITION.lastIndex = 0;
  let match = DEFINITION.exec(clean);
  while (match) {
    const [full, description, kindRaw, name] = match;
    const kind = kindRaw as GraphQLKind;
    const start = (match.index ?? 0) + full.length;

    if (kind === "scalar") {
      types.push({
        kind,
        name: name ?? "",
        description: description?.trim() ?? null,
        fields: [],
        members: [],
        implements: [],
      });
      match = DEFINITION.exec(clean);
      continue;
    }

    if (kind === "union") {
      const line = clean.slice(
        start,
        clean.indexOf("\n", start) === -1 ? undefined : clean.indexOf("\n", start),
      );
      const members = line
        .replace(/^\s*=\s*/, "")
        .split("|")
        .map((member) => member.trim())
        .filter(Boolean);
      types.push({
        kind,
        name: name ?? "",
        description: description?.trim() ?? null,
        fields: [],
        members,
        implements: [],
      });
      match = DEFINITION.exec(clean);
      continue;
    }

    const block = findBlock(clean, start);
    if (!block) {
      errors.push(`Definition "${name}" has no body.`);
      match = DEFINITION.exec(clean);
      continue;
    }

    const header = clean.slice(start, clean.indexOf("{", start));
    const implementsList =
      /implements\s+([^{]+)/
        .exec(header)?.[1]
        ?.split("&")
        .map((entry) => entry.trim())
        .filter(Boolean) ?? [];

    if (kind === "enum") {
      types.push({
        kind,
        name: name ?? "",
        description: description?.trim() ?? null,
        fields: [],
        members: block.body
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#") && !line.startsWith('"')),
        implements: [],
      });
    } else {
      types.push({
        kind,
        name: name ?? "",
        description: description?.trim() ?? null,
        fields: parseFields(block.body),
        members: [],
        implements: implementsList,
      });
    }

    DEFINITION.lastIndex = block.end;
    match = DEFINITION.exec(clean);
  }

  const rootFields = (rootName: string): readonly GraphQLField[] =>
    types.find((type) => type.name === rootName && type.kind === "type")?.fields ?? [];

  return {
    types,
    queries: rootFields("Query"),
    mutations: rootFields("Mutation"),
    subscriptions: rootFields("Subscription"),
    errors,
  };
}

function unwrap(type: string): string {
  return type.replace(/[![\]]/g, "").trim();
}

const SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"]);

/** Build a runnable operation document for a root field. */
export function buildOperation(
  model: GraphQLSchemaModel,
  field: GraphQLField,
  operation: "query" | "mutation" | "subscription" = "query",
): { document: string; variables: string } {
  const variableDefs = field.args.map((arg) => `$${arg.name}: ${arg.type}`).join(", ");
  const argList = field.args.map((arg) => `${arg.name}: $${arg.name}`).join(", ");

  const selection = selectionSet(model, unwrap(field.type), 0);
  const header = `${operation} ${capitalise(field.name)}${variableDefs ? `(${variableDefs})` : ""}`;
  const call = `${field.name}${argList ? `(${argList})` : ""}`;
  const document = `${header} {\n  ${call}${selection ? ` ${selection}` : ""}\n}\n`;

  const variables: Record<string, unknown> = {};
  for (const arg of field.args) {
    variables[arg.name] = exampleForType(unwrap(arg.type));
  }
  return { document, variables: JSON.stringify(variables, null, 2) };
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function exampleForType(type: string): unknown {
  switch (type) {
    case "Int":
      return 1;
    case "Float":
      return 1.5;
    case "Boolean":
      return true;
    case "ID":
      return "1";
    case "String":
      return "example";
    default:
      return {};
  }
}

function selectionSet(model: GraphQLSchemaModel, typeName: string, depth: number): string {
  if (depth > 2 || SCALARS.has(typeName)) return "";
  const type = model.types.find((candidate) => candidate.name === typeName);
  if (!type || type.kind === "enum" || type.kind === "scalar") return "";

  const indent = "  ".repeat(depth + 2);
  const closing = "  ".repeat(depth + 1);
  const lines = type.fields.slice(0, 12).map((field) => {
    const child = selectionSet(model, unwrap(field.type), depth + 1);
    return `${indent}${field.name}${child ? ` ${child}` : ""}`;
  });
  if (lines.length === 0) return "";
  return `{\n${lines.join("\n")}\n${closing}}`;
}

/** Headline statistics for the GraphQL designer sidebar. */
export function graphqlStats(model: GraphQLSchemaModel): {
  types: number;
  queries: number;
  mutations: number;
  subscriptions: number;
  fields: number;
} {
  return {
    types: model.types.length,
    queries: model.queries.length,
    mutations: model.mutations.length,
    subscriptions: model.subscriptions.length,
    fields: model.types.reduce((total, type) => total + type.fields.length, 0),
  };
}
