import { describe, expect, it, vi } from "vitest";
import {
  evaluateAssertion,
  evaluateAssertions,
  defaultAssertions,
} from "@/lib/core/testing/assertions";
import {
  interpolate,
  interpolateRecord,
  readJsonPath,
  referencedVariables,
} from "@/lib/core/testing/interpolate";
import { prepareRequest, toCurl } from "@/lib/core/testing/request";
import { runCollection, runStats, type ExecutionOutcome } from "@/lib/core/testing/runner";
import { collectionFromSpec, requiredVariablesFor } from "@/lib/core/testing/from-spec";
import type { Assertion, RequestCollection, RequestDefinition } from "@/lib/domain/types";
import { petstore } from "../fixtures";

const response = {
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json", "x-request-id": "req_1" },
  body: JSON.stringify({ data: { id: "pet_1", tags: ["a", "b"] }, total: 2 }),
  durationMs: 120,
};

const assertion = (overrides: Partial<Assertion>): Assertion => ({
  id: "a",
  kind: "status",
  target: "",
  operator: "equals",
  expected: "200",
  ...overrides,
});

describe("interpolate", () => {
  it("substitutes variables and reports missing ones", () => {
    const result = interpolate("{{base}}/pets/{{petId}}", { base: "https://api.test" });
    expect(result.value).toBe("https://api.test/pets/{{petId}}");
    expect(result.missing).toEqual(["petId"]);
  });

  it("interpolates record keys and values", () => {
    const result = interpolateRecord({ "x-{{h}}": "{{v}}" }, { h: "tenant", v: "acme" });
    expect(result.record).toEqual({ "x-tenant": "acme" });
  });

  it("lists referenced variables", () => {
    expect(referencedVariables("{{a}}/{{b}}/{{a}}")).toEqual(["a", "b"]);
  });

  it("reads JSON paths with dot and bracket notation", () => {
    const payload = { data: { items: [{ id: 7 }] } };
    expect(readJsonPath(payload, "data.items[0].id")).toBe(7);
    expect(readJsonPath(payload, "$.data.items.0.id")).toBe(7);
    expect(readJsonPath(payload, "data.missing.deep")).toBeUndefined();
  });
});

describe("assertions", () => {
  it("compares status numerically", () => {
    expect(evaluateAssertion(assertion({}), response).passed).toBe(true);
    expect(evaluateAssertion(assertion({ expected: "404" }), response).passed).toBe(false);
  });

  it("checks headers case-insensitively", () => {
    const result = evaluateAssertion(
      assertion({ kind: "header", target: "Content-Type", operator: "contains", expected: "json" }),
      response,
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates JSON paths", () => {
    expect(
      evaluateAssertion(
        assertion({ kind: "jsonPath", target: "data.id", operator: "equals", expected: "pet_1" }),
        response,
      ).passed,
    ).toBe(true);

    expect(
      evaluateAssertion(
        assertion({ kind: "jsonPath", target: "data.nope", operator: "exists" }),
        response,
      ).passed,
    ).toBe(false);
  });

  it("evaluates response time thresholds", () => {
    expect(
      evaluateAssertion(
        assertion({ kind: "responseTime", operator: "lessThan", expected: "500" }),
        response,
      ).passed,
    ).toBe(true);
    expect(
      evaluateAssertion(
        assertion({ kind: "responseTime", operator: "lessThan", expected: "10" }),
        response,
      ).passed,
    ).toBe(false);
  });

  it("supports regular expressions and reports invalid ones", () => {
    expect(
      evaluateAssertion(
        assertion({ kind: "bodyContains", operator: "matches", expected: "pet_\\d" }),
        response,
      ).passed,
    ).toBe(true);
    expect(
      evaluateAssertion(
        assertion({ kind: "bodyContains", operator: "matches", expected: "([" }),
        response,
      ).passed,
    ).toBe(false);
  });

  it("provides a sensible default assertion set", () => {
    const results = evaluateAssertions(defaultAssertions(200), response);
    expect(results.every((result) => result.passed)).toBe(true);
  });
});

describe("prepareRequest", () => {
  const base: RequestDefinition = {
    id: "r1",
    name: "Get pet",
    protocol: "rest",
    method: "GET",
    url: "{{baseUrl}}/pets/{{petId}}",
    headers: { accept: "application/json" },
    query: { include: "owner" },
    body: null,
    variables: null,
    auth: { type: "bearer", token: "{{token}}" },
    assertions: [],
  };

  it("interpolates the URL, query and auth", () => {
    const prepared = prepareRequest(base, {
      baseUrl: "https://api.test",
      petId: "pet_1",
      token: "abc",
    });
    expect(prepared.url).toBe("https://api.test/pets/pet_1?include=owner");
    expect(prepared.headers.authorization).toBe("Bearer abc");
    expect(prepared.missingVariables).toEqual([]);
  });

  it("reports unresolved variables instead of sending them", () => {
    const prepared = prepareRequest(base, { baseUrl: "https://api.test" });
    expect(prepared.missingVariables).toContain("petId");
    expect(prepared.missingVariables).toContain("token");
  });

  it("encodes basic credentials", () => {
    const prepared = prepareRequest(
      { ...base, auth: { type: "basic", username: "ada", password: "lovelace" } },
      { baseUrl: "https://api.test", petId: "1" },
    );
    expect(prepared.headers.authorization).toBe(
      `Basic ${Buffer.from("ada:lovelace").toString("base64")}`,
    );
  });

  it("puts an API key in the query string when configured", () => {
    const prepared = prepareRequest(
      { ...base, auth: { type: "apiKey", name: "api_key", in: "query", value: "k1" } },
      { baseUrl: "https://api.test", petId: "1" },
    );
    expect(prepared.url).toContain("api_key=k1");
  });

  it("wraps GraphQL documents into a POST payload", () => {
    const prepared = prepareRequest(
      {
        ...base,
        protocol: "graphql",
        body: "query { pets { id } }",
        variables: '{"limit":5}',
        auth: { type: "none" },
      },
      { baseUrl: "https://api.test", petId: "1" },
    );
    expect(prepared.method).toBe("POST");
    expect(JSON.parse(prepared.body ?? "{}")).toEqual({
      query: "query { pets { id } }",
      variables: { limit: 5 },
    });
  });

  it("renders an equivalent cURL command", () => {
    const curl = toCurl(
      prepareRequest(base, { baseUrl: "https://api.test", petId: "1", token: "t" }),
    );
    expect(curl).toContain("curl -X GET");
    expect(curl).toContain("authorization: Bearer t");
  });
});

describe("runCollection", () => {
  const collection = (requests: RequestDefinition[]): RequestCollection => ({
    id: "col",
    workspaceId: "ws",
    specId: null,
    name: "Suite",
    description: "",
    requests,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });

  const ok = (body: string): ExecutionOutcome => ({
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    body,
    durationMs: 10,
    sizeBytes: body.length,
    error: null,
  });

  it("runs every request and counts passes", async () => {
    const transport = vi.fn().mockResolvedValue(ok('{"ok":true}'));
    const run = await runCollection(
      collection([
        {
          id: "r1",
          name: "One",
          protocol: "rest",
          method: "GET",
          url: "https://api.test/a",
          headers: {},
          query: {},
          body: null,
          variables: null,
          auth: { type: "none" },
          assertions: [assertion({})],
        },
      ]),
      transport,
      { now: () => 1000 },
    );

    expect(transport).toHaveBeenCalledTimes(1);
    expect(run.passed).toBe(1);
    expect(run.failed).toBe(0);
  });

  it("threads captured variables into later requests", async () => {
    const seen: string[] = [];
    const transport = vi.fn().mockImplementation((request: { url: string }) => {
      seen.push(request.url);
      return Promise.resolve(ok('{"token":"secret-token"}'));
    });

    await runCollection(
      collection([
        {
          id: "login",
          name: "Login",
          protocol: "rest",
          method: "POST",
          url: "https://api.test/login",
          headers: {},
          query: {},
          body: null,
          variables: null,
          auth: { type: "none" },
          assertions: [],
          captures: [{ name: "token", from: "token" }],
        },
        {
          id: "use",
          name: "Use token",
          protocol: "rest",
          method: "GET",
          url: "https://api.test/me?t={{token}}",
          headers: {},
          query: {},
          body: null,
          variables: null,
          auth: { type: "none" },
          assertions: [],
        },
      ]),
      transport,
      { now: () => 0 },
    );

    expect(seen[1]).toBe("https://api.test/me?t=secret-token");
  });

  it("does not send a request with unresolved variables", async () => {
    const transport = vi.fn();
    const run = await runCollection(
      collection([
        {
          id: "r1",
          name: "Needs a variable",
          protocol: "rest",
          method: "GET",
          url: "https://api.test/{{missing}}",
          headers: {},
          query: {},
          body: null,
          variables: null,
          auth: { type: "none" },
          assertions: [],
        },
      ]),
      transport,
      { now: () => 0 },
    );

    expect(transport).not.toHaveBeenCalled();
    expect(run.results[0]?.error).toContain("Unresolved variables");
    expect(run.failed).toBe(1);
  });

  it("stops at the first failure when asked", async () => {
    const transport = vi.fn().mockResolvedValue({ ...ok("{}"), status: 500 });
    const requests: RequestDefinition[] = ["a", "b"].map((name) => ({
      id: name,
      name,
      protocol: "rest" as const,
      method: "GET" as const,
      url: `https://api.test/${name}`,
      headers: {},
      query: {},
      body: null,
      variables: null,
      auth: { type: "none" as const },
      assertions: [assertion({})],
    }));

    const run = await runCollection(collection(requests), transport, {
      stopOnFailure: true,
      now: () => 0,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(run.results).toHaveLength(1);
  });

  it("records a transport failure without aborting the run", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("boom"));
    const run = await runCollection(
      collection([
        {
          id: "r1",
          name: "Fails",
          protocol: "rest",
          method: "GET",
          url: "https://api.test/a",
          headers: {},
          query: {},
          body: null,
          variables: null,
          auth: { type: "none" },
          assertions: [],
        },
      ]),
      transport,
      { now: () => 0 },
    );
    expect(run.results[0]?.error).toBe("boom");
  });

  it("aggregates assertion statistics", async () => {
    const transport = vi.fn().mockResolvedValue(ok('{"ok":true}'));
    const run = await runCollection(
      collection([
        {
          id: "r1",
          name: "One",
          protocol: "rest",
          method: "GET",
          url: "https://api.test/a",
          headers: {},
          query: {},
          body: null,
          variables: null,
          auth: { type: "none" },
          assertions: [assertion({}), assertion({ id: "b", expected: "500" })],
        },
      ]),
      transport,
      { now: () => 0 },
    );

    const stats = runStats(run);
    expect(stats.assertionsPassed).toBe(1);
    expect(stats.assertionsFailed).toBe(1);
  });
});

describe("collectionFromSpec", () => {
  it("turns every operation into a runnable request", () => {
    const collection = collectionFromSpec(petstore(), { workspaceId: "ws", specId: "spec" });
    expect(collection.requests).toHaveLength(3);

    const byId = collection.requests.find((request) => request.url.includes("{{petId}}"));
    expect(byId).toBeDefined();
    expect(byId?.method).toBe("GET");

    const create = collection.requests.find((request) => request.method === "POST");
    expect(create?.body).toContain("name");
  });

  it("lists the variables the environment must provide", () => {
    const collection = collectionFromSpec(petstore(), { workspaceId: "ws", specId: null });
    expect(requiredVariablesFor(collection)).toEqual(
      expect.arrayContaining(["accessToken", "petId"]),
    );
  });
});
