import { SdkView } from "@/components/studio/sdk-view";

export const dynamic = "force-dynamic";

export default async function SdkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SdkView specId={id} />;
}
