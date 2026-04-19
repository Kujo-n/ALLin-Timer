import { JoinClient } from "./join-client";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ tid: string }>;
}) {
  const { tid } = await params;
  return <JoinClient tid={tid} />;
}
