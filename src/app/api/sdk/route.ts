import { z } from "zod";
import { parseSpec } from "@/lib/core/openapi/document";
import { generateSdk, sdkSizeBytes, SDK_LANGUAGES } from "@/lib/core/sdk";
import type { SdkLanguage } from "@/lib/core/sdk/model";
import { ApiError, jsonResponse, readJson, route } from "@/lib/server/http";
import { SpecService } from "@/lib/services/spec-service";

const LANGUAGES = SDK_LANGUAGES.map((language) => language.id) as [SdkLanguage, ...SdkLanguage[]];

const schema = z.object({
  source: z.string().optional(),
  specId: z.string().optional(),
  versionId: z.string().optional(),
  language: z.enum(LANGUAGES),
  packageName: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Package names are lower-case, hyphen separated.")
    .optional(),
});

/** Generate a production-ready SDK for one language. */
export const POST = route(
  async ({ request, identity, log }) => {
    const body = await readJson(request, schema);

    const source = body.source
      ? body.source
      : body.specId
        ? (await SpecService.sourceFor(identity, body.specId, body.versionId)).source
        : null;
    if (!source) throw ApiError.badRequest("Supply either `source` or `specId`.");

    const parsed = parseSpec(source);
    if (!parsed.ok)
      throw ApiError.badRequest(`The specification could not be parsed: ${parsed.error.message}`);

    const sdk = generateSdk(
      parsed.value.document,
      body.language,
      body.packageName ? { packageName: body.packageName } : {},
    );
    log.info("sdk.generated", { language: body.language, files: sdk.files.length });

    return jsonResponse({
      language: sdk.language,
      entryPoint: sdk.entryPoint,
      installCommand: sdk.installCommand,
      sizeBytes: sdkSizeBytes(sdk),
      files: sdk.files,
    });
  },
  { scope: "sdk", limit: 60 },
);

/** The catalogue of supported target languages. */
export const GET = route(async () => jsonResponse({ languages: SDK_LANGUAGES }));
