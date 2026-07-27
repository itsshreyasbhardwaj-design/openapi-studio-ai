import type { Assertion, AssertionResult } from "@/lib/domain/types";
import { readJsonPath, stringifyForDisplay } from "./interpolate";

export interface ResponseSnapshot {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly durationMs: number;
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function compare(
  operator: Assertion["operator"],
  actual: unknown,
  expected: string,
): { passed: boolean; reason: string } {
  const actualText =
    actual === undefined ? "" : typeof actual === "string" ? actual : stringifyForDisplay(actual);

  switch (operator) {
    case "equals": {
      // Numeric and boolean comparisons are compared by value, not text.
      const numeric = Number(expected);
      if (typeof actual === "number" && !Number.isNaN(numeric)) {
        return { passed: actual === numeric, reason: `expected ${numeric}` };
      }
      if (typeof actual === "boolean") {
        return { passed: String(actual) === expected, reason: `expected ${expected}` };
      }
      return { passed: actualText === expected, reason: `expected "${expected}"` };
    }
    case "notEquals":
      return {
        passed: actualText !== expected,
        reason: `expected anything other than "${expected}"`,
      };
    case "contains":
      return { passed: actualText.includes(expected), reason: `expected to contain "${expected}"` };
    case "matches": {
      try {
        return {
          passed: new RegExp(expected).test(actualText),
          reason: `expected to match /${expected}/`,
        };
      } catch {
        return { passed: false, reason: `"${expected}" is not a valid regular expression` };
      }
    }
    case "lessThan": {
      const value = Number(actualText);
      return {
        passed: Number.isFinite(value) && value < Number(expected),
        reason: `expected < ${expected}`,
      };
    }
    case "greaterThan": {
      const value = Number(actualText);
      return {
        passed: Number.isFinite(value) && value > Number(expected),
        reason: `expected > ${expected}`,
      };
    }
    case "exists":
      return {
        passed: actual !== undefined && actual !== null,
        reason: "expected the value to be present",
      };
    default:
      return { passed: false, reason: "unsupported operator" };
  }
}

/**
 * Evaluate a single assertion against a response snapshot.
 *
 * Assertions are pure and synchronous, which lets the UI re-evaluate them
 * against a stored response without replaying the request.
 */
export function evaluateAssertion(
  assertion: Assertion,
  response: ResponseSnapshot,
): AssertionResult {
  let actual: unknown;

  switch (assertion.kind) {
    case "status":
      actual = response.status;
      break;
    case "statusRange":
      actual = `${Math.floor(response.status / 100)}xx`;
      break;
    case "responseTime":
      actual = response.durationMs;
      break;
    case "header": {
      const wanted = assertion.target.toLowerCase();
      const found = Object.entries(response.headers).find(([key]) => key.toLowerCase() === wanted);
      actual = found?.[1];
      break;
    }
    case "bodyContains":
      actual = response.body;
      break;
    case "jsonPath":
      actual = readJsonPath(parseJsonBody(response.body), assertion.target);
      break;
    case "schema": {
      const parsed = parseJsonBody(response.body);
      actual = parsed === undefined ? undefined : typeofJson(parsed);
      break;
    }
    default:
      actual = undefined;
  }

  const { passed, reason } = compare(assertion.operator, actual, assertion.expected);
  const label = describeTarget(assertion);
  return {
    assertionId: assertion.id,
    kind: assertion.kind,
    passed,
    actual: stringifyForDisplay(actual),
    expected: assertion.expected,
    message: passed
      ? `${label} ${reason} ✓`
      : `${label} ${reason}, received ${stringifyForDisplay(actual)}`,
  };
}

function typeofJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function describeTarget(assertion: Assertion): string {
  switch (assertion.kind) {
    case "status":
      return "Status";
    case "statusRange":
      return "Status class";
    case "responseTime":
      return "Response time (ms)";
    case "header":
      return `Header "${assertion.target}"`;
    case "bodyContains":
      return "Body";
    case "jsonPath":
      return `Body path "${assertion.target}"`;
    case "schema":
      return "Body type";
    default:
      return assertion.target || "Value";
  }
}

export function evaluateAssertions(
  assertions: readonly Assertion[],
  response: ResponseSnapshot,
): AssertionResult[] {
  return assertions.map((assertion) => evaluateAssertion(assertion, response));
}

/** Default assertion set proposed for a newly imported operation. */
export function defaultAssertions(successStatus: number): Assertion[] {
  return [
    {
      id: "status",
      kind: "status",
      target: "",
      operator: "equals",
      expected: String(successStatus),
    },
    { id: "speed", kind: "responseTime", target: "", operator: "lessThan", expected: "2000" },
    {
      id: "content-type",
      kind: "header",
      target: "content-type",
      operator: "contains",
      expected: "application/json",
    },
  ];
}
