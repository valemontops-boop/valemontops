import { Suspense } from "react";
import { CrmView } from "@/components/app/crm-view";

export default function CrmPage() {
  return (
    <Suspense fallback={null}>
      <CrmView />
    </Suspense>
  );
}
