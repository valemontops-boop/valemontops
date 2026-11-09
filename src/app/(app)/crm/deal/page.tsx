import { Suspense } from "react";
import { DealView } from "@/components/app/deal-view";

export default function DealPage() {
  return (
    <Suspense fallback={null}>
      <DealView />
    </Suspense>
  );
}
