import { Suspense } from "react";
import { ClientsView } from "@/components/app/clients-view";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientsView />
    </Suspense>
  );
}
