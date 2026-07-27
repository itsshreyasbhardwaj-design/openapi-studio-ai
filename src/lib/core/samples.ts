import { stringifySpec } from "./openapi/document";
import { synthesiseSpec } from "./ai/offline";

/** Ready-made briefs offered in the "new API" dialog. */
export const STARTER_TEMPLATES = [
  {
    id: "orders",
    name: "Commerce Orders API",
    brief: "Design an e-commerce order API with products, cancellations and refunds",
    description: "Orders, catalog, refunds and an order.status_changed webhook.",
  },
  {
    id: "auth",
    name: "Authentication API",
    brief: "Create an authentication API with registration, tokens and session management",
    description: "Register, sign in, refresh, revoke and the current-user endpoint.",
  },
  {
    id: "payments",
    name: "Payments API",
    brief: "Generate a payment service with payment intents, captures and stored methods",
    description: "Payments, captures, refunds, payment methods and delivery webhooks.",
  },
  {
    id: "tasks",
    name: "Task Management API",
    brief: "Design a task management API with projects, tasks and assignments",
    description: "Projects, tasks, workflow states and assignment actions.",
  },
  {
    id: "notifications",
    name: "Notifications API",
    brief: "Build a notification delivery API for email, SMS and push channels",
    description: "Multi-channel delivery with templates and delivery status.",
  },
] as const;

export type StarterTemplateId = (typeof STARTER_TEMPLATES)[number]["id"];

/** Render a starter template to YAML using the offline design engine. */
export function starterSpec(id: StarterTemplateId): { name: string; source: string } {
  const template = STARTER_TEMPLATES.find((entry) => entry.id === id) ?? STARTER_TEMPLATES[0];
  const { document } = synthesiseSpec(template.brief, { title: template.name });
  return { name: template.name, source: stringifySpec(document, "yaml") };
}

/** A minimal, valid document used when starting from scratch. */
export const BLANK_SPEC = `openapi: 3.1.0
info:
  title: New API
  version: 1.0.0
  description: Describe what this API does and who it is for.
servers:
  - url: https://api.example.com/v1
    description: Production
paths:
  /health:
    get:
      operationId: getHealth
      summary: Health check
      description: Returns the current service status.
      tags:
        - System
      responses:
        "200":
          description: The service is healthy.
          content:
            application/json:
              schema:
                type: object
                additionalProperties: false
                properties:
                  status:
                    type: string
                    description: Always "ok" when the service is healthy.
                    maxLength: 16
                    example: ok
              example:
                status: ok
`;
