import { describe, expect, it } from "vitest";
import {
  buildSdkSpec,
  generateAllSdks,
  generateSdk,
  sdkSizeBytes,
  toCamel,
  toPascal,
  toSnake,
} from "@/lib/core/sdk";
import { SDK_LANGUAGES } from "@/lib/core/sdk/model";
import { cloneDocument } from "@/lib/core/openapi/document";
import { petstore } from "../fixtures";

describe("buildSdkSpec", () => {
  it("derives an intermediate model from the document", () => {
    const spec = buildSdkSpec(petstore());
    expect(spec.title).toBe("Petstore");
    expect(spec.packageName).toBe("petstore");
    expect(spec.namespace).toBe("Petstore");
    expect(spec.version).toBe("1.2.0");
    expect(spec.baseUrl).toBe("https://api.example.com/v1");
    expect(spec.operations.map((operation) => operation.id)).toEqual([
      "listPets",
      "createPet",
      "getPet",
    ]);
    expect(spec.models.map((model) => model.name)).toContain("Pet");
  });

  it("marks required properties and resolves references", () => {
    const pet = buildSdkSpec(petstore()).models.find((model) => model.name === "Pet");
    expect(pet?.properties.find((property) => property.name === "id")?.required).toBe(true);
    expect(pet?.properties.find((property) => property.name === "status")?.required).toBe(false);
  });

  it("recognises the security scheme", () => {
    const spec = buildSdkSpec(petstore());
    expect(spec.auth[0]?.kind).toBe("bearer");
  });

  it("detects pagination style from parameter names", () => {
    const document = cloneDocument(petstore());
    document.paths!["/pets"]!.get!.parameters = [
      { name: "cursor", in: "query", schema: { type: "string" } },
    ];
    const spec = buildSdkSpec(document);
    expect(spec.operations.find((operation) => operation.id === "listPets")?.pagination).toBe(
      "cursor",
    );
  });

  it("honours an explicit package name", () => {
    expect(buildSdkSpec(petstore(), { packageName: "my-client" }).packageName).toBe("my-client");
  });
});

describe("naming helpers", () => {
  it("converts between cases", () => {
    expect(toCamel("list-pets by id")).toBe("listPetsById");
    expect(toPascal("list_pets")).toBe("ListPets");
    expect(toSnake("listPetsByID")).toBe("list_pets_by_id");
  });

  it("avoids emitting reserved words", () => {
    expect(toCamel("class")).toBe("classValue");
    expect(toCamel("func")).toBe("funcValue");
  });
});

describe("generateSdk", () => {
  it("emits every supported language", () => {
    const generated = generateAllSdks(petstore());
    expect(generated.map((sdk) => sdk.language).sort()).toEqual(
      SDK_LANGUAGES.map((language) => language.id).sort(),
    );
    for (const sdk of generated) {
      expect(sdk.files.length).toBeGreaterThan(2);
      expect(sdkSizeBytes(sdk)).toBeGreaterThan(500);
      expect(sdk.files.some((file) => file.path === "README.md")).toBe(true);
      expect(sdk.installCommand).toBeTruthy();
      for (const file of sdk.files) expect(file.contents.length).toBeGreaterThan(0);
    }
  });

  it("generates a TypeScript client with typed models and a method per operation", () => {
    const sdk = generateSdk(petstore(), "typescript");
    const client = sdk.files.find((file) => file.path === "src/client.ts")!.contents;
    const models = sdk.files.find((file) => file.path === "src/models.ts")!.contents;

    expect(models).toContain("export interface Pet {");
    expect(models).toContain("id: string;");
    expect(models).toContain("status?:");
    expect(client).toContain("export class PetstoreClient");
    expect(client).toContain("async listPets(");
    expect(client).toContain("async createPet(");
    expect(client).toContain("async getPet(");
    expect(client).toContain("export class ApiError");
    expect(client).toContain("Bearer ${token}");
    expect(client).toContain("maxRetries");
  });

  it("generates a Python client with dataclasses", () => {
    const sdk = generateSdk(petstore(), "python");
    const client = sdk.files.find((file) => file.path.endsWith("client.py"))!.contents;
    const models = sdk.files.find((file) => file.path.endsWith("models.py"))!.contents;

    expect(models).toContain("@dataclass");
    expect(models).toContain("class Pet:");
    expect(client).toContain("class PetstoreClient:");
    expect(client).toContain("def list_pets(");
    expect(client).toContain("class ApiError(Exception):");
    expect(sdk.files.some((file) => file.path === "pyproject.toml")).toBe(true);
  });

  it("generates a Go client with struct tags", () => {
    const sdk = generateSdk(petstore(), "go");
    const models = sdk.files.find((file) => file.path.endsWith("models.go"))!.contents;
    const client = sdk.files.find((file) => file.path.endsWith("client.go"))!.contents;

    expect(models).toContain("type Pet struct {");
    expect(models).toContain('json:"id"');
    expect(models).toContain('json:"status,omitempty"');
    expect(client).toContain("func (c *Client) ListPets(");
    expect(client).toContain("type APIError struct");
    expect(sdk.files.some((file) => file.path === "go.mod")).toBe(true);
  });

  it("generates a Java client with records and a config builder", () => {
    const sdk = generateSdk(petstore(), "java");
    expect(sdk.files.some((file) => file.path.endsWith("PetstoreClient.java"))).toBe(true);
    expect(sdk.files.some((file) => file.path.endsWith("PetstoreConfig.java"))).toBe(true);
    expect(sdk.files.some((file) => file.path.endsWith("ApiException.java"))).toBe(true);
    expect(sdk.files.some((file) => file.path === "pom.xml")).toBe(true);

    const client = sdk.files.find((file) => file.path.endsWith("PetstoreClient.java"))!.contents;
    expect(client).toContain("public Object listPets(");
  });

  it("generates a C# client targeting .NET 8", () => {
    const sdk = generateSdk(petstore(), "csharp");
    const client = sdk.files.find((file) => file.path.endsWith("Client.cs"))!.contents;
    expect(client).toContain("public sealed class PetstoreClient");
    expect(client).toContain("public Task<JsonElement?> ListPetsAsync(");
    expect(sdk.files.some((file) => file.path.endsWith(".csproj"))).toBe(true);
  });

  it("generates a PHP client with PSR-4 autoloading", () => {
    const sdk = generateSdk(petstore(), "php");
    const client = sdk.files.find((file) => file.path.endsWith("Client.php"))!.contents;
    expect(client).toContain("declare(strict_types=1);");
    expect(client).toContain("public function listPets(");
    const composer = sdk.files.find((file) => file.path === "composer.json")!.contents;
    expect(JSON.parse(composer)).toMatchObject({ type: "library", license: "MIT" });
  });

  it("generates a JavaScript client with JSDoc typedefs", () => {
    const sdk = generateSdk(petstore(), "javascript");
    const models = sdk.files.find((file) => file.path === "src/models.js")!.contents;
    const client = sdk.files.find((file) => file.path === "src/client.js")!.contents;

    expect(models).toContain("@typedef {Object} Pet");
    expect(client).toContain("export class PetstoreClient");
    expect(client).toContain("async listPets(");
    // The JavaScript output must not leak TypeScript syntax.
    expect(client).not.toContain(": Promise<");
    expect(client).not.toContain("interface ");
  });

  it("produces valid JSON manifests", () => {
    const typescript = generateSdk(petstore(), "typescript");
    const packageJson = typescript.files.find((file) => file.path === "package.json")!.contents;
    expect(() => JSON.parse(packageJson)).not.toThrow();
    expect(JSON.parse(packageJson)).toMatchObject({ name: "petstore", version: "1.2.0" });
  });

  it("handles a document with no operations without crashing", () => {
    for (const language of SDK_LANGUAGES) {
      const sdk = generateSdk(
        { openapi: "3.1.0", info: { title: "Empty", version: "1.0.0" } },
        language.id,
      );
      expect(sdk.files.length).toBeGreaterThan(0);
    }
  });
});
