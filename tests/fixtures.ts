import { parseSpec } from "@/lib/core/openapi/document";
import type { OpenApiDocument } from "@/lib/core/openapi/types";

/** A small but fully-formed document used across the suites. */
export const PETSTORE_YAML = `openapi: 3.1.0
info:
  title: Petstore
  version: 1.2.0
  description: A tiny pet store API.
  contact:
    email: api@example.com
  license:
    name: MIT
servers:
  - url: https://api.example.com/v1
    description: Production
security:
  - bearerAuth: []
tags:
  - name: Pets
    description: Everything about pets.
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      description: Returns a page of pets.
      tags: [Pets]
      parameters:
        - name: limit
          in: query
          description: Page size.
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
      responses:
        "200":
          description: A page of pets.
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
                      $ref: "#/components/schemas/Pet"
              example:
                data: []
        "400":
          description: Invalid request.
        "429":
          description: Too many requests.
        "500":
          description: Server error.
    post:
      operationId: createPet
      summary: Create a pet
      description: Adds a pet to the store.
      tags: [Pets]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [name]
              properties:
                name:
                  type: string
                  description: The pet's name.
                  maxLength: 80
            example:
              name: Rex
      responses:
        "201":
          description: The created pet.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Pet"
        "400":
          description: Invalid request.
        "429":
          description: Too many requests.
        "500":
          description: Server error.
  /pets/{petId}:
    get:
      operationId: getPet
      summary: Retrieve a pet
      description: Returns a single pet.
      tags: [Pets]
      parameters:
        - name: petId
          in: path
          required: true
          description: Pet identifier.
          schema:
            type: string
            maxLength: 64
      responses:
        "200":
          description: The pet.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Pet"
              example:
                id: pet_1
                name: Rex
                status: available
        "404":
          description: Not found.
        "429":
          description: Too many requests.
        "500":
          description: Server error.
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: A JWT access token.
  schemas:
    Pet:
      type: object
      description: A pet in the store.
      additionalProperties: false
      required: [id, name]
      properties:
        id:
          type: string
          description: Unique identifier.
          maxLength: 64
        name:
          type: string
          description: Display name.
          maxLength: 80
        status:
          type: string
          description: Availability.
          enum: [available, pending, sold]
`;

export function petstore(): OpenApiDocument {
  const parsed = parseSpec(PETSTORE_YAML);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.error.message}`);
  return parsed.value.document;
}

/** A deliberately broken document used to exercise the validator. */
export const BROKEN_YAML = `openapi: 3.1.0
info:
  title: Broken
paths:
  pets:
    get:
      responses: {}
  /orders/{orderId}:
    get:
      operationId: dup
      responses:
        "999":
          description: Nope
    post:
      operationId: dup
      responses:
        "200": {}
`;

export function broken(): OpenApiDocument {
  const parsed = parseSpec(BROKEN_YAML);
  if (!parsed.ok) throw new Error("fixture failed to parse");
  return parsed.value.document;
}
