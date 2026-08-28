import CatalogPage from "./catalog-page";
import DemoSwitcher from "./demo-switcher";

export default function ReportsDemoPage() {
  return <div className="demo-host">
    <DemoSwitcher active="reports" />
    <CatalogPage />
  </div>;
}
