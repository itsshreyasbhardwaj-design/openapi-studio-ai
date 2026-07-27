import type { OpenApiDocument } from "@/lib/core/openapi/types";
import { buildSdkSpec, type GeneratedSdk, type SdkLanguage, type SdkSpec } from "./model";
import { generateTypeScript } from "./typescript";
import { generateJavaScript } from "./javascript";
import { generatePython } from "./python";
import { generateGo } from "./go";
import { generateJava } from "./java";
import { generateCSharp } from "./csharp";
import { generatePhp } from "./php";

export * from "./model";

const GENERATORS: Record<SdkLanguage, (spec: SdkSpec) => GeneratedSdk> = {
  typescript: generateTypeScript,
  javascript: generateJavaScript,
  python: generatePython,
  go: generateGo,
  java: generateJava,
  csharp: generateCSharp,
  php: generatePhp,
};

export interface GenerateOptions {
  readonly packageName?: string;
}

/** Generate an SDK for one language from an OpenAPI document. */
export function generateSdk(
  document: OpenApiDocument,
  language: SdkLanguage,
  options: GenerateOptions = {},
): GeneratedSdk {
  const spec = buildSdkSpec(document, options);
  const generator = GENERATORS[language];
  return generator(spec);
}

/** Generate every supported SDK in one pass (shared IR, so this is cheap). */
export function generateAllSdks(
  document: OpenApiDocument,
  options: GenerateOptions = {},
): GeneratedSdk[] {
  const spec = buildSdkSpec(document, options);
  return Object.values(GENERATORS).map((generator) => generator(spec));
}

/** Total size of a generated SDK, shown in the UI next to the download button. */
export function sdkSizeBytes(sdk: GeneratedSdk): number {
  return sdk.files.reduce((total, file) => total + Buffer.byteLength(file.contents, "utf8"), 0);
}
