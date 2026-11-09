import { Suspense } from "react";
import { MarketingView } from "@/components/app/marketing-view";

export default function Page() {
  // Growth reads ?channel=&view=&tab= (drawer state, D077): useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <MarketingView />
    </Suspense>
  );
}
