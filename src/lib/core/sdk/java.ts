import {
  operationDoc,
  renderPath,
  toCamel,
  toPascal,
  type GeneratedFile,
  type GeneratedSdk,
  type SdkOperation,
  type SdkSpec,
  type TypeRef,
} from "./model";

function javaType(ref: TypeRef): string {
  switch (ref.kind) {
    case "primitive":
      switch (ref.name) {
        case "integer":
          return "Long";
        case "number":
          return "Double";
        case "boolean":
          return "Boolean";
        case "datetime":
          return "OffsetDateTime";
        case "any":
          return "Object";
        default:
          return "String";
      }
    case "array":
      return `List<${javaType(ref.items)}>`;
    case "map":
      return `Map<String, ${javaType(ref.values)}>`;
    case "model":
      return ref.name;
    case "enum":
      return "String";
    case "void":
      return "Void";
  }
}

function modelFiles(spec: SdkSpec, packagePath: string, packageName: string): GeneratedFile[] {
  return spec.models.map((model) => {
    if (model.enumValues.length > 0 && model.properties.length === 0) {
      const constants = model.enumValues
        .map((value) => `  ${toPascal(value).toUpperCase()}(${JSON.stringify(value)})`)
        .join(",\n");
      return {
        path: `${packagePath}/model/${model.name}.java`,
        contents: `package ${packageName}.model;

/** ${model.description ?? model.name} */
public enum ${model.name} {
${constants};

  private final String value;

  ${model.name}(String value) {
    this.value = value;
  }

  public String getValue() {
    return value;
  }
}
`,
      };
    }

    const components = model.properties
      .map(
        (property) =>
          `    @JsonProperty(${JSON.stringify(property.wireName)}) ${javaType(property.type)} ${toCamel(property.name)}`,
      )
      .join(",\n");
    const accessors = model.properties
      .map(
        (property) =>
          `  /** ${property.description ?? property.wireName} */\n  public ${javaType(property.type)} ${toCamel(property.name)}() {\n    return ${toCamel(property.name)};\n  }`,
      )
      .join("\n\n");

    return {
      path: `${packagePath}/model/${model.name}.java`,
      contents: `package ${packageName}.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/** ${model.description ?? `${model.name} generated from the API specification.`} */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ${model.name}(
${components || '    @JsonProperty("_") String placeholder'}
) {
${accessors ? `\n${accessors}\n` : ""}}
`,
    };
  });
}

function authApplication(spec: SdkSpec): string {
  const lines: string[] = [];
  for (const auth of spec.auth) {
    switch (auth.kind) {
      case "bearer":
      case "oauth2":
        lines.push(
          "    if (config.accessToken() != null && !config.accessToken().isBlank()) {",
          '      builder.header("Authorization", "Bearer " + config.accessToken());',
          "    }",
        );
        break;
      case "basic":
        lines.push(
          "    if (config.username() != null) {",
          '      String raw = config.username() + ":" + (config.password() == null ? "" : config.password());',
          '      builder.header("Authorization", "Basic " + Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8)));',
          "    }",
        );
        break;
      case "apiKeyHeader":
        lines.push(
          "    if (config.apiKey() != null && !config.apiKey().isBlank()) {",
          `      builder.header(${JSON.stringify(auth.parameterName ?? "X-API-Key")}, config.apiKey());`,
          "    }",
        );
        break;
      default:
        break;
    }
  }
  return lines.join("\n") || "    // This API declares no security schemes.";
}

function methodFor(operation: SdkOperation): string {
  const args = [
    ...operation.pathParams.map(
      (parameter) => `${javaType(parameter.type)} ${toCamel(parameter.name)}`,
    ),
    ...(operation.requestBody ? ["Object body"] : []),
    ...operation.queryParams.map(
      (parameter) => `${javaType(parameter.type)} ${toCamel(parameter.name)}`,
    ),
  ];

  const path = renderPath(operation, (parameter) => `" + encode(${toCamel(parameter.name)}) + "`);
  const querySetters = operation.queryParams
    .map(
      (parameter) =>
        `    if (${toCamel(parameter.name)} != null) query.put(${JSON.stringify(parameter.wireName)}, String.valueOf(${toCamel(parameter.name)}));`,
    )
    .join("\n");

  const doc = ["  /**", ...operationDoc(operation).map((line) => `   * ${line}`), "   */"].join(
    "\n",
  );

  return `${doc}
  public Object ${toCamel(operation.methodName)}(${args.join(", ")}) throws ApiException, IOException, InterruptedException {
    Map<String, String> query = new LinkedHashMap<>();
${querySetters}
    return request(${JSON.stringify(operation.httpMethod)}, "${path}", query, ${operation.requestBody ? "body" : "null"});
  }`;
}

function clientFile(spec: SdkSpec, packageName: string): string {
  return `package ${packageName};

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Client for ${spec.title}.
 *
 * <p>${spec.description}</p>
 *
 * <pre>{@code
 * var client = new ${spec.namespace}Client(${spec.namespace}Config.builder().build());
 * }</pre>
 *
 * <p>Generated by OpenAPI Studio AI — do not edit by hand.</p>
 */
public class ${spec.namespace}Client {

  private final ${spec.namespace}Config config;
  private final HttpClient httpClient;
  private final ObjectMapper mapper = new ObjectMapper();

  public ${spec.namespace}Client(${spec.namespace}Config config) {
    this.config = config;
    this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  }

  private static String encode(Object value) {
    return URLEncoder.encode(String.valueOf(value), StandardCharsets.UTF_8);
  }

  private void authenticate(HttpRequest.Builder builder) {
${authApplication(spec)}
  }

  protected Object request(String method, String path, Map<String, String> query, Object body)
      throws ApiException, IOException, InterruptedException {
    String queryString =
        query.isEmpty()
            ? ""
            : "?"
                + query.entrySet().stream()
                    .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                    .collect(Collectors.joining("&"));

    HttpRequest.Builder builder =
        HttpRequest.newBuilder()
            .uri(URI.create(config.baseUrl() + path + queryString))
            .timeout(Duration.ofMillis(config.timeoutMillis()))
            .header("Accept", "application/json");

    if (body == null) {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    }
    authenticate(builder);

    IOException lastError = null;
    for (int attempt = 0; attempt <= config.maxRetries(); attempt++) {
      try {
        HttpResponse<String> response =
            httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() >= 400) {
          ApiException error =
              new ApiException(
                  response.statusCode(),
                  response.body(),
                  response.headers().firstValue("x-request-id").orElse(null));
          if (error.isRetryable() && attempt < config.maxRetries()) {
            Thread.sleep((long) Math.pow(2, attempt) * 250L);
            continue;
          }
          throw error;
        }

        if (response.statusCode() == 204 || response.body().isEmpty()) {
          return null;
        }
        return mapper.readValue(response.body(), Object.class);
      } catch (IOException exception) {
        lastError = exception;
        if (attempt == config.maxRetries()) {
          break;
        }
        Thread.sleep((long) Math.pow(2, attempt) * 250L);
      }
    }
    throw lastError == null ? new IOException("Request failed") : lastError;
  }

${spec.operations.map((operation) => methodFor(operation)).join("\n\n")}
}
`;
}

function configFile(spec: SdkSpec, packageName: string): string {
  const authFields = new Set<string>();
  for (const auth of spec.auth) {
    if (auth.kind === "bearer" || auth.kind === "oauth2") authFields.add("accessToken");
    if (auth.kind === "basic") {
      authFields.add("username");
      authFields.add("password");
    }
    if (auth.kind === "apiKeyHeader" || auth.kind === "apiKeyQuery") authFields.add("apiKey");
  }
  const fields = [...authFields];

  return `package ${packageName};

/** Immutable configuration for {@link ${spec.namespace}Client}. */
public record ${spec.namespace}Config(
    String baseUrl,
    long timeoutMillis,
    int maxRetries${fields.length > 0 ? `,\n    ${fields.map((field) => `String ${field}`).join(",\n    ")}` : ""}) {

  public static Builder builder() {
    return new Builder();
  }

  /** Fluent builder with production-ready defaults. */
  public static final class Builder {
    private String baseUrl = ${JSON.stringify(spec.baseUrl)};
    private long timeoutMillis = 30_000L;
    private int maxRetries = 2;
${fields.map((field) => `    private String ${field};`).join("\n")}

    public Builder baseUrl(String value) {
      this.baseUrl = value;
      return this;
    }

    public Builder timeoutMillis(long value) {
      this.timeoutMillis = value;
      return this;
    }

    public Builder maxRetries(int value) {
      this.maxRetries = value;
      return this;
    }

${fields
  .map(
    (field) => `    public Builder ${field}(String value) {
      this.${field} = value;
      return this;
    }`,
  )
  .join("\n\n")}

    public ${spec.namespace}Config build() {
      return new ${spec.namespace}Config(baseUrl, timeoutMillis, maxRetries${fields.length > 0 ? `, ${fields.join(", ")}` : ""});
    }
  }
}
`;
}

export function generateJava(spec: SdkSpec): GeneratedSdk {
  const artifact = spec.packageName;
  const packageName = `com.example.${spec.packageName.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  const packagePath = `src/main/java/${packageName.replace(/\./g, "/")}`;
  const first = spec.operations[0];

  const files: GeneratedFile[] = [
    {
      path: `${packagePath}/${spec.namespace}Client.java`,
      contents: clientFile(spec, packageName),
    },
    {
      path: `${packagePath}/${spec.namespace}Config.java`,
      contents: configFile(spec, packageName),
    },
    {
      path: `${packagePath}/ApiException.java`,
      contents: `package ${packageName};

/** Thrown for any non-2xx response. */
public class ApiException extends Exception {

  private final int statusCode;
  private final String body;
  private final String requestId;

  public ApiException(int statusCode, String body, String requestId) {
    super("HTTP " + statusCode);
    this.statusCode = statusCode;
    this.body = body;
    this.requestId = requestId;
  }

  public int getStatusCode() {
    return statusCode;
  }

  public String getBody() {
    return body;
  }

  public String getRequestId() {
    return requestId;
  }

  /** @return true when retrying the request could succeed. */
  public boolean isRetryable() {
    return statusCode == 429 || statusCode >= 500;
  }
}
`,
    },
    ...modelFiles(spec, packagePath, packageName),
    {
      path: "pom.xml",
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>${artifact}</artifactId>
  <version>${spec.version}</version>
  <name>${spec.title} SDK</name>
  <description>${spec.description}</description>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>2.17.2</version>
    </dependency>
  </dependencies>
</project>
`,
    },
    {
      path: "README.md",
      contents: `# ${spec.title} — Java SDK

${spec.description}

Generated by OpenAPI Studio AI from \`${spec.title}\` v${spec.version}. Requires Java 17+.

\`\`\`xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>${artifact}</artifactId>
  <version>${spec.version}</version>
</dependency>
\`\`\`

\`\`\`java
var config = ${spec.namespace}Config.builder().baseUrl("${spec.baseUrl}").build();
var client = new ${spec.namespace}Client(config);

try {
  Object result = client.${first ? toCamel(first.methodName) : "call"}(${first?.pathParams.map(() => '"123"').join(", ") ?? ""});
  System.out.println(result);
} catch (ApiException error) {
  System.err.printf("%d %s%n", error.getStatusCode(), error.getBody());
}
\`\`\`
`,
    },
  ];

  return {
    language: "java",
    files,
    entryPoint: `${packagePath}/${spec.namespace}Client.java`,
    installCommand: `mvn install`,
  };
}
