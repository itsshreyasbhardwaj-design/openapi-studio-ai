import type { OpenApiDocument, Operation, PathItem, Schema } from "@/lib/core/openapi/types";

/**
 * Domain blueprints for the offline specification synthesiser.
 *
 * The AI assistant must work with **zero API spend** — a hard product
 * requirement for an open-source tool. This module encodes API design expertise
 * (resource modelling, error contracts, pagination, idempotency, rate limits)
 * as data, so a natural-language prompt still produces a standards-compliant,
 * genuinely useful OpenAPI document with no provider key configured.
 */

export interface FieldBlueprint {
  readonly name: string;
  readonly type: Schema["type"];
  readonly format?: string;
  readonly description: string;
  readonly required?: boolean;
  readonly example?: unknown;
  readonly enum?: string[];
  readonly ref?: string;
  readonly items?: { ref?: string; type?: Schema["type"] };
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
}

export interface ResourceBlueprint {
  /** Singular PascalCase model name, e.g. `Order`. */
  readonly model: string;
  /** Plural, kebab-case collection path segment, e.g. `orders`. */
  readonly collection: string;
  readonly description: string;
  readonly tag: string;
  readonly fields: readonly FieldBlueprint[];
  /** Operations to emit. Defaults to the full CRUD set. */
  readonly operations?: readonly ("list" | "create" | "read" | "update" | "delete")[];
  /** Extra, domain-specific actions such as `POST /orders/{id}/cancel`. */
  readonly actions?: readonly {
    readonly method: "post" | "put" | "patch" | "delete" | "get";
    readonly suffix: string;
    readonly summary: string;
    readonly description: string;
    readonly requestFields?: readonly FieldBlueprint[];
    readonly responseRef?: string;
  }[];
}

export interface DomainBlueprint {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Words that select this blueprint from a natural-language prompt. */
  readonly keywords: readonly string[];
  readonly resources: readonly ResourceBlueprint[];
  readonly extraSchemas?: Readonly<Record<string, Schema>>;
  readonly webhooks?: Readonly<
    Record<string, { summary: string; description: string; payloadRef: string }>
  >;
}

const identity = (model: string): FieldBlueprint => ({
  name: "id",
  type: "string",
  description: `Unique identifier of the ${model.toLowerCase()}.`,
  required: true,
  readOnly: true,
  example: `${model.slice(0, 3).toLowerCase()}_01H8XK9P2M`,
});

const timestamps: FieldBlueprint[] = [
  {
    name: "createdAt",
    type: "string",
    format: "date-time",
    description: "When the record was created (RFC 3339).",
    required: true,
    readOnly: true,
  },
  {
    name: "updatedAt",
    type: "string",
    format: "date-time",
    description: "When the record was last modified (RFC 3339).",
    readOnly: true,
  },
];

export const ORDERS_DOMAIN: DomainBlueprint = {
  id: "orders",
  title: "Orders API",
  description:
    "Order lifecycle for an e-commerce platform: carts become orders, orders are paid, fulfilled, and optionally refunded.",
  keywords: [
    "order",
    "ecommerce",
    "e-commerce",
    "commerce",
    "cart",
    "checkout",
    "shop",
    "store",
    "purchase",
  ],
  resources: [
    {
      model: "Order",
      collection: "orders",
      tag: "Orders",
      description: "A customer order.",
      fields: [
        identity("Order"),
        {
          name: "customerId",
          type: "string",
          description: "Identifier of the customer who placed the order.",
          required: true,
          example: "cus_01H8XK9P2M",
        },
        {
          name: "status",
          type: "string",
          description: "Current lifecycle state of the order.",
          required: true,
          enum: ["pending", "paid", "fulfilled", "cancelled", "refunded"],
          example: "paid",
        },
        {
          name: "currency",
          type: "string",
          description: "ISO 4217 currency code.",
          required: true,
          example: "USD",
        },
        {
          name: "totalAmount",
          type: "integer",
          description: "Order total in the smallest currency unit (e.g. cents).",
          required: true,
          example: 12999,
        },
        {
          name: "items",
          type: "array",
          description: "Line items belonging to the order.",
          required: true,
          items: { ref: "OrderItem" },
        },
        {
          name: "shippingAddress",
          type: "object",
          description: "Destination address for physical fulfilment.",
          ref: "Address",
        },
        ...timestamps,
      ],
      actions: [
        {
          method: "post",
          suffix: "cancel",
          summary: "Cancel an order",
          description:
            "Cancels an order that has not yet been fulfilled. Cancelling a paid order automatically issues a refund.",
          requestFields: [
            {
              name: "reason",
              type: "string",
              description: "Why the order is being cancelled.",
              required: true,
            },
          ],
          responseRef: "Order",
        },
        {
          method: "post",
          suffix: "refund",
          summary: "Refund an order",
          description: "Refunds all or part of a paid order.",
          requestFields: [
            {
              name: "amount",
              type: "integer",
              description:
                "Amount to refund in the smallest currency unit. Defaults to the full order total.",
            },
            { name: "reason", type: "string", description: "Reason recorded against the refund." },
          ],
          responseRef: "Order",
        },
      ],
    },
    {
      model: "Product",
      collection: "products",
      tag: "Catalog",
      description: "A purchasable product in the catalog.",
      fields: [
        identity("Product"),
        {
          name: "sku",
          type: "string",
          description: "Stock keeping unit.",
          required: true,
          example: "SKU-1042",
        },
        {
          name: "name",
          type: "string",
          description: "Display name.",
          required: true,
          example: "Cobalt Notebook",
        },
        { name: "description", type: "string", description: "Long-form product description." },
        {
          name: "priceAmount",
          type: "integer",
          description: "Unit price in the smallest currency unit.",
          required: true,
          example: 2499,
        },
        {
          name: "currency",
          type: "string",
          description: "ISO 4217 currency code.",
          required: true,
          example: "USD",
        },
        {
          name: "inventoryCount",
          type: "integer",
          description: "Units currently in stock.",
          example: 42,
        },
        ...timestamps,
      ],
    },
  ],
  extraSchemas: {
    OrderItem: {
      type: "object",
      description: "A single line item within an order.",
      required: ["productId", "quantity", "unitAmount"],
      additionalProperties: false,
      properties: {
        productId: {
          type: "string",
          description: "Identifier of the purchased product.",
          example: "prd_01H8XK9P2M",
          maxLength: 64,
        },
        quantity: { type: "integer", minimum: 1, description: "Units purchased.", example: 2 },
        unitAmount: {
          type: "integer",
          description: "Price per unit in the smallest currency unit.",
          example: 2499,
        },
      },
    },
    Address: {
      type: "object",
      description: "A postal address.",
      required: ["line1", "city", "country"],
      additionalProperties: false,
      properties: {
        line1: {
          type: "string",
          description: "Street address.",
          example: "1 Market Street",
          maxLength: 200,
        },
        line2: { type: "string", description: "Apartment, suite or unit.", maxLength: 200 },
        city: {
          type: "string",
          description: "City or locality.",
          example: "San Francisco",
          maxLength: 100,
        },
        postalCode: {
          type: "string",
          description: "Postal or ZIP code.",
          example: "94105",
          maxLength: 16,
        },
        country: {
          type: "string",
          description: "ISO 3166-1 alpha-2 country code.",
          example: "US",
          maxLength: 2,
        },
      },
    },
  },
  webhooks: {
    "order.status_changed": {
      summary: "Order status changed",
      description:
        "Delivered whenever an order transitions between lifecycle states. Verify the `X-Signature` header before trusting the payload.",
      payloadRef: "Order",
    },
  },
};

export const AUTH_DOMAIN: DomainBlueprint = {
  id: "auth",
  title: "Authentication API",
  description:
    "Token-based authentication: register, sign in, refresh, revoke, and manage the authenticated session.",
  keywords: [
    "auth",
    "authentication",
    "login",
    "signin",
    "sign-in",
    "signup",
    "identity",
    "session",
    "oauth",
    "token",
  ],
  resources: [
    {
      model: "User",
      collection: "users",
      tag: "Users",
      description: "A registered end user.",
      operations: ["list", "read", "update", "delete"],
      fields: [
        identity("User"),
        {
          name: "email",
          type: "string",
          format: "email",
          description: "Primary email address, unique across the tenant.",
          required: true,
        },
        {
          name: "displayName",
          type: "string",
          description: "Human-readable name.",
          example: "Ada Lovelace",
        },
        {
          name: "password",
          type: "string",
          format: "password",
          description: "Plaintext password, accepted on write and never returned.",
          writeOnly: true,
        },
        {
          name: "emailVerified",
          type: "boolean",
          description: "Whether the email address has been confirmed.",
          readOnly: true,
        },
        {
          name: "roles",
          type: "array",
          description: "Roles granted to the user.",
          items: { type: "string" },
        },
        ...timestamps,
      ],
    },
  ],
  extraSchemas: {
    TokenPair: {
      type: "object",
      description: "A short-lived access token paired with a long-lived refresh token.",
      required: ["accessToken", "refreshToken", "expiresIn", "tokenType"],
      additionalProperties: false,
      properties: {
        accessToken: {
          type: "string",
          description: "JWT presented as a bearer token.",
          example: "eyJhbGciOiJIUzI1...",
          maxLength: 4096,
        },
        refreshToken: {
          type: "string",
          description: "Opaque token used to obtain a new access token.",
          maxLength: 512,
          writeOnly: true,
        },
        tokenType: {
          type: "string",
          enum: ["Bearer"],
          description: "Always `Bearer`.",
          example: "Bearer",
        },
        expiresIn: {
          type: "integer",
          description: "Access token lifetime in seconds.",
          example: 3600,
        },
        scope: {
          type: "string",
          description: "Space-delimited granted scopes.",
          example: "profile orders:read",
          maxLength: 512,
        },
      },
    },
    Credentials: {
      type: "object",
      description: "Email and password credentials.",
      required: ["email", "password"],
      additionalProperties: false,
      properties: {
        email: {
          type: "string",
          format: "email",
          description: "Registered email address.",
          maxLength: 320,
        },
        password: {
          type: "string",
          format: "password",
          description: "Account password.",
          minLength: 12,
          maxLength: 256,
          writeOnly: true,
        },
      },
    },
  },
};

export const PAYMENTS_DOMAIN: DomainBlueprint = {
  id: "payments",
  title: "Payments API",
  description:
    "Payment intents, captures, refunds and payment methods, modelled on the conventions of modern payment processors.",
  keywords: [
    "payment",
    "pay",
    "billing",
    "charge",
    "invoice",
    "stripe",
    "checkout",
    "transaction",
    "refund",
  ],
  resources: [
    {
      model: "Payment",
      collection: "payments",
      tag: "Payments",
      description: "A payment intent progressing through authorisation and capture.",
      operations: ["list", "create", "read"],
      fields: [
        identity("Payment"),
        {
          name: "amount",
          type: "integer",
          description: "Amount in the smallest currency unit.",
          required: true,
          example: 4999,
        },
        {
          name: "currency",
          type: "string",
          description: "ISO 4217 currency code.",
          required: true,
          example: "USD",
        },
        {
          name: "status",
          type: "string",
          description: "Current state of the payment.",
          required: true,
          enum: [
            "requires_payment_method",
            "requires_confirmation",
            "processing",
            "succeeded",
            "failed",
            "refunded",
          ],
          example: "succeeded",
        },
        { name: "customerId", type: "string", description: "Customer the payment belongs to." },
        {
          name: "paymentMethodId",
          type: "string",
          description: "Payment method used to fulfil the payment.",
        },
        {
          name: "description",
          type: "string",
          description: "Statement descriptor shown to the payer.",
          example: "Order ord_01H8XK9P2M",
        },
        ...timestamps,
      ],
      actions: [
        {
          method: "post",
          suffix: "capture",
          summary: "Capture an authorised payment",
          description:
            "Captures funds previously authorised. Supply an amount to capture partially.",
          requestFields: [
            {
              name: "amount",
              type: "integer",
              description: "Amount to capture; defaults to the full authorisation.",
            },
          ],
          responseRef: "Payment",
        },
        {
          method: "post",
          suffix: "refund",
          summary: "Refund a captured payment",
          description: "Refunds a captured payment in full or in part.",
          requestFields: [
            {
              name: "amount",
              type: "integer",
              description: "Amount to refund; defaults to the full payment.",
            },
            { name: "reason", type: "string", description: "Reason recorded against the refund." },
          ],
          responseRef: "Payment",
        },
      ],
    },
    {
      model: "PaymentMethod",
      collection: "payment-methods",
      tag: "Payment methods",
      description: "A stored instrument that can fund payments.",
      operations: ["list", "create", "read", "delete"],
      fields: [
        identity("PaymentMethod"),
        {
          name: "type",
          type: "string",
          description: "Instrument type.",
          required: true,
          enum: ["card", "bank_account", "wallet"],
          example: "card",
        },
        {
          name: "customerId",
          type: "string",
          description: "Owner of the instrument.",
          required: true,
        },
        {
          name: "last4",
          type: "string",
          description: "Last four digits, safe to display.",
          readOnly: true,
          example: "4242",
        },
        { name: "expiryMonth", type: "integer", description: "Card expiry month.", example: 12 },
        { name: "expiryYear", type: "integer", description: "Card expiry year.", example: 2030 },
        ...timestamps,
      ],
    },
  ],
  webhooks: {
    "payment.succeeded": {
      summary: "Payment succeeded",
      description: "Delivered when a payment reaches the `succeeded` state.",
      payloadRef: "Payment",
    },
  },
};

export const GENERIC_DOMAIN: DomainBlueprint = {
  id: "generic",
  title: "Resource API",
  description:
    "A RESTful resource API with full CRUD, cursor pagination and a consistent error contract.",
  keywords: [],
  resources: [
    {
      model: "Item",
      collection: "items",
      tag: "Items",
      description: "A generic resource.",
      fields: [
        identity("Item"),
        {
          name: "name",
          type: "string",
          description: "Display name.",
          required: true,
          example: "Example item",
        },
        { name: "description", type: "string", description: "Longer description of the item." },
        {
          name: "status",
          type: "string",
          description: "Lifecycle state.",
          enum: ["active", "archived"],
          example: "active",
        },
        {
          name: "metadata",
          type: "object",
          description: "Arbitrary key/value pairs attached by the integrator.",
        },
        ...timestamps,
      ],
    },
  ],
};

export const TASKS_DOMAIN: DomainBlueprint = {
  id: "tasks",
  title: "Task Management API",
  description: "Projects, tasks, assignments and comments for a collaborative work tracker.",
  keywords: [
    "task",
    "todo",
    "to-do",
    "project",
    "issue",
    "ticket",
    "kanban",
    "board",
    "sprint",
    "work",
  ],
  resources: [
    {
      model: "Project",
      collection: "projects",
      tag: "Projects",
      description: "A container for related tasks.",
      fields: [
        identity("Project"),
        {
          name: "name",
          type: "string",
          description: "Project name.",
          required: true,
          example: "Platform migration",
        },
        {
          name: "key",
          type: "string",
          description: "Short prefix used in task keys.",
          example: "PLT",
        },
        { name: "description", type: "string", description: "What the project is for." },
        { name: "archived", type: "boolean", description: "Whether the project is archived." },
        ...timestamps,
      ],
    },
    {
      model: "Task",
      collection: "tasks",
      tag: "Tasks",
      description: "A unit of work.",
      fields: [
        identity("Task"),
        {
          name: "projectId",
          type: "string",
          description: "Project the task belongs to.",
          required: true,
        },
        {
          name: "title",
          type: "string",
          description: "Short summary of the work.",
          required: true,
          example: "Add rate limiting",
        },
        { name: "description", type: "string", description: "Full description in Markdown." },
        {
          name: "status",
          type: "string",
          description: "Workflow state.",
          required: true,
          enum: ["backlog", "in_progress", "in_review", "done"],
          example: "in_progress",
        },
        {
          name: "priority",
          type: "string",
          description: "Relative priority.",
          enum: ["low", "medium", "high", "urgent"],
          example: "high",
        },
        { name: "assigneeId", type: "string", description: "User the task is assigned to." },
        {
          name: "dueAt",
          type: "string",
          format: "date-time",
          description: "When the task is due.",
        },
        ...timestamps,
      ],
      actions: [
        {
          method: "post",
          suffix: "assign",
          summary: "Assign a task",
          description: "Assigns the task to a user and notifies them.",
          requestFields: [
            {
              name: "assigneeId",
              type: "string",
              description: "User to assign the task to.",
              required: true,
            },
          ],
          responseRef: "Task",
        },
      ],
    },
  ],
};

export const NOTIFICATIONS_DOMAIN: DomainBlueprint = {
  id: "notifications",
  title: "Notifications API",
  description:
    "Multi-channel notification delivery with templates, subscriptions and delivery receipts.",
  keywords: ["notification", "email", "sms", "push", "message", "alert", "inbox", "delivery"],
  resources: [
    {
      model: "Notification",
      collection: "notifications",
      tag: "Notifications",
      description: "A notification queued for delivery.",
      operations: ["list", "create", "read"],
      fields: [
        identity("Notification"),
        {
          name: "channel",
          type: "string",
          description: "Delivery channel.",
          required: true,
          enum: ["email", "sms", "push", "webhook"],
          example: "email",
        },
        {
          name: "recipientId",
          type: "string",
          description: "Recipient identifier.",
          required: true,
        },
        { name: "templateId", type: "string", description: "Template used to render the message." },
        {
          name: "subject",
          type: "string",
          description: "Subject line, where the channel supports one.",
        },
        { name: "body", type: "string", description: "Rendered message body." },
        {
          name: "status",
          type: "string",
          description: "Delivery state.",
          enum: ["queued", "sent", "delivered", "bounced", "failed"],
          readOnly: true,
          example: "delivered",
        },
        ...timestamps,
      ],
    },
  ],
};

export const BLUEPRINTS: readonly DomainBlueprint[] = [
  ORDERS_DOMAIN,
  AUTH_DOMAIN,
  PAYMENTS_DOMAIN,
  TASKS_DOMAIN,
  NOTIFICATIONS_DOMAIN,
];

/** Score each blueprint against the prompt and return the best matches. */
export function selectBlueprints(prompt: string): DomainBlueprint[] {
  const haystack = prompt.toLowerCase();
  const scored = BLUEPRINTS.map((blueprint) => ({
    blueprint,
    score: blueprint.keywords.reduce(
      (total, keyword) => total + (haystack.includes(keyword) ? keyword.length : 0),
      0,
    ),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [GENERIC_DOMAIN];
  return scored.slice(0, 2).map((entry) => entry.blueprint);
}

/** Helper used by the synthesiser to build a schema from field blueprints. */
export function schemaFromFields(description: string, fields: readonly FieldBlueprint[]): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const field of fields) {
    const schema: Schema = { description: field.description };
    if (field.ref) {
      properties[field.name] = {
        $ref: `#/components/schemas/${field.ref}`,
        description: field.description,
      };
      if (field.required) required.push(field.name);
      continue;
    }
    if (field.type) schema.type = field.type;
    if (field.format) schema.format = field.format;
    if (field.enum) schema.enum = field.enum;
    if (field.example !== undefined) schema.example = field.example;
    if (field.readOnly) schema.readOnly = true;
    if (field.writeOnly) schema.writeOnly = true;
    if (field.type === "array") {
      schema.items = field.items?.ref
        ? { $ref: `#/components/schemas/${field.items.ref}` }
        : { type: field.items?.type ?? "string" };
      schema.maxItems = 100;
    }
    if (field.type === "string" && !field.enum && !field.format) schema.maxLength = 512;
    if (field.type === "object" && !field.ref) schema.additionalProperties = { type: "string" };
    properties[field.name] = schema;
    if (field.required) required.push(field.name);
  }

  const out: Schema = { type: "object", description, properties, additionalProperties: false };
  if (required.length > 0) out.required = required;
  return out;
}

export type { Operation, PathItem, OpenApiDocument };
