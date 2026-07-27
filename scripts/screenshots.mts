/**
 * Capture the README screenshots from a running instance.
 *
 * Usage:  pnpm dev            (in one terminal)
 *         pnpm screenshots    (in another)
 *
 * The script seeds a demo API through the public HTTP API, generates a little
 * mock traffic so the monitoring dashboard has something real to plot, then
 * writes PNGs to docs/screenshots/.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";

const DEMO_SPEC = `openapi: 3.1.0
info:
  title: Orders API
  version: 1.4.0
  description: |
    Order lifecycle for a commerce platform: carts become orders, orders are
    paid, fulfilled, and optionally refunded.

    All list endpoints are cursor-paginated and every failure returns the shared
    Error schema with a stable code and a request id.
  contact:
    email: api-support@example.com
  license:
    name: MIT
servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://sandbox.api.example.com/v1
    description: Sandbox
security:
  - bearerAuth: []
tags:
  - name: Orders
    description: Create, inspect and refund customer orders.
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Short-lived JWT issued by the authentication service.
  schemas:
    Order:
      type: object
      description: A customer order.
      additionalProperties: false
      required: [id, status, currency, totalAmount]
      properties:
        id:
          type: string
          description: Unique identifier of the order.
          maxLength: 64
          example: ord_01H8XK9P2M
        status:
          type: string
          description: Current lifecycle state.
          enum: [pending, paid, fulfilled, cancelled, refunded]
          example: paid
        currency:
          type: string
          description: ISO 4217 currency code.
          maxLength: 3
          example: USD
        totalAmount:
          type: integer
          description: Order total in the smallest currency unit.
          example: 12999
        createdAt:
          type: string
          format: date-time
          description: When the order was created.
    Error:
      type: object
      description: A machine-readable error.
      additionalProperties: false
      required: [code, message]
      properties:
        code:
          type: string
          description: Stable, machine-readable error code.
          maxLength: 64
          example: invalid_request
        message:
          type: string
          description: Human-readable explanation.
          maxLength: 512
        requestId:
          type: string
          description: Correlation id for support.
          maxLength: 64
paths:
  /orders:
    get:
      operationId: listOrders
      summary: List orders
      description: Returns a cursor-paginated list of orders, newest first.
      tags: [Orders]
      parameters:
        - name: limit
          in: query
          description: Maximum number of orders to return.
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 25
        - name: cursor
          in: query
          description: Opaque cursor from the previous page.
          schema:
            type: string
            maxLength: 256
      responses:
        "200":
          description: A page of orders.
          content:
            application/json:
              schema:
                type: object
                additionalProperties: false
                required: [data]
                properties:
                  data:
                    type: array
                    maxItems: 100
                    items:
                      $ref: "#/components/schemas/Order"
                  nextCursor:
                    type: string
                    description: Cursor for the next page.
                    maxLength: 256
              example:
                data:
                  - id: ord_01H8XK9P2M
                    status: paid
                    currency: USD
                    totalAmount: 12999
                nextCursor: eyJvZmZzZXQiOjI1fQ
        "401":
          description: Credentials are missing or invalid.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "429":
          description: Too many requests.
          headers:
            Retry-After:
              description: Seconds to wait before retrying.
              schema:
                type: integer
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "500":
          description: Unexpected server error.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
    post:
      operationId: createOrder
      summary: Create an order
      description: Creates a new order. Supply an Idempotency-Key header to make retries safe.
      tags: [Orders]
      parameters:
        - name: Idempotency-Key
          in: header
          description: Unique key that makes the request safe to retry.
          schema:
            type: string
            maxLength: 128
      requestBody:
        required: true
        description: The order to create.
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [currency, totalAmount]
              properties:
                currency:
                  type: string
                  description: ISO 4217 currency code.
                  maxLength: 3
                totalAmount:
                  type: integer
                  description: Order total in the smallest currency unit.
            example:
              currency: USD
              totalAmount: 12999
      responses:
        "201":
          description: The created order.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
        "400":
          description: The request was invalid.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "429":
          description: Too many requests.
        "500":
          description: Unexpected server error.
  /orders/{orderId}:
    parameters:
      - name: orderId
        in: path
        required: true
        description: Identifier of the order.
        schema:
          type: string
          maxLength: 64
    get:
      operationId: getOrder
      summary: Retrieve an order
      description: Returns a single order by identifier.
      tags: [Orders]
      responses:
        "200":
          description: The requested order.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
              example:
                id: ord_01H8XK9P2M
                status: paid
                currency: USD
                totalAmount: 12999
        "401":
          description: Credentials are missing or invalid.
        "404":
          description: The order does not exist.
        "429":
          description: Too many requests.
        "500":
          description: Unexpected server error.
  /orders/{orderId}/refund:
    parameters:
      - name: orderId
        in: path
        required: true
        description: Identifier of the order.
        schema:
          type: string
          maxLength: 64
    post:
      operationId: refundOrder
      summary: Refund an order
      description: Refunds all or part of a paid order.
      tags: [Orders]
      responses:
        "200":
          description: The refunded order.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
        "401":
          description: Credentials are missing or invalid.
        "404":
          description: The order does not exist.
        "409":
          description: The order cannot be refunded in its current state.
        "429":
          description: Too many requests.
        "500":
          description: Unexpected server error.
`;

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const created = await fetch(`${BASE}/api/specs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Orders API", source: DEMO_SPEC }),
  });
  if (!created.ok) throw new Error(`Failed to seed the demo API: ${created.status}`);
  const { project } = (await created.json()) as { project: { id: string } };

  // Generate a little traffic so the monitoring dashboard is not empty.
  const paths = ["/orders", "/orders", "/orders", "/orders/ord_1", "/orders/ord_1/refund"];
  for (let round = 0; round < 8; round += 1) {
    for (const path of paths) {
      const method = path.endsWith("refund") ? "POST" : "GET";
      const forced = round % 5 === 0 && path === "/orders/ord_1" ? "?__mock_status=404" : "";
      await fetch(`${BASE}/api/mock/${project.id}${path}${forced}`, {
        method,
        headers: { authorization: "Bearer demo-token", "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      }).catch(() => undefined);
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  const shots: { name: string; url: string; wait?: string }[] = [
    { name: "landing", url: "/" },
    { name: "dashboard", url: "/dashboard" },
    { name: "designer", url: `/apis/${project.id}` },
    { name: "docs", url: `/apis/${project.id}/docs` },
    { name: "security", url: `/apis/${project.id}/security` },
    { name: "sdk", url: `/apis/${project.id}/sdk`, wait: "text=src/client.ts" },
    { name: "mock", url: `/apis/${project.id}/mock` },
    { name: "versions", url: `/apis/${project.id}/versions` },
    { name: "monitor", url: "/monitor" },
    { name: "client", url: "/client" },
  ];

  for (const shot of shots) {
    await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle" });
    if (shot.wait)
      await page.waitForSelector(shot.wait, { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(900);
    // Disabling animations keeps captures deterministic and avoids waiting
    // for infinite CSS animations to settle.
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, animations: "disabled" });
    console.log(`captured ${shot.name}.png`);
  }

  await browser.close();

  // Leave the workspace as we found it.
  await fetch(`${BASE}/api/specs/${project.id}`, { method: "DELETE" }).catch(() => undefined);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
