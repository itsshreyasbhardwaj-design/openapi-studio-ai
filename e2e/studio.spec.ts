import { expect, test, type Page } from "@playwright/test";

const SAMPLE = `openapi: 3.1.0
info:
  title: E2E Orders API
  version: 1.0.0
  description: Created by the end-to-end suite.
servers:
  - url: https://api.example.com/v1
    description: Production
security:
  - bearerAuth: []
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: A JWT access token.
paths:
  /orders:
    get:
      operationId: listOrders
      summary: List orders
      description: Returns recent orders.
      tags: [Orders]
      parameters:
        - name: limit
          in: query
          description: Page size.
          schema:
            type: integer
            maximum: 100
      responses:
        "200":
          description: A page of orders.
          content:
            application/json:
              schema:
                type: object
                additionalProperties: false
                properties:
                  data:
                    type: array
                    maxItems: 100
                    items:
                      type: object
                      additionalProperties: false
                      properties:
                        id:
                          type: string
                          description: Order identifier.
                          maxLength: 64
              example:
                data:
                  - id: ord_1
        "400":
          description: Invalid request.
        "429":
          description: Too many requests.
        "500":
          description: Server error.
`;

/** Create an API through the public API and return its id. */
async function createSpec(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/specs", {
    data: { name, source: SAMPLE },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

test.describe("marketing", () => {
  test("the landing page renders its hero and links into the studio", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("API workbench");
    await expect(page.getByRole("link", { name: /Start designing/ })).toBeVisible();

    await page.getByRole("link", { name: /Start designing/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("health", () => {
  test("reports capabilities", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { status: string; capabilities: { ai: string } };
    expect(body.status).toBe("ok");
    expect(["offline", "openrouter"]).toContain(body.capabilities.ai);
  });
});

test.describe("designer", () => {
  test("shows scores, the visual editor and diagnostics", async ({ page }) => {
    const id = await createSpec(page, "E2E Designer");
    await page.goto(`/apis/${id}`);

    await expect(page.getByText("Quality", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Valid", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Title/ }).first()).toHaveValue(
      "E2E Orders API",
    );
    await expect(page.getByText("List orders").first()).toBeVisible();
  });

  test("switches to the raw editor", async ({ page }) => {
    const id = await createSpec(page, "E2E Code");
    await page.goto(`/apis/${id}`);

    await page.getByRole("tab", { name: /YAML/ }).click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("documentation", () => {
  test("renders the operation reference", async ({ page }) => {
    const id = await createSpec(page, "E2E Docs");
    await page.goto(`/apis/${id}/docs`);

    await expect(page.getByRole("heading", { name: "E2E Orders API" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Authentication" })).toBeVisible();
    await expect(page.getByText("/orders", { exact: true }).first()).toBeVisible();
  });
});

test.describe("security report", () => {
  test("grades the specification", async ({ page }) => {
    const id = await createSpec(page, "E2E Security");
    await page.goto(`/apis/${id}/security`);
    await expect(page.getByText("Security grade")).toBeVisible();
  });
});

test.describe("mock server", () => {
  test("enforces authentication and serves documented responses", async ({ page, request }) => {
    const id = await createSpec(page, "E2E Mock");

    const unauthorised = await request.get(`/api/mock/${id}/orders`);
    expect(unauthorised.status()).toBe(401);

    const authorised = await request.get(`/api/mock/${id}/orders`, {
      headers: { authorization: "Bearer token" },
    });
    expect(authorised.status()).toBe(200);
    expect(await authorised.json()).toHaveProperty("data");

    const forced = await request.get(`/api/mock/${id}/orders?__mock_status=429`, {
      headers: { authorization: "Bearer token" },
    });
    expect(forced.status()).toBe(429);
  });
});

test.describe("SDK generation", () => {
  test("generates a TypeScript client", async ({ page }) => {
    const id = await createSpec(page, "E2E SDK");
    await page.goto(`/apis/${id}/sdk`);

    await expect(page.getByText("src/client.ts").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("npm install", { exact: false }).first()).toBeVisible();
  });
});

test.describe("versions", () => {
  test("records history and computes a semantic diff", async ({ page, request }) => {
    const id = await createSpec(page, "E2E Versions");

    const changed = SAMPLE.replace("summary: List orders", "summary: List all orders");
    const saved = await request.post(`/api/specs/${id}/versions`, {
      data: { source: changed, message: "Reword the summary" },
    });
    expect(saved.status()).toBe(201);

    await page.goto(`/apis/${id}/versions`);
    await expect(page.getByText("History", { exact: true })).toBeVisible();
    await expect(page.getByText("Semantic diff", { exact: true })).toBeVisible();
  });
});

test.describe("api client", () => {
  test("loads the request console", async ({ page }) => {
    await page.goto("/client");
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Assertions" })).toBeVisible();
  });
});

test.describe("monitoring", () => {
  test("renders the dashboard", async ({ page }) => {
    await page.goto("/monitor");
    await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
    await expect(page.getByText("Availability", { exact: true })).toBeVisible();
  });
});
