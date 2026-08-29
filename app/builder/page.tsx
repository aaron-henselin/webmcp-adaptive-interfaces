"use client";

import { useState } from "react";
import DemoSwitcher, { type WebMcpStatus } from "../demo-switcher";
import WorkspacePage from "../workspace-page";

export default function BuilderDemoPage() {
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  return <div className="demo-host builder-demo-host">
    <DemoSwitcher active="builder" status={webMcpStatus} />
    <WorkspacePage onWebMcpStatusChange={setWebMcpStatus} />
  </div>;
}
