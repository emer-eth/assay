import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { paymentView } from "@/lib/live/intents-pay";
import { load } from "@/lib/live/store";
import { PayView } from "./pay-view";

export const metadata: Metadata = { title: "Pay with NEAR Intents", robots: { index: false } };

export default function Page({ params }: PageProps<"/pay/[id]">) {
  return (
    <Suspense fallback={<main id="main" className="min-h-[60vh]" />}>
      <Payment params={params} />
    </Suspense>
  );
}

async function Payment({ params }: { params: PageProps<"/pay/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const p = load().intentPayments.find((x) => x.id === id);
  if (!p) notFound();
  return <PayView initial={paymentView(p)} />;
}
