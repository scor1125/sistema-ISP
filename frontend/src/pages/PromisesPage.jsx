import { PageHeader } from "@/components/Common";
import PromisesPanel from "@/components/PromisesPanel";

export default function PromisesPage() {
  return (
    <div>
      <PageHeader
        title="Promesas de pagos"
        subtitle="Compromisos de pago acordados con el cliente. Prórrogas, seguimiento y estado (activas / vencidas)."
      />
      <PromisesPanel />
    </div>
  );
}
