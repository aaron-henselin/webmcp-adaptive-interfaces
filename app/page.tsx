"use client";

import { useState } from "react";
import CatalogPage from "./catalog-page";
import DemoSwitcher, { type WebMcpStatus } from "./demo-switcher";

export default function ReportsDemoPage() {
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  return <div className="demo-host">
    <DemoSwitcher active="reports" status={webMcpStatus} />
    <CatalogPage onWebMcpStatusChange={setWebMcpStatus} />
  </div>;
}
